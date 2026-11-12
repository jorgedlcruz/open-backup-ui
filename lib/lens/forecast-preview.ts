// Open Backup UI v1.2.0
import { capacityTrend, DAY, GB, dayStart, projectBackup, repositoryBackups, uniqueFiles, type ForecastSnapshot } from '../forecast/model'

type Point = { at: number; bytes: number }
export type ForecastPreview = {
  repositoryId: string; name: string; mode: 'files' | 'capacity'; fetchedAt: string
  current: number; projected: number | null; history: Point[]; future: Point[]
  stale: boolean; refreshing: boolean; partial: boolean
}

// A sampled repository stays stable for the lifetime of this cached snapshot.
function sampleOrder(value: string) {
  let hash = 2166136261
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

/** Small presentation-only projection; never fetches or writes capacity history. */
export function forecastPreview(snapshot: ForecastSnapshot | null): ForecastPreview | null {
  if (!snapshot) return null
  const now = Date.parse(snapshot.fetchedAt)
  if (!Number.isFinite(now)) return null
  const parents = new Set(snapshot.scaleOut.data.map(repo => repo.id))
  const repositories = snapshot.repositories.data.filter(repo => repo.type !== 'ScaleOut' && !parents.has(repo.id))
    .sort((a, b) => sampleOrder(snapshot.fetchedAt + a.id) - sampleOrder(snapshot.fetchedAt + b.id) || a.id.localeCompare(b.id))
  let fallback: ForecastPreview | null = null
  for (const repo of repositories) {
    const base = { repositoryId: repo.id, name: repo.name || repo.id, fetchedAt: snapshot.fetchedAt,
      stale: snapshot.cache?.stale ?? false, refreshing: snapshot.cache?.refreshing ?? false }
    const rows = repositoryBackups(snapshot, repo.id).map(backup => ({ backup,
      projection: projectBackup(backup, snapshot.policies.data.find(policy => policy.id === backup.jobId), snapshot.configs.data.find(config => config.id === backup.repositoryId), now, 30),
    }))
    const modeled = rows.filter(row => row.projection.values.length === 31)
    if (modeled.length) {
      const files = uniqueFiles(modeled.flatMap(row => row.backup.files.filter(file => row.projection.modeledFileIds?.includes(file.id))))
      // Shared file identities across backups cannot be summed into independent forecasts.
      const ids = modeled.flatMap(row => row.projection.modeledFileIds || [])
      if (!files.conflicts && new Set(ids).size === ids.length) {
        const future = Array.from({ length: 31 }, (_, i) => ({ at: now + i * DAY, bytes: modeled.reduce((sum, row) => sum + row.projection.values[i].bytes, 0) }))
        const history = Array.from({ length: 31 }, (_, i) => {
          const at = i === 30 ? now : dayStart(now) - (30 - i) * DAY
          return { at, bytes: files.files.filter(file => Date.parse(file.creationTime || '') <= at).reduce((sum, file) => sum + (file.backupSize ?? 0), 0) }
        })
        return { ...base, mode: 'files', current: future[0].bytes, projected: future[30].bytes, history, future,
          partial: !snapshot.repositories.complete || !snapshot.backups.complete || !snapshot.policies.complete || !snapshot.configs.complete || modeled.length !== rows.length || modeled.some(row => !!row.projection.excludedFiles) }
      }
    }
    const trend = capacityTrend(snapshot.observations, repo.id, now, 30)
    const history = trend.history.map(point => ({ at: Date.parse(point.at), bytes: (point.capacityGB - point.freeGB) * GB }))
    const capacityKnown = Number.isFinite(repo.capacityGB) && repo.capacityGB! > 0 && Number.isFinite(repo.freeGB) && repo.freeGB! >= 0 && repo.freeGB! <= repo.capacityGB!
    const current = history.at(-1)?.bytes ?? (capacityKnown ? (repo.capacityGB! - repo.freeGB!) * GB : null)
    if (current === null) continue
    // Bound the miniature payload while keeping the first and last recorded samples.
    const sampled = history.length > 61 ? Array.from({ length: 61 }, (_, i) => history[Math.round(i * (history.length - 1) / 60)]) : history
    const preview: ForecastPreview = { ...base, mode: 'capacity', current, projected: trend.values.at(-1)?.bytes ?? null,
      history: sampled.length ? sampled : [{ at: now, bytes: current }], future: trend.values,
      partial: !snapshot.repositories.complete || !snapshot.historyAvailable }
    if (preview.future.length) return preview
    fallback ??= preview
  }
  return fallback
}
