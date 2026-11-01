import { buildProxies, proxyIssues, proxyType, taskLimit, transport, networkFallback, type ProxyInventory } from '../proxies/model'
import { buildServers, hostUpdate, roleNames, serverType, type ServerInventory } from '../managed-servers/model'
import { entitlements, type Snapshot as LicenseSnapshot } from '../licensing/model'
import { capacityRepositories, isRunning, needsAttention, repositoryRisk, sessionSummary, type OperationsSnapshot } from '../operations/model'
import { fieldsFor } from './catalog'
import type { Dataset } from './model'

export type MonitoringSource = 'overview' | 'proxies' | 'servers' | 'licenses'
export type MonitoringSnapshot = OperationsSnapshot | ProxyInventory | ServerInventory | LicenseSnapshot
const yesNo = (value: boolean | null | undefined) => value === true ? 'Yes' : value === false ? 'No' : 'Not reported'
export function monitoringDataset(source: MonitoringSource, raw: MonitoringSnapshot): Dataset {
  const base = { fields: fieldsFor(source), fetchedAt: raw.fetchedAt, sourceName: raw.sourceName, warnings: raw.warnings }
  if (source === 'overview') {
    const data = raw as OperationsSnapshot, jobs = data.jobs, sessions = data.sessions.available ? sessionSummary(data) : null
    const repositories = capacityRepositories(data.repositories.data)
    const complete = [data.jobs, data.sessions, data.repositories, data.security].every(c => c.complete)
    return { ...base, complete, available: [data.jobs, data.sessions, data.repositories, data.security].some(c => c.available), rows: [{ id: 'environment', name: data.sourceName, status: complete ? 'Complete snapshot' : 'Partial snapshot', time: data.fetchedAt,
      jobs: jobs.available ? jobs.data.length : null, active: jobs.available ? jobs.data.filter(isRunning).length : null,
      attention: jobs.available ? jobs.data.filter(needsAttention).length : null, failed: jobs.available ? jobs.data.filter(j => needsAttention(j) && j.lastResult === 'Failed').length : null,
      warning: jobs.available ? jobs.data.filter(j => needsAttention(j) && j.lastResult === 'Warning').length : null, disabled: jobs.available ? jobs.data.filter(j => j.status === 'Disabled').length : null,
      completed: sessions?.completed ?? null, successful: sessions?.success ?? null, failedRuns: sessions?.failed ?? null, warningRuns: sessions?.warning ?? null, successRate: sessions?.percent ?? null,
      repositories: data.repositories.available ? repositories.length : null, atRisk: data.repositories.available ? repositories.filter(r => ['Offline', 'Critical', 'Low space', 'Outdated'].includes(repositoryRisk(r))).length : null,
      securityIssues: data.security.available ? data.security.data.filter(s => s.status && !['Passed', 'NotApplicable', 'Suppressed'].includes(s.status)).length : null,
    }] }
  }
  if (source === 'proxies') {
    const data = raw as ProxyInventory
    return { ...base, available: data.configs.available || data.states.available, complete: data.configs.complete && data.states.complete && data.hosts.complete, rows: buildProxies(data).map(row => {
      const issues = proxyIssues(row)
      return { id: row.id, name: row.name, type: proxyType(row.type), status: issues.offline ? 'Offline' : issues.disabled ? 'Disabled' : issues.outdated ? 'Outdated' : issues.zeroTasks ? 'No task slots' : issues.unknown ? 'Unknown' : 'Ready', host: row.hostName, transport: transport(row).label, tasks: taskLimit(row), online: yesNo(row.state?.isOnline), enabled: row.state?.isDisabled == null ? 'Not reported' : yesNo(!row.state.isDisabled), outdated: yesNo(row.state?.isOutOfDate), fallback: networkFallback(row) }
    }) }
  }
  if (source === 'servers') {
    const data = raw as ServerInventory, rows = buildServers(data)
    return { ...base, available: data.servers.available, complete: data.servers.complete && rows.every(r => r.rolesComplete && !r.conflicts.length), rows: rows.map(row => ({ id: row.server.id, name: row.server.name || row.server.id, type: serverType(row.server.type), status: row.server.status || 'Not reported', updates: hostUpdate(row.server).label, roles: [...new Set(row.roles.map(r => roleNames[r.kind]))].join(', ') || (row.rolesComplete ? 'No roles reported' : 'Not reported'), assignments: row.roles.length, deadline: row.server.autoUpdateDeadline ?? null })) }
  }
  const data = raw as LicenseSnapshot
  return { ...base, available: !!data.vbr, complete: true, warnings: [...base.warnings, 'License quantities use different entitlement units. Filter by entitlement unit before combining consumed or licensed quantities.'], rows: entitlements(data).map(row => ({ id: row.key, name: row.name, status: row.status ?? 'Not reported', type: row.type ?? null, unit: row.unit, licensed: row.usage.total, consumed: row.usage.used, remaining: row.usage.remaining, utilization: row.usage.percent, days: row.expires.days, supportDays: row.support?.days ?? null, expires: row.expires.value, support: row.support?.value ?? null, issues: row.issues.map(i => i.label).join('; ') })) }
}
