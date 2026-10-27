import type { EntityKind, TopologyEntity, TopologyGraph, TopologyPath } from './model'

export type TopologyIssue = 'all' | 'attention' | 'unlinked' | 'unknown'
export const pathMembers = (path: TopologyPath) => [path.workloadId, path.jobId, path.repositoryId].filter((id): id is string => !!id)
export const pathsFor = (graph: TopologyGraph, id: string) => graph.paths.filter(path => pathMembers(path).includes(id))

export function matchesIssue(entity: TopologyEntity, issue: TopologyIssue, linked: Set<string>) {
  return issue === 'all' || (issue === 'attention' ? entity.health === 'attention'
    : issue === 'unlinked' ? !linked.has(entity.id)
      : /unknown|unavailable/i.test(entity.status))
}

// Keep the precise path segments, not every edge between the retained nodes.
// A shared job must never imply a different backup's repository relationship.
export function graphFromPaths(graph: TopologyGraph, paths: TopologyPath[], seeds: string[] = []): TopologyGraph {
  const ids = new Set([...seeds, ...paths.flatMap(pathMembers)])
  const segments = new Map<string, Set<string>>()
  for (const path of paths) {
    const members = pathMembers(path)
    for (let index = 1; index < members.length; index++) {
      const key = `${members[index - 1]}->${members[index]}`
      const backups = segments.get(key) || new Set<string>()
      backups.add(path.backupId); segments.set(key, backups)
    }
  }
  return { entities: graph.entities.filter(entity => ids.has(entity.id)), paths,
    links: graph.links.flatMap(link => {
      const backups = segments.get(`${link.source}->${link.target}`)
      const backupIds = link.backupIds.filter(id => backups?.has(id))
      return backupIds.length ? [{ ...link, backupIds }] : []
    }) }
}

export function investigateTopology(graph: TopologyGraph, query: string, repositoryId: string, issue: TopologyIssue, kind: EntityKind | 'all'): TopologyGraph {
  if (!query.trim() && !repositoryId && issue === 'all' && kind === 'all') return graph
  const scoped = repositoryId ? graphFromPaths(graph, graph.paths.filter(path => path.repositoryId === repositoryId), [repositoryId]) : graph
  const linked = new Set(scoped.links.flatMap(link => [link.source, link.target]))
  const text = query.trim().toLowerCase()
  const eligible = scoped.entities.filter(entity => (kind === 'all' || entity.kind === kind) && matchesIssue(entity, issue, linked))
  const eligibleIds = new Set(eligible.map(entity => entity.id))
  const matches = eligible.filter(entity => `${entity.name} ${entity.subtitle} ${entity.sourceId}`.toLowerCase().includes(text))
  const ids = new Set(matches.map(entity => entity.id))
  return graphFromPaths(scoped, scoped.paths.filter(path => pathMembers(path).some(id => ids.has(id))
    || (text !== '' && `${path.backupName} ${path.backupId}`.toLowerCase().includes(text) && pathMembers(path).some(id => eligibleIds.has(id)))), [...ids])
}

export const focusTopology = (graph: TopologyGraph, id: string) => graphFromPaths(graph, pathsFor(graph, id), [id])

export function topologySummary(graph: TopologyGraph) {
  const linked = new Set(graph.links.flatMap(link => [link.source, link.target]))
  return {
    workload: graph.entities.filter(entity => entity.kind === 'workload').length,
    job: graph.entities.filter(entity => entity.kind === 'job').length,
    repository: graph.entities.filter(entity => entity.kind === 'repository').length,
    backups: new Set(graph.paths.map(path => path.backupId)).size,
    attention: graph.entities.filter(entity => matchesIssue(entity, 'attention', linked)).length,
    unlinked: graph.entities.filter(entity => matchesIssue(entity, 'unlinked', linked)).length,
    unknown: graph.entities.filter(entity => matchesIssue(entity, 'unknown', linked)).length,
  }
}
