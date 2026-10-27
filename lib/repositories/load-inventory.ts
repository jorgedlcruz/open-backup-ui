import { z } from 'zod'
import type { VbrReader } from '../server/vbr-read'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import { revisionForBuild, type Evidence } from '../investigation/model'
import { configSchema, stateSchema, scaleOutSchema } from './model'
import type { RepositoryInventory } from './inventory'

export async function loadRepositoryInventory(raw: VbrReader, sourceName: string, now = new Date()): Promise<RepositoryInventory> {
  const warnings: string[] = []
  let revision: '1.3-rev1' | '1.3-rev2' = '1.3-rev1'
  try { revision = revisionForBuild(z.object({ buildVersion: z.string() }).parse(await raw('/api/v1/serverInfo')).buildVersion) }
  catch (error) {
    if (error instanceof TopologyRequestError && error.status === 401) throw error
    warnings.push('Server version unavailable. Newer settings may not be reported with API 1.3-rev1.')
  }
  const read = (path: string) => raw(path, revision)
  async function optional<T>(label: string, work: Promise<Evidence<T>>): Promise<Evidence<T>> {
    try {
      const result = await work
      if (!result.complete) warnings.push(`${label}: partial collection. Counts describe loaded records only.`)
      return result
    } catch (error) {
      if (error instanceof TopologyRequestError && error.status === 401) throw error
      const reason = error instanceof TopologyRequestError && error.status === 403 ? 'Your account cannot read these records.'
        : error instanceof z.ZodError ? 'The response did not match the expected fields.' : 'The source could not return these records.'
      warnings.push(`${label} unavailable. ${reason}`)
      return { data: [], available: false, complete: false, error: reason }
    }
  }
  const [states, configs, scaleOuts] = await Promise.all([
    optional('Repository states', readOperationsCollection(read, '/api/v1/backupInfrastructure/repositories/states', stateSchema)),
    optional('Repository configuration', readOperationsCollection(read, '/api/v1/backupInfrastructure/repositories', configSchema)),
    optional('Scale-out repositories', readOperationsCollection(read, '/api/v1/backupInfrastructure/scaleOutRepositories', scaleOutSchema)),
  ])
  if (![states, configs, scaleOuts].some(s => s.available)) throw new TopologyRequestError('Repository inventory could not be loaded. Check the source connection and read permissions.', 502)
  return { sourceName, fetchedAt: now.toISOString(), apiRevision: revision, warnings, states, configs, scaleOuts }
}
