import { z } from 'zod'
import { investigationSessionSchema, newestFirst, recordStatus, validId, uuid, type Evidence } from '../investigation/model'

const text = z.string().nullish(), flag = z.boolean().nullish()
const id = z.string().regex(uuid).transform(v => v.toLowerCase())
const reference = text.transform(v => v?.toLowerCase())
const schedule = z.object({
  daily: z.object({ isEnabled: flag, localTime: text, dailyKind: text, days: z.array(z.string()).nullish() }).nullish(),
  periodically: z.object({ isEnabled: flag, periodicallyKind: text, frequency: z.number().finite().nullish() }).nullish(),
  continuously: z.object({ isEnabled: flag }).nullish(),
}).nullish()
export const groupSchema = z.object({
  id, name: text, description: text, type: text, isDisabled: flag,
  options: z.object({
    rescanSchedule: schedule, distributionServerId: reference, distributionRepositoryId: reference,
    installBackupAgent: flag, installCBTDriver: flag, installNoSnapAgent: flag,
    installApplicationPlugins: flag, applicationPlugins: z.array(z.string()).nullish(),
    updateAutomatically: flag, rebootIfRequired: flag,
  }).nullish(),
})
export const entitySchema = z.object({
  id, name: text, parentId: reference, protectionGroupId: reference, type: text,
  state: text, agentStatus: text, agentVersion: text, driverStatus: text, driverVersion: text,
  rebootRequired: flag, isTrusted: flag, ipAddresses: z.array(z.string()).nullish(), lastConnected: text,
  operatingSystem: text, operatingSystemPlatform: text, operatingSystemVersion: text,
  objectId: reference,
  plugins: z.array(z.object({ type: text, version: text, status: text })).nullish(),
  embeddedRecoveryMediaState: z.object({ state: text, lastUpdateDate: text, message: text }).nullish(),
})
export const discoverySchema = investigationSessionSchema.extend({ resourceId: reference, resourceReference: text })
export type ProtectionGroup = z.infer<typeof groupSchema>
export type DiscoveredEntity = z.infer<typeof entitySchema>
export type DiscoverySession = z.infer<typeof discoverySchema>
export type ProtectionInventory = {
  sourceName: string; fetchedAt: string; apiRevision: string; from: string; warnings: string[];
  groups: Evidence<ProtectionGroup>; entities: Evidence<DiscoveredEntity>; sessions: Evidence<DiscoverySession>;
}
export type GroupRow = { group: ProtectionGroup; entities: DiscoveredEntity[]; sessions: DiscoverySession[]; complete: boolean; historyComplete: boolean }
export const groupHref = (id: string) => `/vbr/inventory/protection-groups/${encodeURIComponent(id)}`
export const groupType = (type?: string | null) => ({
  ManuallyAdded: 'Manually added', Unmanaged: 'Unmanaged agents', IndividualComputers: 'Individual computers',
  ADObjects: 'Active Directory', CSVFile: 'CSV file', PreInstalledAgents: 'Pre-installed agents',
  CloudMachines: 'Cloud machines', MongoDB: 'MongoDB', Iris: 'InterSystems IRIS',
}[type || ''] || type || 'Not reported')
export const statusLabel = (value?: string | null) => value ? value.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Not reported'
export function componentTone(value?: string | null): 'danger' | 'warning' | 'success' | 'neutral' {
  return ['Failed', 'UnsupportedOperatingSystem', 'Offline', 'Stopped'].includes(value || '') ? 'danger'
    : ['UpgradeRequired', 'UpgradeAvailable', 'InstalledRebootRequired', 'NotInstalledRebootRequired', 'NotInitialized'].includes(value || '') ? 'warning'
      : ['Installed', 'Online'].includes(value || '') ? 'success' : 'neutral'
}
const agentStates = ['Installed', 'NotInstalled', 'UpgradeRequired', 'Failed', 'UnsupportedOperatingSystem', 'NotInitialized']
const driverStates = ['Installed', 'NotInstalled', 'Stopped', 'Failed', 'UpgradeAvailable', 'InstalledRebootRequired', 'NotInstalledRebootRequired']
export function entityIssues(entity: DiscoveredEntity) {
  const computer = entity.type === 'Computer'
  const issues = {
    offline: computer && entity.state === 'Offline',
    agent: computer && ['Failed', 'UnsupportedOperatingSystem', 'NotInitialized'].includes(entity.agentStatus || ''),
    missingAgent: computer && entity.agentStatus === 'NotInstalled',
    updates: computer && (entity.agentStatus === 'UpgradeRequired' || entity.driverStatus === 'UpgradeAvailable' || !!entity.plugins?.some(p => p.status === 'UpgradeRequired')),
    driver: computer && ['Stopped', 'Failed'].includes(entity.driverStatus || ''),
    reboot: computer && (entity.rebootRequired === true || ['InstalledRebootRequired', 'NotInstalledRebootRequired'].includes(entity.driverStatus || '')),
    trust: computer && entity.isTrusted === false,
    unknown: computer ? !['Online', 'Offline'].includes(entity.state || '') || !agentStates.includes(entity.agentStatus || '') ||
      !driverStates.includes(entity.driverStatus || '') || entity.isTrusted == null || entity.rebootRequired == null ||
      entity.plugins == null || entity.plugins.some(p => !['Installed', 'NotInstalled', 'UpgradeRequired'].includes(p.status || ''))
      : !['Cluster', 'ActiveDirectory'].includes(entity.type || ''),
  }
  return { ...issues, attention: issues.offline || issues.agent || issues.updates || issues.driver || issues.reboot || issues.trust }
}
// A job-related activity ID or resource ID can identify a group. Never join by name,
// and never attach a discovery session whose explicit group references conflict.
export function discoveryGroup(session: DiscoverySession, groupIds: Set<string>) {
  if (session.sessionType !== 'AgentDiscovery') return null
  const refs = [session.jobId, session.resourceId]
  if (session.resourceReference) {
    try {
      const path = new URL(session.resourceReference, 'https://vbr.invalid').pathname
      const match = path.match(/^\/api\/v1\/agents\/protectionGroups\/([0-9a-f-]+)\/?$/i)
      if (match) refs.push(match[1].toLowerCase())
    } catch { /* Malformed resource references do not establish membership. */ }
  }
  const references = [...new Set(refs.filter((v): v is string => validId(v)))]
  // Be equally conservative in an all-group list and a single-group detail.
  return references.length === 1 && groupIds.has(references[0]) ? references[0] : null
}
export function buildGroups(data: ProtectionInventory): GroupRow[] {
  const ids = new Set(data.groups.data.map(g => g.id))
  return data.groups.data.map(group => ({
    group, entities: data.entities.data.filter(e => e.protectionGroupId === group.id),
    sessions: data.sessions.data.filter(s => discoveryGroup(s, ids) === group.id).sort(newestFirst),
    complete: data.entities.complete, historyComplete: data.sessions.complete,
  }))
}
export function groupIssues(row: GroupRow) {
  const issues = row.entities.map(entityIssues), latest = row.sessions[0]
  const discovery = !!latest && ['Failed', 'Warning', 'Canceled'].includes(recordStatus(latest))
  const disabled = row.group.isDisabled === true
  const unknown = row.group.isDisabled == null || !row.complete || !row.historyComplete || !latest || issues.some(i => i.unknown)
  return {
    all: true, attention: disabled || discovery || issues.some(i => i.attention),
    discovery, disabled, offline: issues.some(i => i.offline), agent: issues.some(i => i.agent), driver: issues.some(i => i.driver),
    missingAgent: issues.some(i => i.missingAgent), updates: issues.some(i => i.updates),
    reboot: issues.some(i => i.reboot), trust: issues.some(i => i.trust), unknown,
    empty: row.complete && row.entities.length === 0,
  }
}
export type GroupIssue = keyof ReturnType<typeof groupIssues>
export type GroupFilters = { query: string; issue: GroupIssue; type: string }
export const defaultGroupFilters: GroupFilters = { query: '', issue: 'all', type: 'all' }
export function matchesGroup(row: GroupRow, filters: GroupFilters) {
  const q = filters.query.trim().toLowerCase(), g = row.group
  return (!q || [g.id, g.name, g.description, groupType(g.type), ...row.entities.flatMap(e => [e.name, e.id, ...(e.ipAddresses || [])])].join(' ').toLowerCase().includes(q)) &&
    (filters.type === 'all' || filters.type === (g.type || 'unknown')) && groupIssues(row)[filters.issue]
}
export function groupPage(rows: GroupRow[], filters: GroupFilters, order: string, page: number, size = 15) {
  const rank = (r: GroupRow) => { const i = groupIssues(r); return i.discovery ? 0 : i.attention ? 1 : i.unknown ? 2 : 3 }
  const matching = rows.filter(r => matchesGroup(r, filters)).sort((a,b) =>
    (order === 'risk' ? rank(a) - rank(b) : order === 'computers' ? b.entities.filter(e => e.type === 'Computer').length - a.entities.filter(e => e.type === 'Computer').length : 0) ||
    (a.group.name || a.group.id).localeCompare(b.group.name || b.group.id))
  const current = Math.max(0, Math.min(page, Math.max(0, Math.ceil(matching.length / size) - 1)))
  return { allRows: matching, rows: matching.slice(current * size, (current + 1) * size), count: matching.length, current }
}
export type EntityIssue = 'all' | keyof ReturnType<typeof entityIssues>
export function matchesEntity(e: DiscoveredEntity, query: string, issue: EntityIssue, type: string, agent: string) {
  const q = query.trim().toLowerCase()
  return (!q || [e.id, e.name, e.operatingSystem, e.operatingSystemVersion, e.agentVersion, ...(e.ipAddresses || [])].join(' ').toLowerCase().includes(q)) &&
    (issue === 'all' || entityIssues(e)[issue]) && (type === 'all' || (e.type || 'Unknown') === type) && (agent === 'all' || e.agentStatus === agent)
}
export function scheduleText(group: ProtectionGroup) {
  const s = group.options?.rescanSchedule
  if (!s) return 'Not reported'
  const parts = []
  if (s.daily?.isEnabled === true) parts.push(`At ${s.daily.localTime || 'time not reported'} · ${s.daily.days?.join(', ') || s.daily.dailyKind || 'days not reported'}`)
  if (s.periodically?.isEnabled === true) parts.push(`Periodic · ${s.periodically.frequency ?? 'interval not reported'} ${s.periodically.periodicallyKind || ''}`.trim())
  if (s.continuously?.isEnabled === true) parts.push('Continuous · configured window')
  if (parts.length) return parts.join(' / ')
  return [s.daily, s.periodically, s.continuously].every(v => v?.isEnabled === false) ? 'All schedule modes disabled' : 'Schedule mode not reported'
}
