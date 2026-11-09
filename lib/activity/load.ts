import { z } from 'zod'
import type { PublishedRecoveryReader, VbrReader } from '../server/vbr-read'
import { TopologyRequestError } from '../topology/load'
import { readOperationsCollection } from '../operations/load'
import { dateWindows, sessionGroups, type ActivityQuery } from './filters'
import { historySize, investigationSessionSchema, mergeActivity, mountBelongsToSession, mountPaths, parseMount, platforms, type ActivityFeed, type Mount } from './model'
import type { Session } from '../investigation/model'

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

export async function loadActivityMounts(read: VbrReader, published?: PublishedRecoveryReader, kinds?: readonly Mount['kind'][]) {
  const selected = kinds ? platforms.filter(kind => kinds.includes(kind)) : platforms
  const [collections, extra] = await Promise.all([
    Promise.allSettled(selected.map(kind => readOperationsCollection(
      path => read(path, '1.3-rev2'), mountPaths[kind], z.unknown().transform(raw => parseMount(kind, raw)),
    ))),
    published && (!kinds || kinds.includes('other')) ? publishedMounts(published).catch(() => null) : null,
  ])
  const mounts: Mount[] = [], warnings: string[] = []
  for (const [index, result] of collections.entries()) {
    if (result.status === 'rejected' || !result.value.complete) warnings.push(selected[index])
    if (result.status === 'fulfilled') mounts.push(...result.value.data)
  }
  // The console list calls its mount ID sessionId. The typed public records supply the verified session linkage.
  const known = new Set(mounts.flatMap(mount => [mount.id, mount.sessionId]))
  for (const item of extra?.data ?? []) if (!known.has(item.id)) mounts.push(item)
  if (extra && !extra.complete) warnings.push('Mounted recoveries')
  return {mounts: mounts.filter(mount => mount.state !== 'Unmounted'), warnings,
    available: !!extra || collections.some(result => result.status === 'fulfilled')}
}

async function readHistory(read: VbrReader, query: ActivityQuery, now: Date) {
  const params = new URLSearchParams({orderColumn: 'CreationTime', orderAsc: 'false', createdBeforeFilter: now.toISOString()})
  if (query.name) params.set('nameFilter', `*${query.name}*`)
  if (query.state) params.set('stateFilter', query.state)
  if (query.window) params.set('createdAfterFilter', new Date(now.getTime() - dateWindows[query.window] * 86400000).toISOString())
  const types = query.types.length ? query.types : sessionGroups[query.group] || []
  for (const type of types) params.append('typeFilter', type)
  for (const result of query.results) params.append('resultFilter', result)

  // VBR has no platform filter and may include related types (BackupJob also returns PlatformBackupJob).
  // Preserve its offsets while narrowing each page to the operator's exact selection.
  const exactTypes = new Set(types)
  const scan = !!query.platform || exactTypes.size > 0
  const limit = scan ? 500 : historySize
  params.set('limit', String(limit))
  let nextSkip = query.skip
  let privateFeed = true
  let publicRevision: '1.3-rev1'|'1.3-rev2' = '1.3-rev2'
  const scanDeadline = Date.now() + 35000
  let total: number|null = null
  let hasMore = false
  const data: Session[] = []
  for (let batch = 0; batch < (scan ? 5 : 1); batch++) {
    params.set('skip', String(nextSkip))
    let page: z.infer<typeof historySchema> | undefined
    if (privateFeed) {
      try { page = historySchema.parse(await read(`/private-api/v1/sessions?${params}`, '1.3-rev2')) }
      catch { privateFeed = false }
    }
    if (!page) {
      const path = `/api/v1/sessions?${params}`
      try { page = historySchema.parse(await read(path, publicRevision)) }
      catch (error) {
        if (publicRevision === '1.3-rev1' || error instanceof TopologyRequestError && [401, 403].includes(error.status)) throw error
        publicRevision = '1.3-rev1'
        page = historySchema.parse(await read(path, publicRevision))
      }
    }
    total = page.pagination?.total ?? null
    let consumed = 0
    for (const session of page.data) {
      consumed++
      if ((!query.platform || session.platformName === query.platform) &&
          (!exactTypes.size || !!session.sessionType && exactTypes.has(session.sessionType))) data.push(session)
      if (data.length === historySize) break
    }
    nextSkip += consumed
    hasMore = consumed > 0 && (total === null ? consumed < page.data.length || page.data.length === limit : nextSkip < total)
    if (!hasMore || data.length === historySize || Date.now() >= scanDeadline) break
  }
  const filteredTotal = !query.skip && !hasMore ? data.length : null
  return {data, total: scan ? filteredTotal : total, nextSkip, hasMore}
}

export async function loadActivity(read: VbrReader, sourceName: string, sourceKey: string, query: ActivityQuery,
  published?: PublishedRecoveryReader, now = new Date()): Promise<ActivityFeed> {
  const before = query.before ? new Date(query.before) : now
  const [historyResult, mounted] = await Promise.all([
    Promise.allSettled([readHistory(read, query, before)]).then(([result]) => result),
    loadActivityMounts(read, published),
  ])
  if (historyResult.status === 'rejected' && !mounted.available) {
    if (historyResult.reason instanceof TopologyRequestError) throw historyResult.reason
    throw new TopologyRequestError('Activity could not be loaded.', 502)
  }
  const page = historyResult.status === 'fulfilled' ? historyResult.value : null
  const warnings = mounted.warnings
  if (!page) warnings.push('Session history')
  const sessions = page?.data ?? []
  // Always attach mount controls to a matching history row. Pin standalone mounts only in unfiltered
  // history or a mount-name search; result, time, source platform and session state require session evidence.
  const pin = !query.state && !query.group && !query.types.length && !query.results.length && !query.platform && !query.window
  const name = query.name.toLowerCase()
  const isPinned = (mount: Mount) => pin && (!name || mount.name?.toLowerCase().includes(name))
  const mounts = mounted.mounts.filter(mount => !query.skip && isPinned(mount) || sessions.some(session => mountBelongsToSession(mount, session)))
  const rows = mergeActivity(sessions, mounts).filter(row => !query.skip || !row.mount || !isPinned(row.mount))
  return {rows, total: page?.total ?? null, hasMore: page?.hasMore ?? false,
    nextSkip: page?.nextSkip ?? query.skip, before: before.toISOString(), warnings, sourceName, sourceKey}
}
