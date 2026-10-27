import { z } from 'zod'
import { knownSize } from '../restore-points/model'
import { time } from '../investigation/model'

const text = z.string().nullish()
const ref = text.transform(value => value?.toLowerCase())
const id = z.string().min(1).transform(value => value.toLowerCase())
const bool = z.boolean().nullish()
const number = z.union([z.number(), z.string()]).nullish().transform(value => {
  const n = typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : null
})
// Only display evidence is returned. Credentials, account settings and API links are excluded.
export const jobSchema = z.object({ id, name: text, description: text, backupType: text, organizationId: ref, repositoryId: ref,
  lastRun: text, lastBackup: text, nextRun: text, isEnabled: bool, lastStatus: text,
  schedulePolicy: z.object({ scheduleEnabled: bool, type: text, dailyType: text, dailyTime: text, retryEnabled: bool, retryNumber: number }).nullish() })
export const sessionSchema = z.object({ id, jobId: ref, repositoryId: ref, mainSessionId: ref, details: text, creationTime: text, endTime: text,
  retryCount: number, jobWillBeRetried: bool, progress: number, jobType: text, status: text,
  statistics: z.object({ processingRateBytesPS: number, processingRateItemsPS: number, readRateBytesPS: number, writeRateBytesPS: number,
    transferredDataBytes: number, processedObjects: number, bottleneck: text }).nullish() })
export const repositorySchema = z.object({ id, name: text, description: text, path: text, capacityBytes: number, freeSpaceBytes: number,
  isOutdated: bool, isOutOfSync: bool, isOutOfOrder: bool, outOfOrderReason: text, maintenanceMode: text,
  retentionType: text, retentionPeriodType: text, dailyRetentionPeriod: text, monthlyRetentionPeriod: text, yearlyRetentionPeriod: text,
  objectStorage: z.object({ id: ref, type: text, sizeLimitEnabled: bool, sizeLimitGB: number, usedSpaceBytes: number, freeSpaceBytes: number,
    enableImmutability: bool, enableImmutabilityGovernanceMode: bool, immutabilityPeriodDays: number }).nullish() })
export const organizationSchema = z.object({ id, name: text, type: text, backedUpOrganizationId: ref })
export const usageSchema = z.object({ repositoryId: id, usedSpaceBytes: number, localCacheUsedSpaceBytes: number, objectStorageUsedSpaceBytes: number, isAvailable: bool, protectedObjectsCount: number })
export const protectedSchema = z.object({ id, displayName: text, name: text, organizationId: ref, backedUpOrganizationId: ref })
export const licensedSchema = z.object({ id, name: text, isBackedUp: bool, lastBackupDate: text, licenseState: text, organizationId: ref, backedUpOrganizationId: ref, organizationName: text })
export const licenseSchema = z.object({ licensedTo: text, email: text, supportID: text, usedNumber: number, totalNumber: number, newNumber: number,
  type: text, package: text, status: text, licenseExpires: text, gracePeriodExpires: text })
