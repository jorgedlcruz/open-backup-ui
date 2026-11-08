import { z } from 'zod'
import type { PublishedRecoveryReader, VbrReader } from '../server/vbr-read'
import { TopologyRequestError } from '../topology/load'
import { readOperationsCollection } from '../operations/load'
import { historySize, investigationSessionSchema, mergeActivity, mountPaths, parseMount, platforms, type ActivityFeed, type ActivityQuery, type Mount } from './model'

const historySchema = z.object({
  data: z.array(investigationSessionSchema),
  pagination: z.object({total: z.number().int().nonnegative().optional()}).optional(),
})

const publishedSchema = z.object({
  sessionId: z.string().uuid(), mountState: z.string(), sessionType: z.string(),
  hostName: z.string().nullish(), backupName: z.string().nullish(), vmName: z.string().nullish(), restorePoint: z.string().nullish(),
}).transform((row): Mount => ({
  id: row.sessionId.toLowerCase(), sessionId: row.sessionId.toLowerCase(), kind: 'other', operation: row.sessionType,
  state: row.mountState, name: row.vmName || row.backupName || undefined, pointTime: row.restorePoint ?? undefined,
  host: row.hostName ?? undefined, backup: row.backupName ?? undefined,
}))

async function publishedMounts(read: PublishedRecoveryReader) {
  return readOperationsCollection(async path => {
    const params = new URL(path, 'https://vbr.invalid').searchParams
    const page = z.object({sessions: z.array(z.unknown()), pagination: z.object({total: z.number()}).optional()})
      .parse(await read(Number(params.get('skip')), Number(params.get('limit'))))
    return {data: page.sessions, pagination: page.pagination}
  }, '/mounts', publishedSchema)
}

export async function loadActivity(read: VbrReader, sourceName: string, sourceKey: string, query: ActivityQuery, published?: PublishedRecoveryReader): Promise<ActivityFeed> {
  const params = new URLSearchParams({ skip: String(query.skip), limit: String(historySize), orderColumn: 'CreationTime', orderAsc: 'false' })
  if (query.name) params.set('nameFilter', `*${query.name}*`)
  if (query.state) params.set('stateFilter', query.state)
  const warnings: string[] = []
  async function history() {
    try {
      return historySchema.parse(await read(`/private-api/v1/sessions?${params}`, '1.3-rev2'))
    } catch {
      return historySchema.parse(await read(`/api/v1/sessions?${params}`))
    }
  }

  const [historyResult, mountResults, focus, extra] = await Promise.all([
    Promise.allSettled([history()]).then(([result]) => result),
    Promise.allSettled(platforms.map(kind => readOperationsCollection(
      path => read(path, '1.3-rev2'), mountPaths[kind], z.unknown().transform(raw => parseMount(kind, raw)),
    ))),
    query.focus ? read(`/api/v1/sessions/${query.focus}`).then(raw => investigationSessionSchema.parse(raw)).catch(() => null) : null,
    published ? publishedMounts(published).catch(() => null) : null,
  ])
  if (historyResult.status === 'rejected' && mountResults.every(result => result.status === 'rejected') && !extra) {
    if (historyResult.reason instanceof TopologyRequestError) throw historyResult.reason
    throw new TopologyRequestError('Activity could not be loaded.', 502)
  }
  const page = historyResult.status === 'fulfilled' ? historyResult.value : null
  if (!page) warnings.push('Session history')
  const sessions = [...page?.data ?? []]
  if (focus && focus.id === query.focus) sessions.push(focus)
  const mounts: Mount[] = []
  for (const [index, result] of mountResults.entries()) {
    if (result.status === 'rejected' || !result.value.complete) warnings.push(platforms[index])
    if (result.status === 'fulfilled') mounts.push(...result.value.data)
  }
  // The console lists mount IDs under sessionId. Typed public records supply the verified restore-session linkage and available actions.
  const known = new Set(mounts.flatMap(mount => [mount.id, mount.sessionId]))
  for (const item of extra?.data ?? []) if (!known.has(item.id)) mounts.push(item)
  if (extra && !extra.complete) warnings.push('Mounted recoveries')
  // Pin mounts on the first page and retain their metadata when a later session page references them.
  const ids = new Set(sessions.map(session => session.id))
  const selectedMounts = mounts.filter(mount => mount.state !== 'Unmounted').filter(mount => mount.sessionId === query.focus || ids.has(mount.sessionId) ||
    (!query.skip && !query.state && (!query.name || mount.name?.toLowerCase().includes(query.name.toLowerCase()))))
  const total = page?.pagination?.total ?? null
  return {rows: mergeActivity(sessions, selectedMounts), total, hasMore: !!page?.data.length &&
    (total === null ? page.data.length === historySize : query.skip + page.data.length < total), warnings, sourceName, sourceKey}
}
