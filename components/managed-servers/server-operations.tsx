"use client"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterCondition,FilterFields,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableGrid } from '@/components/ui/sortable-grid'
import { useCallback,useMemo,useState } from 'react'

import { Empty,Loading,Notice,Pager,Panel,SearchBox,date,useEvidence,useRefresh } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { veeamApi } from '@/lib/api/veeam-client'
import { validId } from '@/lib/investigation/model'
import { buildServers,componentPorts,defaultServerFilters,hostUpdate,matchesServer,roleKinds,roleNames,serverHref,serverIssues,serverPage,serverType,type ServerFilters,type ServerIssue,type ServerRole,type ServerRow } from '@/lib/managed-servers/model'
import { cn } from '@/lib/utils'
import { ArrowLeft,ArrowUpRight,CircleHelp,Layers,RefreshCw,Server,TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import styles from './server-operations.module.css'

type Tone = 'neutral' | 'danger' | 'warning' | 'success' | 'active'
function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return <span className={cn(ops.badge, ops[tone])}><span className={ops.dot} />{label}</span>
}
function Availability({ row }: { row: ServerRow }) {
  return <Badge label={row.server.status || 'Not reported'} tone={row.server.status === 'Available' ? 'success' : row.server.status === 'Unavailable' ? 'danger' : 'neutral'} />
}
function Updates({ row }: { row: ServerRow }) {
  const update = hostUpdate(row.server), outdated = row.roles.filter(r => r.outdated === true).length
  return <div className={styles.updates}><Badge label={update.label} tone={update.tone} />{outdated > 0 && <small className={ops.warning}>{outdated} assigned {outdated === 1 ? 'resource needs' : 'resources need'} component updates</small>}</div>
}
function RoleHealth({ role }: { role: ServerRole }) {
  if (!['proxy', 'repository'].includes(role.kind)) return <span className={styles.muted}>Assignment only</span>
  return <div className={styles.badges}>
    <Badge label={role.online === true ? 'Online' : role.online === false ? 'Offline' : 'Availability unknown'} tone={role.online === true ? 'success' : role.online === false ? 'danger' : 'neutral'} />
    {role.disabled === true && <Badge label="Disabled" tone="warning" />}
    <Badge label={role.outdated === true ? 'Update required' : role.outdated === false ? 'Components current' : 'Updates not reported'} tone={role.outdated === true ? 'warning' : 'neutral'} />
  </div>
}
const issueFilters: { value: ServerIssue; label: string }[] = [
  { value: 'all', label: 'All servers' }, { value: 'attention', label: 'Needs attention' }, { value: 'unavailable', label: 'Unavailable' },
  { value: 'updates', label: 'Updates required' }, { value: 'failed', label: 'Update failures' }, { value: 'updating', label: 'Checking / installing' },
  { value: 'roles', label: 'Role issues' }, { value: 'unknown', label: 'Missing evidence' },
]
const updateLabels: Record<string, string> = { CheckInProgress: 'Checking updates', Installing: 'Installing', LastInstallFailed: 'Installation failed', Available: 'Updates available', NotAvailable: 'No updates available', CheckUpdatesFailed: 'Update check failed', OutOfDate: 'Out of date' }
const roleScope = 'Roles cover backup-server and default-mount flags, proxy and repository hosts, explicit gateways, and mount-server assignments. Automatic gateway selection and component-port settings do not establish fixed roles.'

