"use client"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterCondition,FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { AiHealthSummary } from '@/components/ai-health-summary'
import { LensSwitcher } from '@/components/lens/lens-switcher'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { veeamApi } from '@/lib/api/veeam-client'
import type { LensId } from '@/lib/lens/navigation'
import { activityBuckets,capacitySummary,exportJobsCsv,filterJobs,filterRepositories,isRunning,jobStatus,needsAttention,repositoryFilters,repositoryRisk,sessionSummary,utilization,type JobFilter,type OperationJob,type OperationsSnapshot,type Range,type RepositoryFilter } from '@/lib/operations/model'
import { cn } from '@/lib/utils'
import { Activity,ArrowDownToLine,ArrowRight,ArrowUpRight,Check,CheckCircle2,ChevronLeft,ChevronRight,CircleHelp,CirclePause,Clock3,Database,HardDrive,ListFilter,Loader2,Network,RefreshCw,Search,ShieldCheck,Sparkles,TriangleAlert,XCircle } from 'lucide-react'
import Link from 'next/link'
import { useEffect,useMemo,useState,type ReactNode } from 'react'
import { Bar,BarChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis } from 'recharts'
import styles from './operations.module.css'

type View = Exclude<LensId,'forecast'>
const titles = {
  overview: ['Overview', 'A clear picture of your backup estate. A focused plan for your day.'],
  operations: ['Job Operations', 'Investigate exceptions, follow active runs, and get to the right action.'],
  capacity: ['Capacity Watch', 'Find storage pressure before it becomes a failed backup.'],
}
const filters: { value: JobFilter; label: string }[] = [
  { value: 'attention', label: 'Needs attention' }, { value: 'running', label: 'Active' },
  { value: 'failed', label: 'Failed' }, { value: 'warning', label: 'Warning' },
  { value: 'disabled', label: 'Disabled' }, { value: 'all', label: 'All jobs' },
]
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not reported'
const space = (gb: number) => gb >= 1024 ? `${(gb / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} TB` : `${gb.toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`
const percent = (n: number | null) => n === null ? '—' : `${n.toFixed(1)}%`
function Tone({ value }: { value: string }) {
  const tone = ['Failed', 'Offline', 'Critical'].includes(value) ? 'danger' : ['Warning', 'Low space', 'Outdated'].includes(value) ? 'warning' : ['Success', 'Healthy', 'Passed'].includes(value) ? 'success' : ['Running', 'Starting', 'Stopping'].includes(value) ? 'active' : 'neutral'
  return <span className={cn(styles.badge, styles[tone])}><span className={styles.dot} />{value}</span>
}
function Panel({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cn(styles.panel, className)}><div className={styles.panelHeading}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>
}
function Empty({ children }: { children: ReactNode }) {
  return <div className={styles.empty}><CircleHelp size={22} /><p>{children}</p></div>
}
function Metric({ title, value, detail, href, onClick, selected, icon, accent }: { title: string; value: string; detail: string; href?: string; onClick?: () => void; selected?: boolean; icon: ReactNode; accent?: string }) {
  const content = <><div className={styles.metricLabel}>{title}<span className={cn(styles.metricIcon, accent && styles[accent])}>{icon}</span></div><div className={styles.metricValue}>{value}<ArrowUpRight size={18} /></div><p>{detail}</p></>
  return href ? <Link href={href} className={styles.metric}>{content}</Link> : <button type="button" className={cn(styles.metric, selected && styles.metricSelected)} onClick={onClick} aria-pressed={selected}>{content}</button>
}

