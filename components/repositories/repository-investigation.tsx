"use client"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { Empty,Loading,Notice,Pager,Panel,SearchBox,Status,date,useEvidence,useRefresh } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { veeamApi } from '@/lib/api/veeam-client'
import { validId } from '@/lib/investigation/model'
import { jobStatus,repositoryRisk,utilization } from '@/lib/operations/model'
import { configuredImmutability,reportedGB,repositoryHref,yesNo,type Consumption,type RepositoryConfig,type RepositorySnapshot } from '@/lib/repositories/model'
import { formatBytes } from '@/lib/restore-points/model'
import { cn } from '@/lib/utils'
import { ArrowLeft,ArrowUpRight,Database,HardDrive,Layers,RefreshCw,ShieldCheck,TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useCallback,useState,type ReactNode } from 'react'
import styles from './repositories.module.css'

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'danger' | 'warning' | 'success' | 'neutral' | 'active' }) {
  return <span className={cn(ops.badge, ops[tone])}><span className={ops.dot} />{children}</span>
}
const healthTone = (health: string) => health === 'Offline' || health === 'Critical' ? 'danger' : health === 'Low space' || health === 'Outdated' ? 'warning' : health === 'Healthy' ? 'success' : 'neutral'
function Metric({ label, value, note, icon, tone }: { label: string; value: ReactNode; note: string; icon: ReactNode; tone?: string }) {
  return <div className={ops.metric}><div className={ops.metricLabel}>{label}<span className={ops.metricIcon}>{icon}</span></div><div className={cn(ops.metricValue, styles.metricValue, tone && ops[tone])}>{value}</div><p>{note}</p></div>
}
function Detail({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div> }
function bytes(consumption: Consumption) { return consumption.physical === null ? 'Not measured' : formatBytes(consumption.physical) }
function Immutability({ config, parent }: { config: RepositoryConfig | null; parent: boolean }) {
  const evidence = configuredImmutability(config)
  const tone = ['Enabled', 'Configured'].includes(evidence.status) ? 'success' : evidence.status === 'Disabled' ? 'warning' : 'neutral'
  return <Panel title="Immutability" subtitle={parent ? 'Review configuration on each extent below' : 'Repository configuration returned by VBR'} action={<ShieldCheck size={18} className={ops.neutral} />}>
    <div className={styles.protection}><Badge tone={tone}>{parent ? 'Defined per extent' : evidence.status}</Badge><strong>{parent ? 'Extent policies' : evidence.period}</strong><p>{parent ? 'A scale-out repository can contain extents with different immutability settings.' : evidence.evidence}</p></div>
    {!parent && <dl className={styles.details}><Detail label="Policy mode">{evidence.mode}</Detail><Detail label="File lock verification">Not exposed by this API</Detail></dl>}
    <p className={ops.panelFoot}>Configured retention does not verify that every file is currently locked. These endpoints do not report file lock expiry or safely reclaimable bytes. Investigate job and task logs for immutability errors.</p>
  </Panel>
}
function Capacity({ data, parent }: { data: RepositorySnapshot; parent: boolean }) {
  const state = data.state, percent = state ? utilization(state) : null
  const health = state ? repositoryRisk(state) : 'Unknown'
  const settings = data.config?.repository, storage = data.config?.bucket || data.config?.container
  const taskEnabled = settings?.taskLimitEnabled ?? settings?.enableTaskLimit ?? data.config?.taskLimitEnabled
  const taskCount = settings?.maxTaskCount ?? data.config?.maxTaskCount
  const limit = storage?.storageConsumptionLimit
  if (parent) {
    const capacity = data.scaleOut?.capacityTier, archive = data.scaleOut?.archiveTier
    const days = (value?: number | null) => value != null && value >= 0 ? `${value} days` : 'Not reported'
    const tiers = ['Performance', 'Capacity', 'Archive']
    return <Panel title="Capacity & storage" subtitle="Scale-out layout and tiering policies" action={<Layers size={18} className={ops.neutral} />}>
      <div className={styles.capacity}><div className={styles.capacityNumber}><strong>{data.extents.length}</strong><span>storage extents</span></div><div className={cn(styles.capacityNumbers, styles.tiers)}>{tiers.map(tier => <div key={tier}><small>{tier} tier</small><strong>{data.extents.filter(e => e.tier.startsWith(tier)).length} extents</strong></div>)}</div></div>
      <dl className={styles.details}>
        <Detail label="Capacity tier">{yesNo(capacity?.isEnabled)}</Detail>
        <Detail label="Copy backups to capacity tier">{yesNo(capacity?.copyPolicyEnabled)}</Detail>
        <Detail label="Move inactive chains">{yesNo(capacity?.movePolicyEnabled)}</Detail>
        <Detail label="Operational restore window">{days(capacity?.operationalRestorePeriodDays)}</Detail>
        <Detail label="Archive tier">{yesNo(archive?.isEnabled)}</Detail>
        <Detail label="Archive after">{archive?.isEnabled === false ? 'Not applicable' : days(archive?.archivePeriodDays)}</Detail>
      </dl>
      <p className={ops.panelFoot}>Inspect free space on each extent below. Capacity is not added across tiers or shared volumes; a parent total would conceal which storage location needs attention.</p>
    </Panel>
  }
  return <Panel title="Capacity & storage" subtitle={parent ? 'Parent readings are shown separately from extent capacity' : 'Current repository readings from VBR'} action={<Badge tone={healthTone(health)}>{health}</Badge>}>
    <div className={styles.capacity}>
      <div className={styles.capacityNumber}><strong className={ops[healthTone(health)]}>{percent === null ? 'Unmeasured' : `${percent.toFixed(1)}%`}</strong><span>used capacity</span></div>
      <div className={styles.capacityTrack} role={percent === null ? undefined : 'meter'} aria-label="Repository capacity used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><span className={percent !== null && percent >= 90 ? ops.dangerBar : percent !== null && percent >= 80 ? ops.warningBar : ops.successBar} style={{ width: `${percent ?? 0}%` }} /></div>
      <div className={styles.capacityNumbers}><div><small>Free</small><strong>{reportedGB(state?.freeGB)}</strong></div><div><small>Total</small><strong>{reportedGB(state?.capacityGB)}</strong></div><div><small>Reported used</small><strong>{reportedGB(state?.usedSpaceGB)}</strong></div></div>
    </div>
    {state?.usedSpaceGB != null && state.capacityGB != null && state.capacityGB > 0 && state.usedSpaceGB > state.capacityGB && <div className={styles.inlineNotice}><Layers size={15} /><p>Reported used bytes exceed volume capacity.{settings?.useFastCloningOnXFSVolumes === true && ' XFS Fast Clone is enabled.'} File sizes can include shared blocks; use free capacity to assess storage headroom.</p></div>}
    <dl className={styles.details}>
      <Detail label="Availability"><Badge tone={state?.isOnline === true ? 'success' : state?.isOnline === false ? 'danger' : 'neutral'}>{state?.isOnline === true ? 'Online' : state?.isOnline === false ? 'Offline' : 'Not reported'}</Badge></Detail>
      <Detail label="Components">{state?.isOutOfDate === true ? 'Update required' : state?.isOutOfDate === false ? 'Up to date' : 'Not reported'}</Detail>
      <Detail label="Host">{state?.hostName || (parent ? 'Multiple extents' : 'Not reported')}</Detail>
      <Detail label="Path / container">{state?.path || settings?.path || [storage?.bucketName || storage?.containerName, storage?.folderName || storage?.folder].filter(Boolean).join('/') || 'Not reported'}</Detail>
      <Detail label="Concurrent task limit">{taskEnabled === false ? 'Unlimited (configured)' : taskEnabled === true && taskCount != null && taskCount > 0 ? `${taskCount} tasks` : 'Not reported'}</Detail>
      <Detail label="XFS Fast Clone">{yesNo(settings?.useFastCloningOnXFSVolumes)}</Detail>
      <Detail label="Per-VM backup files">{yesNo(settings?.advancedSettings?.perVmBackup)}</Detail>
      {limit && <Detail label="Object storage soft limit">{limit.isEnabled === false ? 'Disabled' : limit.isEnabled === true && limit.consumptionLimitCount != null ? `${limit.consumptionLimitCount} ${limit.consumptionLimitKind || '(unit not reported)'}` : 'Not reported'}</Detail>}
    </dl>
    <p className={ops.panelFoot}>Capacity units are GB as reported by VBR. Utilization uses total minus free. Repositories may share a volume; their capacity readings must not be added together. Negative capacity values remain unmeasured.</p>
  </Panel>
}
function BackupTable({ data, parent }: { data: RepositorySnapshot; parent: boolean }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const rows = data.backups.data.filter(b => [b.name, b.repositoryName, b.jobType].join(' ').toLowerCase().includes(query.toLowerCase()))
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 8) - 1))
  return <Panel title="Backup consumption" subtitle={parent ? 'Backups assigned to this scale-out repository or its extents' : 'Backups linked to this repository by repository ID'} action={<span className={ops.smallTag}>{data.backups.available ? `${data.backups.data.length} BACKUPS` : 'UNAVAILABLE'}</span>}>
    <div className={styles.consumptionSummary}><div><small>{data.consumption.complete ? 'Reported file bytes' : 'Known file bytes · partial'}</small><strong>{bytes(data.consumption)}</strong></div><div><small>Before compression / deduplication{!data.consumption.complete || data.consumption.unknownLogical ? ' · known subtotal' : ''}</small><strong>{data.consumption.logical === null ? 'Not measured' : formatBytes(data.consumption.logical)}</strong></div><div><small>Unique files loaded</small><strong>{data.consumption.files.toLocaleString()}<span> · {data.consumption.shared} shared across workloads</span></strong></div></div>
    {(!data.consumption.complete || !data.backups.complete) && <div className={styles.inlineNotice}><TriangleAlert size={15} /><p>Consumption covers readable files only. {data.consumption.unknownPhysical > 0 && `${data.consumption.unknownPhysical} files have an unknown size. `}{data.consumption.conflicts > 0 && `${data.consumption.conflicts} conflicting file IDs were excluded. `}Missing or unsupported inventory is not zero usage.</p></div>}
    {!!data.parentBackups && <div className={styles.inlineNotice}><Layers size={15} /><p>{data.parentBackups} additional backups belong to a scale-out parent. Their file bytes are not assigned to this extent; inspect the parent for those backups.</p></div>}
    <FilterWorkspace label="Backup consumption filters" search={<><SearchBox label="Search backups" value={query} onChange={value => { setQuery(value); setPage(0) }} /></>} onClear={()=>{setQuery('');setPage(0)}} filters={<FilterFields><span>Largest known file size first</span></FilterFields>}>
{!data.backups.available ? <Empty>Backup inventory is unavailable. Refresh to retry.</Empty> : !rows.length ? <Empty>{query ? 'No backups match your search.' : 'No backups in the loaded inventory reference this repository directly.'}</Empty> : <div className={ops.tableScroll}><SortableGrid rows={rows} columns={[{id:'name',value:r=>r.name},{id:'physical',value:r=>r.consumption.physical},{id:'logical',value:r=>r.consumption.logical},{id:'files',value:r=>r.consumption.files},{id:'newest',value:r=>r.consumption.latest,kind:'date'}]} onSortChange={()=>setPage(0)}>{(rows)=>(<table className={ops.table}><thead><tr><th>Backup</th><th>Reported file bytes</th><th>Data before reduction</th><th>Files / shared</th><th>Newest file</th><th>Investigate</th></tr></thead><tbody>{rows.slice(current * 8, current * 8 + 8).map(backup => <tr key={backup.id}>
      <td><Link className={ops.jobName} href={`/vbr/protected-data/restore-points?backupId=${backup.id}&name=${encodeURIComponent(backup.name || 'Backup')}`}>{backup.name || backup.id}</Link><p className={ops.subtext}>{backup.jobType || 'Type not reported'}{parent && ` · ${backup.repositoryName || backup.repositoryId || 'Repository not reported'}`}</p></td>
      <td className={styles.numeric}><strong>{bytes(backup.consumption)}</strong><p className={ops.subtext}>{backup.error || (!backup.available ? 'Unavailable' : backup.consumption.complete ? 'Complete file inventory' : 'Partial / unknown sizes')}</p></td>
      <td className={styles.numeric}>{backup.consumption.logical === null ? 'Not measured' : formatBytes(backup.consumption.logical)}{backup.consumption.unknownLogical > 0 && <p className={ops.subtext}>Known subtotal · {backup.consumption.unknownLogical} unknown</p>}</td>
      <td>{backup.available ? `${backup.consumption.files} / ${backup.consumption.shared}` : 'Not reported'}</td><td className={ops.dateCell}>{date(backup.consumption.latest)}</td>
      <td>{validId(backup.jobId) ? <Link className={ops.textLink} href={`/vbr/jobs/${backup.jobId}`}>Job <ArrowUpRight size={13} /></Link> : <span className={ops.subtext}>Job not reported</span>}</td>
    </tr>)}</tbody></table>)}</SortableGrid></div>}
