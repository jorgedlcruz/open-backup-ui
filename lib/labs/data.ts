// Open Backup UI v1.2.0
import { applicationRequest } from '../api/application-request'
import { capacityRepositories, isProtectionSession, jobStatus, repositoryRisk, utilization, type OperationsSnapshot } from '../operations/model'
import { rowsFrom, repositoryName, type Snapshot as ProtectedSnapshot } from '../protected-data/model'
import type { Snapshot as MalwareSnapshot } from '../ransomware/model'
import { isCachedSource, type Dataset, type SourceId, type Widget } from './model'
import { fieldsFor } from './catalog'
import { monitoringDataset, type MonitoringSnapshot } from './monitoring-data'
export { fieldsFor } from './catalog'

export type DatasetRequest = Pick<Widget, 'source' | 'range'> & Partial<Pick<Widget, 'repositoryId' | 'forecastMode' | 'horizon'>>
export type RawDataset = OperationsSnapshot | ProtectedSnapshot | MalwareSnapshot | MonitoringSnapshot | Dataset
export function endpoint(source: SourceId, range: Widget['range'], selection: Partial<DatasetRequest> = {}) {
  if (isCachedSource(source)) return `/api/labs/forecast?${new URLSearchParams({ source, repository: selection.repositoryId ?? '', mode: selection.forecastMode ?? 'capacity', horizon: String(selection.horizon ?? 30) })}`
  if (source === 'proxies') return '/api/vbr/proxies'
  if (source === 'servers') return '/api/vbr/managed-servers'
  if (source === 'licenses') return '/api/vbr/licensing'
  if (source === 'protected' || source === 'objects') return '/api/vbr/protected-data?operations=true'
  if (source === 'malware') return '/api/vbr/ransomware'
  return `/api/vbr/operations?range=${range}`
}
const measured = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
export function toDataset(source: SourceId, raw: RawDataset): Dataset {
  if (isCachedSource(source)) return raw as Dataset
  if (source === 'overview' || source === 'proxies' || source === 'servers' || source === 'licenses') return monitoringDataset(source, raw as MonitoringSnapshot)
  const base = { fields: fieldsFor(source), fetchedAt: raw.fetchedAt, sourceName: raw.sourceName, warnings: raw.warnings }
  if (source === 'protected' || source === 'objects') {
    const data = raw as ProtectedSnapshot
    const copies = rowsFrom(data).map(r => ({ id: source === 'objects' ? r.object.id : r.key, name: r.name, platform: r.object.platformName ?? null, type: r.object.type ?? null,
      status: r.coverage, run: r.run, repository: repositoryName(r), job: r.backup?.name ?? r.object.jobName ?? null, size: r.size, points: r.points, copies: r.copies }))
    if (source === 'protected') return { ...base, available: true, complete: data.objectsComplete && data.backups.complete, rows: copies }
    const groups = new Map<string, typeof copies>()
    for (const r of copies) { const group = groups.get(r.id) ?? []; group.push(r); groups.set(r.id, group) }
    const rows = [...groups.values()].map(g => ({ ...g[0], copies: g.length,
      // Object size is the largest reported copy; recovery points are summed across copies.
      size: g.some(r => r.size !== null) ? Math.max(...g.map(r => r.size ?? 0)) : null,
      points: g.every(r => r.points !== null) ? g.reduce((n, r) => n + r.points!, 0) : null,
      status: g.some(r => (r.points ?? 0) > 0) ? 'Restore points available' : g.some(r => r.points === null) ? 'Count not reported' : 'No restore points',
      run: g.some(r => r.run === 'Failed') ? 'Failed' : g.every(r => r.run === 'Not failed') ? 'Not failed' : 'Not reported',
      repository: [...new Set(g.map(r => r.repository))].join(', '), job: [...new Set(g.map(r => r.job).filter(Boolean))].join(', ') || null,
    }))
    return { ...base, available: true, complete: data.objectsComplete && data.backups.complete, rows }
  }
  if (source === 'malware') {
    const data = raw as MalwareSnapshot
    return { ...base, available: data.events.available, complete: data.events.complete, rows: data.events.data.map(e => ({ id: e.id, name: e.machine?.displayName ?? null, objectId: e.machine?.backupObjectId ?? null, severity: e.severity ?? null, status: e.state ?? null, type: e.type ?? null, engine: e.engine ?? null, source: e.source ?? null, time: e.detectionTimeUtc ?? e.creationTimeUtc ?? null, details: e.details ?? null })) }
  }
  const data = raw as OperationsSnapshot
  if (source === 'jobs') return { ...base, available: data.jobs.available, complete: data.jobs.complete, rows: data.jobs.data.map(j => ({ id: j.id, name: j.name, type: j.type ?? null, status: jobStatus(j), result: j.lastResult ?? null, repository: j.repositoryName ?? null, objects: measured(j.objectsCount), progress: measured(j.progressPercent), time: j.lastRun ?? null, next: j.nextRun ?? null })) }
  if (source === 'history') {
    const jobs = new Map(data.jobs.data.map(j => [j.id.toLowerCase(), j]))
    return { ...base, available: data.sessions.available, complete: data.sessions.complete, rows: data.sessions.data.filter(s => isProtectionSession(s) && Date.parse(s.creationTime) >= Date.parse(data.from) && Date.parse(s.creationTime) <= Date.parse(data.fetchedAt)).map(s => {
      const job = s.jobId ? jobs.get(s.jobId.toLowerCase()) : undefined
      return { id: s.id, name: s.name, jobName: job?.name || s.name, jobNameSource: job?.name ? 'Job inventory' : 'Reported session name', jobId: job?.id ?? s.jobId?.toLowerCase() ?? null, type: s.sessionType, status: s.state === 'Stopped' ? s.result?.result ?? 'Unknown' : s.state, time: s.creationTime, end: s.endTime ?? null, duration: s.endTime ? measured((Date.parse(s.endTime) - Date.parse(s.creationTime)) / 1000) : null, progress: measured(s.progressPercent) }
    }) }
  }
  if (source === 'repositories') return { ...base, available: data.repositories.available, complete: data.repositories.complete, rows: capacityRepositories(data.repositories.data).map(r => ({ id: r.id, name: r.name, type: r.type ?? null, status: repositoryRisk(r), capacity: measured(r.capacityGB), free: measured(r.freeGB), used: utilization(r) === null ? null : r.capacityGB! - r.freeGB!, utilization: utilization(r) })) }
  return { ...base, available: data.security.available, complete: data.security.complete, rows: data.security.data.map((s, i) => ({ id: s.id ?? String(i), name: s.bestPractice ?? null, status: s.status ?? null })) }
}
export async function loadDatasets(widgets: DatasetRequest[], signal: AbortSignal, onDataset?: (key: string, value: Dataset | Error) => void): Promise<Record<string, Dataset | Error>> {
  const paths = [...new Set(widgets.map(w => endpoint(w.source, w.range, w)))]
  const result: Record<string, Dataset | Error> = {}
  await Promise.all(paths.map(async path => {
    let raw: RawDataset | Error
    try { raw = await applicationRequest<RawDataset>(path, { signal }) }
    catch (error) { raw = error instanceof Error ? error : new Error('Data could not be loaded.') }
    for (const widget of widgets.filter(w => endpoint(w.source, w.range, w) === path)) {
      const key = dataKey(widget)
      try { result[key] = raw instanceof Error ? raw : toDataset(widget.source, raw) }
      catch { result[key] = new Error('The source returned an unreadable dataset.') }
      if (!signal.aborted) onDataset?.(key, result[key])
    }
  }))
  return result
}
export const dataKey = (w: DatasetRequest) => isCachedSource(w.source) ? endpoint(w.source, w.range, w) : `${w.source}:${w.range}`