export function OperationsConsole({ view = 'overview', initialFilter = 'attention' }: { view?: View; initialFilter?: JobFilter }) {
  const [range, setRange] = useState<Range>('24h')
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [filter, setFilter] = useState<JobFilter>(initialFilter)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [storageFilter, setStorageFilter] = useState<RepositoryFilter>('all')
  const [showAi, setShowAi] = useState(false)
  useEffect(() => { setFilter(initialFilter); setPage(0) }, [initialFilter])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
    veeamApi.getOperationsSnapshot(range, controller.signal).then(value => {
      if (!controller.signal.aborted) setSnapshot(value)
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'The operations snapshot could not be loaded.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [range, revision])
  useEffect(() => {
    if (loading) return
    const timer = setInterval(() => { if (!document.hidden) setRevision(n => n + 1) }, 60000)
    return () => clearInterval(timer)
  }, [loading])
  const data = snapshot?.range === range ? snapshot : null
  const summary = useMemo(() => data ? sessionSummary(data) : null, [data])
  const buckets = useMemo(() => data ? activityBuckets(data) : [], [data])
  const jobs = data?.jobs.data || []
  const attention = jobs.filter(needsAttention)
  const running = jobs.filter(isRunning)
  const capacity = capacitySummary(data?.repositories.data || [])
  const repositories = [...(data?.repositories.data || [])].sort((a, b) => {
    const rank = (risk: string) => ['Offline', 'Critical', 'Low space', 'Outdated', 'Unknown', 'Healthy'].indexOf(risk)
    return rank(repositoryRisk(a)) - rank(repositoryRisk(b)) || (utilization(b) ?? -1) - (utilization(a) ?? -1)
  })
  const atRisk = repositories.filter(r => ['Offline', 'Critical', 'Low space', 'Outdated'].includes(repositoryRisk(r)))
  const visibleJobs = filterJobs(jobs, filter, search)
  const visibleRepositories = filterRepositories(repositories, storageFilter, search)
  const unmeasured = filterRepositories(repositories, 'unmeasured', '').length
  const storagePartial = data?.repositories.complete ? '' : ' · partial collection'
  const jobsPartial = data?.jobs.complete ? '' : ' · partial collection'
  const hasCapacity = !!data?.repositories.available && capacity.measured > 0
  const pages = Math.max(1, Math.ceil(visibleJobs.length / 10))
  const currentPage = Math.min(page, pages - 1)
  const selected = jobs.find(j => j.id === selectedId)
  const sample = data?.sessions.complete === false ? 'Loaded' : 'Completed'
  const jobCount = (value: number) => data?.jobs.available ? String(value) : '—'
  const setJobFilter = (value: JobFilter) => { setFilter(value); setPage(0) }
  const selectJobMetric = (value: JobFilter) => { setJobFilter(value); setSearch('') }
  const selectStorageMetric = (value: RepositoryFilter) => { setStorageFilter(value); setSearch('') }
  function download() {
    const blob = new Blob(['\ufeff', exportJobsCsv(visibleJobs)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `backup-operations-${filter}-${data?.fetchedAt.slice(0, 10) || 'snapshot'}.csv`
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function jobTable(rows: OperationJob[], compact = false, paged = false) {
    return <div className={styles.tableScroll}><SortableGrid rows={rows} columns={[{id:'name',value:r=>r.name},{id:'result',value:r=>r.lastResult},{id:'status',value:r=>r.status},...(!compact?[{id:'repository',value:(r:OperationJob)=>r.repositoryName}]:[]),{id:'lastRun',value:r=>r.lastRun,kind:'date'}]} onSortChange={()=>setPage(0)} scope="loaded jobs">{(rows)=>(<table className={styles.table}><thead><tr><th>Job / workload</th><th>Last result</th><th>Current state</th>{!compact && <th>Repository</th>}<th>Last run</th><th><span className="sr-only">Inspect</span></th></tr></thead><tbody>{(paged ? rows.slice(currentPage * 10, currentPage * 10 + 10) : rows).map(job => <tr key={job.id}>
      <td><button className={styles.jobName} onClick={() => setSelectedId(job.id)}>{job.name}</button><div className={styles.subtext}>{job.type || 'Type not reported'}{job.highPriority ? ' · High priority' : ''}</div></td>
      <td><Tone value={job.lastResult && job.lastResult !== 'None' ? job.lastResult : 'Unknown'} /></td>
      <td>{isRunning(job) ? <><Tone value={job.status!} />{job.progressPercent != null && <div className={styles.miniProgress}><span style={{ width: `${Math.max(0, Math.min(100, job.progressPercent))}%` }} /></div>}</> : <span className={styles.subtext}>{job.status || 'Unknown'}</span>}</td>
      {!compact && <td className={styles.repoCell}>{job.repositoryName || 'Not reported'}</td>}<td className={styles.dateCell}>{date(job.lastRun)}</td>
      <td><button className={styles.inspect} aria-label={`Inspect ${job.name}`} onClick={() => setSelectedId(job.id)}><ArrowUpRight size={17} /></button></td>
    </tr>)}</tbody></table>)}</SortableGrid></div>
  }
  return <div className={styles.console}>
    <header className={styles.header}><div><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div>
      <div className={styles.headerActions}><span className={styles.source}><span className={cn(styles.dot, data && !error ? styles.connected : '')} />{data?.sourceName || 'VBR source'}</span><div className={styles.headerControls}><Button variant="outline" size="sm" disabled={loading} onClick={() => setRevision(n => n + 1)}><RefreshCw size={14} className={cn(loading && 'animate-spin')} />Refresh</Button><LensSwitcher view={view} snapshot={data} loading={loading} stale={!!error}/></div></div>
    </header>
    <div className={styles.toolbar}><span className={styles.rangeLabel}>{view === 'capacity' ? 'Current repository state · history window applies to Lens previews' : view === 'operations' ? 'Current job states · selected history for session investigation' : 'Current job and repository state · selected session history'}</span>
      <label className={styles.rangeLabel}><Clock3 size={14} />Session history<select aria-label="Session history window" value={range} onChange={e => setRange(e.target.value as Range)}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
    </div>
    {error && <div className={styles.notice} role="alert"><TriangleAlert size={18} /><div><strong>{data ? 'Refresh failed — showing the previous snapshot.' : 'Unable to load operations.'}</strong><p>{error}</p></div><Link href="/connect">Reconnect <ArrowRight size={14} /></Link></div>}
    {data && data.warnings.length > 0 && <details className={styles.warnings}><summary>Partial visibility · {data.warnings.length} collection notice{data.warnings.length === 1 ? '' : 's'}</summary><ul>{data.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
    {!data ? <div className={styles.loading}>{loading ? <><Loader2 className="animate-spin" size={28} /><h2>Building your operations picture</h2><p>Reading jobs, session history, repository states, and security checks.</p></> : <><Database size={28} /><h2>Connect your backup environment</h2><p>Connect a VBR source to see live operations data.</p><Button asChild><Link href="/connect">Open connections <ArrowRight size={16} /></Link></Button></>}</div> : <>
      <div className={styles.metrics} role="group" aria-label={`${titles[view][0]} metrics`}>
        {view === 'overview' && <>
        <Metric title="Session success" value={data.sessions.available ? percent(summary?.percent ?? null) : '—'} detail={data.sessions.available ? `${summary?.success} of ${summary?.completed} completed protection runs${data.sessions.complete ? '' : ' · partial'}` : 'Session history unavailable'} href="/vbr/lens/operations?filter=all" icon={<ShieldCheck size={19} />} accent="success" />
        <Metric title="Jobs needing attention" value={jobCount(attention.length)} detail={data.jobs.available ? `${attention.filter(j => j.lastResult === 'Failed').length} failed · ${attention.filter(j => j.lastResult === 'Warning').length} warnings${data.jobs.complete ? '' : ' · partial'}` : 'Job states unavailable'} href="/vbr/lens/operations?filter=attention" icon={<TriangleAlert size={19} />} accent="warning" />
        <Metric title="Active jobs" value={jobCount(running.length)} detail={data.jobs.available ? `Across ${jobs.length} loaded jobs · current state` : 'Job states unavailable'} href="/vbr/lens/operations?filter=running" icon={<Activity size={19} />} accent="active" />
        <Metric title="Repositories at risk" value={data.repositories.available ? String(atRisk.length) : '—'} detail={data.repositories.available ? `${repositories.filter(r => ['Critical', 'Offline'].includes(repositoryRisk(r))).length} critical / offline · ${capacity.measured} measured` : 'Repository states unavailable'} href="/vbr/lens/capacity" icon={<HardDrive size={19} />} />
        </>}
        {view === 'operations' && <>
          <Metric title="Failed jobs" value={jobCount(filterJobs(jobs, 'failed', '').length)} detail={data.jobs.available ? `Latest result failed · active retries excluded${jobsPartial}` : 'Job states unavailable'} onClick={() => selectJobMetric('failed')} selected={filter === 'failed'} icon={<XCircle size={19}/>} accent="danger"/>
          <Metric title="Jobs with warnings" value={jobCount(filterJobs(jobs, 'warning', '').length)} detail={data.jobs.available ? `Latest result warning · active runs excluded${jobsPartial}` : 'Job states unavailable'} onClick={() => selectJobMetric('warning')} selected={filter === 'warning'} icon={<TriangleAlert size={19}/>} accent="warning"/>
          <Metric title="Active jobs" value={jobCount(running.length)} detail={data.jobs.available ? `Running, starting or stopping${jobsPartial}` : 'Job states unavailable'} onClick={() => selectJobMetric('running')} selected={filter === 'running'} icon={<Activity size={19}/>} accent="active"/>
          <Metric title="Disabled jobs" value={jobCount(filterJobs(jobs, 'disabled', '').length)} detail={data.jobs.available ? `Current disabled state · review schedules${jobsPartial}` : 'Job states unavailable'} onClick={() => selectJobMetric('disabled')} selected={filter === 'disabled'} icon={<CirclePause size={19}/>}/>
        </>}
        {view === 'capacity' && <>
          <Metric title="Reported capacity" value={hasCapacity ? space(capacity.total) : '—'} detail={data.repositories.available ? hasCapacity ? `${capacity.measured} measured repositories · ${percent(capacity.percent)} used${unmeasured || !data.repositories.complete ? ' · subtotal' : ''}` : `No measurable capacity${storagePartial}` : 'Repository states unavailable'} onClick={() => selectStorageMetric('measured')} selected={storageFilter === 'measured'} icon={<Database size={19}/>}/>
          <Metric title="Reported free space" value={hasCapacity ? space(capacity.free) : '—'} detail={data.repositories.available ? hasCapacity ? `${space(capacity.used)} used · repository totals may overlap${unmeasured || !data.repositories.complete ? ' · subtotal' : ''}` : `No measurable capacity${storagePartial}` : 'Repository states unavailable'} onClick={() => selectStorageMetric('measured')} selected={storageFilter === 'measured'} icon={<HardDrive size={19}/>}/>
          <Metric title="Repositories at risk" value={data.repositories.available ? String(atRisk.length) : '—'} detail={data.repositories.available ? `${repositories.filter(r => ['Critical', 'Offline'].includes(repositoryRisk(r))).length} critical or offline · ${atRisk.length} need attention${storagePartial}` : 'Repository states unavailable'} onClick={() => selectStorageMetric('attention')} selected={storageFilter === 'attention'} icon={<TriangleAlert size={19}/>} accent="warning"/>
          <Metric title="Unmeasured capacity" value={data.repositories.available ? String(unmeasured) : '—'} detail={data.repositories.available ? `Missing, unlimited or invalid capacity${storagePartial}` : 'Repository states unavailable'} onClick={() => selectStorageMetric('unmeasured')} selected={storageFilter === 'unmeasured'} icon={<CircleHelp size={19}/>}/>
        </>}
      </div>
      {view === 'operations' && <p className={styles.metricNote}>Current job states across the loaded inventory. Disabled jobs can also have failures or warnings; counts are not additive. Select a metric to filter the queue.</p>}
      {view === 'capacity' && <p className={styles.metricNote}>Reported repository totals exclude known scale-out parents and unmeasured capacity. Repositories can share storage; these are not unique physical capacity totals. Select a metric to inspect its repositories.</p>}
      {view === 'overview' && <>
        <div className={styles.briefing}><span className={styles.briefingIcon}><ListFilter size={22} /></span><div><div className={styles.eyebrow}>Your next move</div><h2>{!data.jobs.available ? 'Restore visibility into your jobs.' : attention.length ? `${attention.length} job${attention.length === 1 ? '' : 's'} to investigate. Start with the exceptions.` : 'No job exceptions in the loaded records.'}</h2><p>{atRisk.length ? `${atRisk.length} repositories also need a closer look. ` : ''}Review current results, inspect the evidence, and plan your next action.</p></div><Button asChild className={styles.primaryButton}><Link href="/vbr/lens/operations">Open work queue <ArrowRight size={16} /></Link></Button></div>
        <div className={styles.overviewGrid}><div className={styles.mainColumn}>
          <Panel title="Protection activity" subtitle={`${sample} backup, copy, replication and log sessions · grouped by start time`} action={<span className={styles.smallTag}>{range === '24h' ? 'HOURLY' : 'DAILY'}</span>}>
            {data.sessions.available && summary?.completed ? <><div className={styles.chartSummary}><strong>{summary.completed.toLocaleString()}</strong><span>completed runs</span><div className={styles.legend}>{(['Success', 'Warning', 'Failed'] as const).map((s, i) => <span key={s}><i style={{ background: ['var(--ops-chart-success)', 'var(--ops-chart-warning)', 'var(--ops-chart-danger)'][i] }} />{s}</span>)}</div></div>
              <div className={styles.chart} role="img" aria-label={`${summary.success} successful, ${summary.warning} warning and ${summary.failed} failed protection sessions`}><ResponsiveContainer width="100%" height="100%"><BarChart data={buckets} margin={{ top: 8, right: 10, left: -24, bottom: 0 }} barCategoryGap="28%"><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)" /><XAxis dataKey="timestamp" tickFormatter={n => new Date(n).toLocaleString([], range === '24h' ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' })} axisLine={false} tickLine={false} minTickGap={26} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.4 }} contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelFormatter={n => new Date(Number(n)).toLocaleString()} /><Bar dataKey="Success" stackId="runs" fill="var(--ops-chart-success)" maxBarSize={32} /><Bar dataKey="Warning" stackId="runs" fill="var(--ops-chart-warning)" maxBarSize={32} /><Bar dataKey="Failed" stackId="runs" fill="var(--ops-chart-danger)" maxBarSize={32} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
              <div className={styles.panelFoot}>Retries count as separate attempts. Session success does not establish RPO compliance.</div></> : <Empty>{data.sessions.available ? 'No completed protection sessions in this window. Choose a longer history window.' : 'Session history is unavailable; success rate is unknown.'}</Empty>}
          </Panel>
          <Panel title="Priority work queue" subtitle="Current failed and warning results, with high-priority jobs first." action={<Link className={styles.textLink} href="/vbr/lens/operations">View all <ArrowRight size={14} /></Link>}>
            {!data.jobs.available ? <Empty>Job states could not be loaded.</Empty> : attention.length ? jobTable(filterJobs(jobs, 'attention', '').slice(0, 5), true) : <div className={styles.clear}><CheckCircle2 size={25} /><div><strong>No current job failures or warnings</strong><p>Keep an eye on active runs and repository headroom.</p></div></div>}
          </Panel>
        </div><div className={styles.sideColumn}>
          <Panel title="Capacity watch" subtitle="Most urgent repositories first" action={<Link href="/vbr/lens/capacity" className={styles.inspect} aria-label="Explore capacity"><ArrowUpRight size={17} /></Link>}>
            {!data.repositories.available ? <Empty>Repository state is unavailable.</Empty> : repositories.length ? <div className={styles.repositoryList}>{repositories.slice(0, 4).map(repo => <Link href={`/vbr/infrastructure/repositories/${repo.id}`} key={repo.id} className={styles.repositoryItem}><div><span className={styles.repositoryName}>{repo.name}</span><strong>{percent(utilization(repo))}</strong></div><div className={styles.capacityBar}><span className={cn(repositoryRisk(repo) === 'Critical' || repo.isOnline === false ? styles.dangerBar : repositoryRisk(repo) === 'Low space' ? styles.warningBar : styles.successBar)} style={{ width: `${utilization(repo) ?? 0}%` }} /></div><div><span>{repo.freeGB != null && repo.freeGB >= 0 ? `${space(repo.freeGB)} free` : 'Capacity unknown'}</span><span>{repositoryRisk(repo)}</span></div></Link>)}</div> : <Empty>No repositories returned by this source.</Empty>}
          </Panel>
          <Panel title="Active now" subtitle="Current job state, refreshed every minute" action={<span className={styles.smallTag}>{jobCount(running.length)} JOBS</span>}>
            {!data.jobs.available ? <Empty>Job state is unavailable.</Empty> : running.length ? <div className={styles.activeList}>{running.slice(0, 3).map(job => <button key={job.id} onClick={() => setSelectedId(job.id)}><span className={styles.activeIcon}><Activity size={16} /></span><span><strong>{job.name}</strong><small>{job.status} · {job.progressPercent == null ? 'Progress unknown' : `${job.progressPercent}% complete`}</small></span><ChevronRight size={15} /></button>)}</div> : <div className={styles.quiet}><Check size={18} /><span>No jobs are currently active.</span></div>}
          </Panel>
          <Panel title="Recovery & assurance" subtitle="Follow the evidence beyond job success">
            <div className={styles.quickLinks}><Link href="/vbr/protected-data"><span><Database size={17} /><span>Find a restore point<small>Explore protected data and recovery history</small></span></span><ArrowUpRight size={15} /></Link><Link href="/vbr/topology"><span><Network size={17} /><span>Trace a protection path<small>Workload → job → repository</small></span></span><ArrowUpRight size={15} /></Link><Link href="/vbr/threat-center"><span><ShieldCheck size={17} /><span>Review security signals<small>{data.security.available ? `${data.security.data.filter(s => s.status === 'Violation').length} security violations · ${data.security.data.length} reported` : 'Security checks unavailable'}</small></span></span><ArrowUpRight size={15} /></Link></div>
          </Panel>
        </div></div>
        <button className={styles.aiToggle} onClick={() => setShowAi(true)} disabled={showAi} aria-expanded={showAi}><Sparkles size={16} /><span>{showAi ? "AI health summary" : "Generate AI health summary"}</span><span>Sends environment context to your configured provider</span><ChevronRight size={16} className={cn(showAi && 'rotate-90')} /></button>{showAi && <AiHealthSummary />}
      </>}
      {view === 'operations' && <Panel title="Your work queue" subtitle="Job state is current. The history window controls the session evidence available in each investigation." action={<Button variant="outline" size="sm" onClick={download} disabled={!visibleJobs.length || !data.jobs.available}><ArrowDownToLine size={14} />Export CSV</Button>}>
        <FilterWorkspace label="Your work queue filters" search={<><input aria-label="Search jobs" placeholder="Search jobs or repositories…" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></>} onClear={()=>{setJobFilter('all');setSearch('');setPage(0)}} filters={<FilterFields><FilterCondition>{filters.map(f => <button key={f.value} aria-pressed={filter === f.value} onClick={() => setJobFilter(f.value)} className={cn(filter === f.value && styles.filterSelected)}>{f.label}<span>{data.jobs.available ? filterJobs(jobs, f.value, '').length : '—'}</span></button>)}</FilterCondition>
<Search size={16} /></FilterFields>}>
{!data.jobs.available ? <Empty>Job states are unavailable. Reconnect or refresh to try again.</Empty> : visibleJobs.length ? jobTable(visibleJobs, false, true) : <Empty>No jobs match this view. Try another filter or search term.</Empty>}
<div className={styles.pagination}><span>{visibleJobs.length} matching jobs{!data.jobs.complete ? ' · partial collection' : ''}</span><div><Button variant="ghost" size="sm" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></Button><span>{currentPage + 1} / {pages}</span><Button variant="ghost" size="sm" aria-label="Next page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></Button></div></div>
</FilterWorkspace></Panel>}
      {view === 'capacity' && <>
        <div className={styles.capacityIntro}><HardDrive size={22} /><div><strong>{data.repositories.available ? `${atRisk.length} repositories need attention` : 'Repository visibility is unavailable'}</strong><p>Critical at 90% used · low space at 80% used · offline and outdated components are flagged independently.</p></div><Button asChild variant="outline" size="sm"><Link href="/vbr/infrastructure/repositories">Manage repositories <ArrowUpRight size={14} /></Link></Button></div>
        <Panel title="Repository headroom" subtitle="Current capacity snapshot. Historical growth and time-to-full forecasts are not available yet.">
          <FilterWorkspace label="Repository headroom filters" search={<><input aria-label="Search repositories" placeholder="Search repositories…" value={search} onChange={e => setSearch(e.target.value)} /></>} onClear={()=>{setStorageFilter('all');setSearch('')}} filters={<FilterFields><label className={styles.storageFilter}>Show<FilterSelect label={"Filter repositories"} value={storageFilter} onValueChange={e => setStorageFilter(e as RepositoryFilter)}>{repositoryFilters.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</FilterSelect><span>{data.repositories.available ? `${visibleRepositories.length} matching${storagePartial}` : 'Unavailable'}</span></label>
<Search size={16} /></FilterFields>}>
{!data.repositories.available ? <Empty>Repository state is unavailable.</Empty> : <div className={styles.tableScroll}><SortableGrid rows={visibleRepositories} columns={[{id:'name',value:r=>r.name},{id:'health',value:r=>repositoryRisk(r)},{id:'used',value:r=>utilization(r)},{id:'free',value:r=>utilization(r)===null?null:r.freeGB},{id:'jobs',value:r=>data.jobs.available?jobs.filter(j=>j.repositoryId===r.id).length:null}]}>{(visibleRepositories)=>(<table className={styles.table}><thead><tr><th>Repository</th><th>Health</th><th>Utilization</th><th>Free / total</th><th>Jobs targeting repository</th></tr></thead><tbody>{visibleRepositories.map(repo => <tr key={repo.id}><td><Link href={`/vbr/infrastructure/repositories/${repo.id}`} className={styles.jobName}>{repo.name}</Link><div className={styles.subtext}>{repo.type || 'Type not reported'}</div></td><td><Tone value={repositoryRisk(repo)} /></td><td className={styles.capacityCell}><div><span>{percent(utilization(repo))}</span><div className={styles.capacityBar}><span className={cn((utilization(repo) ?? 0) >= 90 ? styles.dangerBar : (utilization(repo) ?? 0) >= 80 ? styles.warningBar : styles.successBar)} style={{ width: `${utilization(repo) ?? 0}%` }} /></div></div></td><td className={styles.dateCell}>{utilization(repo) === null ? 'Not measurable' : `${space(repo.freeGB!)} / ${space(repo.capacityGB!)}`}</td><td>{data.jobs.available ? `${jobs.filter(j => j.repositoryId === repo.id).length} direct targets` : 'Unknown'}</td></tr>)}</tbody></table>)}</SortableGrid>{!visibleRepositories.length && <Empty>No repositories match this view.</Empty>}</div>}
<div className={styles.panelFoot}>Repositories can share backing storage, so free space is shown per repository. Unknown or unlimited capacity stays unmeasured. Direct targets do not include jobs assigned to a scale-out parent.</div>
</FilterWorkspace></Panel>
      </>}
      <footer className={styles.footer}><span><span className={cn(styles.dot, !error && styles.connected)} />{error ? 'Previous snapshot' : loading ? 'Refreshing snapshot' : 'Connected snapshot'} · {data.sourceName} · {date(data.fetchedAt)}</span><span>60-second refresh · Current state + selected session history</span></footer>
    </>}
    <Dialog open={!!selectedId} onOpenChange={open => { if (!open) setSelectedId(null) }}><DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle className="pr-6 break-words">{selected?.name || 'Job no longer in this snapshot'}</DialogTitle><DialogDescription>Investigate the current state and recorded session evidence before taking action.</DialogDescription></DialogHeader>{selected && <>
      <div className={styles.detailMeta}><Tone value={jobStatus(selected)} /><span>{selected.type}</span>{selected.highPriority && <span>High priority</span>}</div>
      <dl className={styles.detailGrid}><div><dt>Latest result</dt><dd>{selected.lastResult || 'Unknown'}</dd></div><div><dt>Last run</dt><dd>{date(selected.lastRun)}</dd></div><div><dt>Target repository</dt><dd>{selected.repositoryName || 'Not reported'}</dd></div><div><dt>Next run</dt><dd>{selected.nextRun ? date(selected.nextRun) : selected.nextRunPolicy || 'Not reported'}</dd></div></dl>
      <h3 className="font-semibold text-sm mt-2">Recent session evidence · {range}</h3><div className={styles.evidence}>{data?.sessions.data.filter(s => s.jobId === selected.id).sort((a, b) => Date.parse(b.creationTime) - Date.parse(a.creationTime)).slice(0, 5).map(session => <div key={session.id}><div><Tone value={session.state !== 'Stopped' ? session.state : session.result?.result || 'Unknown'} /><span>{date(session.creationTime)}</span></div><p>{session.result?.message || 'No result message was returned for this session.'}</p><small>{session.sessionType} · {session.id}</small></div>)}{!data?.sessions.data.some(s => s.jobId === selected.id) && <Empty>{data?.sessions.available ? 'No session evidence was loaded for this job in the selected window. Its reported last result may be older.' : 'Session evidence is unavailable.'}</Empty>}</div>
      <div className={styles.detailActions}><p>Continue to the job for task details and available start, retry, or stop controls.</p><Button asChild><Link href={`/vbr/jobs/${encodeURIComponent(selected.id)}`}>Open job details <ArrowUpRight size={16} /></Link></Button></div>
    </>}</DialogContent></Dialog>
  </div>
}