<Pager page={current} count={rows.length} size={8} onChange={setPage} label="backups" />
<p className={ops.panelFoot}>Each file ID is counted once; shared files are never multiplied by workload or restore-point count. File sizes are displayed in IEC units. File bytes are not exclusive disk allocation: Fast Clone, other data, and metadata can differ from volume usage.{parent && ' The file API does not locate bytes on individual tiers, so these figures are not a tier allocation breakdown.'}</p>
</FilterWorkspace></Panel>
}
function JobTable({ data }: { data: RepositorySnapshot }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(0)
  const rows = data.jobs.data.filter(row => [row.name, ...row.relationships].join(' ').toLowerCase().includes(query.toLowerCase()) &&
    (filter === 'all' || filter === 'issues' && ['Failed', 'Warning'].includes(row.job?.lastResult || '') || filter === 'target' && row.relationships.some(r => r !== 'Retained backup')))
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 8) - 1))
  return <Panel title="Affected jobs" subtitle="Configured targets, scale-out dependencies, and retained-backup ownership" action={<span className={ops.smallTag}>{data.jobs.data.length} LINKED</span>}>
    {!data.jobs.complete && <div className={styles.inlineNotice}><TriangleAlert size={15} /><p>Dependency inventory is incomplete. Additional jobs may be affected.</p></div>}
    <FilterWorkspace label="Affected jobs filters" search={<><SearchBox label="Search affected jobs" value={query} onChange={value => { setQuery(value); setPage(0) }} /></>} onClear={()=>{setQuery('');setFilter('all');setPage(0)}} filters={<FilterFields><FilterSelect label={"Affected jobs filter"} value={filter} onValueChange={e => { setFilter(e); setPage(0) }}><option value="all">All relationships</option><option value="issues">Last run failed / warning</option><option value="target">Configured dependencies</option></FilterSelect></FilterFields>}>
{!data.jobs.available ? <Empty>Job dependencies are unavailable.</Empty> : !rows.length ? <Empty>{query || filter !== 'all' ? 'No linked jobs match these filters.' : 'No job relationships were found in the loaded inventory.'}</Empty> : <div className={ops.tableScroll}><SortableGrid rows={rows} columns={[{id:'name',value:r=>r.name},{id:'relationship',value:r=>r.relationships.join(", ")},{id:'status',value:r=>r.job?.status},{id:'result',value:r=>r.job?.lastResult},{id:'lastRun',value:r=>r.job?.lastRun,kind:'date'},{id:'nextRun',value:r=>r.job?.nextRun,kind:'date'}]} onSortChange={()=>setPage(0)}>{(rows)=>(<table className={ops.table}><thead><tr><th>Job</th><th>Relationship</th><th>Current status</th><th>Last result</th><th>Last run</th><th>Next run</th><th>Evidence</th></tr></thead><tbody>{rows.slice(current * 8, current * 8 + 8).map(row => <tr key={row.id}>
      <td><Link className={ops.jobName} href={`/vbr/jobs/${row.id}`}>{row.name}</Link><p className={ops.subtext}>{row.job?.type || 'Current job not returned'}</p></td>
      <td><div className={styles.relationships}>{row.relationships.map(r => <Badge key={r} tone={r === 'Via scale-out parent' ? 'active' : 'neutral'}>{r}</Badge>)}</div>{row.backups > 0 && <p className={ops.subtext}>{row.backups} retained {row.backups === 1 ? 'backup' : 'backups'}</p>}</td>
      <td><Status value={row.job?.status || 'Not reported'} /></td><td><Status value={row.job?.lastResult || 'Not reported'} /></td>
      <td className={ops.dateCell}>{date(row.job?.lastRun)}</td><td className={ops.dateCell}>{date(row.job?.nextRun)}</td>
      <td><Link className={ops.textLink} href={`/vbr/jobs/${row.id}${validId(row.job?.sessionId) ? `?session=${row.job.sessionId}` : ''}`}>Sessions & logs <ArrowUpRight size={13} /></Link></td>
    </tr>)}</tbody></table>)}</SortableGrid></div>}