function ServerDetail({ row, rows }: { row: ServerRow; rows: ServerRow[] }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const s = row.server, update = hostUpdate(s), issues = serverIssues(row), ports = componentPorts(s)
  const matching = row.roles.filter(r => `${roleNames[r.kind]} ${r.name} ${r.evidence}`.toLowerCase().includes(query.toLowerCase()))
  const current = Math.min(page, Math.max(0, Math.ceil(matching.length / 10) - 1))
  const parent = validId(s.parentHostId) ? rows.find(r => r.server.id === s.parentHostId)?.server : null
  const children = rows.filter(r => r.server.parentHostId === s.id)
  const findings = [
    issues.unavailable && 'VBR reports this managed server unavailable. Review host connectivity and the assigned resources below.',
    update.failed && 'The host update check or installation failed. VBR does not provide failure details in this inventory.',
    update.issue && !update.failed && 'VBR reports host updates available or out-of-date software.',
    row.roles.some(r => r.outdated === true) && 'At least one assigned proxy or repository reports outdated components.',
    issues.roles && 'At least one assigned proxy or repository is offline or disabled. This is separate from managed-server availability.',
    !row.rolesComplete && 'Role evidence is incomplete. The visible assignments may be a subset.',
    ...row.conflicts,
  ].filter(Boolean) as string[]
  const portText = (value?: number | null) => value != null && Number.isInteger(value) && value >= 0 && value <= 65535 ? value : 'Not reported'
  return <>
    {!!findings.length && <div className={styles.findings}><TriangleAlert size={18} /><ul>{findings.map(f => <li key={f}>{f}</li>)}</ul></div>}
    <div className={styles.detailGrid}>
      <Panel title="Availability & identity" subtitle="Managed-server availability is independent of each assigned resource.">
        <dl className={styles.facts}>
          <div><dt>Availability</dt><dd><Availability row={row} /></dd></div>
          <div><dt>Server type</dt><dd>{serverType(s.type)}{s.viHostType && ` · ${s.viHostType}`}</dd></div>
          <div><dt>VBR Linux appliance</dt><dd>{s.isVBRLinuxAppliance === true ? 'Reported appliance' : s.isVBRLinuxAppliance === false ? 'No' : 'Not reported'}</dd></div>
          <div><dt>Description</dt><dd>{s.description || 'Not reported'}</dd></div>
          <div><dt>Managed-server ID</dt><dd><code>{s.id}</code></dd></div>
          <div><dt>Parent server</dt><dd>{validId(s.parentHostId) ? <Link className={ops.textLink} href={serverHref(s.parentHostId)}>{parent?.name || s.parentHostName || s.parentHostId}<ArrowUpRight size={13} /></Link> : 'Not reported'}</dd></div>
          {!!children.length && <div><dt>Loaded child hosts</dt><dd className={styles.linkList}>{children.map(child => <Link key={child.server.id} href={serverHref(child.server.id)}>{child.server.name || child.server.id}<ArrowUpRight size={13} /></Link>)}</dd></div>}
        </dl>
      </Panel>
      <Panel title="Updates & maintenance" subtitle="Host update state and assigned-resource component reports retain their own scope.">
        <dl className={styles.facts}>
          <div><dt>Host update state</dt><dd><Badge label={update.label} tone={update.tone} /></dd></div>
          <div><dt>Automatic update deadline</dt><dd>{date(s.autoUpdateDeadline)}<small>A reported schedule does not confirm installation or completion.</small></dd></div>
          <div><dt>Outdated assigned resources</dt><dd>{row.roles.filter(r => r.outdated === true).length}<small>Only proxies and directly hosted repositories with explicit update reports.</small></dd></div>
          <div><dt>Missing resource update reports</dt><dd>{row.roles.filter(r => ['proxy', 'repository'].includes(r.kind) && r.outdated == null).length}</dd></div>
          <div><dt>Component versions / failure logs</dt><dd>Not exposed by these inventory endpoints</dd></div>
        </dl>
        <p className={ops.panelFoot}>“No updates available” is a host update-check result. It does not certify every assigned component. Missing update state stays unreported.</p>
      </Panel>
    </div>
    <Panel title="Assigned roles & resources" subtitle={roleScope} action={<span className={ops.smallTag}>{row.roles.length} REPORTED ASSIGNMENTS</span>}>
      <FilterWorkspace label="Assigned roles & resources filters" search={<><SearchBox label="Search assigned roles and resources" value={query} onChange={v => { setQuery(v); setPage(0) }} /></>} onClear={()=>{setQuery('');setPage(0)}} filters={null}>
{matching.length ? <div className={ops.tableScroll}><SortableGrid rows={matching} columns={[{id:'role',value:r=>roleNames[r.kind]},{id:'name',value:r=>r.name},{id:'evidence',value:r=>r.evidence},{id:'health',value:r=>r.online===false?"Offline":r.disabled?"Disabled":r.outdated?"Outdated":r.online===true?"Online":null}]} onSortChange={()=>setPage(0)}>{(matching)=>(<table className={cn(ops.table, styles.roleTable)}><thead><tr><th>Role</th><th>Assignment</th><th>Evidence</th><th>Resource status</th></tr></thead><tbody>{matching.slice(current * 10, current * 10 + 10).map(role => <tr key={role.key}><td>{roleNames[role.kind]}</td><td>{role.href ? <Link className={ops.textLink} href={role.href}>{role.name}<ArrowUpRight size={13} /></Link> : role.name}</td><td className={styles.muted}>{role.evidence}</td><td><RoleHealth role={role} /></td></tr>)}</tbody></table>)}</SortableGrid></div> : <Empty>{query ? 'No assignments match this search.' : 'No assignments were returned by the loaded role sources.'}</Empty>}
<Pager page={current} count={matching.length} size={10} onChange={setPage} label="role assignments" />
<p className={ops.panelFoot}>An assignment indicates configuration, not current use by a job. Investigate linked proxies and repositories for their operating details.</p>
</FilterWorkspace></Panel>
    <div className={styles.detailGrid}>
      <Panel title="Component ports" subtitle="Ports reported in the host configuration; service reachability is not measured here.">
        {ports.length ? <div className={ops.tableScroll}><SortableGrid rows={ports} columns={[{id:'component',value:r=>r.componentName},{id:'port',value:r=>r.port},{id:'source',value:r=>r.source}]}>{(ports)=>(<table className={ops.table}><thead><tr><th>Component</th><th>Port</th><th>Source</th></tr></thead><tbody>{ports.map((c, index) => <tr key={index}><td>{c.componentName || 'Not reported'}</td><td>{portText(c.port)}</td><td>{c.source}</td></tr>)}</tbody></table>)}</SortableGrid></div> : <Empty>No component-port settings were returned.</Empty>}
        <dl className={styles.facts}><div><dt>Network data-transfer ports</dt><dd>{portText(s.networkSettings?.portRangeStart)} – {portText(s.networkSettings?.portRangeEnd)}</dd></div><div><dt>SSH data-transfer ports</dt><dd>{portText(s.sshSettings?.portRangeStart)} – {portText(s.sshSettings?.portRangeEnd)}</dd></div></dl>
      </Panel>
      <Panel title="Optional component configuration" subtitle="Configured optional components; this is not a version or installation-health inventory.">
        {s.optionalComponents?.optionalComponents?.length ? <ul className={styles.optional}>{s.optionalComponents.optionalComponents.map((c, index) => <li key={index}><strong>{c.displayName || c.optionalComponent || 'Not reported'}</strong>{c.displayName && c.optionalComponent && <small>{c.optionalComponent}</small>}</li>)}</ul> : <Empty>{s.optionalComponents?.optionalComponents ? 'No optional components are configured in the returned settings.' : 'Optional component settings were not reported.'}</Empty>}
      </Panel>
    </div>
  </>
}

