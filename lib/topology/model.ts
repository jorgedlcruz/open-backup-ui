export type EntityKind = 'workload' | 'job' | 'repository'
export type Health = 'attention' | 'healthy' | 'unknown'

export interface TopologyEntity {
  id: string
  sourceId: string
  kind: EntityKind
  name: string
  subtitle: string
  health: Health
  status: string
  facts: { label: string; value: string }[]
  href?: string
}

export interface BackupObject {
  id: string
  name: string
  platformName?: string
  restorePointsCount?: number
}

export interface Backup {
  id: string
  name: string
  jobId?: string
  repositoryId?: string
  repositoryName?: string
}

export interface Job {
  id: string
  name: string
  type?: string
  status?: string
  lastResult?: string
  isRunning?: boolean
  isDisabled?: boolean
}

export interface Repository {
  id: string
  name: string
  type?: string
  isOnline?: boolean
  capacityGB?: number
  freeGB?: number
}

export interface BackupMembership {
  backupId: string
  objects: BackupObject[]
}

export interface TopologyLink {
  id: string
  source: string
  target: string
  backupIds: string[]
}

// Preserve each backup's path: a graph traversal through a shared job could
// otherwise incorrectly associate a workload with another backup's repository.
export interface TopologyPath {
  backupId: string
  backupName: string
  workloadId?: string
  jobId?: string
  repositoryId?: string
}

export interface TopologyGraph {
  entities: TopologyEntity[]
  links: TopologyLink[]
  paths: TopologyPath[]
}

export interface TopologySnapshot extends TopologyGraph {
  fetchedAt: string
  sourceName: string
  warnings: string[]
}

const validId = (id?: string) => !!id && id !== '00000000-0000-0000-0000-000000000000'
const nodeId = (kind: EntityKind, id: string) => `${kind}:${id}`

