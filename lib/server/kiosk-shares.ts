import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'
import { boardSchema, type Board } from '../labs/model'
import { normalizeTheme, type ThemeType } from '../themes'
import { withFileLease } from './file-lease'

const directory = () => path.join(process.cwd(), 'data', 'kiosk-shares')
const derive = promisify(scrypt)
export const opaqueToken = () => randomBytes(32).toString('base64url')
export const validToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value)
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export class ShareError extends Error { constructor(message: string, public status = 400) { super(message) } }
export type ShareRecord = {
  version: 1; id: string; owner: string; sourceId: string; sourceBinding: string; revision: string
  board: Board; theme: ThemeType; mode: 'light' | 'dark'; createdAt: string; updatedAt: string
  password: { salt: string; hash: string } | null; accessSecret: string; attempts: { start: number; count: number }
}
export const publishSchema = z.object({
  board: boardSchema, theme: z.record(z.string().max(40), z.string().max(100)), mode: z.enum(['light', 'dark']),
  access: z.enum(['public', 'password']), password: z.string().max(128).optional(),
})
export type PublishInput = z.infer<typeof publishSchema>
export function sourceBinding(source: { id: string; protocol: string; host: string; port: number; username: string }) {
  return digest(JSON.stringify([source.id, source.protocol, source.host.toLowerCase(), source.port, source.username]))
}
const fileFor = (id: string) => { if (!validToken(id)) throw new ShareError('Shared kiosk not found.', 404); return path.join(directory(), `${id}.json`) }
export async function readShare(id: string): Promise<ShareRecord | null> {
  const file = fileFor(id)
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as ShareRecord
    if (value.version !== 1 || value.id !== id) throw new Error('Invalid share file')
    return value
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
async function writeShare(record: ShareRecord) {
  const file = fileFor(record.id), temporary = `${file}.${opaqueToken()}.tmp`
  await fs.mkdir(directory(), { recursive: true })
  try { await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, file) }
  finally { await fs.unlink(temporary).catch(() => {}) }
}
export async function listShares(owner: string, sourceId: string) {
  let files: string[]
  try { files = await fs.readdir(directory()) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const records = await Promise.all(files.filter(f => /^[A-Za-z0-9_-]{43}\.json$/.test(f)).map(f => readShare(f.slice(0, -5))))
  return records.filter((r): r is ShareRecord => !!r && r.owner === digest(owner) && r.sourceId === sourceId)
}
async function locked<T>(id: string, work: () => Promise<T>) {
  const result = await withFileLease(`${fileFor(id)}.lock`, 30000, work)
  if (result === null) throw new ShareError('Sharing is busy. Please retry.', 409)
  return result
}
async function passwordHash(password: string) {
  if (password.length < 10 || password.length > 128) throw new ShareError('Use a password of 10 to 128 characters.')
  const salt = randomBytes(16).toString('hex'), hash = await derive(password, salt, 64) as Buffer
  return { salt, hash: hash.toString('hex') }
}
export async function publishShare(owner: string, source: { id: string; binding: string }, input: PublishInput, id?: string) {
  // A global lease also bounds the on-disk collection under concurrent creation.
  const result = await withFileLease(path.join(directory(), 'publish.lock'), 30000, async () => {
    const shareId = id ?? opaqueToken()
    return locked(shareId, async () => {
      const old = id ? await readShare(id) : null
      if (id && (!old || old.owner !== digest(owner) || old.sourceId !== source.id)) throw new ShareError('Shared kiosk not found.', 404)
      if (!old) {
        const count = (await fs.readdir(directory())).filter(f => /^[A-Za-z0-9_-]{43}\.json$/.test(f)).length
        if (count >= 200 || (await listShares(owner, source.id)).length >= 50) throw new ShareError('Sharing limit reached. Revoke an unused link first.', 409)
      }
      const password = input.access === 'public' ? null : input.password ? await passwordHash(input.password) : old?.password
      if (input.access === 'password' && !password) throw new ShareError('Enter a password before publishing.')
      const now = new Date().toISOString()
      const record: ShareRecord = {
        version: 1, id: shareId, owner: digest(owner), sourceId: source.id, sourceBinding: source.binding, revision: opaqueToken(),
        board: input.board, theme: normalizeTheme(input.theme), mode: input.mode, createdAt: old?.createdAt ?? now, updatedAt: now,
        password: password ?? null, accessSecret: old && password === old.password ? old.accessSecret : opaqueToken(), attempts: { start: 0, count: 0 },
      }
      await writeShare(record)
      return record
    })
  })
  if (!result) throw new ShareError('Sharing is busy. Please retry.', 409)
  return result
}
export async function revokeShare(id: string, owner: string, sourceId: string) {
  return locked(id, async () => {
    const record = await readShare(id)
    if (!record || record.owner !== digest(owner) || record.sourceId !== sourceId) throw new ShareError('Shared kiosk not found.', 404)
    await fs.unlink(fileFor(id)); return true
  })
}
const equal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
export function accessTicket(record: ShareRecord, expires = Date.now() + 8 * 60 * 60 * 1000) {
  const value = `${record.id}.${expires}`
  return `${expires}.${createHmac('sha256', record.accessSecret).update(value).digest('base64url')}`
}
export function canView(record: ShareRecord, ticket?: string) {
  if (!record.password) return true
  if (!ticket || !/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(ticket)) return false
  const expires = Number(ticket.split('.')[0])
  return expires > Date.now() && expires <= Date.now() + 8 * 60 * 60 * 1000 && equal(ticket, accessTicket(record, expires))
}
export async function unlockShare(id: string, password: string) {
  return locked(id, async () => {
    const record = await readShare(id)
    if (!record) throw new ShareError('Shared kiosk not found.', 404)
    if (!record.password) return { record, ticket: '' }
    const now = Date.now()
    if (now - record.attempts.start >= 5 * 60 * 1000) record.attempts = { start: now, count: 0 }
    if (record.attempts.count >= 10) throw new ShareError('Too many attempts. Try again in five minutes.', 429)
    record.attempts.count++
    // Persist the attempt before doing the costly password work.
    await writeShare(record)
    const hash = await derive(password, record.password.salt, 64) as Buffer
    if (!equal(hash.toString('hex'), record.password.hash)) throw new ShareError('Incorrect password.', 401)
    record.attempts = { start: 0, count: 0 }; await writeShare(record)
    return { record, ticket: accessTicket(record) }
  })
}
