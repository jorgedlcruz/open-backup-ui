import { z } from 'zod'
import { jobSchema } from '../operations/model'
import { stateSchema as repoSchema, reportedGB } from '../repositories/model'
import { formatBytes } from '../restore-points/model'
import { objectSchema } from '../protected-data/model'
import { TopologyRequestError } from '../topology/load'
import { collection, VbmRequestError, type Reader } from '../vbm-dashboard/load'
import { jobSchema as vbmJobSchema, repositorySchema as vbmRepoSchema, capacity } from '../vbm-dashboard/model'
import { objectSchema as vbmObjectSchema, objectKey, restoreHref, types, name as objectName } from '../vbm-protected/model'
import { searchable, type SearchIndex, type SearchItem, type SearchSignal, type SearchFact } from './model'

const fact = (label: string, value?: string | number | null): SearchFact => ({ label, value: value == null || value === '' ? 'Not reported' : String(value) })
const date = (label: string, value?: string | null): SearchFact => value && Number.isFinite(Date.parse(value)) ? { label, value, kind: 'date' } : fact(label)
function jobSignal(result?: string | null, state?: string | null): SearchSignal {
  if (state === 'Running' || state === 'Working' || result === 'Running') return { label: 'Running', tone: 'active' }
  if (result === 'Failed') return { label: 'Last run failed', tone: 'danger' }
  if (result === 'Warning') return { label: 'Last run warning', tone: 'warning' }
  if (state === 'Disabled') return { label: 'Disabled', tone: 'neutral' }
  if (result === 'Success' || result === 'Succeeded') return { label: 'Last run successful', tone: 'success' }
  return { label: result || 'Result not reported', tone: 'neutral' }
}

// VBR can return repeated workload identities within a complete page. Page
// offsets count raw records; result identity deduplication happens afterwards.
async function vbrCollection<T>(read: Reader, path: string, schema: z.ZodType<T>, max = 5000) {
  const data: T[] = [], pages = new Set<string>()
  try {
    for (let page = 0; page < 100 && data.length < max; page++) {
      const limit = Math.min(200, max - data.length)
      const value = z.object({ data: z.array(schema), pagination: z.object({ total: z.number().optional() }).optional() })
        .parse(await read(`${path}${path.includes('?') ? '&' : '?'}${new URLSearchParams({ skip: String(data.length), limit: String(limit) })}`))
      const fingerprint = JSON.stringify(value.data)
      if (pages.has(fingerprint)) return { data, complete: false }
      pages.add(fingerprint)
      data.push(...value.data.slice(0, limit))
      if (value.data.length > limit) return { data, complete: false }
      const total = value.pagination?.total
      if (total !== undefined && data.length >= total) return { data, complete: true }
      if (!value.data.length || (total === undefined && value.data.length < limit)) return { data, complete: total === undefined }
    }
    return { data, complete: false }
  } catch (error) {
    if (!data.length || error instanceof TopologyRequestError && error.status === 401) throw error
    return { data, complete: false }
  }
}

