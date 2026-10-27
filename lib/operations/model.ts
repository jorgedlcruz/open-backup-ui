import { z } from 'zod'

const text = z.string().nullish()
const number = z.number().finite().nullish()
export const jobSchema = z.object({
  id: z.string().min(1), name: z.string(), type: text, status: text, lastResult: text,
  lastRun: text, nextRun: text, nextRunPolicy: text, repositoryId: text, repositoryName: text,
  objectsCount: number, progressPercent: number, sessionId: text, highPriority: z.boolean().nullish(),
})
export const sessionSchema = z.object({
  id: z.string().min(1), jobId: text, name: z.string(), sessionType: z.string(), state: z.string(),
  creationTime: z.string(), endTime: text, progressPercent: number,
  result: z.object({ result: text, message: text }).nullish(),
})
export const repositorySchema = z.object({
  id: z.string().min(1), name: z.string(), type: text, capacityGB: number, freeGB: number,
  usedSpaceGB: number, isOnline: z.boolean().nullish(), isOutOfDate: z.boolean().nullish(),
  // An extent reports its parent. Aggregate capacity must not count both.
  scaleOutRepositoryDetails: z.object({ scaleOutRepositoryId: text }).nullish(),
})
export const securitySchema = z.object({ id: text, bestPractice: text, status: text })
export type OperationJob = z.infer<typeof jobSchema>
export type OperationSession = z.infer<typeof sessionSchema>
export type OperationRepository = z.infer<typeof repositorySchema>
export type Range = '24h' | '7d' | '30d'
export type Collection<T> = { data: T[]; available: boolean; complete: boolean }
export type OperationsSnapshot = {
  sourceName: string; fetchedAt: string; from: string; range: Range; warnings: string[]
  jobs: Collection<OperationJob>; sessions: Collection<OperationSession>
  repositories: Collection<OperationRepository>; security: Collection<z.infer<typeof securitySchema>>
}
export type JobFilter = 'attention' | 'running' | 'failed' | 'warning' | 'disabled' | 'all'

// Explicit protection activity types from the supplied VBR 1.3-rev2 specification.
// Restore, maintenance, discovery, policy parents and health checks are excluded.
const protectionTypes = new Set(['BackupJob', 'ReplicaJob', 'BackupCopyJob', 'AgentBackup',
  'EndpointBackup', 'UnstructuredDataBackupCopy', 'FileServerSave', 'SqlLogBackup',
  'OracleLogBackup', 'PostgreSqlLogBackup', 'PlatformBackupJob', 'PlatformSnapshotJob',
  'PlatformSnapshotCopyJob', 'AgentOperationBackupNow', 'AgentOperationActiveFull'])
