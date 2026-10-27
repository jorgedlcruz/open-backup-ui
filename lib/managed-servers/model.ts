import { z } from 'zod'
import { uuid, validId, type Evidence } from '../investigation/model'
import { proxyConfigSchema, proxyStateSchema, proxyHref, proxyType, type ProxyConfig, type ProxyState } from '../proxies/model'
import { repositoryHref } from '../repositories/model'

const id = z.string().regex(uuid).transform(v => v.toLowerCase())
const text = z.string().nullish(), flag = z.boolean().nullish(), number = z.number().finite().nullish()
const reference = text.transform(v => v?.toLowerCase())
const ports = z.object({
  components: z.array(z.object({ componentName: text, port: number })).nullish(),
  portRangeStart: number, portRangeEnd: number,
}).nullish()
export const serverSchema = z.object({
  id, name: text, description: text, type: text, status: text, viHostType: text,
  updatesState: text, autoUpdateDeadline: text, isBackupServer: flag, isDefaultMountServer: flag,
  isVBRLinuxAppliance: flag, parentHostId: reference, parentHostName: text,
  networkSettings: ports, sshSettings: ports,
  optionalComponents: z.object({ optionalComponents: z.array(z.object({ displayName: text, optionalComponent: text })).nullish() }).nullish(),
})
const gateway = z.object({ autoSelectEnabled: flag, autoSelection: flag, gatewayServerIds: z.array(z.string().transform(v => v.toLowerCase())).nullish() }).nullish()
const mount = z.object({
  mountServerSettingsType: text,
  // Legacy rev1 settings and the rev2 Windows/Linux configuration are retained separately.
  mountServerId: reference,
  windows: z.object({ mountServerId: reference }).nullish(),
  linux: z.object({ mountServerId: reference }).nullish(),
}).nullish()
export const repositoryRolesSchema = z.object({
  id, name: text, type: text, hostId: reference, mountServer: mount, mountServers: mount,
  share: z.object({ gatewayServer: gateway }).nullish(),
  hpeStoreOnce: z.object({ gatewayServer: gateway }).nullish(),
  dellDataDomain: z.object({ gatewayServer: gateway }).nullish(),
  account: z.object({ connectionSettings: z.object({ connectionType: text, gatewayServerIds: z.array(z.string().transform(v => v.toLowerCase())).nullish() }).nullish() }).nullish(),
})
export const repositoryRoleStateSchema = z.object({ id, name: text, type: text, hostId: reference, isOnline: flag, isOutOfDate: flag })
export const mountRoleSchema = z.object({ id, type: text, isDefault: flag })
export { proxyConfigSchema, proxyStateSchema }
export type ManagedServer = z.infer<typeof serverSchema>
export type RepositoryRoleConfig = z.infer<typeof repositoryRolesSchema>
export type RepositoryRoleState = z.infer<typeof repositoryRoleStateSchema>
export type MountRole = z.infer<typeof mountRoleSchema>
export type ServerInventory = {
  sourceName: string; fetchedAt: string; apiRevision: string; warnings: string[];
  servers: Evidence<ManagedServer>; proxies: Evidence<ProxyConfig>; proxyStates: Evidence<ProxyState>;
  repositories: Evidence<RepositoryRoleConfig>; repositoryStates: Evidence<RepositoryRoleState>; mounts: Evidence<MountRole>;
}
export const serverHref = (id: string) => `/vbr/infrastructure/managed-servers/${encodeURIComponent(id)}`
export type RoleKind = 'backup' | 'proxy' | 'repository' | 'mount' | 'defaultMount' | 'gateway'
export const roleNames: Record<RoleKind, string> = { backup: 'Backup server', proxy: 'Backup proxy', repository: 'Repository host', mount: 'Mount server', defaultMount: 'Default mount server', gateway: 'Gateway' }
export type ServerRole = { key: string; kind: RoleKind; name: string; href?: string; evidence: string; online?: boolean | null; disabled?: boolean | null; outdated?: boolean | null }
export type ServerRow = { server: ManagedServer; roles: ServerRole[]; rolesComplete: boolean; conflicts: string[] }
export const serverType = (type?: string | null) => ({ WindowsHost: 'Windows', LinuxHost: 'Linux', ViHost: 'VMware vSphere', HvServer: 'Hyper-V host', HvCluster: 'Hyper-V cluster', SCVMM: 'SCVMM', CloudDirectorHost: 'Cloud Director', SmbV3Cluster: 'SMB v3 cluster', SmbV3StandaloneHost: 'SMB v3 host', NutanixCluster: 'Nutanix cluster', PrismCentral: 'Prism Central', ProxmoxNode: 'Proxmox node', ProxmoxCluster: 'Proxmox cluster' }[type || ''] || type || 'Not reported')
export type UpdateInfo = { label: string; tone: 'neutral' | 'danger' | 'warning' | 'success' | 'active'; issue: boolean; failed: boolean; active: boolean; unknown: boolean }
export function hostUpdate(server: ManagedServer): UpdateInfo {
  const value = server.updatesState
  const labels: Record<string, string> = { CheckInProgress: 'Checking updates', Installing: 'Installing', LastInstallFailed: 'Installation failed', Available: 'Updates available', NotAvailable: 'No updates available', CheckUpdatesFailed: 'Update check failed', OutOfDate: 'Out of date' }
  const failed = ['LastInstallFailed', 'CheckUpdatesFailed'].includes(value || '')
  const active = ['CheckInProgress', 'Installing'].includes(value || '')
  const issue = failed || ['Available', 'OutOfDate'].includes(value || '')
  const applicable = ['WindowsHost', 'LinuxHost', 'HvServer'].includes(server.type || '')
  return { label: value ? labels[value] || value : applicable || !server.type ? 'Not reported' : 'Not exposed for this type',
    tone: failed ? 'danger' : issue ? 'warning' : active ? 'active' : value === 'NotAvailable' ? 'success' : 'neutral',
    issue, failed, active, unknown: value ? !labels[value] : applicable || !server.type }
}
export function buildServers(data: ServerInventory): ServerRow[] {
  const rows = new Map(data.servers.data.map(server => [server.id, { server, roles: [], rolesComplete: data.proxies.complete && data.proxyStates.complete && data.repositories.complete && data.repositoryStates.complete && data.mounts.complete, conflicts: [] } as ServerRow]))
  const add = (hostId: string | null | undefined, role: ServerRole) => {
    if (!validId(hostId)) return
    const row = rows.get(hostId)
    if (row && !row.roles.some(r => r.key === role.key)) row.roles.push(role)
  }
  const conflict = (a: string | null | undefined, b: string | null | undefined, label: string) => {
    if (!validId(a) || !validId(b) || a === b) return false
    for (const hostId of [a, b]) { const row = rows.get(hostId); if (row) row.conflicts.push(`${label}: configured and state host IDs disagree.`) }
    return true
  }
  for (const { server } of rows.values()) {
    if (server.isBackupServer === true) add(server.id, { key: 'backup', kind: 'backup', name: 'VBR backup server', evidence: 'Managed server isBackupServer flag' })
    if (server.isDefaultMountServer === true) add(server.id, { key: 'defaultMount', kind: 'defaultMount', name: 'Default mount server', evidence: 'Managed server isDefaultMountServer flag' })
  }
  const proxies = new Map(data.proxies.data.map(p => [p.id, p])), proxyStates = new Map(data.proxyStates.data.map(p => [p.id, p]))
  for (const key of new Set([...proxies.keys(), ...proxyStates.keys()])) {
    const config = proxies.get(key), state = proxyStates.get(key)
    if (conflict(config?.server?.hostId, state?.hostId, `Proxy ${config?.name || state?.name || key}`)) continue
    add(validId(config?.server?.hostId) ? config.server.hostId : state?.hostId, {
      key: `proxy:${key}`, kind: 'proxy', name: config?.name || state?.name || key, href: proxyHref(key),
      evidence: `${proxyType(config?.type || state?.type || 'Not reported')} · proxy hostId`,
      online: state?.isOnline, disabled: state?.isDisabled, outdated: state?.isOutOfDate,
    })
  }
  const repos = new Map(data.repositories.data.map(r => [r.id, r])), repoStates = new Map(data.repositoryStates.data.map(r => [r.id, r]))
  for (const key of new Set([...repos.keys(), ...repoStates.keys()])) {
    const config = repos.get(key), state = repoStates.get(key), name = config?.name || state?.name || key
    // Repository-state gateway names are not fixed role assignments. Host storage
    // roles require a local-host repository type or an explicit configured hostId.
    const local = ['WinLocal', 'LinuxLocal', 'LinuxHardened', 'ExaGrid', 'QuantumDXi', 'Infinidat', 'Fujitsu'].includes(config?.type || state?.type || '')
    if (!conflict(config?.hostId, state?.hostId, `Repository ${name}`) && (validId(config?.hostId) || local)) {
      add(validId(config?.hostId) ? config.hostId : state?.hostId, { key: `repository:${key}`, kind: 'repository', name, href: repositoryHref(key), evidence: 'Repository hostId', online: state?.isOnline, outdated: state?.isOutOfDate })
    }
    for (const settings of [config?.share?.gatewayServer, config?.hpeStoreOnce?.gatewayServer, config?.dellDataDomain?.gatewayServer]) {
      if (settings && (settings.autoSelectEnabled === false || settings.autoSelection === false)) for (const hostId of settings.gatewayServerIds || []) {
        add(hostId, { key: `gateway:${key}`, kind: 'gateway', name, href: repositoryHref(key), evidence: 'Explicit gatewayServerIds; automatic selection disabled' })
      }
    }
    const connection = config?.account?.connectionSettings
    if (connection?.connectionType === 'SelectedGateway') for (const hostId of connection.gatewayServerIds || []) add(hostId, { key: `gateway:${key}`, kind: 'gateway', name, href: repositoryHref(key), evidence: 'Object storage gatewayServerIds' })
    for (const settings of [config?.mountServer, config?.mountServers]) {
      if (!settings) continue
      const refs = [
        settings.mountServerId,
        ['Windows', 'Both'].includes(settings.mountServerSettingsType || '') ? settings.windows?.mountServerId : null,
        ['Linux', 'Both'].includes(settings.mountServerSettingsType || '') ? settings.linux?.mountServerId : null,
      ]
      for (const hostId of refs) add(hostId, { key: `mount:${key}`, kind: 'mount', name, href: repositoryHref(key), evidence: 'Repository mountServerId' })
    }
  }
  for (const mount of data.mounts.data) {
    add(mount.id, { key: 'mount-registration', kind: 'mount', name: `${mount.type || 'Registered'} mount server`, evidence: 'Mount-server inventory ID equals managed-server ID' })
    if (mount.isDefault === true) add(mount.id, { key: 'defaultMount', kind: 'defaultMount', name: 'Default mount server', evidence: 'Mount-server isDefault flag' })
  }
  return [...rows.values()]
}
export const roleKinds = (row: ServerRow) => [...new Set(row.roles.map(r => r.kind))]
export function serverIssues(row: ServerRow) {
  const update = hostUpdate(row.server)
  return {
    unavailable: row.server.status === 'Unavailable',
    updates: update.issue || row.roles.some(r => r.outdated === true),
    failed: update.failed, updating: update.active,
    roles: row.roles.some(r => r.online === false || r.disabled === true),
    unknown: !['Available', 'Unavailable'].includes(row.server.status || '') || update.unknown || !row.rolesComplete || !!row.conflicts.length,
  }
}
export const needsServerAttention = (row: ServerRow) => { const i = serverIssues(row); return i.unavailable || i.updates || i.roles }
export type ServerIssue = 'all' | 'attention' | 'unavailable' | 'updates' | 'failed' | 'updating' | 'roles' | 'unknown' | 'available'
export type ServerFilters = { query: string; issue: ServerIssue; type: string; role: string; update: string }
export const defaultServerFilters: ServerFilters = { query: '', issue: 'all', type: 'all', role: 'all', update: 'all' }
export function matchesServer(row: ServerRow, filters: ServerFilters) {
  const s = row.server, query = filters.query.trim().toLowerCase()
  if (query && ![s.id, s.name, s.description, s.type, serverType(s.type), s.parentHostName, ...row.roles.map(r => `${roleNames[r.kind]} ${r.name}`)].join(' ').toLowerCase().includes(query)) return false
  if (filters.type !== 'all' && filters.type !== (s.type || 'unknown')) return false
  if (filters.role === 'none' ? row.roles.length > 0 : filters.role !== 'all' && !row.roles.some(r => r.kind === filters.role)) return false
  if (filters.update !== 'all' && (filters.update === 'unknown' ? !hostUpdate(s).unknown : s.updatesState !== filters.update)) return false
  return filters.issue === 'all' || (filters.issue === 'attention' ? needsServerAttention(row) : filters.issue === 'available' ? s.status === 'Available' : serverIssues(row)[filters.issue])
}
export function serverPage(rows: ServerRow[], filters: ServerFilters, order: string, page: number, size = 15) {
  const rank = (r: ServerRow) => { const i = serverIssues(r); return i.unavailable ? 0 : i.failed ? 1 : i.updates ? 2 : i.roles ? 3 : i.unknown ? 4 : 5 }
  const matching = rows.filter(row => matchesServer(row, filters)).sort((a, b) =>
    (order === 'roles' ? b.roles.length - a.roles.length : order === 'risk' ? rank(a) - rank(b) : 0) ||
    (a.server.name || a.server.id).localeCompare(b.server.name || b.server.id) || a.server.id.localeCompare(b.server.id))
  const current = Math.min(page, Math.max(0, Math.ceil(matching.length / size) - 1))
  return { allRows: matching, rows: matching.slice(current * size, (current + 1) * size), count: matching.length, current }
}
export function componentPorts(server: ManagedServer) {
  return [...(server.networkSettings?.components || []).map(c => ({ ...c, source: 'Network settings' })), ...(server.sshSettings?.components || []).map(c => ({ ...c, source: 'SSH settings' }))]
    .filter((c, index, all) => all.findIndex(other => other.componentName === c.componentName && other.port === c.port && other.source === c.source) === index)
}
