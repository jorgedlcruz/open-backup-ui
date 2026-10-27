"use client"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterCondition,FilterFields,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableGrid } from '@/components/ui/sortable-grid'
import { useCallback,useMemo,useState } from 'react'

import { Empty,Loading,Notice,Pager,Panel,SearchBox,date,useEvidence,useRefresh } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { veeamApi } from '@/lib/api/veeam-client'
import { buildProxies,defaultProxyFilters,matchesProxy,networkFallback,onlineEnabled,proxyHref,proxyIssues,proxyPage,proxyType,taskLimit,transport,transportNames,type ProxyFilters,type ProxyIssue,type ProxyRow } from '@/lib/proxies/model'
import { cn } from '@/lib/utils'
import { ArrowLeft,ArrowUpRight,CircleHelp,MoreHorizontal,Network,Power,PowerOff,RefreshCw,ServerCog,Trash2,TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import styles from './proxy-operations.module.css'

type Tone = 'neutral' | 'danger' | 'warning' | 'success' | 'active'
function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return <span className={cn(ops.badge, ops[tone])}><span className={ops.dot} />{label}</span>
}
const flag = (value?: boolean | null) => value === true ? 'Enabled' : value === false ? 'Disabled' : 'Not reported'
function Health({ row }: { row: ProxyRow }) {
  return <div className={styles.badges}>
    <Badge label={row.state?.isOnline === true ? 'Online' : row.state?.isOnline === false ? 'Offline' : 'Availability unknown'} tone={row.state?.isOnline === true ? 'success' : row.state?.isOnline === false ? 'danger' : 'neutral'} />
    <Badge label={row.state?.isDisabled === true ? 'Disabled' : row.state?.isDisabled === false ? 'Enabled' : 'Enabled state unknown'} tone={row.state?.isDisabled === true ? 'warning' : 'neutral'} />
  </div>
}
function Updates({ row }: { row: ProxyRow }) {
  return <Badge label={row.state?.isOutOfDate === true ? 'Update required' : row.state?.isOutOfDate === false ? 'Up to date' : 'Not reported'} tone={row.state?.isOutOfDate === true ? 'warning' : row.state?.isOutOfDate === false ? 'success' : 'neutral'} />
}
function Tasks({ row }: { row: ProxyRow }) {
  const limit = taskLimit(row)
  return <div className={styles.tasks}><strong className={limit === 0 ? ops.warning : undefined}>{limit === null ? 'Not reported' : limit.toLocaleString()}</strong><small>{limit === null ? 'Configured limit unavailable' : 'Configured concurrent limit'}</small></div>
}
type ProxyAction = { row: ProxyRow; type: 'enable' | 'disable' | 'remove' }
function Actions({ row, onAction }: { row: ProxyRow; onAction: (action: ProxyAction) => void }) {
  if (!row.config) return null
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${row.name}`}><MoreHorizontal size={17} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
    {row.state?.isDisabled === true && <DropdownMenuItem onSelect={() => onAction({ row, type: 'enable' })}><Power size={14} />Enable proxy</DropdownMenuItem>}
    {row.state?.isDisabled === false && <DropdownMenuItem onSelect={() => onAction({ row, type: 'disable' })}><PowerOff size={14} />Disable proxy</DropdownMenuItem>}
    {row.state?.isDisabled == null && <DropdownMenuItem disabled>Enabled state not reported</DropdownMenuItem>}
    <DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onSelect={() => onAction({ row, type: 'remove' })}><Trash2 size={14} />Remove proxy</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>
}
const issueFilters: { value: ProxyIssue; label: string }[] = [
  { value: 'all', label: 'All proxies' }, { value: 'attention', label: 'Needs attention' },
  { value: 'offline', label: 'Offline' }, { value: 'disabled', label: 'Disabled' },
  { value: 'outdated', label: 'Component updates' }, { value: 'zeroTasks', label: 'Zero task limit' },
  { value: 'noFallback', label: 'No NBD fallback' }, { value: 'unknown', label: 'Missing evidence' },
]
function ProxyDetail({ row }: { row: ProxyRow }) {
  const settings = row.config?.server, datastores = settings?.connectedDatastores
  const issues = proxyIssues(row)
  const findings = [
    issues.offline && 'VBR reports this proxy offline. Check its managed host and connectivity.',
    issues.disabled && 'This proxy is disabled in VBR and is unavailable for new task assignments.',
    issues.outdated && 'Proxy components require an update.',
    issues.zeroTasks && 'VBR reports a concurrent task limit of zero. Review the configured limit in VBR.',
    issues.noFallback && 'Network fallback is explicitly disabled for this transport mode. Review whether this matches your intended configuration.',
    issues.unknown && 'Some proxy evidence is missing or conflicting. Review the unknown fields below before making changes.',
  ].filter(Boolean) as string[]
  return <>
    {!!findings.length && <div className={styles.findings}><TriangleAlert size={18} /><ul>{findings.map(f => <li key={f}>{f}</li>)}</ul></div>}
    <div className={styles.detailGrid}>
      <Panel title="Availability & host" subtitle="Proxy state and managed-host evidence retain their separate meanings.">
        <dl className={styles.facts}>
          <div><dt>Proxy availability / state</dt><dd><Health row={row} /></dd></div>
          <div><dt>Proxy components</dt><dd><Updates row={row} /></dd></div>
          <div><dt>Proxy type</dt><dd>{proxyType(row.type)}</dd></div>
          <div><dt>Managed host</dt><dd>{row.hostId ? <Link className={ops.textLink} href={`/vbr/infrastructure/managed-servers/${encodeURIComponent(row.hostId)}`}>{row.hostName}<ArrowUpRight size={13} /></Link> : row.hostName}</dd></div>
          <div><dt>Host type</dt><dd>{row.host?.type || 'Not reported'}{row.host?.isVBRLinuxAppliance === true && ' · VBR Linux appliance'}</dd></div>
          <div><dt>Managed-host status</dt><dd>{row.host?.status || 'Not reported'}</dd></div>
          <div><dt>Host updates</dt><dd>{row.host?.updatesState || 'Not reported'}</dd></div>
          <div><dt>Description</dt><dd>{row.config?.description || row.state?.description || 'Not reported'}</dd></div>
        </dl>
      </Panel>
      <Panel title="Transport & concurrency" subtitle="Configured policy; the transport selected for an individual task may differ.">
        <dl className={styles.facts}>
          <div><dt>Transport mode</dt><dd>{transport(row).label}</dd></div>
          <div><dt>Network fallback</dt><dd>{networkFallback(row)}{row.type === 'ViProxy' && settings?.transportMode === 'Auto' && <small>Explicit fallback flag; automatic transport selection is separate.</small>}</dd></div>
          <div><dt>Network transport encryption</dt><dd>{row.type === 'ViProxy' ? flag(settings?.hostToProxyEncryption) : 'Not applicable'}{row.type === 'ViProxy' && <small>Host-to-proxy TLS setting when network transport is used.</small>}</dd></div>
          <div><dt>Concurrent task limit</dt><dd><Tasks row={row} /></dd></div>
          <div><dt>Active tasks / utilization</dt><dd>Not exposed by proxy inventory<small>A configured limit does not measure current load or available slots.</small></dd></div>
        </dl>
        <p className={ops.panelFoot}>VMware transport modes and network settings do not apply to general-purpose or Hyper-V off-host proxies. Zero and missing task limits are never treated as unlimited.</p>
      </Panel>
    </div>
    {row.type === 'ViProxy' && <Panel title="Connected datastores" subtitle="Configured direct SAN/NFS datastore access. This does not measure current connectivity.">
      <dl className={styles.facts}><div><dt>Automatic datastore detection</dt><dd>{flag(datastores?.autoSelectEnabled)}</dd></div></dl>
      {datastores?.datastores?.length ? <div className={ops.tableScroll}><SortableGrid rows={datastores.datastores} columns={[{id:'datastore',value:r=>r.datastore?.name || r.datastore?.objectId},{id:'host',value:r=>r.datastore?.hostName},{id:'count',value:r=>r.vmCount}]}>{(sortedDatastores)=>(<table className={ops.table}><thead><tr><th>Datastore</th><th>Inventory host</th><th>Reported VM count</th></tr></thead><tbody>{sortedDatastores.map((d, index) => <tr key={index}><td>{d.datastore?.name || d.datastore?.objectId || 'Not reported'}</td><td>{d.datastore?.hostName || 'Not reported'}</td><td>{d.vmCount != null && Number.isSafeInteger(d.vmCount) && d.vmCount >= 0 ? d.vmCount : 'Not reported'}</td></tr>)}</tbody></table>)}</SortableGrid></div> : <Empty>{datastores?.autoSelectEnabled === true ? 'Datastores are detected automatically; no explicit datastore entries were returned.' : datastores?.datastores ? 'No explicit datastore entries were returned.' : 'Datastore configuration was not reported.'}</Empty>}
    </Panel>}
    <Panel title="Source identifiers"><dl className={styles.facts}><div><dt>Proxy ID</dt><dd><code>{row.id}</code></dd></div><div><dt>Host ID</dt><dd><code>{row.hostId || 'Not reported'}</code></dd></div>{row.hostConflict && <><div><dt>Configured host ID</dt><dd><code>{row.config?.server?.hostId}</code></dd></div><div><dt>State host ID</dt><dd><code>{row.state?.hostId}</code></dd></div></>}</dl></Panel>
  </>
}
export function ProxyOperations({ id }: { id?: string }) {
  const { revision, refresh } = useRefresh()
  const load = useCallback((signal: AbortSignal) => veeamApi.getProxyInventory(signal), [])
  const { data, error, loading } = useEvidence(load, revision)
  const rows = useMemo(() => data ? buildProxies(data) : [], [data])
  const [filters, setFilters] = useState<ProxyFilters>(defaultProxyFilters), [order, setOrder] = useState('risk'), [page, setPage] = useState(0)
  const [action, setAction] = useState<ProxyAction | null>(null), [pending, setPending] = useState(false)
  const view = useMemo(() => proxyPage(rows, filters, order, page), [rows, filters, order, page])
  const selected = id ? rows.find(r => r.id === id) : null
  const counts = Object.fromEntries(issueFilters.map(f => [f.value, rows.filter(row => matchesProxy(row, { ...defaultProxyFilters, issue: f.value })).length]))
  const full = data?.configs.complete && data.states.complete && data.hosts.complete
  const filtered = Object.keys(filters).some(k => filters[k as keyof ProxyFilters] !== defaultProxyFilters[k as keyof ProxyFilters])
  function change<K extends keyof ProxyFilters>(key: K, value: ProxyFilters[K]) { setFilters(current => ({ ...current, [key]: value })); setPage(0) }
  function quick(issue: ProxyIssue) { setFilters({ ...defaultProxyFilters, issue }); setPage(0) }
  async function runAction() {
    if (!action || pending) return
    setPending(true)
    try {
      if (action.type === 'enable') await veeamApi.enableBackupProxy(action.row.id)
      else if (action.type === 'disable') await veeamApi.disableBackupProxy(action.row.id)
      else await veeamApi.deleteBackupProxy(action.row.id)
      toast.success(`Proxy ${action.type === 'remove' ? 'removal' : action.type} request accepted`)
      setAction(null); refresh()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Proxy action failed.') }
    finally { setPending(false) }
  }
  return <div className={cn(ops.console, styles.page)}>
    <header className={ops.header}><div><h1>{id ? selected?.name || 'Proxy investigation' : 'Backup proxies'}</h1><p>{id ? 'Availability, transport policy, and task limits for this proxy.' : 'Find unavailable proxies, inspect transport policy, and review configured task limits.'}</p></div><div className={ops.headerActions}>{id && <Link className={ops.backLink} href="/vbr/infrastructure/proxies"><ArrowLeft size={14} />All proxies</Link>}{data && <span className={ops.source}><span className={ops.dot} />{data.sourceName}</span>}<Button variant="outline" size="sm" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</Button>{selected && <Actions row={selected} onAction={setAction} />}</div></header>
    {error && <Notice error>{error}{data && ' Showing the previous snapshot; this refresh failed.'}</Notice>}
    {!data ? loading ? <Loading>Loading proxy states, configuration, and managed hosts…</Loading> : <Empty>Proxy inventory is unavailable. Use Refresh to retry.</Empty> : <>
      {!!data.warnings.length && <details className={ops.warnings}><summary>{data.warnings.length} data coverage {data.warnings.length === 1 ? 'notice' : 'notices'}</summary><ul>{data.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
      {id ? selected ? <ProxyDetail row={selected} /> : <Empty>{data.configs.complete && data.states.complete ? 'This proxy was not found in the connected source.' : 'This proxy was not found in the available records. Incomplete inventory may omit it.'}<Link className={ops.backLink} href="/vbr/infrastructure/proxies">Return to proxy inventory</Link></Empty> : <>
        <div className={ops.metrics}>
          <button className={cn(ops.metric, styles.metric)} onClick={() => quick('all')}><div className={ops.metricLabel}>Backup proxies<ServerCog size={17} /></div><div className={ops.metricValue}>{rows.length}</div><p>{new Set(rows.map(r => r.hostId).filter(Boolean)).size} identified hosts · {full ? 'complete inventory' : 'partial evidence'}</p></button>
          <button className={cn(ops.metric, styles.metric)} onClick={() => quick('onlineEnabled')}><div className={ops.metricLabel}>Online & enabled<Network size={17} /></div><div className={cn(ops.metricValue, ops.success)}>{data.states.available ? rows.filter(onlineEnabled).length : 'Unknown'}</div><p>Reported state · task load is not exposed</p></button>
          <button className={cn(ops.metric, styles.metric)} onClick={() => quick('attention')}><div className={ops.metricLabel}>Need attention<TriangleAlert size={17} /></div><div className={cn(ops.metricValue, counts.attention ? ops.danger : ops.neutral)}>{counts.attention > 0 || data.states.available ? counts.attention : 'Unknown'}</div><p>{data.states.available ? `${counts.offline} offline · ${counts.disabled} disabled · ${counts.outdated} outdated` : 'Proxy states unavailable · configured limits only'}</p></button>
          <button className={cn(ops.metric, styles.metric)} onClick={() => quick('unknown')}><div className={ops.metricLabel}>Missing evidence<CircleHelp size={17} /></div><div className={ops.metricValue}>{counts.unknown}</div><p>Unknown state, transport, limits, or configuration</p></button>
        </div>
        <Panel title="Proxy inventory" subtitle="Offline, disabled, outdated, and zero task limits are flagged independently." action={<span className={ops.smallTag}>{view.count} MATCHING</span>}>
          <FilterWorkspace label="Proxy inventory filters" search={<><SearchBox label="Search proxies, hosts, descriptions, or IDs" value={filters.query} onChange={value => change('query', value)} /></>} onClear={() => { setFilters(defaultProxyFilters); setPage(0) }} filters={<FilterFields><FilterCondition>{issueFilters.map(f => <button key={f.value} aria-pressed={filters.issue === f.value} onClick={() => change('issue', f.value)} className={cn(styles.quickFilter, filters.issue === f.value && styles.selected)}>{f.label}<span>{counts[f.value]}</span></button>)}</FilterCondition>
<FilterSelect label={"Proxy type"} value={filters.type} onValueChange={e => change('type', e)}><option value="all">All types</option>{[...new Set(rows.map(r => r.type))].sort().map(type => <option key={type} value={type}>{proxyType(type)}</option>)}</FilterSelect>
<FilterSelect label={"Transport mode"} value={filters.transport} onValueChange={e => change('transport', e)}><option value="all">All modes</option>{[...new Set([...Object.keys(transportNames), ...rows.map(r => transport(r).key)])].filter(key => !['unknown', 'na'].includes(key)).map(key => <option key={key} value={key}>{transportNames[key] || key}</option>)}<option value="unknown">Not reported</option><option value="na">Not applicable</option></FilterSelect>
<FilterSelect label={"Task limit"} value={filters.tasks} onValueChange={e => change('tasks', e)}><option value="all">All limits</option><option value="positive">Positive limit</option><option value="zero">Zero reported</option><option value="unknown">Not reported / invalid</option></FilterSelect>
<span>Counts cover loaded proxy IDs. Network-only transport and disabled fallback can be intentional.</span></FilterFields>} actions={<><GridViewMenu><select aria-label="Proxy sort order" value={order} onChange={e => { setOrder(e.target.value); setPage(0) }}><option value="risk">Issues first</option><option value="name">Name A–Z</option><option value="tasks">Highest task limit</option></select></GridViewMenu></>}>
{view.count ? <div className={ops.tableScroll}><SortableGrid rows={view.allRows} columns={[{id:'name',value:r=>r.name},{id:'available',value:r=>r.state?.isOnline},{id:'transport',value:r=>transport(r).label},{id:'tasks',value:r=>taskLimit(r)},{id:'updates',value:r=>r.state?.isOutOfDate}]} key={order} onSortChange={()=>setPage(0)}>{(sortedRows)=>(<table className={cn(ops.table, styles.table)}><thead><tr><th>Proxy / host</th><th>Availability</th><th>Transport policy</th><th>Concurrent tasks</th><th>Components</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{sortedRows.slice(view.current*15,(view.current+1)*15).map(row => <tr key={row.id}>
            <td><div className={styles.identity}><ServerCog size={17} /><div><Link className={ops.jobName} href={proxyHref(row.id)}>{row.name}</Link><div className={ops.subtext}>{proxyType(row.type)} · {row.host?.type || 'Host type not reported'}</div><div className={styles.host} title={row.hostName}>{row.hostName}</div>{row.host?.isVBRLinuxAppliance === true && <small>VBR Linux appliance</small>}</div></div></td>
            <td><Health row={row} /></td>
            <td><div className={styles.transport}><strong>{transport(row).label}</strong>{row.type === 'ViProxy' && <small>{transport(row).key === 'Network' ? `Network encryption: ${flag(row.config?.server?.hostToProxyEncryption)}` : `NBD fallback: ${networkFallback(row)}`}</small>}</div></td>
            <td><Tasks row={row} /></td><td><Updates row={row} /></td>
            <td><div className={styles.rowActions}><Link className={ops.inspect} href={proxyHref(row.id)} aria-label={`Investigate ${row.name}`}><ArrowUpRight size={17} /></Link><Actions row={row} onAction={setAction} /></div></td>
          </tr>)}</tbody></table>)}</SortableGrid></div> : <Empty>{rows.length ? 'No proxies match these filters.' : data.configs.complete && data.states.complete ? 'No proxies are configured on this source.' : 'No proxies were returned in the available inventory.'}{filtered && <Button variant="outline" size="sm" onClick={() => { setFilters(defaultProxyFilters); setPage(0) }}>Reset filters</Button>}</Empty>}
<Pager page={view.current} count={view.count} size={15} onChange={setPage} label="proxies" />
<p className={ops.panelFoot}>Task limits are configured maxima, not active tasks or spare capacity. Proxy roles sharing a host remain separate; their limits are not added. Transport mode describes policy, not the mode used by a particular session. Missing status is never treated as offline, enabled, or up to date.</p>
</FilterWorkspace></Panel>
      </>}
      <footer className={ops.footer}><span><span className={ops.dot} />Snapshot {date(data.fetchedAt)}{loading ? ' · Refreshing…' : ' · Refreshes every 60 seconds while visible'}</span><span>VBR {data.apiRevision} · {full ? 'Complete inventory' : 'Partial evidence'}</span></footer>
    </>}
    <Dialog open={!!action} onOpenChange={open => { if (!open && !pending) setAction(null) }}><DialogContent><DialogHeader><DialogTitle>{action?.type === 'remove' ? 'Remove proxy' : action?.type === 'enable' ? 'Enable proxy' : 'Disable proxy'}</DialogTitle><DialogDescription>{action?.type === 'remove' ? 'Remove this proxy role from VBR configuration. VBR validates dependencies and eligibility.' : action?.type === 'enable' ? 'Enable this proxy for task assignments on the connected VBR server.' : 'Disable this proxy for new task assignments. This reduces the proxy resources available to jobs.'} Review the exact proxy before submitting.</DialogDescription></DialogHeader><p className="text-sm break-words">{action?.row.name} · {action?.row.hostName}</p><code className="text-xs text-muted-foreground break-all">{action?.row.id}</code><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setAction(null)}>Cancel</Button><Button variant={action?.type === 'remove' ? 'destructive' : 'default'} disabled={pending} onClick={runAction}>{pending ? 'Sending…' : action?.type === 'remove' ? 'Remove proxy' : action?.type === 'enable' ? 'Enable proxy' : 'Disable proxy'}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
