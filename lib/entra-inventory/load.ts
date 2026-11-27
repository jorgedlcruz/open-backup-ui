// Open Backup UI v1.3.0
import { z } from 'zod'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import type { EntraInventory, EntraInventoryWarning, EntraTenant } from './model'

type Read = (path: string) => Promise<unknown>
const guid = z.string().regex(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i).transform(value => value.toLowerCase())
const text = z.string().nullish()
// All tenant API versions can return authentication material. Project only public inventory fields.
const tenantSchema = z.object({
  id: guid, azureTenantId: guid.nullish(), cacheRepositoryId: guid, name: text, description: text, region: text,
})
const repositorySchema = z.object({ id: guid, name: z.string() })
const backupType = 'EntraIDTenantBackup'
const jobSchema = z.object({ id: guid, name: z.string(), type: z.literal(backupType), storage: z.object({ tenantId: guid }) })
const stateSchema = z.object({ id: guid, type: z.literal(backupType), lastRun: text, lastResult: text })
const pointSchema = z.object({ id: guid, name: text, platformName: z.literal('EntraID'), creationTime: z.string().datetime({offset:true}) })

async function optional<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request
  } catch (error) {
    if (error instanceof TopologyRequestError && error.status === 401) throw error
    return null
  }
}

async function readLatestPoint(read: Read) {
  const response = await read('/api/v1/restorePoints?platformNameFilter=EntraID&orderColumn=CreationTime&orderAsc=false&skip=0&limit=1')
  const page = z.object({
    data: z.array(pointSchema).max(1), pagination: z.object({ total: z.number().int().nonnegative() }).optional(),
  }).parse(response)
  if (page.pagination && Math.min(1, page.pagination.total) !== page.data.length) throw new Error('Incomplete restore point page.')
  return page.data
}

export async function loadEntraInventory(read: Read, sourceName: string, sourceKey: string): Promise<EntraInventory> {
  const filter = '?typeFilter=' + backupType
  const [inventory, jobs, states, repositories, points] = await Promise.all([
    readOperationsCollection(read, '/api/v1/inventory/entraId/tenants', tenantSchema),
    optional(readOperationsCollection(read, '/api/v1/jobs' + filter, jobSchema)),
    optional(readOperationsCollection(read, '/api/v1/jobs/states' + filter, stateSchema)),
    optional(readOperationsCollection(read, '/api/v1/backupInfrastructure/repositories/states', repositorySchema)),
    optional(readLatestPoint(read)),
  ])
  const warnings: EntraInventoryWarning[] = []
  if (!inventory.complete) warnings.push('partialTenants')
  if (!jobs?.complete) warnings.push(jobs ? 'partialJobs' : 'jobsUnavailable')
  if (!states?.complete) warnings.push(states ? 'partialJobStates' : 'jobStatesUnavailable')
  if (!repositories?.complete) warnings.push(repositories ? 'partialRepositories' : 'repositoriesUnavailable')
  if (!points) warnings.push('restorePointsUnavailable')

  const repositoryNames = new Map(repositories?.data.map(repository => [repository.id, repository.name]))
  const stateByJob = new Map(states?.data.map(state => [state.id, state]))
  const tenants: EntraTenant[] = inventory.data.map(tenant => ({
    id: tenant.id, name: tenant.name ?? null, description: tenant.description ?? null, region: tenant.region ?? null,
    azureTenantId: tenant.azureTenantId ?? null, cacheRepositoryId: tenant.cacheRepositoryId,
    cacheRepositoryName: repositoryNames.get(tenant.cacheRepositoryId) ?? null, backupJobs: [], lastRun: null,
  }))
  const tenantById = new Map(tenants.map(tenant => [tenant.id, tenant]))
  for (const job of jobs?.data ?? []) {
    // storage.tenantId is VBR's inventory ID; azureTenantId and display names are different identities.
    const tenant = tenantById.get(job.storage.tenantId)
    if (!tenant) continue
    tenant.backupJobs.push({ id: job.id, name: job.name })
    const state = stateByJob.get(job.id)
    const lastRun = state?.lastRun
    if (!lastRun || lastRun.startsWith('0001-') || !Number.isFinite(Date.parse(lastRun))) continue
    if (!tenant.lastRun || Date.parse(lastRun) > Date.parse(tenant.lastRun.time)) {
      tenant.lastRun = { jobId: job.id, jobName: job.name, time: lastRun, result: state?.lastResult ?? null }
    }
  }
  const point = points?.[0]
  return {
    sourceName, sourceKey, fetchedAt: new Date().toISOString(), tenants, tenantInventoryComplete: inventory.complete,
    jobsAvailable: !!jobs, jobsComplete: jobs?.complete ?? false, jobStatesAvailable: !!states,
    jobStatesComplete: states?.complete ?? false, backupJobCount: jobs?.data.length ?? null,
    latestRestorePoint: point ? { id: point.id, name: point.name ?? null, creationTime: point.creationTime } : null,
    restorePointsAvailable: !!points, warnings,
  }
}