export function isProtectionSession(session: OperationSession) { return protectionTypes.has(session.sessionType) }
export function isRunning(job: OperationJob) { return ['Running', 'Starting', 'Stopping'].includes(job.status || '') }
export function needsAttention(job: OperationJob) { return !isRunning(job) && ['Failed', 'Warning'].includes(job.lastResult || '') }
export function jobStatus(job: OperationJob) {
  if (isRunning(job)) return job.status || 'Running'
  if (job.status === 'Disabled') return 'Disabled'
  return ['Success', 'Warning', 'Failed'].includes(job.lastResult || '') ? job.lastResult! : 'Unknown'
}
export function filterJobs(jobs: OperationJob[], filter: JobFilter, search: string) {
  const query = search.trim().toLowerCase()
  return jobs.filter(job => (!query || [job.name, job.type, job.repositoryName].some(v => v?.toLowerCase().includes(query))) && (
    filter === 'all' || (filter === 'attention' && needsAttention(job)) ||
    (filter === 'running' && isRunning(job)) || (filter === 'disabled' && job.status === 'Disabled') ||
    (filter === 'failed' && !isRunning(job) && job.lastResult === 'Failed') ||
    (filter === 'warning' && !isRunning(job) && job.lastResult === 'Warning')
  )).sort((a, b) => {
    const rank = (j: OperationJob) => needsAttention(j) ? j.lastResult === 'Failed' ? 0 : 1 : isRunning(j) ? 2 : 3
    return rank(a) - rank(b) || (Number(b.highPriority) || 0) - (Number(a.highPriority) || 0) || a.name.localeCompare(b.name)
  })
}
export function utilization(repo: OperationRepository): number | null {
  const { capacityGB: capacity, freeGB: free } = repo
  if (capacity == null || free == null || capacity <= 0 || free < 0 || free > capacity) return null
  return (capacity - free) / capacity * 100
}
export function repositoryRisk(repo: OperationRepository) {
  const used = utilization(repo)
  if (repo.isOnline === false) return 'Offline'
  if (used !== null && used >= 90) return 'Critical'
  if (used !== null && used >= 80) return 'Low space'
  if (repo.isOutOfDate) return 'Outdated'
  if (repo.isOnline == null || used === null) return 'Unknown'
  return 'Healthy'
}
export function capacitySummary(repositories: OperationRepository[]) {
  // Sum measurable extents and standalone records; shared backing volumes may overlap.
  const measured = capacityRepositories(repositories).filter(r => utilization(r) !== null)
  const total = measured.reduce((sum, r) => sum + r.capacityGB!, 0)
  const free = measured.reduce((sum, r) => sum + r.freeGB!, 0)
  return { total, free, used: total - free, percent: total > 0 ? (total - free) / total * 100 : null, measured: measured.length }
}
/** Repository values may overlap physical volumes; exclude known aggregate parents. */
export function capacityRepositories(repositories: OperationRepository[]) {
  const parentIds = new Set(repositories.map(r => r.scaleOutRepositoryDetails?.scaleOutRepositoryId).filter(Boolean))
  return repositories.filter(r => !parentIds.has(r.id) && r.type !== 'ScaleOut')
}
export const repositoryFilters = [
  {value:'all',label:'All repositories'}, {value:'attention',label:'Needs attention'},
  {value:'critical',label:'Critical capacity'}, {value:'offline',label:'Offline'},
  {value:'measured',label:'Measured capacity'}, {value:'unmeasured',label:'Unmeasured capacity'},
] as const
export type RepositoryFilter = typeof repositoryFilters[number]['value']
export function filterRepositories(repositories: OperationRepository[], filter: RepositoryFilter, search: string) {
  const query = search.trim().toLowerCase()
  const rows = filter === 'measured' || filter === 'unmeasured' ? capacityRepositories(repositories) : repositories
  return rows.filter(repo => repo.name.toLowerCase().includes(query) && (
    filter === 'all' ||
    (filter === 'attention' && ['Offline','Critical','Low space','Outdated'].includes(repositoryRisk(repo))) ||
    (filter === 'critical' && utilization(repo) !== null && utilization(repo)! >= 90) ||
    (filter === 'offline' && repo.isOnline === false) ||
    (filter === 'measured' && utilization(repo) !== null) ||
    (filter === 'unmeasured' && utilization(repo) === null)
  ))
}
export function sessionSummary(snapshot: OperationsSnapshot) {
  const start = Date.parse(snapshot.from), end = Date.parse(snapshot.fetchedAt)
  const sessions = snapshot.sessions.data.filter(s => isProtectionSession(s) && Date.parse(s.creationTime) >= start && Date.parse(s.creationTime) <= end)
  const completed = sessions.filter(s => s.state === 'Stopped' && ['Success', 'Warning', 'Failed'].includes(s.result?.result || ''))
  const success = completed.filter(s => s.result?.result === 'Success').length
  const warning = completed.filter(s => s.result?.result === 'Warning').length
  const failed = completed.filter(s => s.result?.result === 'Failed').length
  return { sessions, completed: completed.length, success, warning, failed, percent: completed.length ? success / completed.length * 100 : null }
}
export function activityBuckets(snapshot: OperationsSnapshot) {
  const start = Date.parse(snapshot.from), end = Date.parse(snapshot.fetchedAt)
  const count = snapshot.range === '24h' ? 24 : snapshot.range === '7d' ? 7 : 30
  const width = (end - start) / count
  const buckets = Array.from({ length: count }, (_, i) => ({ timestamp: start + i * width, Success: 0, Warning: 0, Failed: 0 }))
  for (const session of sessionSummary(snapshot).sessions) {
    const result = session.result?.result
    if (session.state !== 'Stopped' || !['Success', 'Warning', 'Failed'].includes(result || '')) continue
    const index = Math.min(count - 1, Math.floor((Date.parse(session.creationTime) - start) / width))
    if (index >= 0) buckets[index][result as 'Success' | 'Warning' | 'Failed']++
  }
  return buckets
}
export function exportJobsCsv(jobs: OperationJob[]) {
  const quote = (value: unknown) => {
    let safe = String(value ?? '')
    if (/^[\s]*[=+@-]|^[\t\r\n]/.test(safe)) safe = `'${safe}`
    return `"${safe.replace(/"/g, '""')}"`
  }
  return [['Job', 'Type', 'Current state', 'Last result', 'Last run', 'Next run', 'Repository'],
    ...jobs.map(j => [j.name, j.type, j.status, j.lastResult, j.lastRun, j.nextRun, j.repositoryName])]
    .map(row => row.map(quote).join(',')).join('\r\n')
}