export function buildTopology(input: {
  objects: BackupObject[]; backups: Backup[]; jobs: Job[]
  repositories: Repository[]; memberships: BackupMembership[]
}): TopologyGraph {
  const entities = new Map<string, TopologyEntity>()
  const links = new Map<string, TopologyLink>()
  const paths: TopologyPath[] = []
  const objects = new Map(input.objects.map(object => [object.id, object]))
  for (const membership of input.memberships) {
    for (const object of membership.objects) {
      if (!objects.has(object.id)) objects.set(object.id, object)
    }
  }

  for (const object of objects.values()) {
    const count = object.restorePointsCount
    entities.set(nodeId('workload', object.id), {
      id: nodeId('workload', object.id), sourceId: object.id, kind: 'workload',
      name: object.name, subtitle: object.platformName || 'Platform unknown',
      health: count === 0 ? 'attention' : 'unknown',
      status: count === undefined ? 'Coverage unknown' : count === 0 ? 'No restore points' : `${count} restore points`,
      facts: [{ label: 'Platform', value: object.platformName || 'Unknown' },
        { label: 'Restore points reported', value: count === undefined ? 'Unknown' : String(count) },
        { label: 'Recovery objective', value: 'Not evaluated by this view' }],
      href: '/vbr/protected-data',
    })
  }
  for (const job of input.jobs) {
    const disabled = job.isDisabled === true || job.status === 'Disabled'
    const running = job.isRunning === true || ['Running', 'Starting', 'Stopping'].includes(job.status || '')
    const attention = job.lastResult === 'Failed' || job.lastResult === 'Warning' || disabled
    entities.set(nodeId('job', job.id), {
      id: nodeId('job', job.id), sourceId: job.id, kind: 'job', name: job.name,
      subtitle: job.type || 'Backup job',
      health: attention ? 'attention' : job.lastResult === 'Success' ? 'healthy' : 'unknown',
      status: disabled ? 'Disabled' : running ? job.status || 'Running' : job.lastResult && job.lastResult !== 'None' ? job.lastResult : 'Status unknown',
      facts: [{ label: 'Last result', value: job.lastResult || 'Unknown' },
        { label: 'Enabled', value: disabled ? 'No' : job.isDisabled === false ? 'Yes' : 'Unknown' }],
      href: `/vbr/jobs/${encodeURIComponent(job.id)}`,
    })
  }
  for (const repo of input.repositories) {
    const used = repo.capacityGB !== undefined && repo.capacityGB > 0 && repo.freeGB !== undefined && repo.freeGB >= 0 && repo.freeGB <= repo.capacityGB
      ? (1 - repo.freeGB / repo.capacityGB) * 100 : undefined
    entities.set(nodeId('repository', repo.id), {
      id: nodeId('repository', repo.id), sourceId: repo.id, kind: 'repository', name: repo.name,
      subtitle: repo.type || 'Repository',
      health: repo.isOnline === false || (used !== undefined && used >= 90) ? 'attention'
        : repo.isOnline === true ? 'healthy' : 'unknown',
      status: repo.isOnline === false ? 'Offline' : used !== undefined && used >= 90 ? 'Capacity ≥ 90%'
        : repo.isOnline === true ? 'Online' : 'Status unknown',
      facts: [{ label: 'Capacity used', value: used === undefined ? 'Unknown' : `${used.toFixed(1)}%` },
        { label: 'Free space', value: repo.freeGB === undefined || repo.freeGB < 0 ? 'Unknown' : `${repo.freeGB.toLocaleString()} GB` }],
      href: '/vbr/infrastructure/repositories',
    })
  }

  const addLink = (source: string | undefined, target: string | undefined, backupId: string) => {
    if (!source || !target) return
    const id = `${source}->${target}`
    const link = links.get(id) || { id, source, target, backupIds: [] }
    if (!link.backupIds.includes(backupId)) link.backupIds.push(backupId)
    links.set(id, link)
  }
  const members = new Map(input.memberships.map(m => [m.backupId, m.objects]))
  for (const backup of input.backups) {
    const jobId = validId(backup.jobId) ? nodeId('job', backup.jobId!) : undefined
    const repositoryId = validId(backup.repositoryId) ? nodeId('repository', backup.repositoryId!) : undefined
    for (const [id, kind, sourceId, name] of [
      [jobId, 'job', backup.jobId, 'Job details unavailable'],
      [repositoryId, 'repository', backup.repositoryId, backup.repositoryName || 'Repository details unavailable'],
    ] as const) {
      if (id && sourceId && !entities.has(id)) entities.set(id, {
        id, sourceId, kind, name, subtitle: 'Referenced by a backup', health: 'unknown',
        status: 'Details unavailable', facts: [{ label: 'Details', value: 'Not returned by the platform' }],
      })
    }
    addLink(jobId, repositoryId, backup.id)
    const backupObjects = members.get(backup.id) || []
    if (!backupObjects.length) paths.push({ backupId: backup.id, backupName: backup.name, jobId, repositoryId })
    for (const object of new Map(backupObjects.map(o => [o.id, o])).values()) {
      const workloadId = nodeId('workload', object.id)
      paths.push({ backupId: backup.id, backupName: backup.name, workloadId, jobId, repositoryId })
      addLink(workloadId, jobId || repositoryId, backup.id)
    }
  }
  return {
    entities: [...entities.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    links: [...links.values()], paths,
  }
}

export function relatedEntities(graph: TopologyGraph, selected: string): Set<string> {
  const ids = new Set([selected])
  for (const path of graph.paths) {
    const members = [path.workloadId, path.jobId, path.repositoryId]
    if (members.includes(selected)) for (const id of members) if (id) ids.add(id)
  }
  return ids
}

export function filterTopology(graph: TopologyGraph, query: string, attentionOnly: boolean, repositoryId: string): TopologyGraph {
  if (!query.trim() && !attentionOnly && !repositoryId) return graph
  const candidates = repositoryId ? relatedEntities(graph, repositoryId) : new Set(graph.entities.map(e => e.id))
  const matches = graph.entities.filter(e => candidates.has(e.id)
    && (!attentionOnly || e.health === 'attention')
    && `${e.name} ${e.subtitle}`.toLowerCase().includes(query.trim().toLowerCase()))
  const matchedIds = new Set(matches.map(e => e.id))
  const visible = new Set(matchedIds)
  // Filter path provenance too: don't invent connections by retaining every
  // edge between nodes that happen to remain visible.
  const paths = graph.paths.filter(p => (!repositoryId || p.repositoryId === repositoryId)
    && [p.workloadId, p.jobId, p.repositoryId].some(id => id && matchedIds.has(id)))
  for (const path of paths) for (const id of [path.workloadId, path.jobId, path.repositoryId]) {
    if (id && candidates.has(id)) visible.add(id)
  }
  const backupIds = new Set(paths.map(p => p.backupId))
  return {
    entities: graph.entities.filter(e => visible.has(e.id)),
    links: graph.links.filter(l => visible.has(l.source) && visible.has(l.target) && l.backupIds.some(id => backupIds.has(id))),
    paths,
  }
}