export function ServerOperations({ id }: { id?: string }) {
  const { revision, refresh } = useRefresh()
  const load = useCallback((signal: AbortSignal) => veeamApi.getManagedServerInventory(signal), [])
  const { data, error, loading } = useEvidence(load, revision)
  const rows = useMemo(() => data ? buildServers(data) : [], [data])
  const [filters, setFilters] = useState<ServerFilters>(defaultServerFilters), [order, setOrder] = useState('risk'), [page, setPage] = useState(0)
  const view = useMemo(() => serverPage(rows, filters, order, page), [rows, filters, order, page])
  const selected = id ? rows.find(r => r.server.id === id) : null
  const counts = Object.fromEntries(issueFilters.map(f => [f.value, rows.filter(r => matchesServer(r, { ...defaultServerFilters, issue: f.value })).length]))
  const full = data && [data.servers, data.proxies, data.proxyStates, data.repositories, data.repositoryStates, data.mounts].every(e => e.complete)
  const filtered = Object.keys(filters).some(k => filters[k as keyof ServerFilters] !== defaultServerFilters[k as keyof ServerFilters])
  function change<K extends keyof ServerFilters>(key: K, value: ServerFilters[K]) { setFilters(current => ({ ...current, [key]: value })); setPage(0) }
  function quick(issue: ServerIssue) { setFilters({ ...defaultServerFilters, issue }); setPage(0) }
  return <div className={cn(ops.console, styles.page)}>
    <header className={ops.header}><div><h1>{id ? selected?.server.name || 'Server investigation' : 'Managed servers'}</h1><p>{id ? 'Availability, update evidence, and assigned backup infrastructure roles.' : 'Find unavailable hosts, review component updates, and trace assigned roles.'}</p></div><div className={ops.headerActions}>{id && <Link className={ops.backLink} href="/vbr/infrastructure/managed-servers"><ArrowLeft size={14} />All servers</Link>}{data && <span className={ops.source}><span className={ops.dot} />{data.sourceName}</span>}<Button variant="outline" size="sm" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</Button></div></header>
    {error && <Notice error>{error}{data && ' Showing the previous snapshot; this refresh failed.'}</Notice>}
    {!data ? loading ? <Loading>Loading managed servers and role evidence…</Loading> : <Empty>Managed-server inventory is unavailable. Use Refresh to retry.</Empty> : <>
      {!!data.warnings.length && <details className={ops.warnings}><summary>{data.warnings.length} data coverage {data.warnings.length === 1 ? 'notice' : 'notices'}</summary><ul>{data.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
      {id ? selected ? <ServerDetail key={id} row={selected} rows={rows} /> : <Empty>{data.servers.complete ? 'This server was not found in the connected source.' : 'This server was not found in the available records. The inventory is incomplete.'}<Link className={ops.backLink} href="/vbr/infrastructure/managed-servers">Return to server inventory</Link></Empty> : <>
        <div className={ops.metrics}>
          <button className={cn(ops.metric, styles.metric)} onClick={() => quick('all')}><div className={ops.metricLabel}>Managed servers<Server size={17} /></div><div className={ops.metricValue}>{rows.length}</div><p>{rows.filter(r => r.server.status === 'Available').length} available · nested hosts included</p></button>
          <button className={cn(ops.metric, styles.metric)} onClick={() => quick('attention')}><div className={ops.metricLabel}>Need attention<TriangleAlert size={17} /></div><div className={cn(ops.metricValue, counts.attention ? ops.danger : ops.neutral)}>{counts.attention}</div><p>{counts.unavailable} unavailable · {counts.updates} with update issues</p></button>
          <button className={cn(ops.metric, styles.metric)} onClick={() => { setFilters({ ...defaultServerFilters, role: 'all' }); setOrder('roles'); setPage(0) }}><div className={ops.metricLabel}>Assigned hosts<Layers size={17} /></div><div className={ops.metricValue}>{rows.filter(r => r.roles.length).length}</div><p>Explicit roles · sort by assignment count</p></button>
          <button className={cn(ops.metric, styles.metric)} onClick={() => quick('unknown')}><div className={ops.metricLabel}>Missing evidence<CircleHelp size={17} /></div><div className={ops.metricValue}>{counts.unknown}</div><p>Unknown availability, updates, or role coverage</p></button>
        </div>
        <Panel title="Server inventory" subtitle="Host availability, software updates, and assigned-resource issues are checked independently." action={<span className={ops.smallTag}>{view.count} MATCHING</span>}>
          <FilterWorkspace label="Server inventory filters" search={<><SearchBox label="Search servers, roles, resources, or IDs" value={filters.query} onChange={v => change('query', v)} /></>} onClear={() => { setFilters(defaultServerFilters); setPage(0) }} filters={<FilterFields><FilterCondition>{issueFilters.map(f => <button key={f.value} aria-pressed={filters.issue === f.value} onClick={() => change('issue', f.value)} className={cn(styles.quickFilter, filters.issue === f.value && styles.selected)}>{f.label}<span>{counts[f.value]}</span></button>)}</FilterCondition>
<FilterSelect label={"Server type"} value={filters.type} onValueChange={e => change('type', e)}><option value="all">All types</option>{[...new Set(rows.map(r => r.server.type || 'unknown'))].sort().map(type => <option key={type} value={type}>{type === 'unknown' ? 'Not reported' : serverType(type)}</option>)}</FilterSelect>
<FilterSelect label={"Assigned role"} value={filters.role} onValueChange={e => change('role', e)}><option value="all">All roles</option>{Object.entries(roleNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}<option value="none">No assignments returned</option></FilterSelect>
<FilterSelect label={"Host updates"} value={filters.update} onValueChange={e => change('update', e)}><option value="all">All update states</option>{Object.entries(updateLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="unknown">Not reported / unrecognized</option></FilterSelect>
<span>Counts cover loaded servers. Missing evidence stays visible.</span></FilterFields>} actions={<><GridViewMenu><select aria-label="Server sort order" value={order} onChange={e => { setOrder(e.target.value); setPage(0) }}><option value="risk">Issues first</option><option value="name">Name A–Z</option><option value="roles">Most assignments</option></select></GridViewMenu></>}>
{view.count ? <div className={ops.tableScroll}><SortableGrid rows={view.allRows} columns={[{id:'name',value:r=>r.server.name || r.server.id},{id:'available',value:r=>r.server.status},{id:'updates',value:r=>r.server.updatesState},{id:'roles',value:r=>r.roles.length},{id:'issues',value:r=>r.roles.filter(role=>role.online===false || role.disabled===true).length}]} key={order} onSortChange={()=>setPage(0)}>{(sortedRows)=>(<table className={cn(ops.table, styles.table)}><thead><tr><th>Managed server</th><th>Availability</th><th>Host / component updates</th><th>Assigned roles</th><th>Resource issues</th><th><span className="sr-only">Investigate</span></th></tr></thead><tbody>{sortedRows.slice(view.current*15,(view.current+1)*15).map(row => {
            const offline = row.roles.filter(r => r.online === false).length, disabled = row.roles.filter(r => r.disabled === true).length
            return <tr key={row.server.id}><td><div className={styles.identity}><Server size={17} /><div><Link className={ops.jobName} href={serverHref(row.server.id)}>{row.server.name || row.server.id}</Link><div className={ops.subtext}>{serverType(row.server.type)}{row.server.viHostType && ` · ${row.server.viHostType}`}</div>{row.server.isVBRLinuxAppliance === true && <small>VBR Linux appliance</small>}<div className={styles.description} title={row.server.description || undefined}>{row.server.description || 'No description reported'}</div></div></div></td>
              <td><Availability row={row} /></td><td><Updates row={row} /></td><td><div className={styles.badges}>{roleKinds(row).map(kind => <Badge key={kind} label={roleNames[kind]} tone="active" />)}</div>{!row.roles.length && <span className={styles.muted}>No assignments returned</span>}<small className={styles.coverage}>{row.roles.length} reported assignments{!row.rolesComplete && ' · partial role evidence'}{!!row.conflicts.length && ' · conflicting host references'}</small></td>
              <td><div className={styles.badges}>{offline > 0 && <Badge label={`${offline} offline`} tone="danger" />}{disabled > 0 && <Badge label={`${disabled} disabled`} tone="warning" />}{!offline && !disabled && <span className={styles.muted}>None reported</span>}</div></td>
              <td><Link className={ops.inspect} href={serverHref(row.server.id)} aria-label={`Investigate ${row.server.name || row.server.id}`}><ArrowUpRight size={17} /></Link></td></tr>
          })}</tbody></table>)}</SortableGrid></div> : <Empty>{rows.length ? 'No servers match these filters.' : data.servers.complete ? 'No managed servers were returned by this source.' : 'No servers were returned in the available inventory.'}{filtered && <Button variant="outline" size="sm" onClick={() => { setFilters(defaultServerFilters); setPage(0) }}>Reset filters</Button>}</Empty>}
<Pager page={view.current} count={view.count} size={15} onChange={setPage} label="servers" />
<p className={ops.panelFoot}>{roleScope} Missing update state does not imply current software.</p>
</FilterWorkspace></Panel>
      </>}
      <footer className={ops.footer}><span><span className={ops.dot} />Snapshot {date(data.fetchedAt)}{loading ? ' · Refreshing…' : ' · Refreshes every 60 seconds while visible'}</span><span>VBR {data.apiRevision} · {full ? 'Complete loaded sources' : 'Partial evidence'}</span></footer>
    </>}
  </div>
}