<Pager page={current} count={rows.length} size={8} onChange={setPage} label="affected jobs" />
<p className={ops.panelFoot}>A retained backup identifies its creating job, which may now target another repository or have been removed. Scale-out dependencies indicate potential exposure; they do not prove which extent a run used or that storage caused its failure.</p>
</FilterWorkspace></Panel>
}
function Extents({ data }: { data: RepositorySnapshot }) {
  if (!data.extents.length) return null
  return <Panel title="Storage extents" subtitle="Capacity and immutability stay separate for each repository">
    <div className={ops.tableScroll}><SortableGrid rows={data.extents} columns={[{id:'name',value:r=>r.name || r.id},{id:'tier',value:r=>r.tier},{id:'health',value:r=>r.state?repositoryRisk(r.state):null},{id:'free',value:r=>r.state?.freeGB},{id:'immutable',value:r=>configuredImmutability(r.config).status}]}>{(extents)=>(<table className={ops.table}><thead><tr><th>Extent</th><th>Tier / state</th><th>Health</th><th>Free / total</th><th>Immutability</th></tr></thead><tbody>{extents.map(extent => {
      const policy = configuredImmutability(extent.config), health = extent.state ? repositoryRisk(extent.state) : 'Unknown'
      return <tr key={extent.id}><td><Link className={ops.jobName} href={repositoryHref(extent.id)}>{extent.name}</Link></td><td>{extent.tier}<p className={ops.subtext}>{extent.status.join(', ') || 'Extent status not reported'}</p></td><td><Badge tone={healthTone(health)}>{health}</Badge></td><td>{reportedGB(extent.state?.freeGB)} / {reportedGB(extent.state?.capacityGB)}</td><td>{policy.status}<p className={ops.subtext}>{policy.period} · {policy.mode}</p></td></tr>
    })}</tbody></table>)}</SortableGrid></div>
    <p className={ops.panelFoot}>Capacity and archive tiers may have unmeasured or unlimited capacity. Parent and extent values are not summed.</p>
  </Panel>
}
export function RepositoryInvestigation({ id }: { id: string }) {
  const { revision, refresh } = useRefresh()
  const load = useCallback((signal: AbortSignal) => veeamApi.getRepositoryInvestigation(id, signal), [id])
  const { data, error, loading } = useEvidence(load, revision)
  const parent = !!data && (!!data.scaleOut || !!data.extents.length || data.state?.type === 'ExtendableRepository')
  const health = data?.state ? repositoryRisk(data.state) : 'Unknown'
  const issues = data?.jobs.data.filter(row => row.job && ['Failed', 'Warning'].includes(jobStatus(row.job))).length || 0
  const targets = data?.jobs.data.filter(row => row.relationships.some(r => r !== 'Retained backup')).length || 0
  const extentRisks = data?.extents.filter(e => e.state && ['Critical', 'Low space', 'Offline', 'Outdated'].includes(repositoryRisk(e.state))).length || 0
  return <div className={cn(ops.console, styles.page)}>
    <header className={ops.header}><div><h1>{data?.name || 'Repository investigation'}</h1><p>{parent ? 'Scale-out repository' : data?.config?.type || data?.state?.type || 'Backup repository'} · Capacity, backup consumption, and job dependencies</p></div><div className={ops.headerActions}><Link href="/vbr/infrastructure/repositories" className={ops.backLink}><ArrowLeft size={14} /> Repositories</Link><Link href="/vbr/lens/capacity" className={ops.backLink}>Capacity overview</Link><Button variant="outline" size="sm" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</Button></div></header>
    {error && <Notice error>{error}{data && ' Showing the previous snapshot; this refresh failed.'}</Notice>}
    {!data ? loading ? <Loading>Loading repository evidence…</Loading> : <Empty>Repository data could not be loaded. Use Refresh to retry.</Empty> : <>
      <nav aria-label="Repository sections" className={styles.sectionNav}><a href="#storage">Storage overview</a><a href="#consumption">Backup consumption</a><a href="#affected-jobs">Affected jobs</a><span>{data.sourceName}</span></nav>
      {(health === 'Critical' || health === 'Offline' || health === 'Low space') && <div className={cn(styles.alert, ops[healthTone(health)])}><TriangleAlert size={20} /><div><strong>{health === 'Offline' ? 'Repository is offline' : health === 'Critical' ? 'Capacity needs attention' : 'Free capacity is running low'}</strong><p>{health === 'Offline' ? 'Check storage connectivity and inspect dependent job logs.' : `${reportedGB(data.state?.freeGB)} free. Review the largest backups and investigate failed or warning job runs.`} {data.jobs.statesAvailable ? `${targets} configured job ${targets === 1 ? 'dependency' : 'dependencies'} found.` : 'Configured job dependencies are unavailable.'}</p></div><a href="#affected-jobs">Investigate jobs <ArrowUpRight size={14} /></a></div>}
      {!!data.warnings.length && <details className={ops.warnings}><summary>{data.warnings.length} data coverage {data.warnings.length === 1 ? 'notice' : 'notices'}</summary><ul>{data.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
      <div className={ops.metrics}>
        {parent ? <Metric label="Extent capacity" value={`${extentRisks} at risk`} note={`${data.extents.filter(e => e.state && utilization(e.state) !== null).length} of ${data.extents.length} extents have measured capacity`} icon={<HardDrive size={17} />} tone={extentRisks ? 'warning' : 'neutral'} />
          : <Metric label="Free capacity" value={reportedGB(data.state?.freeGB)} note={data.state?.capacityGB != null && data.state.capacityGB >= 0 ? `of ${reportedGB(data.state.capacityGB)} reported capacity` : 'Capacity is unmeasured'} icon={<HardDrive size={17} />} tone={healthTone(health)} />}
        <Metric label="Backup file bytes" value={bytes(data.consumption)} note={data.consumption.complete ? `${data.consumption.files} unique files · complete inventory` : `${data.consumption.files} files loaded · partial accounting`} icon={<Database size={17} />} />
        <Metric label="Job dependencies" value={data.jobs.statesAvailable ? targets : 'Unknown'} note={data.jobs.complete ? 'Direct targets and scale-out dependencies' : 'Loaded dependencies · inventory incomplete'} icon={<Layers size={17} />} />
        <Metric label="Jobs needing attention" value={data.jobs.statesAvailable ? issues : 'Unknown'} note="Loaded linked jobs with a failed or warning last result" icon={<TriangleAlert size={17} />} tone={issues ? 'danger' : 'neutral'} />
      </div>
      {!!data.parents.length && <div className={styles.parentLinks}><Layers size={16} /><span>Member of</span>{data.parents.map(p => <Link key={p.id} href={repositoryHref(p.id)}>{p.name}<ArrowUpRight size={13} /></Link>)}</div>}
      <div id="storage" className={styles.overview}><Capacity data={data} parent={parent} /><Immutability config={data.config} parent={parent} /></div>
      <div className={styles.stack}><Extents data={data} /><div id="consumption"><BackupTable data={data} parent={parent} /></div><div id="affected-jobs"><JobTable data={data} /></div></div>
      <footer className={ops.footer}><span><span className={ops.dot} /> Snapshot {date(data.fetchedAt)}{loading ? ' · Refreshing…' : ' · Refreshes every 60 seconds while visible'}</span><span>VBR {data.apiRevision} · {data.id}</span></footer>
    </>}
  </div>
}
