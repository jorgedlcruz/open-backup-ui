// Open Backup UI v1.2.0
import { z } from 'zod'
import type { Collection } from '../operations/model'
import { TopologyRequestError } from '../topology/load'
import type { RestorePoint } from './model'
import { isAbortedRead } from '../recovery/catalog-cache'

const text = z.string().nullish()
const strings = z.array(z.string()).nullish()
export const pointSchema = z.object({
  id: z.string().min(1), backupId: z.string().min(1), name: text, creationTime: text,
  type: text, platformName: text, backupFileId: text, malwareStatus: text, allowedOperations: strings,
  gfsPeriods: strings, originalSize: z.number().nullish(), sessionId: text, guestOsFamily: text,
})

const responseSchema = z.object({ data: z.array(pointSchema), pagination: z.object({
  total: z.number().int().nonnegative().optional(), skip: z.number().int().nonnegative().optional(),
}).optional() })
export const restorePointCacheMs = 30 * 60_000
export const initialPointLimit = 200
export const maximumPointLimit = 20_000
type Read = (path: string) => Promise<unknown>
export type PointWindow = Collection<RestorePoint> & {
  pointCount: number; pointLimit: number; pointTotal?: number; hasMorePoints: boolean; pointsFetchedAt: string; stale?: boolean
}
type Snapshot = { data: RestorePoint[]; skip: number; total?: number; exhausted: boolean; partial: boolean; fetchedAt: string }
type Entry = { snapshot?: Snapshot; expires: number; depth: number; pending?: Promise<void>; stale: boolean }
const processCache = globalThis as typeof globalThis & { objectRestorePointWindows?: Map<string, Entry> }
const entries = processCache.objectRestorePointWindows ??= new Map<string, Entry>()
const unauthorized = (error: unknown) => error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403)
const pointKey = (point: RestorePoint) => point.backupId.toLowerCase() + '/' + point.id.toLowerCase()
const prefixFor = (identity: string, objectId: string) => JSON.stringify([identity, objectId.toLowerCase()]) + '/'
class PointPageError extends TopologyRequestError {}
function trimCache() {
  for (const [key, entry] of entries) {
    if (entries.size <= 128) break
    if (!entry.pending) entries.delete(key)
  }
}
function result(entry: Entry): PointWindow {
  const page = entry.snapshot!
  return structuredClone({ data: page.data, available: true, complete: !page.partial && !entry.stale,
    pointCount: page.data.length, pointLimit: entry.depth, pointTotal: page.total,
    hasMorePoints: !page.exhausted, pointsFetchedAt: page.fetchedAt, ...(entry.stale && { stale: true }) })
}
function covers(entry: Entry, requested: number, restorePointId?: string) {
  const page = entry.snapshot
  return !!page && !page.partial && !entry.stale && (page.exhausted || page.skip >= requested) &&
    (!restorePointId || page.data.some(point => point.id.toLowerCase() === restorePointId.toLowerCase()))
}
export function invalidateObjectRestorePointCache(identity: string) {
  for (const key of entries.keys()) if (key.startsWith(JSON.stringify([identity]).slice(0, -1) + ',')) entries.delete(key)
}
// A second request waits for a batch, then uses its own reader for further pages.
// Request-scoped readers must never continue in a detached background promise.
async function fetchWindow(read: Read, path: string, backupId: string | undefined, previous: Snapshot | undefined, depth: number): Promise<Snapshot> {
  const page: Snapshot = previous ? { ...previous, data: [...previous.data] }
    : { data: [], skip: 0, exhausted: false, partial: false, fetchedAt: new Date(Date.now()).toISOString() }
  const rows = new Map(page.data.map(point => [pointKey(point), point]))
  while (!page.exhausted && page.skip < depth && page.skip < maximumPointLimit) {
    const url = new URL(path, 'https://vbr.invalid'), skip = page.skip, limit = Math.min(initialPointLimit, depth - skip)
    url.searchParams.set('skip', String(skip)); url.searchParams.set('limit', String(limit))
    const response = responseSchema.parse(await read(url.pathname + url.search))
    if (response.data.length > limit || response.pagination?.skip !== undefined && response.pagination.skip !== skip)
      throw new PointPageError('VBR returned an inconsistent restore-point page. Refresh the list to retry.', 502)
    if (backupId && response.data.some(point => point.backupId.toLowerCase() !== backupId))
      throw new PointPageError('VBR returned restore points outside the selected backup. No results were displayed.', 502)
    const before = rows.size, total = response.pagination?.total
    if (page.total !== undefined && total !== undefined && page.total !== total) page.partial = true
    if (total !== undefined) page.total = total
    for (const point of response.data) rows.set(pointKey(point), point)
    page.skip += response.data.length
    if (rows.size - before !== response.data.length) page.partial = true
    if (total !== undefined && page.skip >= total) {
      page.exhausted = true
      if (rows.size !== total) page.partial = true
    } else if (!response.data.length) {
      page.exhausted = true
      if (total !== undefined && page.skip < total) page.partial = true
    } else if (total === undefined && response.data.length < limit) page.exhausted = true
    if (response.data.length && rows.size === before) { page.partial = true; page.exhausted = true }
    if (page.partial) break
  }
  page.data = [...rows.values()]
  return page
}
/** Raw rows only. Identity includes the authenticated VBR source/principal and API revision. */
export async function readObjectRestorePointWindow(read: Read, identity: string, objectId: string,
  options: { refresh?: boolean; backupId?: string; pointLimit?: number; restorePointId?: string } = {}): Promise<PointWindow> {
  const prefix = prefixFor(identity, objectId), backupId = options.backupId?.toLowerCase(), key = prefix + (backupId || '')
  const requested = Math.max(initialPointLimit, Math.min(maximumPointLimit, options.pointLimit ?? initialPointLimit))
  const current = entries.get(key)
  if (options.refresh && !current?.pending) {
    // An unfiltered refresh supersedes filtered snapshots; a filtered refresh
    // invalidates the all-copy snapshot without discarding refreshed sibling copies.
    for (const [id, entry] of entries) if (id.startsWith(prefix) && id !== key && !entry.pending && (!backupId || id === prefix)) entries.delete(id)
  }
  const full = backupId && !options.refresh ? entries.get(prefix) : undefined
  if (full) {
    const readableDuringRefresh = !!full.pending && full.snapshot?.exhausted && covers(full, requested, options.restorePointId)
    try { if (!readableDuringRefresh) await full.pending } catch (error) {
      if (isAbortedRead(error)) return readObjectRestorePointWindow(read, identity, objectId, options)
      throw error
    }
    if (full.snapshot?.exhausted && !full.snapshot.partial && !full.stale && (readableDuringRefresh || full.expires > Date.now())) {
      const data = full.snapshot.data.filter(point => point.backupId.toLowerCase() === backupId)
      return { ...result(full), data: structuredClone(data), pointCount: data.length, pointTotal: data.length }
    }
  }
  let entry = entries.get(key)
  if (!entry) { entry = { expires: 0, depth: requested, stale: false }; entries.set(key, entry) }
  const query = new URLSearchParams({ orderColumn: 'CreationTime', orderAsc: 'false' })
  if (backupId) query.set('backupIdFilter', backupId)
  const path = '/api/v1/backupObjects/' + encodeURIComponent(objectId) + '/restorePoints?' + query
  let force = !!options.refresh
  while (true) {
    if (entry.pending) {
      if (!force && covers(entry, requested, options.restorePointId)) return result(entry)
      try { await entry.pending } catch (error) {
        if (isAbortedRead(error)) return readObjectRestorePointWindow(read, identity, objectId, options)
        throw error
      }
      force = false
      // Another waiter may already have started the next page while this one
      // resumed. Recheck pending before deciding whether to extend the window.
      continue
    }
    const page = entry.snapshot, expired = entry.expires <= Date.now()
    const needsSeed = !!options.restorePointId && !page?.data.some(point => point.id.toLowerCase() === options.restorePointId!.toLowerCase())
    const extend = !!page && !page.exhausted && !page.partial && !entry.stale &&
      (page.skip < requested || needsSeed && page.skip < maximumPointLimit)
    if (page && !force && !expired && !extend) return result(entry)
    const replace = force || expired || !page
    const depth = replace ? Math.max(entry.depth, requested) : Math.max(requested, needsSeed ? Math.min(maximumPointLimit, page!.skip + initialPointLimit) : entry.depth)
    const target = entry, previous = replace ? undefined : page
    const work = fetchWindow(read, path, backupId, previous, depth).then(snapshot => {
      target.snapshot = snapshot; target.stale = false; target.depth = depth
      target.expires = snapshot.partial ? 0 : Date.parse(snapshot.fetchedAt) + restorePointCacheMs
    }, error => {
      if (unauthorized(error)) { invalidateObjectRestorePointCache(identity); throw error }
      if (isAbortedRead(error)) { if (!target.snapshot && entries.get(key) === target) entries.delete(key); throw error }
      if (error instanceof PointPageError || error instanceof z.ZodError) { if (entries.get(key) === target) entries.delete(key); throw error }
      if (!target.snapshot || target.snapshot.partial) { if (entries.get(key) === target) entries.delete(key); throw error }
      // Preserve the last authorized snapshot after a transient failure, with an
      // explicit stale flag and a short retry interval. Auth failures always evict.
      target.stale = true; target.expires = Date.now() + 25_000
    })
    target.pending = work
    try { await work } finally { if (target.pending === work) target.pending = undefined; trimCache() }
    force = false
    if (target.stale || target.snapshot?.partial) return result(target)
    // Only an explicit pinned point walks beyond the requested window. The
    // bounded object-scoped lookup cannot accept a point belonging to another VM.
    if (!needsSeed || target.snapshot?.exhausted || target.snapshot!.skip >= maximumPointLimit ||
      target.snapshot?.data.some(point => point.id.toLowerCase() === options.restorePointId!.toLowerCase())) return result(target)
  }
}
/** Protected Data keeps its full-collection contract while sharing recovery's raw cached pages. */
export async function readObjectRestorePoints(read: Read, identity: string, objectId: string,
  options: { refresh?: boolean; backupId?: string } = {}): Promise<Collection<RestorePoint>> {
  const page = await readObjectRestorePointWindow(read, identity, objectId, { ...options, pointLimit: options.backupId ? 5000 : maximumPointLimit })
  return { data: page.data, available: page.available, complete: page.complete && !page.hasMorePoints }
}