// Search only needs identities and names: no restore-point, session, backup-file
// or storage-accounting fan-out.
export async function loadVbrSearch(read: Reader): Promise<SearchIndex> {
  const warnings: string[] = []
  let available = 0
  async function section<T>(label: string, promise: Promise<{ data: T[]; complete: boolean }>): Promise<T[]> {
    try {
      const value = await promise
      available++
      if (!value.complete) warnings.push(`${label}: only part of the inventory could be searched.`)
      return value.data
    } catch (error) {
      if (error instanceof TopologyRequestError && error.status === 401) throw error
      warnings.push(`${label} could not be searched. Check the source connection and permissions.`)
      return []
    }
  }
  const [jobs, objects, repositories] = await Promise.all([
    section('VBR jobs', vbrCollection(read, '/api/v1/jobs/states', jobSchema)),
    // Keep paging order and the all-name scope explicit on every inventory read.
    section('VBR workloads', vbrCollection(read, '/api/v1/backupObjects?orderColumn=Name&orderAsc=true&nameFilter=*', objectSchema, 20000)),
    section('VBR repositories', vbrCollection(read, '/api/v1/backupInfrastructure/repositories/states', repoSchema)),
  ])
  if (!available) throw new TopologyRequestError('VBR search is unavailable. Check the source connection and retry.', 502)
  const items: SearchItem[] = [...new Map(jobs.map(job => [job.id, job])).values()].map(job => ({
    key: `vbr:job:${job.id}`, id: job.id, name: job.name || job.id, type: 'VBR Job',
    url: `/vbr/jobs/${encodeURIComponent(job.id)}`, description: job.type || 'Backup job',
    signal: jobSignal(job.lastResult, job.status),
    facts: [fact('Current state', job.status), fact('Last result', job.lastResult), date('Last run', job.lastRun), date('Next run', job.nextRun), fact('Repository', job.repositoryName || job.repositoryId)],
    note: 'Job success does not establish workload recovery readiness.',
    terms: searchable([job.name, job.id, job.type]),
  }))
  const workloads = new Map<string, typeof objects>()
  for (const object of objects) {
    const copies = workloads.get(object.id) || []
    copies.push(object); workloads.set(object.id, copies)
  }
  for (const [id, copies] of workloads) {
    const object = copies.find(copy => copy.name) || copies[0], name = object.name || id
    const copyCount = new Set(copies.map(copy => copy.backupId).filter(Boolean)).size
    const description = [object.platformName || object.type, object.path || object.objectId || id, copyCount > 1 ? `${copyCount} backup copies` : ''].filter(Boolean).join(' · ')
    items.push({ key: `vbr:workload:${id}`, id, name, type: 'VBR Workload',
      // Deliberately inspect all copies of this workload; per-copy IDs are not
      // interchangeable with parent backup IDs used by the restore-point API.
      url: `/vbr/protected-data/restore-points?${new URLSearchParams({ objectId: id, name })}`, description,
      lazy: true, signal: copies.some(copy => copy.lastRunFailed === true) ? { label: 'Backup run failed', tone: 'danger' } : { label: 'Protected workload', tone: 'neutral' },
      facts: [fact('Platform', object.platformName), fact('Inventory object', object.objectId), fact('Reported object size', formatBytes(object.size))],
      terms: searchable(copies.flatMap(copy => [copy.name, copy.id, copy.objectId, copy.path, copy.backupId, copy.platformName, copy.type, copy.jobName])),
    })
  }
  for (const repository of new Map(repositories.map(row => [row.id, row])).values()) {
    const total = repository.capacityGB, free = repository.freeGB
    const used = total != null && total > 0 && free != null && free >= 0 && free <= total ? 100 * (total - free) / total : null
    items.push({ key: `vbr:repository:${repository.id}`, id: repository.id, name: repository.name, type: 'VBR Repository',
      url: `/vbr/infrastructure/repositories/${encodeURIComponent(repository.id)}`, description: [repository.type, repository.hostName, repository.path].filter(Boolean).join(' · '), lazy: true,
      signal: repository.isOnline === false ? { label: 'Offline', tone: 'danger' } : used !== null && used >= 80 ? { label: 'Low space', tone: used >= 90 ? 'danger' : 'warning' } : repository.isOnline === true ? { label: 'Online', tone: 'success' } : { label: 'Availability not reported', tone: 'neutral' },
      facts: [fact('Capacity', reportedGB(total)), fact('Free space', reportedGB(free)), fact('Space used', used === null ? null : `${used.toFixed(1)}%`), fact('Repository type', repository.type)],
      terms: searchable([repository.name, repository.id, repository.hostName, repository.path, repository.type]),
    })
  }
  return { items, warnings, complete: !warnings.length, fetchedAt: new Date().toISOString() }
}