export const healthSchema = z.object({ status: text, entries: z.record(z.string(), z.object({ status: text, description: text }).nullish()).nullish() })
export const versionSchema = z.object({ version: text })
export type Job = z.infer<typeof jobSchema>
export type Session = z.infer<typeof sessionSchema>
export type Repository = z.infer<typeof repositorySchema>
export type Licensed = z.infer<typeof licensedSchema>
export type Evidence<T> = { data: T[]; available: boolean; complete: boolean; error?: string }
export const kinds = ['Users', 'Groups', 'Sites', 'Teams'] as const
export type Kind = typeof kinds[number]
export type Snapshot = {
  sourceName: string; fetchedAt: string; days: 7|30; warnings: string[];
  jobs: Evidence<Job>; sessions: Evidence<Session>; repositories: Evidence<Repository>;
  organizations: Evidence<z.infer<typeof organizationSchema>>;
  usage: { organizationId: string; evidence: Evidence<z.infer<typeof usageSchema>> }[];
  protected: Record<Kind, Evidence<z.infer<typeof protectedSchema>>>; licensed: Evidence<Licensed>;
  license: z.infer<typeof licenseSchema> | null; health: z.infer<typeof healthSchema> | null; version: z.infer<typeof versionSchema> | null;
}
export const status = (value?: string|null) => value === 'Succeeded' ? 'Success' : value || 'Not reported'
export const failed = (value?: string|null) => ['Failed','Warning'].includes(status(value))
export function latestSession(job: Job, rows: Session[]) {
  return rows.filter(row => row.jobId === job.id).sort((a,b)=>(time(b.creationTime) ?? -Infinity)-(time(a.creationTime) ?? -Infinity) || a.id.localeCompare(b.id))[0]
}
export type JobIssue = 'all'|'attention'|'failed'|'warning'|'running'|'disabled'|'unscheduled'|'unknown'
export function jobMatches(job: Job, issue: JobIssue) {
  const result = status(job.lastStatus)
  return issue === 'all' || (issue === 'attention' ? failed(result) || job.isEnabled === false || job.schedulePolicy?.scheduleEnabled === false
    : issue === 'failed' ? result === 'Failed' : issue === 'warning' ? result === 'Warning' : issue === 'running' ? result === 'Running'
      : issue === 'disabled' ? job.isEnabled === false : issue === 'unscheduled' ? job.schedulePolicy?.scheduleEnabled === false
        : !['Success','Warning','Failed','Running','Stopped'].includes(result) || job.isEnabled == null)
}
export function capacity(repository: Repository) {
  const diskTotal = knownSize(repository.capacityBytes), diskFree = knownSize(repository.freeSpaceBytes)
  const disk = diskTotal !== null && diskTotal > 0 && diskFree !== null && diskFree <= diskTotal
    ? { total: diskTotal, free: diskFree, used: diskTotal-diskFree, percent: (diskTotal-diskFree)/diskTotal*100 } : null
  const object = repository.objectStorage
  const objectUsed = knownSize(object?.usedSpaceBytes), objectFree = knownSize(object?.freeSpaceBytes)
  // Object quota headroom is separate from local disk/cache space. Unlimited storage has no utilization percentage.
  const objectTotal = objectUsed !== null && objectFree !== null && Number.isSafeInteger(objectUsed+objectFree) ? objectUsed+objectFree : null
  const quota = object?.sizeLimitEnabled === true && objectTotal !== null && objectTotal > 0
    ? { total: objectTotal, free: objectFree!, used: objectUsed!, percent: objectUsed!/objectTotal*100 } : null
  return { disk, quota, objectUsed, objectFree, primary: object ? quota : disk, scope: object ? 'Object-storage quota' : 'Local disk' }
}
export function repositoryIssues(repository: Repository, snapshot: Snapshot) {
  const reasons: string[] = [], cap = capacity(repository)
  if (snapshot.usage.some(org=>org.evidence.data.some(row=>row.repositoryId===repository.id && row.isAvailable===false))) reasons.push('Unavailable to an organization')
  if (repository.isOutOfOrder) reasons.push('Out of order')
  if (repository.isOutOfSync) reasons.push('Out of sync')
  if (repository.isOutdated) reasons.push('Update required')
  if (repository.maintenanceMode && !['None','Disabled'].includes(repository.maintenanceMode)) reasons.push(`Maintenance: ${repository.maintenanceMode}`)
  for (const [label,value] of [['Disk',cap.disk],['Object quota',cap.quota]] as const) if (value && value.percent>=80) reasons.push(`${label}: ${value.percent>=90 ? 'critical capacity':'low space'}`)
  return reasons
}
export function cacheObjectUsage(snapshot: Snapshot) {
  const rows = snapshot.usage.flatMap(org=>org.evidence.data)
  const values = rows.flatMap(row=>[knownSize(row.localCacheUsedSpaceBytes),knownSize(row.objectStorageUsedSpaceBytes)])
  const measured = values.filter((n):n is number=>n!==null), total = measured.reduce((a,b)=>a+b,0)
  const complete = snapshot.organizations.available && snapshot.organizations.complete && snapshot.usage.length===snapshot.organizations.data.length
    && snapshot.usage.every(org=>org.evidence.available && org.evidence.complete) && values.every(n=>n!==null) && Number.isSafeInteger(total)
  return { total: (measured.length || (complete && !rows.length)) && Number.isSafeInteger(total) ? total : null, complete, rows: rows.length }
}
export function licensedIssue(user: Licensed, now: number, hours=24) {
  if (user.isBackedUp === false) return 'No backup reported'
  const t = time(user.lastBackupDate)
  if (user.isBackedUp !== true || t === null || t > now) return 'Unknown evidence'
  return now-t>hours*3600000 ? `Older than ${hours}h` : 'Within threshold'
}
export type SessionFilters = { query: string; statuses: string[]; types: string[]; day: string|null }
export function filterSessions(rows: Session[], jobs: Job[], filters: SessionFilters) {
  const names = new Map(jobs.map(job=>[job.id,job.name]))
  return rows.filter(row=>(!filters.statuses.length || filters.statuses.includes(status(row.status)))
    && (!filters.types.length || filters.types.includes(row.jobType || 'Not reported'))
    && (!filters.day || (time(row.creationTime)!==null && new Date(row.creationTime!).toISOString().slice(0,10)===filters.day))
    && [row.id,row.jobId,names.get(row.jobId || ''),row.details,row.jobType].join(' ').toLowerCase().includes(filters.query.trim().toLowerCase()))
}
export function sessionStats(rows: Session[]) {
  const success = rows.filter(s=>status(s.status)==='Success').length
  const warning = rows.filter(s=>status(s.status)==='Warning').length, failed = rows.filter(s=>status(s.status)==='Failed').length
  return { success, warning, failed, running: rows.filter(s=>status(s.status)==='Running').length,
    recordedRate: rows.length ? success/rows.length*100 : null, completedRate: success+warning+failed ? success/(success+warning+failed)*100 : null }
}
export function dailySessions(rows: Session[], now: string, days: number) {
  const end = new Date(now); end.setUTCHours(0,0,0,0)
  return Array.from({length:days},(_,index)=>{
    const key = new Date(end.getTime()-(days-1-index)*86400000).toISOString().slice(0,10)
    const day = rows.filter(s=>time(s.creationTime)!==null && new Date(s.creationTime!).toISOString().slice(0,10)===key)
    const stats = sessionStats(day)
    return { day:key, ...stats, other:day.length-stats.success-stats.warning-stats.failed-stats.running,total:day.length }
  })
}
export function sessionExport(rows: Session[], jobs: Job[]) {
  return rows.map(row=>({status:status(row.status),jobName:jobs.find(job=>job.id===row.jobId)?.name || row.jobId || 'Job not reported',type:row.jobType || '',
    date:time(row.creationTime)!==null ? new Date(row.creationTime!).toLocaleDateString() : '',time:time(row.creationTime)!==null ? new Date(row.creationTime!).toLocaleTimeString() : '',
    id:row.id,jobId:row.jobId,creationTime:row.creationTime,endTime:row.endTime,details:row.details}))
}
export const csvCell = (value: unknown) => {const text = String(value ?? '');return `"${(/^[=+\-@\t\r]/.test(text) ? "'"+text : text).replaceAll('"','""')}"`}
