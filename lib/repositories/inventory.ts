import { utilization } from '../operations/model'
import { validId, type Evidence } from '../investigation/model'
import { configuredImmutability, extentReferences, type RepositoryConfig, type RepositoryState, type ScaleOut } from './model'

export type RepositoryInventory = {
  sourceName: string; fetchedAt: string; apiRevision: string; warnings: string[];
  states: Evidence<RepositoryState>; configs: Evidence<RepositoryConfig>; scaleOuts: Evidence<ScaleOut>;
}
export type Membership = { id: string; name: string; tier: string; status: string[] }
export type InventoryRow = {
  id: string; name: string; type: string; host: string; path: string; description: string;
  state: RepositoryState | null; config: RepositoryConfig | null; memberships: Membership[];
  policy: ReturnType<typeof configuredImmutability>; groupId: string;
}
export type InventoryGroup = { id: string; name: string; parent: boolean; inferred: boolean; rows: InventoryRow[] }
export type Issue = 'all' | 'attention' | 'critical' | 'low' | 'offline' | 'outdated' | 'extent-state' | 'unmeasured'
export type InventoryFilters = { query: string; issue: Issue; immutability: string; type: string; membership: string }
export const defaultInventoryFilters: InventoryFilters = { query: '', issue: 'all', immutability: 'all', type: 'all', membership: 'all' }
export const policyState = (row: InventoryRow) => ['Configured', 'Enabled'].includes(row.policy.status) ? 'configured' : row.policy.status === 'Disabled' ? 'disabled' : 'unknown'
export function rowIssues(row: InventoryRow) {
  const used = row.state ? utilization(row.state) : null
  const extentStates = [...new Set(row.memberships.flatMap(m => m.status).filter(s => s !== 'Normal'))]
  return {
    critical: used !== null && used >= 90, low: used !== null && used >= 80,
    offline: row.state?.isOnline === false, outdated: row.state?.isOutOfDate === true,
    extentStates, unmeasured: used === null,
  }
}
export function needsStorageAttention(row: InventoryRow) {
  const issues = rowIssues(row)
  return issues.low || issues.offline || issues.outdated || !!issues.extentStates.length
}
export function riskRank(row: InventoryRow) {
  const issues = rowIssues(row)
  return issues.offline ? 0 : issues.critical ? 1 : issues.low ? 2 : issues.extentStates.length ? 3 : issues.outdated ? 4 : issues.unmeasured ? 5 : 6
}
export function buildInventory(data: RepositoryInventory): { rows: InventoryRow[]; groups: InventoryGroup[] } {
  const states = new Map(data.states.data.map(s => [s.id, s])), configs = new Map(data.configs.data.map(c => [c.id, c]))
  const groups = new Map<string, InventoryGroup>()
  const names = new Map<string, string>(), members = new Map<string, Map<string, Membership>>()
  const addGroup = (id: string, name: string, inferred: boolean) => {
    if (!groups.has(id)) groups.set(id, { id, name, parent: true, inferred, rows: [] })
  }
  const addMember = (id: string, membership: Membership) => {
    if (!validId(id) || id === membership.id) return
    if (!members.has(id)) members.set(id, new Map())
    const prior = members.get(id)!.get(membership.id)
    members.get(id)!.set(membership.id, prior ? { ...membership, tier: prior.tier, status: [...new Set([...prior.status, ...membership.status])] } : membership)
  }
  for (const sobr of data.scaleOuts.data) {
    addGroup(sobr.id, sobr.name, false)
    for (const ref of extentReferences(sobr)) {
      if (ref.name) names.set(ref.id, ref.name)
      addMember(ref.id, { id: sobr.id, name: sobr.name, tier: ref.tier, status: ref.status || [] })
    }
  }
  for (const state of data.states.data) {
    if (state.type === 'ExtendableRepository' || state.type === 'ScaleOut') addGroup(state.id, state.name, true)
    const membership = state.scaleOutRepositoryDetails
    if (validId(membership?.scaleOutRepositoryId) && membership.scaleOutRepositoryId !== state.id) {
      const parent = membership.scaleOutRepositoryId
      addGroup(parent, membership.membership || parent, true)
      addMember(state.id, { id: parent, name: groups.get(parent)!.name, tier: membership.extentType || 'Tier not reported', status: [] })
    }
  }
  for (const config of data.configs.data) if (config.type === 'ExtendableRepository' || config.type === 'ScaleOut') addGroup(config.id, config.name || config.id, true)
  const ids = new Set([...states.keys(), ...configs.keys(), ...members.keys()])
  const membershipComplete = data.states.complete && data.scaleOuts.complete
  const rows: InventoryRow[] = []
  for (const id of ids) {
    if (groups.has(id)) continue // A logical parent is not another storage extent.
    const state = states.get(id) || null, config = configs.get(id) || null, memberships = [...(members.get(id)?.values() || [])]
    const storage = config?.bucket || config?.container
    const groupId = memberships.length > 1 ? 'multiple' : memberships[0]?.id || (membershipComplete ? 'standalone' : 'unverified')
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, name: groupId === 'multiple' ? 'Multiple scale-out memberships' : groupId === 'standalone' ? 'Standalone repositories' : 'Membership not verified', parent: false, inferred: groupId === 'unverified', rows: [] })
    const row: InventoryRow = { id, name: config?.name || state?.name || names.get(id) || id, type: config?.type || state?.type || 'Not reported',
      host: state?.hostName || 'Not reported', path: state?.path || config?.repository?.path || [storage?.bucketName || storage?.containerName, storage?.folderName || storage?.folder].filter(Boolean).join('/') || 'Not reported',
      description: config?.description || state?.description || '', state, config, memberships, policy: configuredImmutability(config), groupId }
    rows.push(row); groups.get(groupId)!.rows.push(row)
  }
  return { rows, groups: [...groups.values()] }
}
export function matchesRepository(row: InventoryRow, filters: InventoryFilters) {
  const issues = rowIssues(row), policy = policyState(row)
  const query = filters.query.trim().toLowerCase()
  if (query && ![row.name, row.id, row.type, row.host, row.path, row.description, ...row.memberships.flatMap(m => [m.name, m.id, m.tier])].join(' ').toLowerCase().includes(query)) return false
  if (filters.type !== 'all' && row.type !== filters.type) return false
  if (filters.immutability !== 'all' && filters.immutability !== policy) return false
  if (filters.membership === 'standalone' && row.groupId !== 'standalone') return false
  if (filters.membership === 'unverified' && row.groupId !== 'unverified') return false
  if (filters.membership === 'extent' && !row.memberships.length) return false
  if (['Performance', 'Capacity', 'Archive'].includes(filters.membership) && !row.memberships.some(m => m.tier.startsWith(filters.membership))) return false
  return filters.issue === 'all' || filters.issue === 'attention' && needsStorageAttention(row) ||
    filters.issue === 'critical' && issues.critical || filters.issue === 'low' && issues.low ||
    filters.issue === 'offline' && issues.offline || filters.issue === 'outdated' && issues.outdated ||
    filters.issue === 'extent-state' && issues.extentStates.length > 0 || filters.issue === 'unmeasured' && issues.unmeasured
}
export function sortRepositories(rows: InventoryRow[], order: string) {
  return [...rows].sort((a, b) => {
    if (order === 'name') return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    if (order === 'usage') {
      const av = a.state ? utilization(a.state) : null, bv = b.state ? utilization(b.state) : null
      return (bv ?? -1) - (av ?? -1) || a.name.localeCompare(b.name)
    }
    return riskRank(a) - riskRank(b) || (b.state ? utilization(b.state) ?? -1 : -1) - (a.state ? utilization(a.state) ?? -1 : -1) || a.name.localeCompare(b.name)
  })
}
// Page storage rows, then retain their group context. Shared/multiple membership
// rows stay unique, and no parent is treated as additional physical capacity.
export function inventoryPage(groups: InventoryGroup[], filters: InventoryFilters, order: string, grouped: boolean, page: number, size = 15) {
  const filtered = groups.map(group => ({ ...group, rows: sortRepositories(group.rows.filter(r => matchesRepository(r, filters)), order) }))
  const populated = filtered.filter(g => g.rows.length).sort((a, b) => {
    if (order === 'name') return a.name.localeCompare(b.name)
    if (order === 'usage') return Math.max(...b.rows.map(r => r.state ? utilization(r.state) ?? -1 : -1)) - Math.max(...a.rows.map(r => r.state ? utilization(r.state) ?? -1 : -1)) || a.name.localeCompare(b.name)
    return Math.min(...a.rows.map(riskRank)) - Math.min(...b.rows.map(riskRank)) || a.name.localeCompare(b.name)
  })
  const rows = grouped ? populated.flatMap(g => g.rows) : sortRepositories(populated.flatMap(g => g.rows), order)
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1)), ids = new Set(rows.slice(current * size, (current + 1) * size).map(r => r.id))
  const emptyParents = filters.issue === 'all' && filters.immutability === 'all' && filters.type === 'all' && filters.membership === 'all'
    ? groups.filter(g => g.parent && !g.rows.length && g.name.toLowerCase().includes(filters.query.trim().toLowerCase())) : []
  return { allRows: rows, allGroups: populated, current, count: rows.length, rows: rows.slice(current * size, (current + 1) * size),
    groups: populated.filter(g => g.rows.some(r => ids.has(r.id))).map(g => ({ ...g, matching: g.rows.length, rows: g.rows.filter(r => ids.has(r.id)) })),
    emptyParents }
}
