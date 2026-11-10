// Open Backup UI v1.2.0
import { z } from 'zod'
import { readOperationsCollection } from '../operations/load'
import type { Collection } from '../operations/model'
import { TopologyRequestError } from '../topology/load'
import type { RestorePoint } from './model'

const text = z.string().nullish()
const strings = z.array(z.string()).nullish()
export const pointSchema = z.object({
  id: z.string().min(1), backupId: z.string().min(1), name: text, creationTime: text,
  type: text, platformName: text, backupFileId: text, malwareStatus: text, allowedOperations: strings,
  gfsPeriods: strings, originalSize: z.number().nullish(), sessionId: text, guestOsFamily: text,
})

type Page = Collection<RestorePoint>
type Entry = { result: Promise<Page>; expires: number }
const processCache = globalThis as typeof globalThis & { objectRestorePointCollections?: Map<string, Entry> }
const entries = processCache.objectRestorePointCollections ??= new Map<string, Entry>()
const ttl = 60_000

/** Raw VBR rows only. The caller supplies its authenticated source/principal and API revision. */
export async function readObjectRestorePoints(read: (path: string) => Promise<unknown>, identity: string, objectId: string,
  options: { refresh?: boolean; backupId?: string } = {}): Promise<Page> {
  const prefix = identity + '/' + objectId.toLowerCase() + '/'
  const backupId = options.backupId?.toLowerCase()
  const key = prefix + (backupId || '')
  const now = Date.now()
  if (options.refresh) {
    for (const [id, entry] of entries) if (id.startsWith(prefix) && entry.expires !== Infinity) entries.delete(id)
  }
  const full = entries.get(prefix)
  if (backupId && full && full.expires > now) {
    const all = await full.result
    if (all.complete) return structuredClone({ ...all, data: all.data.filter(point => point.backupId.toLowerCase() === backupId) })
  }
  const hit = entries.get(key)
  if (hit && hit.expires > now) return structuredClone(await hit.result)
  const query = new URLSearchParams({ orderColumn: 'CreationTime', orderAsc: 'false' })
  if (backupId) query.set('backupIdFilter', backupId)
  const path = '/api/v1/backupObjects/' + encodeURIComponent(objectId) + '/restorePoints?' + query
  const result = readOperationsCollection(read, path, pointSchema, backupId ? 5000 : 20000).then(page => {
    if (backupId && page.data.some(point => point.backupId.toLowerCase() !== backupId))
      throw new TopologyRequestError('VBR returned restore points outside the selected backup. No results were displayed.', 502)
    return page
  })
  const entry = { result, expires: Infinity }
  entries.set(key, entry)
  while (entries.size > 128) entries.delete(entries.keys().next().value!)
  try {
    const page = await result
    if (page.complete) entry.expires = Date.now() + ttl
    else if (entries.get(key) === entry) entries.delete(key)
    // Protected Data attaches application and VM membership evidence to its own response.
    return structuredClone(page)
  } catch (error) {
    if (entries.get(key) === entry) entries.delete(key)
    throw error
  }
}
