"use client"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterCondition,FilterFields,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableGrid } from '@/components/ui/sortable-grid'
import { Fragment,useCallback,useMemo,useState } from 'react'

import { Empty,Loading,Notice,Pager,SearchBox,date,useEvidence,useRefresh } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { veeamApi } from '@/lib/api/veeam-client'
import { utilization } from '@/lib/operations/model'
import { buildInventory,defaultInventoryFilters,inventoryPage,matchesRepository,needsStorageAttention,policyState,riskRank,rowIssues,type InventoryFilters,type InventoryRow,type Issue } from '@/lib/repositories/inventory'
import { reportedGB,repositoryHref } from '@/lib/repositories/model'
import { cn } from '@/lib/utils'
import { ArrowUpRight,HardDrive,Layers,MoreHorizontal,RefreshCw,RotateCw,ShieldCheck,Trash2,TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import styles from './repository-list.module.css'

function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'danger' | 'warning' | 'success' | 'active' }) {
  return <span className={cn(ops.badge, ops[tone])}><span className={ops.dot} />{label}</span>
}
function StorageHealth({ row }: { row: InventoryRow }) {
  const issues = rowIssues(row), labels = []
  if (issues.offline) labels.push(<Badge key="offline" label="Offline" tone="danger" />)
  else if (row.state?.isOnline === true) labels.push(<Badge key="online" label="Online" tone="success" />)
  else labels.push(<Badge key="unknown" label="Availability unknown" />)
  if (issues.critical) labels.push(<Badge key="space" label="Critical capacity" tone="danger" />)
  else if (issues.low) labels.push(<Badge key="space" label="Low space" tone="warning" />)
  if (issues.outdated) labels.push(<Badge key="outdated" label="Update required" tone="warning" />)
  for (const status of issues.extentStates) labels.push(<Badge key={status} label={status} tone="warning" />)
  return <div className={styles.badges}>{labels}</div>
}
function Capacity({ row }: { row: InventoryRow }) {
  const used = row.state ? utilization(row.state) : null
  return <div className={styles.capacity}>
    <strong>{used === null ? 'Unmeasured' : `${used.toFixed(1)}% used`}</strong>
    {used !== null && <div className={ops.capacityBar} role="meter" aria-label={`${row.name} capacity used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}><span className={used >= 90 ? ops.dangerBar : used >= 80 ? ops.warningBar : ops.successBar} style={{ width: `${used}%` }} /></div>}
    <p>{used === null ? `Reported used: ${reportedGB(row.state?.usedSpaceGB)}` : `${reportedGB(row.state?.freeGB)} free / ${reportedGB(row.state?.capacityGB)}`}</p>
    {row.config?.repository?.useFastCloningOnXFSVolumes === true && <small>XFS Fast Clone enabled</small>}
  </div>
}
function TaskLimit({ row }: { row: InventoryRow }) {
  const settings = row.config?.repository
  const enabled = settings?.taskLimitEnabled ?? settings?.enableTaskLimit ?? row.config?.taskLimitEnabled
  const max = settings?.maxTaskCount ?? row.config?.maxTaskCount
  return <span>{enabled === false ? 'Unlimited' : enabled === true && max != null && max > 0 ? `${max} concurrent` : 'Not reported'}</span>
}
type ManagementAction = { row: InventoryRow; action: 'rescan' | 'remove' }
function RepositoryRow({ row, grouped, onAction }: { row: InventoryRow; grouped: boolean; onAction: (action: ManagementAction) => void }) {
  const policy = policyState(row)
  return <tr>
    <td><div className={styles.repository}><HardDrive size={16} /><div><Link className={ops.jobName} href={repositoryHref(row.id)}>{row.name}</Link><div className={ops.subtext}>{row.type}{grouped && row.memberships.length === 1 && ` · ${row.memberships[0].tier}`}</div>
      {(!grouped || row.memberships.length > 1) && row.memberships.map(m => <Link key={m.id} className={styles.membership} href={repositoryHref(m.id)}>{m.name} · {m.tier} <ArrowUpRight size={11} /></Link>)}
      <div className={styles.location} title={`${row.host} · ${row.path}`}>{row.host} · {row.path}</div>
    </div></div></td>
    <td><StorageHealth row={row} /></td>
    <td><Capacity row={row} /></td>
    <td><div className={styles.policy}><Badge label={row.policy.status} tone={policy === 'configured' ? 'success' : policy === 'disabled' ? 'warning' : 'neutral'} />{policy === 'unknown' ? <small>{row.config ? 'No immutability setting returned' : 'Configuration unavailable'}</small> : <><p>{row.policy.period}</p>{row.policy.mode !== 'Not reported' && <small>{row.policy.mode}</small>}</>}</div></td>
    <td className={styles.tasks}><TaskLimit row={row} /></td>
    <td><div className={styles.rowActions}><Link href={repositoryHref(row.id)} className={ops.inspect} aria-label={`Investigate ${row.name}`}><ArrowUpRight size={17} /></Link>
      {row.config && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${row.name}`}><MoreHorizontal size={17} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => onAction({ row, action: 'rescan' })}><RotateCw size={14} /> Rescan repository</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onSelect={() => onAction({ row, action: 'remove' })}><Trash2 size={14} /> Remove repository</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
    </div></td>
  </tr>
}
const issueFilters: { value: Issue; label: string }[] = [
  { value: 'all', label: 'All storage' }, { value: 'attention', label: 'Needs attention' },
  { value: 'critical', label: 'Critical capacity' }, { value: 'low', label: 'Low space' }, { value: 'offline', label: 'Offline' },
  { value: 'outdated', label: 'Component updates' }, { value: 'extent-state', label: 'Extent states' }, { value: 'unmeasured', label: 'Unmeasured' },
]
export function RepositoryList() {
  const { revision, refresh } = useRefresh()
  const load = useCallback((signal: AbortSignal) => veeamApi.getRepositoryInventory(signal), [])
  const { data, error, loading } = useEvidence(load, revision)
  const inventory = useMemo(() => data ? buildInventory(data) : { rows: [], groups: [] }, [data])
  const [filters, setFilters] = useState<InventoryFilters>(defaultInventoryFilters), [order, setOrder] = useState('risk'), [grouped, setGrouped] = useState(true), [page, setPage] = useState(0)
  const [action, setAction] = useState<ManagementAction | null>(null), [pending, setPending] = useState(false)
  const view = useMemo(() => inventoryPage(inventory.groups, filters, order, grouped, page), [inventory, filters, order, grouped, page])
  const counts = Object.fromEntries(issueFilters.map(f => [f.value, inventory.rows.filter(row => matchesRepository(row, { ...defaultInventoryFilters, issue: f.value })).length]))
  const configured = inventory.rows.filter(row => policyState(row) === 'configured').length
  const missingPolicy = inventory.rows.filter(row => policyState(row) === 'unknown').length
  const disabledPolicy = inventory.rows.filter(row => policyState(row) === 'disabled').length
  const full = data && data.states.complete && data.configs.complete && data.scaleOuts.complete
  const filtered = Object.keys(filters).some(key => filters[key as keyof InventoryFilters] !== defaultInventoryFilters[key as keyof InventoryFilters])
  function change<K extends keyof InventoryFilters>(key: K, value: InventoryFilters[K]) { setFilters(current => ({ ...current, [key]: value })); setPage(0) }
  function quick(issue: Issue) { setFilters({ ...defaultInventoryFilters, issue }); setPage(0) }
  async function runAction() {
    if (!action || pending) return
    setPending(true)
    try {
      if (action.action === 'rescan') await veeamApi.rescanBackupRepository([action.row.id])
      else await veeamApi.deleteBackupRepository(action.row.id)
      toast.success(action.action === 'rescan' ? 'Repository rescan request accepted' : 'Repository removal request accepted')
      setAction(null); refresh()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Repository action failed.') }
    finally { setPending(false) }
  }
  return <div className={cn(ops.console, styles.page)}>
    <header className={ops.header}><div><h1>Backup repositories</h1><p>Find storage pressure, review immutability, and investigate each repository in context.</p></div><div className={ops.headerActions}>{data && <span className={ops.source}><span className={ops.dot} />{data.sourceName}</span>}<Button variant="outline" size="sm" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</Button></div></header>
    {error && <Notice error>{error}{data && ' Showing the previous snapshot; this refresh failed.'}</Notice>}
    {!data ? loading ? <Loading>Loading repository states, configuration, and scale-out membership…</Loading> : <Empty>Repository inventory is unavailable. Use Refresh to retry.</Empty> : <>
      <div className={ops.metrics}>
        <button className={cn(ops.metric, styles.metric)} onClick={() => quick('all')}><div className={ops.metricLabel}>Storage repositories<HardDrive size={17} /></div><div className={ops.metricValue}>{inventory.rows.length}</div><p>{inventory.groups.filter(g => g.parent).length} scale-out parents · {full ? 'unique storage IDs' : 'partial inventory'}</p></button>
        <button className={cn(ops.metric, styles.metric)} onClick={() => quick('attention')}><div className={ops.metricLabel}>Need attention<TriangleAlert size={17} /></div><div className={cn(ops.metricValue, counts.attention ? ops.danger : ops.neutral)}>{counts.attention > 0 || data.states.available ? counts.attention : 'Unknown'}</div><p>{data.states.available ? `${counts.offline} offline · ${counts.low} at least 80% used` : 'Repository states unavailable · extent evidence only'}</p></button>
        <button className={cn(ops.metric, styles.metric)} onClick={() => { setFilters({ ...defaultInventoryFilters, immutability: 'configured' }); setPage(0) }}><div className={ops.metricLabel}>Immutability configured<ShieldCheck size={17} /></div><div className={cn(ops.metricValue, ops.success)}>{data.configs.available ? configured : 'Unknown'}</div><p>{disabledPolicy} explicitly disabled · {missingPolicy} not reported</p></button>
        <button className={cn(ops.metric, styles.metric)} onClick={() => quick('unmeasured')}><div className={ops.metricLabel}>Unmeasured capacity<Layers size={17} /></div><div className={ops.metricValue}>{counts.unmeasured}</div><p>Unknown or unlimited capacity · not zero usage</p></button>
      </div>
      {!!data.warnings.length && <details className={ops.warnings}><summary>{data.warnings.length} data coverage {data.warnings.length === 1 ? 'notice' : 'notices'}</summary><ul>{data.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
      <section className={ops.panel} aria-label="Repository inventory">
        <div className={ops.panelHeading}><div><h2>Storage inventory</h2><p>Critical at 90% used · low space at 80% · availability, components, and extent states flagged independently</p></div><span className={ops.smallTag}>{view.count} MATCHING</span></div>
        <FilterWorkspace label="Grid filters" search={<><SearchBox label="Search repositories, hosts, paths, or scale-out parents" value={filters.query} onChange={value => change('query', value)} /></>} onClear={() => { setFilters(defaultInventoryFilters); setPage(0) }} filters={<FilterFields><FilterCondition>{issueFilters.map(f => <button key={f.value} aria-pressed={filters.issue === f.value} onClick={() => change('issue', f.value)} className={cn(styles.quickFilter, filters.issue === f.value && styles.selected)}>{f.label}<span>{counts[f.value]}</span></button>)}</FilterCondition>
<FilterSelect label={"Immutability"} value={filters.immutability} onValueChange={e => change('immutability', e)}><option value="all">All policies</option><option value="configured">Configured / enabled</option><option value="disabled">Explicitly disabled</option><option value="unknown">Not reported</option></FilterSelect>
<FilterSelect label={"Storage type"} value={filters.type} onValueChange={e => change('type', e)}><option value="all">All types</option>{[...new Set(inventory.rows.map(r => r.type))].sort().map(type => <option key={type}>{type}</option>)}</FilterSelect>
<FilterSelect label={"Membership"} value={filters.membership} onValueChange={e => change('membership', e)}><option value="all">All repositories</option><option value="standalone">Standalone</option><option value="extent">Scale-out extents</option><option value="Performance">Performance tier</option><option value="Capacity">Capacity tier</option><option value="Archive">Archive tier</option><option value="unverified">Unverified membership</option></FilterSelect>
<span>Counts cover loaded storage IDs; scale-out parents are separate.</span></FilterFields>} actions={<><GridViewMenu><select aria-label="Repository sort order" value={order} onChange={e => { setOrder(e.target.value); setPage(0) }}><option value="risk">Issues first</option><option value="usage">Highest utilization</option><option value="name">Name A–Z</option></select>
<label className={ops.checkLabel}><input type="checkbox" checked={grouped} onChange={e => { setGrouped(e.target.checked); setPage(0) }} />Group by scale-out</label></GridViewMenu></>}>
{!view.count ? <Empty>{inventory.rows.length ? 'No repositories match these filters.' : full ? 'No storage repositories are configured on this source.' : 'No storage repositories were returned in the available inventory.'}{filtered && <Button size="sm" variant="outline" onClick={() => { setFilters(defaultInventoryFilters); setPage(0) }}>Reset filters</Button>}</Empty> :
          <div className={ops.tableScroll}><SortableGrid groupBy={grouped?row=>row.groupId:undefined} scope={grouped?'within each group, across loaded extents':'loaded repositories'} rows={view.allRows} columns={[{id:'name',value:r=>r.name},{id:'health',value:r=>riskRank(r)},{id:'capacity',value:r=>r.state?utilization(r.state):null},{id:'immutable',value:r=>r.policy.status},{id:'tasks',value:r=>r.config?.repository?.maxTaskCount ?? r.config?.maxTaskCount}]} key={order+String(grouped)} onSortChange={()=>setPage(0)}>{(sortedRows)=>(<table className={cn(ops.table, styles.table)}><thead><tr><th>Repository / location</th><th>Storage health</th><th>Capacity</th><th>Immutability policy</th><th>Task limit</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
            {grouped ? view.allGroups.map(group=>({...group,matching:group.rows.length,rows:sortedRows.slice(view.current*15,(view.current+1)*15).filter(row=>row.groupId===group.id)})).filter(group=>group.rows.length).map(group => {
              const total = inventory.groups.find(g => g.id === group.id)!, atRisk = total.rows.filter(needsStorageAttention).length, policies = total.rows.filter(r => policyState(r) === 'configured').length
              return <Fragment key={group.id}><tr className={styles.groupRow}><th colSpan={6} scope="rowgroup"><div className={styles.groupHeading}><div className={styles.groupName}>{group.parent ? <Layers size={18} /> : <HardDrive size={18} />}<div>{group.parent ? <Link href={repositoryHref(group.id)}>{group.name}<ArrowUpRight size={13} /></Link> : <strong>{group.name}</strong>}<p>{group.rows.length} shown · {group.matching} matching · {total.rows.length} {group.parent ? 'extents' : 'repositories'} total{group.inferred ? ' · membership evidence incomplete' : ''}</p></div></div><div className={styles.groupSummary}>{atRisk > 0 && <Badge label={`${atRisk} ${atRisk === 1 ? 'needs' : 'need'} attention in group`} tone="warning" />}<span>{policies}/{total.rows.length} immutability configured</span>{group.parent && <small>Capacity shown per extent</small>}</div></div></th></tr>{group.rows.map(row => <RepositoryRow key={row.id} row={row} grouped onAction={setAction} />)}</Fragment>
            }) : sortedRows.slice(view.current*15,(view.current+1)*15).map(row => <RepositoryRow key={row.id} row={row} grouped={false} onAction={setAction} />)}
          </tbody></table>)}</SortableGrid></div>}
<Pager page={view.current} count={view.count} size={15} onChange={setPage} label="repositories" />
<p className={ops.panelFoot}>Capacity is shown in VBR-reported GB; utilization uses total minus free. Shared volumes and scale-out parents are never summed. Immutability shows configured policy, not verified file locks. Use a repository’s investigation view for backup consumption and affected jobs.</p>
</FilterWorkspace></section>
      {!!view.emptyParents.length && <section className={styles.emptyParents} aria-label="Scale-out parents without loaded extents"><h2>Scale-out parents without loaded extents</h2>{view.emptyParents.map(g => <Link key={g.id} href={repositoryHref(g.id)}><Layers size={16} />{g.name}<ArrowUpRight size={14} /></Link>)}<p>These parents remain visible even when extent records are missing or their configuration is empty.</p></section>}
      <footer className={ops.footer}><span><span className={ops.dot} />Snapshot {date(data.fetchedAt)}{loading ? ' · Refreshing…' : ' · Refreshes every 60 seconds while visible'}</span><span>VBR {data.apiRevision} · {full ? 'Complete inventory' : 'Partial inventory'}</span></footer>
    </>}
    <Dialog open={!!action} onOpenChange={open => { if (!open && !pending) setAction(null) }}><DialogContent><DialogHeader><DialogTitle>{action?.action === 'remove' ? 'Remove repository' : 'Rescan repository'}</DialogTitle><DialogDescription>{action?.action === 'remove' ? 'Remove this repository from the VBR configuration. VBR validates dependencies and eligibility. Review the exact repository before submitting.' : 'Ask VBR to rescan this repository and update its backup inventory. This starts a repository operation on the connected server.'}</DialogDescription></DialogHeader><p className="text-sm break-words">{action?.row.name}</p><code className="text-xs text-muted-foreground break-all">{action?.row.id}</code><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setAction(null)}>Cancel</Button><Button variant={action?.action === 'remove' ? 'destructive' : 'default'} disabled={pending} onClick={runAction}>{pending ? 'Sending…' : action?.action === 'remove' ? 'Remove repository' : 'Start rescan'}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
