// Open Backup UI v1.2.0
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { validId } from '../investigation/model'

export type MigrationDestination = {host?: string; datastore?: string}
export type MigrationLink = { sourceKey: string; parentSessionId: string; mountId: string; childSessionId: string; destination?: MigrationDestination }

function destinationFields(value: unknown): {destination?: MigrationDestination} {
  if (!value || typeof value !== 'object') return {}
  const {host, datastore} = value as MigrationDestination
  const name = (text: unknown) => typeof text === 'string' && text.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(text) ? text.trim() : ''
  const hostName = name(host), datastoreName = name(datastore)
  return hostName || datastoreName ? {destination:{...(hostName && {host:hostName}), ...(datastoreName && {datastore:datastoreName})}} : {}
}

function id(value: string) {
  if (typeof value !== 'string' || !validId(value)) throw new Error('Invalid migration identifier.')
  return value.toLowerCase()
}

function directory(sourceKey: string, parentSessionId: string) {
  if (typeof sourceKey !== 'string' || !/^[a-f0-9]{64}$/.test(sourceKey)) throw new Error('Invalid migration source.')
  return path.join(process.cwd(), 'data', 'migration-links', sourceKey, id(parentSessionId))
}

function missing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT' }

// Save only the distinct session ID returned by the accepted migrate call for this exact mount.
// Each mount has its own file so simultaneous migrations on the same parent do not overwrite one another.
export async function saveMigrationLink(sourceKey: string, parentSessionId: string, mountId: string, childSessionId: string, destination?: MigrationDestination) {
  const dir = directory(sourceKey, parentSessionId)
  const link: MigrationLink = { sourceKey, parentSessionId:id(parentSessionId), mountId:id(mountId), childSessionId:id(childSessionId), ...destinationFields(destination) }
  if (link.childSessionId === link.parentSessionId || link.childSessionId === link.mountId) throw new Error('Expected a distinct migration session.')
  await fs.mkdir(dir, {recursive:true, mode:0o700})
  const file = path.join(dir, link.mountId + '.json'), temp = file + '.' + randomUUID() + '.tmp'
  try {
    await fs.writeFile(temp, JSON.stringify(link), {flag:'wx', mode:0o600})
    await fs.rename(temp, file)
  } finally { await fs.unlink(temp).catch(() => {}) }
}

// A read only discovers receipts under one authorized parent. A receipt is never authorization to read the child.
export async function readMigrationLinks(sourceKey: string, parentSessionId: string, mountId?: string): Promise<MigrationLink[]> {
  const dir = directory(sourceKey, parentSessionId), parent = id(parentSessionId)
  let ids: string[]
  if (mountId !== undefined) ids = [id(mountId)]
  else {
    try { ids = (await fs.readdir(dir)).filter(name => name.endsWith('.json') && validId(name.slice(0, -5))).map(name => name.slice(0, -5)) }
    catch (error) { if (missing(error)) return []; throw error }
  }
  const rows = await Promise.all(ids.map(async mount => {
    try {
      const record = JSON.parse(await fs.readFile(path.join(dir, mount + '.json'), 'utf8')) as Partial<MigrationLink> | null
      if (record?.sourceKey !== sourceKey || record.parentSessionId !== parent || record.mountId !== mount ||
        typeof record.childSessionId !== 'string' || !validId(record.childSessionId) || record.childSessionId === parent || record.childSessionId === mount) return null
      return {sourceKey, parentSessionId:parent, mountId:mount, childSessionId:record.childSessionId.toLowerCase(), ...destinationFields(record.destination)}
    } catch (error) { if (missing(error) || error instanceof SyntaxError) return null; throw error }
  }))
  return rows.filter((record): record is MigrationLink => record !== null)
}

export async function readMigrationLink(sourceKey: string, parentSessionId: string, mountId?: string) {
  const links = await readMigrationLinks(sourceKey, parentSessionId, mountId)
  return links.length === 1 ? links[0] : null
}
