import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, X509Certificate } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import path from 'node:path'
import { z } from 'zod'
import { ENCRYPTION_KEY, LEGACY_DEFAULT_KEY } from './encryption'
import { withFileLease } from './file-lease'
import { TopologyRequestError } from '../topology/load'

export type VmwareConsoleConnection = { hostname: string; port: number; username: string; password: string; caPem?: string }
export type VmwareManager = { id: string; hostname: string; port: number }
export type SavedVmwareManager = VmwareManager & { username: string; customTrust: boolean; revision: string }
type Stored = SavedVmwareManager & { nonce: string; ciphertext: string; tag: string }

const sourceKeyPattern = /^[0-9a-f]{64}$/
const sourceFolder = (sourceKey: string) => path.join(process.cwd(), 'data', 'vmware-console-connections', sourceKey)
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const connectionFile = (sourceKey: string, hostname: string, port: number) =>
  path.join(sourceFolder(sourceKey), digest(JSON.stringify([hostname, port])) + '.json')
const portSchema = z.number().int().min(1).max(65535)
const secretSchema = z.object({ password: z.string().min(1).max(4096), caPem: z.string().max(65536).optional() })
const storedSchema = z.object({ id: z.string().uuid(), hostname: z.string(), port: portSchema, username: z.string().min(1).max(512),
  customTrust: z.boolean(), revision: z.string().uuid(), nonce: z.string().regex(/^[0-9a-f]{24}$/),
  ciphertext: z.string().regex(/^[0-9a-f]+$/), tag: z.string().regex(/^[0-9a-f]{32}$/) })

/** ManagerModel.name is a DNS name or IP, never a URL supplied by the browser. */
export function vmwareManagerHostname(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.$/, '')
  const ip = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (!ip.includes('%') && isIP(ip) === 6) return new URL('https://[' + ip + ']').hostname.slice(1,-1)
  if (isIP(host) === 4) return host
  if (host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null
  // Reject legacy integer, octal and shorthand IPv4 spellings.
  try { return new URL('https://' + host).hostname === host ? host : null } catch { return null }
}

export function vmwareManager(raw: unknown): VmwareManager | null {
  const parsed = z.object({id:z.string().uuid(), type:z.literal('ViHost'), viHostType:z.enum(['VC','ESXi','ESX']), name:z.string(), port:portSchema}).safeParse(raw)
  if (!parsed.success) return null
  const hostname = vmwareManagerHostname(parsed.data.name)
  return hostname ? {id:parsed.data.id.toLowerCase(), hostname, port:parsed.data.port} : null
}

export function normalizeVmwareCa(value?: string) {
  const pem = value?.trim()
  if (!pem) return undefined
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || []
  try {
    if (!blocks.length || blocks.length > 16 || blocks.join('').replace(/\s/g, '') !== pem.replace(/\s/g, '')) throw new Error()
    return blocks.map(block => new X509Certificate(block).toString().trim()).join('\n')
  } catch { throw new TopologyRequestError('Enter a PEM-encoded VMware CA or server certificate.', 400) }
}

const publicRecord = ({id, hostname, port, username, customTrust, revision}: Stored): SavedVmwareManager =>
  ({id, hostname, port, username, customTrust, revision})
const aad = (sourceKey: string, row: SavedVmwareManager) => Buffer.from(JSON.stringify([sourceKey, row.id, row.hostname, row.port, row.username, row.customTrust, row.revision]))
function vaultKey() {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY === LEGACY_DEFAULT_KEY) throw new TopologyRequestError('Configure a private application encryption key before saving VMware credentials.', 503)
  return scryptSync(ENCRYPTION_KEY, 'open-backup-ui.vmware-console.v1', 32)
}
function read(file: string): Stored | null {
  try { return storedSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new TopologyRequestError('The VMware console connection could not be read.', 500) }
}
export function listVmwareConsoleConnections(sourceKey: string): SavedVmwareManager[] {
  if (!sourceKeyPattern.test(sourceKey)) throw new TopologyRequestError('Select a VBR source.', 400)
  const dir = sourceFolder(sourceKey)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(name => /^[0-9a-f]{64}\.json$/.test(name)).flatMap(name => {
    const row = read(path.join(dir, name))
    return row ? [publicRecord(row)] : []
  })
}

/** Server-only. Exact VBR source and exact vCenter/ESXi manager authority. Never call with an arbitrary browser host. */
export function getVmwareConsoleConnection(sourceKey: string, managerHost: string, port = 443): VmwareConsoleConnection | null {
  const hostname = vmwareManagerHostname(managerHost)
  if (!hostname || !sourceKeyPattern.test(sourceKey) || !portSchema.safeParse(port).success) return null
  const row = read(connectionFile(sourceKey, hostname, port))
  if (!row || row.hostname !== hostname || row.port !== port) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', vaultKey(), Buffer.from(row.nonce, 'hex'))
    decipher.setAAD(aad(sourceKey, row))
    decipher.setAuthTag(Buffer.from(row.tag, 'hex'))
    const plaintext = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'hex')), decipher.final()])
    return { hostname, port, username:row.username, ...secretSchema.parse(JSON.parse(plaintext.toString('utf8'))) }
  } catch { throw new TopologyRequestError('The VMware console connection could not be read.', 500) }
}

export async function writeVmwareConnection(sourceKey: string, manager: VmwareManager, expectedRevision: string | null, connection: VmwareConsoleConnection | null) {
  if (!sourceKeyPattern.test(sourceKey) || vmwareManagerHostname(manager.hostname) !== manager.hostname || !portSchema.safeParse(manager.port).success || !z.string().uuid().safeParse(manager.id).success) throw new TopologyRequestError('Invalid VMware manager.', 400)
  const file = connectionFile(sourceKey, manager.hostname, manager.port)
  const result = await withFileLease(file + '.lock', 30000, async () => {
    const old = read(file)
    if ((old?.revision ?? null) !== expectedRevision || old && old.id !== manager.id) throw new TopologyRequestError('This VMware connection changed. Reload before editing.', 409)
    if (!connection) { if (old) unlinkSync(file); return true }
    if (connection.hostname !== manager.hostname || connection.port !== manager.port) throw new TopologyRequestError('Invalid VMware manager.', 400)
    const caPem = normalizeVmwareCa(connection.caPem)
    const row: SavedVmwareManager = { ...manager, username:connection.username, customTrust:!!caPem, revision:randomUUID() }
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', vaultKey(), nonce)
    cipher.setAAD(aad(sourceKey, row))
    const plaintext = JSON.stringify(secretSchema.parse({password:connection.password, caPem}))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const record = storedSchema.parse({...row, nonce:nonce.toString('hex'), tag:cipher.getAuthTag().toString('hex'), ciphertext:ciphertext.toString('hex')})
    const temporary = file + '.' + randomUUID() + '.tmp'
    try { writeFileSync(temporary, JSON.stringify(record), {flag:'wx',mode:0o600}); renameSync(temporary, file) }
    finally { if (existsSync(temporary)) unlinkSync(temporary) }
    return true
  })
  if (!result) throw new TopologyRequestError('This VMware connection changed. Reload before editing.', 409)
}