export async function loadVbmSearch(raw: Reader): Promise<SearchIndex> {
  let active = 0
  const queue: (() => void)[] = []
  const read: Reader = async path => {
    if (active >= 3) await new Promise<void>(resolve => queue.push(resolve))
    active++
    try { return await raw(path) } finally { active--; queue.shift()?.() }
  }
  const warnings: string[] = []
  let available = 0
  async function collect<T>(label: string, path: string, schema: z.ZodType<T>, key: (row: T) => string) {
    const value = await collection(read, path, schema, key)
    if (value.available) available++
    if (!value.complete) warnings.push(`${label}: ${value.error || 'only part of the inventory could be searched.'}`)
    return value.data
  }
  const [jobs, repositories, ...groups] = await Promise.all([
    collect('Microsoft 365 jobs', '/v8/Jobs', vbmJobSchema, row => row.id),
    collect('Microsoft 365 repositories', '/v8/BackupRepositories', vbmRepoSchema, row => row.id),
    ...types.map(type => collect(`Microsoft 365 ${type.toLowerCase()}s`, `/v8/Protected${type}s`, vbmObjectSchema, row => objectKey({ ...row, type }))),
  ] as const)
  if (!available) throw new VbmRequestError('Microsoft 365 search is unavailable. Check the source connection and retry.', 502)
  const items: SearchItem[] = jobs.map(job => ({ key: `vb365:job:${job.id}`, id: job.id, name: job.name || job.id, type: 'VB365 Job',
    url: `/vbm/jobs/${encodeURIComponent(job.id)}/sessions`, description: job.description || job.backupType || 'Microsoft 365 backup job',
    signal: jobSignal(job.lastStatus, job.isEnabled === false ? 'Disabled' : null),
    facts: [fact('Enabled', job.isEnabled == null ? null : job.isEnabled ? 'Yes' : 'No'), fact('Last result', job.lastStatus), date('Last run', job.lastRun), date('Next run', job.nextRun), fact('Backup type', job.backupType)],
    terms: searchable([job.name, job.id, job.description, job.organizationId, job.backupType]),
  }))
  groups.forEach((rows, index) => rows.forEach(row => {
    const object = { ...row, type: types[index] }, name = objectName(object)
    const emails = (row.mailboxes || []).map(mailbox => mailbox.email)
    const organization = row.organizationId || row.backedUpOrganizationId
    items.push({ key: `vb365:item:${objectKey(object)}`, id: row.id, name, type: 'VB365 Item', url: restoreHref(object),
      lazy: true, detail: { objectType: object.type, organizationId: organization }, signal: { label: `${object.type} backup inventory`, tone: 'neutral' },
      facts: [fact('Object type', object.type), fact('Mailbox', emails.filter(Boolean).join(', ')), fact('Organization', organization)],
      description: [object.type, ...emails.filter(Boolean).slice(0, 1), organization].filter(Boolean).join(' · '),
      terms: searchable([name, row.id, row.msid, row.description, row.url, organization, row.backedUpOrganizationId,
        ...emails, ...(row.oneDrives || []).flatMap(drive => [drive.url, drive.displayName]), ...(row.sites || []).flatMap(site => [site.url, site.displayName])]),
    })
  }))
  for (const repository of repositories) {
    const cap = capacity(repository), immutability = repository.objectStorage?.enableImmutability
    items.push({ key: `vb365:repository:${repository.id}`, id: repository.id, name: repository.name || repository.id, type: 'VB365 Repository',
      url: `/vbm/infrastructure/repositories/${encodeURIComponent(repository.id)}`, description: repository.path || repository.description || cap.scope,
      signal: repository.isOutOfOrder === true ? { label: 'Out of order', tone: 'danger' } : repository.isOutOfSync === true ? { label: 'Out of sync', tone: 'warning' } : cap.primary && cap.primary.percent >= 80 ? { label: 'Low space', tone: 'warning' } : { label: 'Backup repository', tone: 'neutral' },
      facts: [fact('Capacity scope', cap.scope), fact('Capacity', formatBytes(cap.primary?.total)), fact('Free space', formatBytes(cap.primary?.free)), fact('Immutability', immutability == null ? null : immutability ? 'Enabled' : 'Disabled'), fact('Retention', repository.retentionPeriodType)],
      note: 'Repository immutability settings do not establish a restore point’s immutable-until date.',
      terms: searchable([repository.name, repository.id, repository.description, repository.path, repository.retentionPeriodType]),
    })
  }
  return { items, warnings, complete: !warnings.length, fetchedAt: new Date().toISOString() }
}
