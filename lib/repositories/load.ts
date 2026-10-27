import { z } from 'zod'
import type { VbrReader } from '../server/vbr-read'
import { TopologyRequestError } from '../topology/load'
import { readOperationsCollection } from '../operations/load'
import { revisionForBuild, validId, type Evidence } from '../investigation/model'
import { configSchema, stateSchema, scaleOutSchema, backupSchema, fileSchema, repositoryJobSchema,
  extentReferences, affectedJobs, summarizeFiles, type File, type BackupConsumption, type RepositorySnapshot, type RepositoryConfig } from './model'

export async function loadRepository(raw: VbrReader, sourceName: string, id: string, now = new Date()): Promise<RepositorySnapshot> {
  const warnings: string[] = []
  let revision: '1.3-rev1' | '1.3-rev2' = '1.3-rev1'
  try {
    revision = revisionForBuild(z.object({ buildVersion: z.string() }).parse(await raw('/api/v1/serverInfo')).buildVersion)
  } catch (error) {
    if (error instanceof TopologyRequestError && error.status === 401) throw error
    warnings.push('Server version unavailable. Using API 1.3-rev1; newer settings may not be reported.')
  }
  const read = (path: string) => raw(path, revision)
  async function optional<T>(label: string, work: Promise<Evidence<T>>): Promise<Evidence<T>> {
    try {
      const value = await work
      if (!value.complete) warnings.push(`${label}: partial collection. Only loaded records are included.`)
      return value
    } catch (error) {
      if (error instanceof TopologyRequestError && error.status === 401) throw error
      const reason = error instanceof TopologyRequestError && error.status === 403 ? 'Your account cannot read these records.'
        : error instanceof z.ZodError ? 'The response did not match the expected fields.' : 'The source could not return these records.'
      warnings.push(`${label} unavailable. ${reason}`)
      return { data: [], available: false, complete: false, error: reason }
    }
  }
  const loadConfig = (repoId: string) => optional('Repository configuration', (async () => {
    const config = configSchema.parse(await read(`/api/v1/backupInfrastructure/repositories/${encodeURIComponent(repoId)}`))
    if (config.id !== repoId) throw new Error('Repository identity mismatch')
    return { data: [config], available: true, complete: true }
  })())
  const [states, sobrs, allBackups, allJobs] = await Promise.all([
    optional('Repository states', readOperationsCollection(read, '/api/v1/backupInfrastructure/repositories/states', stateSchema)),
    optional('Scale-out repositories', readOperationsCollection(read, '/api/v1/backupInfrastructure/scaleOutRepositories', scaleOutSchema)),
    optional('Backup inventory', readOperationsCollection(read, '/api/v1/backups', backupSchema)),
    optional('Job states', readOperationsCollection(read, '/api/v1/jobs/states', repositoryJobSchema)),
  ])
  const state = states.data.find(r => r.id === id) || null, scaleOut = sobrs.data.find(r => r.id === id) || null
  const config = scaleOut ? null : (await loadConfig(id)).data[0] || null
  if (!state && !scaleOut && !config) throw new TopologyRequestError('This repository is unavailable. Check its ID, source, and read permissions.', 404)
  const parentMap = new Map(sobrs.data.filter(s => extentReferences(s).some(e => e.id === id)).map(s => [s.id, { id: s.id, name: s.name }]))
  const stateParent = state?.scaleOutRepositoryDetails
  if (validId(stateParent?.scaleOutRepositoryId) && stateParent.scaleOutRepositoryId !== id && !parentMap.has(stateParent.scaleOutRepositoryId))
    parentMap.set(stateParent.scaleOutRepositoryId, { id: stateParent.scaleOutRepositoryId, name: stateParent.membership || stateParent.scaleOutRepositoryId })
  const parents = [...parentMap.values()]
  const refs = scaleOut ? extentReferences(scaleOut) : []
  // A parent can be recognized from states even when its configuration is unavailable.
  const stateChildren = states.data.filter(r => r.id !== id && r.scaleOutRepositoryDetails?.scaleOutRepositoryId === id)
  for (const child of stateChildren) if (!refs.some(r => r.id === child.id)) refs.push({ id: child.id, name: child.name, tier: child.scaleOutRepositoryDetails?.extentType || 'Not reported', status: [] })
  const configMap = new Map<string, RepositoryConfig>()
  let configIndex = 0
  await Promise.all(Array.from({ length: Math.min(4, refs.length) }, async () => {
    while (configIndex < Math.min(refs.length, 30)) {
      const ref = refs[configIndex++], config = (await loadConfig(ref.id)).data[0]
      if (config) configMap.set(ref.id, config)
    }
  }))
  if (refs.length > 30) warnings.push('Extent configuration is limited to 30 repositories. Remaining settings are not reported.')
  const extents = refs.map(ref => ({ id: ref.id, name: ref.name || states.data.find(s => s.id === ref.id)?.name || ref.id,
    tier: ref.tier, status: ref.status || [], state: states.data.find(s => s.id === ref.id) || null, config: configMap.get(ref.id) || null }))
  const directIds = new Set([id, ...refs.map(r => r.id)]), parentIds = new Set(parents.map(p => p.id))
  const scopedBackups = allBackups.data.filter(b => directIds.has(b.repositoryId || ''))
  const parentBackups = allBackups.data.filter(b => parentIds.has(b.repositoryId || '')).length
  const byBackup = new Map<string, Evidence<File>>()
  let backupIndex = 0
  await Promise.all(Array.from({ length: Math.min(4, scopedBackups.length) }, async () => {
    while (backupIndex < Math.min(scopedBackups.length, 30)) {
      const backup = scopedBackups[backupIndex++]
      // Preserve repeated records for conflict checks instead of allowing the generic
      // collection reader's ID map to silently overwrite contradictory sizes.
      const observed: File[] = []
      const files = await optional(`Files for ${backup.name || backup.id}`, readOperationsCollection(async path => {
        const result = await read(path)
        const page = z.object({ data: z.array(fileSchema) }).parse(result)
        observed.push(...page.data)
        return result
      }, `/api/v1/backups/${backup.id}/backupFiles`, fileSchema, 3000))
      if (files.available) {
        const loadedIds = new Set(files.data.map(f => f.id))
        files.data = observed.filter(f => loadedIds.has(f.id))
      }
      const scoped = files.data.filter(f => f.backupId === backup.id)
      if (scoped.length !== files.data.length) warnings.push(`Files for ${backup.name || backup.id}: unrelated records were excluded.`)
      // NAS and other workloads may return an empty collection despite having a
      // retained backup. An empty file endpoint is not evidence of zero usage.
      byBackup.set(backup.id, { ...files, data: scoped, complete: files.complete && scoped.length > 0 && scoped.length === files.data.length,
        error: files.error || (!scoped.length ? 'No file inventory returned; consumption is unmeasured.' : undefined) })
    }
  }))
  if (scopedBackups.length > 30) warnings.push('File inventory is limited to 30 backups per refresh. Other backups remain listed with unmeasured consumption.')
  const backups: BackupConsumption[] = scopedBackups.map(backup => {
    const files = byBackup.get(backup.id)
    return { ...backup, consumption: summarizeFiles(files?.data || [], files?.complete === true),
      available: files?.available === true, error: files?.error || (!files ? 'File inventory not loaded within this refresh limit.' : undefined) }
  }).sort((a, b) => (b.consumption.physical ?? -1) - (a.consumption.physical ?? -1) || (a.name || a.id).localeCompare(b.name || b.id))
  const filesComplete = allBackups.complete && parentBackups === 0 && (!refs.length || states.complete && sobrs.complete) && scopedBackups.every(b => byBackup.get(b.id)?.complete)
  const consumption = summarizeFiles([...byBackup.values()].flatMap(f => f.data), !!filesComplete)
  if (consumption.conflicts) warnings.push(`${consumption.conflicts} conflicting file IDs excluded from the combined consumption subtotal.`)
  return { id, name: scaleOut?.name || config?.name || state?.name || id, sourceName, fetchedAt: now.toISOString(), apiRevision: revision,
    state, config, scaleOut, parents, extents, warnings: [...new Set(warnings)], parentBackups,
    backups: { data: backups, available: allBackups.available, complete: allBackups.complete },
    consumption, jobs: { data: affectedJobs(allJobs.data, scopedBackups, directIds, parentIds), available: allJobs.available || allBackups.available, statesAvailable: allJobs.available,
      complete: allJobs.complete && allBackups.complete && states.complete && sobrs.complete } }
}
