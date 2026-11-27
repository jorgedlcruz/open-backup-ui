// Open Backup UI v1.3.0
export type EntraInventoryWarning = 'partialTenants' | 'partialJobs' | 'jobsUnavailable' | 'partialJobStates'
  | 'jobStatesUnavailable' | 'partialRepositories' | 'repositoriesUnavailable' | 'restorePointsUnavailable'

export type EntraTenant = {
  id: string
  azureTenantId: string | null
  name: string | null
  description: string | null
  region: string | null
  cacheRepositoryId: string
  cacheRepositoryName: string | null
  backupJobs: { id: string; name: string }[]
  lastRun: { jobId: string; jobName: string; time: string; result: string | null } | null
}

export type EntraInventory = {
  sourceName: string
  sourceKey: string
  fetchedAt: string
  tenants: EntraTenant[]
  tenantInventoryComplete: boolean
  jobsAvailable: boolean
  jobsComplete: boolean
  jobStatesAvailable: boolean
  jobStatesComplete: boolean
  backupJobCount: number | null
  latestRestorePoint: { id: string; name: string | null; creationTime: string } | null
  restorePointsAvailable: boolean
  warnings: EntraInventoryWarning[]
}
