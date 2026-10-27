import { z } from 'zod'
import { uuid, validId, type Evidence } from '../investigation/model'

const id = z.string().regex(uuid).transform(v => v.toLowerCase())
const text = z.string().nullish(), flag = z.boolean().nullish()
const reference = text.transform(v => v?.toLowerCase())
const number = z.number().finite().nullish()
// Explicit allowlists keep host credentials and connection secrets on the server.
export const proxyConfigSchema = z.object({
  id, name: text, description: text, type: text,
  server: z.object({
    hostId: reference, hostName: text, transportMode: text, failoverToNetwork: flag,
    hostToProxyEncryption: flag, maxTaskCount: number,
    connectedDatastores: z.object({
      autoSelectEnabled: flag,
      datastores: z.array(z.object({
        datastore: z.object({ name: text, objectId: text, hostName: text, platform: text }).nullish(),
        vmCount: number,
      })).nullish(),
    }).nullish(),
  }).nullish(),
})
export const proxyStateSchema = z.object({
  id, name: text, description: text, type: text, hostId: reference, hostName: text,
  isOnline: flag, isDisabled: flag, isOutOfDate: flag,
})
export const proxyHostSchema = z.object({
  id, name: text, description: text, type: text, status: text,
  isVBRLinuxAppliance: flag, isBackupServer: flag, updatesState: text,
})
export type ProxyConfig = z.infer<typeof proxyConfigSchema>
export type ProxyState = z.infer<typeof proxyStateSchema>
export type ProxyHost = z.infer<typeof proxyHostSchema>
export type ProxyInventory = {
  sourceName: string; fetchedAt: string; apiRevision: string; warnings: string[];
  configs: Evidence<ProxyConfig>; states: Evidence<ProxyState>; hosts: Evidence<ProxyHost>;
}
export type ProxyRow = {
  id: string; name: string; type: string; hostName: string; hostId: string | null; hostConflict: boolean;
  config: ProxyConfig | null; state: ProxyState | null; host: ProxyHost | null;
}
export const proxyHref = (id: string) => `/vbr/infrastructure/proxies/${encodeURIComponent(id)}`
export const proxyType = (type: string) => ({ ViProxy: 'VMware', HvProxy: 'Hyper-V off-host', GeneralPurposeProxy: 'General purpose', NutanixAHV: 'Nutanix AHV', PVE: 'Proxmox VE' }[type] || type)
export const transportNames: Record<string, string> = { Auto: 'Automatic', DirectAccess: 'Direct storage access', VirtualAppliance: 'Virtual appliance (HotAdd)', Network: 'Network (NBD)' }
export function transport(row: ProxyRow) {
  if (row.type !== 'ViProxy') return { key: row.type === 'Not reported' ? 'unknown' : 'na', label: row.type === 'Not reported' ? 'Not reported' : 'Not applicable' }
  const mode = row.config?.server?.transportMode
  return { key: mode || 'unknown', label: mode ? transportNames[mode] || mode : 'Not reported' }
}
export function networkFallback(row: ProxyRow) {
  if (row.type !== 'ViProxy') return 'Not applicable'
  const mode = row.config?.server?.transportMode
  if (mode === 'Network') return 'Already using network'
  const enabled = row.config?.server?.failoverToNetwork
  return enabled === true ? 'Enabled' : enabled === false ? 'Disabled' : 'Not reported'
}
export function taskLimit(row: ProxyRow) {
  const value = row.config?.server?.maxTaskCount
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
export function buildProxies(data: ProxyInventory): ProxyRow[] {
  const configs = new Map(data.configs.data.map(r => [r.id, r])), states = new Map(data.states.data.map(r => [r.id, r]))
  const hosts = new Map(data.hosts.data.map(r => [r.id, r]))
  return [...new Set([...configs.keys(), ...states.keys()])].map(id => {
    const config = configs.get(id) || null, state = states.get(id) || null
    const configId = validId(config?.server?.hostId) ? config.server.hostId : null
    const stateId = validId(state?.hostId) ? state.hostId : null
    const hostConflict = !!configId && !!stateId && configId !== stateId
    const hostId = hostConflict ? null : configId || stateId, host = hostId ? hosts.get(hostId) || null : null
    return { id, name: config?.name || state?.name || id, type: config?.type || state?.type || 'Not reported',
      hostId, hostConflict, config, state, host,
      hostName: hostConflict ? 'Conflicting host references' : host?.name || config?.server?.hostName || state?.hostName || 'Not reported' }
  })
}
export function proxyIssues(row: ProxyRow) {
  return {
    offline: row.state?.isOnline === false,
    disabled: row.state?.isDisabled === true,
    outdated: row.state?.isOutOfDate === true,
    zeroTasks: taskLimit(row) === 0,
    noFallback: row.type === 'ViProxy' && ['DirectAccess', 'VirtualAppliance'].includes(row.config?.server?.transportMode || '') && row.config?.server?.failoverToNetwork === false,
    unknown: !row.config || !row.state || row.state.isOnline == null || row.state.isDisabled == null || row.state.isOutOfDate == null || taskLimit(row) === null || transport(row).key === 'unknown' || row.hostConflict,
  }
}
export const needsAttention = (r: ProxyRow) => { const i = proxyIssues(r); return i.offline || i.disabled || i.outdated || i.zeroTasks }
export const onlineEnabled = (r: ProxyRow) => r.state?.isOnline === true && r.state.isDisabled === false
export type ProxyIssue = 'all' | 'attention' | 'offline' | 'disabled' | 'outdated' | 'zeroTasks' | 'noFallback' | 'unknown' | 'onlineEnabled'
export type ProxyFilters = { query: string; issue: ProxyIssue; type: string; transport: string; tasks: string }
export const defaultProxyFilters: ProxyFilters = { query: '', issue: 'all', type: 'all', transport: 'all', tasks: 'all' }
export function matchesProxy(row: ProxyRow, filters: ProxyFilters) {
  const issues = proxyIssues(row), limit = taskLimit(row)
  const query = filters.query.trim().toLowerCase()
  if (query && ![row.id, row.name, row.hostId, row.hostName, proxyType(row.type), row.type, row.host?.type, row.config?.description, row.state?.description].join(' ').toLowerCase().includes(query)) return false
  if (filters.type !== 'all' && filters.type !== row.type) return false
  if (filters.transport !== 'all' && filters.transport !== transport(row).key) return false
  if (filters.tasks === 'unknown' && limit !== null || filters.tasks === 'zero' && limit !== 0 || filters.tasks === 'positive' && (limit === null || limit <= 0)) return false
  return filters.issue === 'all' || (filters.issue === 'attention' ? needsAttention(row) : filters.issue === 'onlineEnabled' ? onlineEnabled(row) : issues[filters.issue])
}
export function proxyPage(rows: ProxyRow[], filters: ProxyFilters, order: string, page: number, size = 15) {
  const rank = (r: ProxyRow) => { const i = proxyIssues(r); return i.offline ? 0 : i.zeroTasks ? 1 : i.disabled ? 2 : i.outdated ? 3 : i.unknown ? 4 : 5 }
  const matching = rows.filter(row => matchesProxy(row, filters)).sort((a, b) => {
    if (order === 'tasks') return (taskLimit(b) ?? -1) - (taskLimit(a) ?? -1) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    return (order === 'risk' ? rank(a) - rank(b) : 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  })
  const current = Math.min(page, Math.max(0, Math.ceil(matching.length / size) - 1))
  return { allRows: matching, rows: matching.slice(current * size, (current + 1) * size), count: matching.length, current }
}
