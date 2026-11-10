// Open Backup UI v1.2.0
import { capacityTrend, DAY, GB, dayStart, policyLabel, projectBackup, repositoryBackups, uniqueFiles, type ForecastSnapshot } from '../forecast/model'
import { hygieneAnalysis, retentionAnalysis, retentionCategories } from '../forecast/investigation'
import { fieldsFor } from './catalog'
import type { Dataset, RecordRow, Widget } from './model'

export type CachedSource = 'forecast' | 'runway' | 'footprint' | 'retention' | 'hygiene'
export type ForecastSelection = Partial<Pick<Widget, 'repositoryId' | 'forecastMode' | 'horizon'>>
const measured = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Cached observations and policy scenarios retain their original collection time. */
export function forecastDataset(data: ForecastSnapshot | null, source: CachedSource, selection: ForecastSelection = {}): Dataset {
  const base: Dataset = { rows: [], fields: fieldsFor(source), available: !!data, complete: false, warnings: data?.warnings ?? [], sourceName: data?.sourceName ?? '', fetchedAt: data?.fetchedAt ?? '', repositories: [],
    freshness: { cached: true, stale: data?.cache?.stale ?? false, refreshing: data?.cache?.refreshing ?? false } }
  if (!data) return { ...base, emptyReason: 'cache-empty' }
  const now = Date.parse(data.fetchedAt), horizon = selection.horizon ?? 30
  const parents = new Set([...data.scaleOut.data.map(r => r.id), ...data.repositories.data.map(r => r.scaleOutRepositoryDetails?.scaleOutRepositoryId).filter(Boolean)])
  const physical = data.repositories.data.filter(r => r.type !== 'ScaleOut' && !parents.has(r.id))
  const choices = new Map(data.repositories.data.map(r => [r.id, r.name || r.id]))
  data.scaleOut.data.forEach(r => choices.set(r.id, r.name || r.id))
  data.backups.data.forEach(b => { if (b.repositoryId && !choices.has(b.repositoryId)) choices.set(b.repositoryId, b.repositoryId) })
  const capacityOnly = source === 'runway' || source === 'forecast' && selection.forecastMode !== 'files'
  base.repositories = [...(capacityOnly ? new Map(physical.map(r => [r.id, r.name || r.id])) : choices)].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  if (selection.repositoryId && !base.repositories.some(r => r.id === selection.repositoryId)) return { ...base, emptyReason: 'repository-missing' }
  const usable = base.repositories.find(choice => capacityOnly ? physical.some(r => r.id === choice.id && measured(r.capacityGB) && r.capacityGB > 0 && measured(r.freeGB) && r.freeGB <= r.capacityGB) : repositoryBackups(data, choice.id).some(b => b.files.length))
  const selected = selection.repositoryId || (source === 'forecast' ? (usable ?? base.repositories[0])?.id : '')
  const repository = (id: string) => ({ repositoryId: id, repository: choices.get(id) || id })
  const inScope = (id: string) => !selected || id === selected
  if (source === 'forecast') {
    if (!selected) return { ...base, emptyReason: 'no-projection' }
    const rows = new Map<number, RecordRow>()
    const point = (at: number) => {
      const day = dayStart(at)
      if (!rows.has(day)) rows.set(day, { id: `${selected}:${day}`, name: choices.get(selected) || selected, ...repository(selected), time: new Date(day).toISOString(), status: day > dayStart(now) ? 'Projected' : 'Recorded', recorded: null, projected: null, peak: null, capacity: null })
      return rows.get(day)!
    }
    if (selection.forecastMode === 'files') {
      const backups = repositoryBackups(data, selected)
      const models = backups.map(backup => ({ backup, projection: projectBackup(backup, data.policies.data.find(p => p.id === backup.jobId), data.configs.data.find(r => r.id === backup.repositoryId), now, horizon) })).filter(row => row.projection.values.length)
      const ids = models.flatMap(row => row.projection.modeledFileIds || [])
      const files = uniqueFiles(models.flatMap(row => row.backup.files.filter(file => row.projection.modeledFileIds?.includes(file.id))))
      if (new Set(ids).size !== ids.length || files.conflicts) return { ...base, emptyReason: 'no-projection', warnings: [...base.warnings, 'Shared or conflicting file identities prevent an unambiguous repository projection.'] }
      if (!models.length) return { ...base, emptyReason: 'no-projection' }
      for (let i = 0; i <= 30; i++) {
        const at = i === 30 ? now : dayStart(now) - (30 - i) * DAY
        point(at).recorded = files.files.filter(f => Date.parse(f.creationTime || '') <= at).reduce((sum, f) => sum + (f.backupSize ?? 0), 0)
      }
      for (let i = 0; i <= horizon; i++) {
        const row = point(now + i * DAY)
        row.projected = models.reduce((sum, m) => sum + m.projection.values[i].bytes, 0)
        row.peak = models.reduce((sum, m) => sum + m.projection.values[i].peak, 0)
      }
      base.complete = data.backups.complete && data.policies.complete && data.configs.complete && models.length === backups.length && models.every(m => !m.projection.excludedFiles)
      base.warnings = [...base.warnings, 'File scenarios cover modeled backups only. Retained file dates are not historical disk utilization.']
    } else {
      const repo = physical.find(r => r.id === selected)!, trend = capacityTrend(data.observations, selected, now, horizon)
      const capacity = measured(repo.capacityGB) && repo.capacityGB > 0 ? repo.capacityGB * GB : null
      for (const sample of trend.history) point(Date.parse(sample.at)).recorded = (sample.capacityGB - sample.freeGB) * GB
      if (!trend.history.length && capacity !== null && measured(repo.freeGB) && repo.freeGB * GB <= capacity) point(now).recorded = capacity - repo.freeGB * GB
      for (const sample of trend.values) point(sample.at).projected = sample.bytes
      for (const row of rows.values()) row.capacity = capacity
      base.complete = data.repositories.complete && data.historyAvailable
      if (!trend.values.length) base.warnings = [...base.warnings, 'More recorded history is needed for a capacity trend. No projection has been invented.']
    }
    return { ...base, rows: [...rows.values()].sort((a, b) => String(a.time).localeCompare(String(b.time))), ...(!rows.size ? { emptyReason: 'no-projection' as const } : {}) }
  }
  if (source === 'runway') return { ...base, complete: data.repositories.complete && data.historyAvailable, rows: physical.filter(r => inScope(r.id)).map(r => {
    const trend = capacityTrend(data.observations, r.id, now, 90)
    const future = (day: number) => trend.values[day] ? trend.values[day].bytes / GB : null
    const known = measured(r.capacityGB) && r.capacityGB > 0 && measured(r.freeGB) && r.freeGB <= r.capacityGB
    return { id: r.id, name: r.name || r.id, ...repository(r.id), status: trend.slope === null ? 'Learning trend' : 'Observed trend', used: known ? r.capacityGB! - r.freeGB! : null, free: known ? r.freeGB! : null, capacity: measured(r.capacityGB) ? r.capacityGB : null, utilization: known ? (r.capacityGB! - r.freeGB!) / r.capacityGB! * 100 : null, growth: trend.slope, days80: trend.daysTo80, projected30: future(30), projected60: future(60), projected90: future(90) }
  }) }
  // Each backup belongs to its reported repository; do not include parent extents twice.
  const ids = [...new Set(data.backups.data.map(b => b.repositoryId).filter((id): id is string => !!id))].filter(inScope)
  if (source === 'footprint') return { ...base, complete: data.backups.complete && data.policies.complete && data.configs.complete && data.backups.data.every(b => b.complete && !uniqueFiles(b.files).conflicts && b.files.every(f => measured(f.backupSize))), warnings: [...base.warnings, 'Future footprint includes modeled files only. Not modeled or partial models do not predict the whole backup.'], rows: data.backups.data.filter(b => b.repositoryId && inScope(b.repositoryId)).map(b => {
    const policy = data.policies.data.find(p => p.id === b.jobId), config = data.configs.data.find(r => r.id === b.repositoryId), files = uniqueFiles(b.files)
    const projection = projectBackup(b, policy, config, now, 90)
    const dates = files.files.map(f => Date.parse(f.creationTime || '')).filter(Number.isFinite)
    return { id: b.id, name: b.name || b.id, ...repository(b.repositoryId!), job: policy?.name || null, status: projection.values.length ? projection.excludedFiles ? 'Partial model' : 'Modeled' : 'Not modeled', size: projection.current, files: files.files.length, objects: new Set(files.files.flatMap(f => f.objectIds || [])).size || null, projected30: projection.values[30]?.bytes ?? null, projected60: projection.values[60]?.bytes ?? null, projected90: projection.values[90]?.bytes ?? null, retention: policyLabel(policy), time: dates.length ? new Date(Math.max(...dates)).toISOString() : null }
  }) }
  if (source === 'retention') {
    const seen = new Set<string>(), rows: RecordRow[] = []
    for (const id of ids) for (const row of retentionAnalysis(data, id).rows) {
      if (row.backup.repositoryId !== id || seen.has(row.id)) continue
      seen.add(row.id)
      rows.push({ id: row.id, name: row.file.name || row.id, ...repository(id), backup: row.backup.name || row.backup.id, job: row.policy?.name || null, status: retentionCategories[row.category], size: row.bytes, time: row.at === null ? null : new Date(row.at).toISOString(), holdUntil: row.holdUntil === null ? null : new Date(row.holdUntil).toISOString(), detail: row.reason })
    }
    return { ...base, rows, complete: data.backups.complete && data.configs.complete && data.policies.complete && data.backups.data.every(b => b.complete), warnings: [...base.warnings, 'Retention categories describe file evidence, not reclaimable disk space or permission to delete backups.'] }
  }
  return { ...base, complete: data.backups.complete && data.policies.complete && data.backups.data.every(b => b.complete && !!b.latestPoint && b.latestPoint.state !== 'unavailable'), rows: ids.flatMap(id => hygieneAnalysis(data, id).filter(r => r.backup.repositoryId === id).map(r => ({ id: r.backup.id, name: r.backup.name || r.backup.id, ...repository(id), job: r.policy?.name || null, status: r.attention ? 'Needs review' : r.flags.length ? 'Evidence notice' : 'No findings reported', issues: r.flags.map(f => f.label).join('; '), findings: r.flags.filter(f => f.attention).length, size: r.bytes, age: r.latestPoint === null ? null : Math.max(0, (now - r.latestPoint) / DAY), time: r.latestPoint === null ? null : new Date(r.latestPoint).toISOString(), latestFile: r.latestFile === null ? null : new Date(r.latestFile).toISOString() }))) }
}
