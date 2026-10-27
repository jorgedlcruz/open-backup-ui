import { z } from 'zod'
import { repositorySchema, jobSchema, type OperationJob } from '../operations/model'
import { uuid, validId, type Evidence } from '../investigation/model'
import { knownSize } from '../restore-points/model'

const text = z.string().nullish()
const number = z.number().finite().nullish()
const bool = z.boolean().nullish()
const id = z.string().regex(uuid).transform(value => value.toLowerCase())
const reference = text.transform(value => value?.toLowerCase())
const immutability = z.object({ isEnabled: bool, daysCount: number, immutabilityMode: text }).nullish()
const storage = z.object({
  bucketName: text, containerName: text, folderName: text, folder: text, immutability,
  storageConsumptionLimit: z.object({ isEnabled: bool, consumptionLimitCount: number, consumptionLimitKind: text }).nullish(),
}).nullish()
// Deliberately whitelist display fields. Account/credential configuration never leaves the server.
export const configSchema = z.object({
  id, name: text, description: text, type: text, taskLimitEnabled: bool, maxTaskCount: number,
  repository: z.object({
    path: text, taskLimitEnabled: bool, enableTaskLimit: bool, maxTaskCount: number,
    useFastCloningOnXFSVolumes: bool, makeRecentBackupsImmutableDays: number,
    enableGovernanceMode: bool, governanceModeRetentionDays: number,
    advancedSettings: z.object({ perVmBackup: bool, rotatedDrives: bool, decompressBeforeStoring: bool }).nullish(),
  }).nullish(),
  bucket: storage, container: storage,
})
export const stateSchema = repositorySchema.extend({
  id, hostName: text, path: text, description: text,
  scaleOutRepositoryDetails: z.object({ scaleOutRepositoryId: reference, membership: text, extentType: text }).nullish(),
})
const extent = z.object({ id, name: text, status: z.array(z.string()).nullish() })
export const scaleOutSchema = z.object({
  id, name: z.string(), description: text,
  performanceTier: z.object({ performanceExtents: z.array(extent) }).nullish(),
  capacityTier: z.object({ isEnabled: bool, extents: z.array(extent).nullish(), copyPolicyEnabled: bool, movePolicyEnabled: bool, operationalRestorePeriodDays: number }).nullish(),
  archiveTier: z.object({ isEnabled: bool, extentId: reference, archivePeriodDays: number }).nullish(),
})
export const backupSchema = z.object({
  id, name: text, jobId: reference, repositoryId: reference, repositoryName: text, jobType: text, creationTime: text,
})
export const fileSchema = z.object({
  id, backupId: reference, backupSize: number, dataSize: number, creationTime: text,
  objectIds: z.array(z.string()).nullish(), restorePointIds: z.array(z.string()).nullish(),
})
export const repositoryJobSchema = jobSchema.extend({ id, repositoryId: reference, sessionId: reference })
export type RepositoryConfig = z.infer<typeof configSchema>
export type RepositoryState = z.infer<typeof stateSchema>
export type ScaleOut = z.infer<typeof scaleOutSchema>
export type Backup = z.infer<typeof backupSchema>
export type File = z.infer<typeof fileSchema>
export type Extent = { id: string; name: string; tier: string; status: string[]; state: RepositoryState | null; config: RepositoryConfig | null }
export type Consumption = {
  files: number; physical: number | null; logical: number | null; unknownPhysical: number; unknownLogical: number;
  shared: number; conflicts: number; latest: string | null; complete: boolean;
}
export type BackupConsumption = Backup & { consumption: Consumption; available: boolean; error?: string }
export type AffectedJob = { id: string; name: string; job: OperationJob | null; relationships: string[]; backups: number }
export type RepositorySnapshot = {
  id: string; name: string; sourceName: string; fetchedAt: string; apiRevision: string; warnings: string[];
  state: RepositoryState | null; config: RepositoryConfig | null; scaleOut: ScaleOut | null;
  parents: { id: string; name: string }[]; extents: Extent[];
  backups: Evidence<BackupConsumption>; consumption: Consumption; parentBackups: number;
  jobs: Evidence<AffectedJob> & { statesAvailable: boolean };
}
export const repositoryHref = (id: string) => `/vbr/infrastructure/repositories/${encodeURIComponent(id)}`
export const reportedGB = (value?: number | null) => value != null && Number.isFinite(value) && value >= 0
  ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} GB` : 'Not reported'
export const yesNo = (value?: boolean | null) => value === true ? 'Enabled' : value === false ? 'Disabled' : 'Not reported'
export function configuredImmutability(config: RepositoryConfig | null): { status: string; period: string; mode: string; evidence: string } {
  const missing = { status: 'Not reported', period: 'Not reported', mode: 'Not reported', evidence: 'No immutability setting returned for this repository.' }
  if (!config) return missing
  const days = (value?: number | null) => value != null && Number.isInteger(value) && value > 0 ? `${value} days` : 'Not reported'
  if (config.type === 'LinuxHardened') {
    const period = days(config.repository?.makeRecentBackupsImmutableDays)
    return { status: period === 'Not reported' ? 'Not reported' : 'Configured', period, mode: 'Hardened repository', evidence: 'Recent-backup immutability period reported by VBR.' }
  }
  if (config.type === 'LinuxLocal' && config.repository?.enableGovernanceMode != null) {
    return { status: yesNo(config.repository.enableGovernanceMode), period: config.repository.enableGovernanceMode ? days(config.repository.governanceModeRetentionDays) : 'Not applicable',
      mode: 'Governance', evidence: 'Linux repository governance-mode setting.' }
  }
  const setting = config.bucket?.immutability || config.container?.immutability
  if (!setting) return missing
  return { status: yesNo(setting.isEnabled), period: setting.isEnabled === false ? 'Not applicable' : setting.immutabilityMode === 'RetentionSettings' ? 'Follows backup retention' : days(setting.daysCount),
    mode: setting.immutabilityMode === 'RetentionSettings' ? 'Backup retention' : setting.immutabilityMode === 'RepositorySettings' ? 'Repository period' : 'Not reported',
    evidence: `${config.bucket ? 'Bucket' : 'Container'} immutability configuration.` }
}
export function extentReferences(sobr: ScaleOut) {
  const items = [
    ...(sobr.performanceTier?.performanceExtents || []).map(e => ({ ...e, tier: 'Performance' })),
    ...(sobr.capacityTier?.extents || []).map(e => ({ ...e, tier: sobr.capacityTier?.isEnabled === false ? 'Capacity (disabled)' : 'Capacity' })),
    ...(validId(sobr.archiveTier?.extentId) ? [{ id: sobr.archiveTier.extentId, name: null, status: [], tier: sobr.archiveTier.isEnabled === false ? 'Archive (disabled)' : 'Archive' }] : []),
  ]
  return [...new Map(items.map(item => [item.id, item])).values()]
}
export function summarizeFiles(files: File[], complete: boolean): Consumption {
  const unique = new Map<string, File>(), conflicts = new Set<string>()
  for (const file of files) {
    const previous = unique.get(file.id)
    if (previous && (previous.backupId !== file.backupId || previous.backupSize !== file.backupSize || previous.dataSize !== file.dataSize)) conflicts.add(file.id)
    else unique.set(file.id, previous ? { ...file, objectIds: [...new Set([...(previous.objectIds || []), ...(file.objectIds || [])])] } : file)
  }
  for (const id of conflicts) unique.delete(id)
  const rows = [...unique.values()]
  const sum = (key: 'backupSize' | 'dataSize') => {
    const known = rows.map(f => knownSize(f[key])).filter((v): v is number => v !== null)
    const total = known.reduce((a, b) => a + b, 0)
    return { total: (known.length || (!files.length && complete)) && Number.isSafeInteger(total) ? total : null, unknown: rows.length - known.length }
  }
  const physical = sum('backupSize'), logical = sum('dataSize')
  const times = rows.map(f => f.creationTime).filter((t): t is string => !!t && Number.isFinite(Date.parse(t))).sort((a, b) => Date.parse(b) - Date.parse(a))
  return { files: rows.length, physical: physical.total, logical: logical.total, unknownPhysical: physical.unknown, unknownLogical: logical.unknown,
    shared: rows.filter(f => new Set(f.objectIds || []).size > 1).length, conflicts: conflicts.size, latest: times[0] || null,
    complete: complete && !conflicts.size && physical.unknown === 0 && physical.total !== null }
}
export function affectedJobs(jobs: OperationJob[], backups: Backup[], directIds: Set<string>, parentIds: Set<string>): AffectedJob[] {
  const result = new Map<string, AffectedJob>()
  for (const job of jobs) {
    const relationships = directIds.has(job.repositoryId || '') ? ['Configured target']
      : parentIds.has(job.repositoryId || '') ? ['Via scale-out parent'] : []
    if (relationships.length) result.set(job.id, { id: job.id, name: job.name, job, relationships, backups: 0 })
  }
  for (const backup of backups) {
    if (!validId(backup.jobId)) continue
    const existing = result.get(backup.jobId), job = jobs.find(j => j.id === backup.jobId) || null
    const row = existing || { id: backup.jobId, name: job?.name || backup.name || backup.jobId, job, relationships: [], backups: 0 }
    if (!row.relationships.includes('Retained backup')) row.relationships.push('Retained backup')
    row.backups++; result.set(row.id, row)
  }
  const rank = (row: AffectedJob) => row.job?.lastResult === 'Failed' ? 0 : row.job?.lastResult === 'Warning' ? 1 : 2
  return [...result.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}
