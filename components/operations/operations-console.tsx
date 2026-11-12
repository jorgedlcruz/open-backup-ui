"use client"
// Open Backup UI v1.2.0
import { Trans , useI18n } from "@/components/providers/i18n-provider"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterCondition,FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { AiHealthSummary } from '@/components/ai-health-summary'
import { LensSwitcher } from '@/components/lens/lens-switcher'
import { DataLoading } from '@/components/ui/data-loading'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { veeamApi } from '@/lib/api/veeam-client'
import type { LensId } from '@/lib/lens/navigation'
import { activityBuckets,capacitySummary,exportJobsCsv,filterJobs,filterRepositories,isRunning,jobStatus,needsAttention,repositoryFilters,repositoryRisk,sessionSummary,utilization,type JobFilter,type OperationJob,type OperationsSnapshot,type Range,type RepositoryFilter } from '@/lib/operations/model'
import { cn } from '@/lib/utils'
import { enumLabel } from '@/lib/i18n/presentation'
import { vbrError } from '@/lib/i18n/vbr-errors'
import { Activity,ArrowDownToLine,ArrowRight,ArrowUpRight,Check,CheckCircle2,ChevronLeft,ChevronRight,CircleHelp,CirclePause,Clock3,Database,HardDrive,ListFilter,Network,RefreshCw,Search,ShieldCheck,TriangleAlert,XCircle } from 'lucide-react'
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
/** Only recognized application enums are translated; unknown provider values stay intact. */
function useOperationsPresentation() {
  const { t, formatNumber, formatDate } = useI18n()
  const labels: Record<string, string> = {
    Failed: t('Failed'), Offline: t('Offline'), Critical: t('Critical'), Warning: t('Warning'),
    'Low space': t('Low space'), Outdated: t('Outdated'), Success: t('Success'), Healthy: t('Healthy'),
    Passed: t('Passed'), Running: t('Running'), Starting: t('Starting'), Stopping: t('Stopping'),
    Stopped: t('Stopped'), Disabled: t('Disabled'), Unknown: t('Unknown'), Idle: t('Idle'),
    Working: t('Working'), Pending: t('Pending'), None: t('None'),
    Backup: t('Backup'), BackupJob: t('Backup'), Replication: t('Replication'), Replica: t('Replication'), ReplicaJob: t('Replication'),
    BackupCopy: t('Backup copy'), BackupCopyJob: t('Backup copy'),
    AgentBackup: t('Agent backup'), EndpointBackup: t('Agent backup'),
    UnstructuredDataBackupCopy: t('Unstructured data backup copy'), FileServerSave: t('File backup'),
    SqlLogBackup: t('SQL log backup'), OracleLogBackup: t('Oracle log backup'), PostgreSqlLogBackup: t('PostgreSQL log backup'),
    PlatformBackupJob: t('Platform backup'), PlatformSnapshotJob: t('Platform snapshot'), PlatformSnapshotCopyJob: t('Platform snapshot copy'),
    AgentOperationBackupNow: t('Agent backup'), AgentOperationActiveFull: t('Active full backup'),
    Windows: t('Windows'), Linux: t('Linux'), ObjectStorage: t('Object storage'), ScaleOut: t('Scale-out repository'),
    Nfs: t('NFS'), Smb: t('SMB'), Never: t('Never'), Periodically: t('Periodically'), Continuously: t('Continuously'),
  }
  return {
    t, formatNumber, formatDate,
    label: (value?: string | null, fallback = t('Unknown')) => value ? labels[value] ?? enumLabel(t, value) : fallback,
    date: (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? formatDate(value, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('Not reported'),
    space: (gb: number) => `${formatNumber(gb >= 1024 ? gb / 1024 : gb, { maximumFractionDigits: 1 })} ${gb >= 1024 ? 'TB' : 'GB'}`,
    percent: (value: number | null) => value === null ? '—' : formatNumber(value / 100, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  }
}
function Tone({ value }: { value: string }) {
  const { label } = useOperationsPresentation()
  const tone = ['Failed', 'Offline', 'Critical'].includes(value) ? 'danger' : ['Warning', 'Low space', 'Outdated'].includes(value) ? 'warning' : ['Success', 'Healthy', 'Passed'].includes(value) ? 'success' : ['Running', 'Starting', 'Stopping'].includes(value) ? 'active' : 'neutral'
  return <span className={cn(styles.badge, styles[tone])}><span className={styles.dot} />{label(value)}</span>
}
function Panel({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cn(styles.panel, className)}><div className={styles.panelHeading}><div><h2><Trans>{title}</Trans></h2>{subtitle && <p><Trans>{subtitle}</Trans></p>}</div>{action}</div>{children}</section>
}
function Empty({ children }: { children: ReactNode }) {
  return <div className={styles.empty}><CircleHelp size={22} /><p>{children}</p></div>
}
function Metric({ title, value, detail, href, onClick, selected, icon, accent }: { title: string; value: string; detail: string; href?: string; onClick?: () => void; selected?: boolean; icon: ReactNode; accent?: string }) {
  const content = <><div className={styles.metricLabel}><Trans>{title}</Trans><span className={cn(styles.metricIcon, accent && styles[accent])}>{icon}</span></div><div className={styles.metricValue}>{value}<ArrowUpRight size={18} /></div><p><Trans>{detail}</Trans></p></>
  return href ? <Link href={href} className={styles.metric}>{content}</Link> : <button type="button" className={cn(styles.metric, selected && styles.metricSelected)} onClick={onClick} aria-pressed={selected}>{content}</button>
}

export function OperationsConsole({ view = 'overview', initialFilter = 'attention' }: { view?: View; initialFilter?: JobFilter }) {
  const { t, formatNumber, formatDate, label, date, space, percent } = useOperationsPresentation()
  // Translate only the loader's own templates; API-supplied reasons remain verbatim.
  function notice(value: string) {
    const reasons: Record<string, string> = {
      'The operations snapshot could not be loaded.': t('The operations snapshot could not be loaded.'),
      'The response did not match the expected API fields.': t('The response did not match the expected API fields.'),
      'Check the source connection and retry.': t('Check the source connection and retry.'),
      'VBR returned no usable operations data. Check the connection and permissions, then retry.': t('VBR returned no usable operations data. Check the connection and permissions, then retry.'),
    }
    const sections: Record<string, string> = { Jobs: t('Jobs'), 'Session history': t('Session history'), Repositories: t('Repositories'), 'Security checks': t('Security checks') }
    const partial = /^(Jobs|Session history|Repositories|Security checks): partial collection\. Counts describe loaded records only\.$/.exec(value)
    if (partial) return t('{section}: partial collection. Counts describe loaded records only.', { section: sections[partial[1]] })
    const unavailable = /^(Jobs|Session history|Repositories|Security checks) unavailable\. (.*)$/.exec(value)
    if (unavailable) return t('{section} unavailable. {reason}', { section: sections[unavailable[1]], reason: reasons[unavailable[2]] ?? vbrError(t, unavailable[2]) })
    return reasons[value] ?? vbrError(t, value)
  }

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
  const withPartial = (text: string, complete?: boolean) => complete ? text : t('{text} · partial collection', { text })
  const withSubtotal = (text: string) => unmeasured || !data?.repositories.complete ? t('{text} · subtotal', { text }) : text
  const hasCapacity = !!data?.repositories.available && capacity.measured > 0
  const pages = Math.max(1, Math.ceil(visibleJobs.length / 10))
  const currentPage = Math.min(page, pages - 1)
  const selected = jobs.find(j => j.id === selectedId)
  const jobCount = (value: number) => data?.jobs.available ? formatNumber(value) : '—'
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
    return <div className={styles.tableScroll}><SortableGrid rows={rows} columns={[{id:'name',value:r=>r.name},{id:'result',value:r=>r.lastResult},{id:'status',value:r=>r.status},...(!compact?[{id:'repository',value:(r:OperationJob)=>r.repositoryName}]:[]),{id:'lastRun',value:r=>r.lastRun,kind:'date'}]} onSortChange={()=>setPage(0)} scope={t('loaded jobs')}>{(rows)=>(<table className={styles.table}><thead><tr><th><Trans>{"Job / workload"}</Trans></th><th><Trans>{"Last result"}</Trans></th><th><Trans>{"Current state"}</Trans></th>{!compact && <th><Trans>{"Repository"}</Trans></th>}<th><Trans>{"Last run"}</Trans></th><th><span className="sr-only"><Trans>{"Inspect"}</Trans></span></th></tr></thead><tbody>{(paged ? rows.slice(currentPage * 10, currentPage * 10 + 10) : rows).map(job => <tr key={job.id}>
      <td><button className={styles.jobName} onClick={() => setSelectedId(job.id)}>{job.name}</button><div className={styles.subtext}>{job.highPriority ? t('{type} · High priority', { type: label(job.type, t('Type not reported')) }) : label(job.type, t('Type not reported'))}</div></td>
      <td><Tone value={job.lastResult && job.lastResult !== 'None' ? job.lastResult : 'Unknown'} /></td>
      <td>{isRunning(job) ? <><Tone value={job.status!} />{job.progressPercent != null && <div className={styles.miniProgress}><span style={{ width: `${Math.max(0, Math.min(100, job.progressPercent))}%` }} /></div>}</> : <span className={styles.subtext}>{label(job.status)}</span>}</td>
      {!compact && <td className={styles.repoCell}>{job.repositoryName || t('Not reported')}</td>}<td className={styles.dateCell}>{date(job.lastRun)}</td>
      <td><button className={styles.inspect} aria-label={t('Inspect {name}', { name: job.name })} onClick={() => setSelectedId(job.id)}><ArrowUpRight size={17} /></button></td>
    </tr>)}</tbody></table>)}</SortableGrid></div>
  }
  return <div className={styles.console}>
    <header className={styles.header}><div><h1><Trans>{titles[view][0]}</Trans></h1><p><Trans>{titles[view][1]}</Trans></p></div>
      <div className={styles.headerActions}><span className={styles.source}><span className={cn(styles.dot, data && !error ? styles.connected : '')} />{data?.sourceName || t('VBR source')}</span><div className={styles.headerControls}><Button variant="outline" size="sm" disabled={loading} onClick={() => setRevision(n => n + 1)}><RefreshCw size={14} className={cn(loading && 'animate-spin')} /><Trans>{"Refresh"}</Trans></Button><LensSwitcher view={view} snapshot={data} loading={loading} stale={!!error}/></div></div>
    </header>
    <div className={styles.toolbar}><span className={styles.rangeLabel}>{view === 'capacity' ? t('Current repository state · history window applies to Lens previews') : view === 'operations' ? t('Current job states · selected history for session investigation') : t('Current job and repository state · selected session history')}</span>
      <label className={styles.rangeLabel}><Clock3 size={14} /><Trans>{"Session history"}</Trans><select aria-label={t('Session history window')} value={range} onChange={e => setRange(e.target.value as Range)}><option value="24h"><Trans>{"Last 24 hours"}</Trans></option><option value="7d"><Trans>{"Last 7 days"}</Trans></option><option value="30d"><Trans>{"Last 30 days"}</Trans></option></select></label>
    </div>
    {error && <div className={styles.notice} role="alert"><TriangleAlert size={18} /><div><strong>{data ? t('Refresh failed — showing the previous snapshot.') : t('Unable to load operations.')}</strong><p>{notice(error)}</p></div><Link href="/connect"><Trans>{"Reconnect "}</Trans><ArrowRight size={14} /></Link></div>}
    {data && data.warnings.length > 0 && <details className={styles.warnings}><summary>{t('Partial visibility · {count} collection notices', { count: formatNumber(data.warnings.length) })}</summary><ul>{data.warnings.map(w => <li key={w}>{notice(w)}</li>)}</ul></details>}
    {!data ? <div className={styles.loading}>{loading ? <DataLoading status={t('Reading jobs, session history, repository states, and security checks.')}/> : <><Database size={28} /><h2><Trans>{"Connect your backup environment"}</Trans></h2><p><Trans>{"Connect a VBR source to see live operations data."}</Trans></p><Button asChild><Link href="/connect"><Trans>{"Open connections "}</Trans><ArrowRight size={16} /></Link></Button></>}</div> : <>
      <div className={styles.metrics} role="group" aria-label={t('{view} metrics', { view: t(titles[view][0]) })}>
        {view === 'overview' && <>
        <Metric title="Session success" value={data.sessions.available ? percent(summary?.percent ?? null) : '—'} detail={data.sessions.available ? withPartial(t('{success} of {completed} completed protection runs', { success: formatNumber(summary?.success ?? 0), completed: formatNumber(summary?.completed ?? 0) }), data.sessions.complete) : 'Session history unavailable'} href="/vbr/lens/operations?filter=all" icon={<ShieldCheck size={19} />} accent="success" />
        <Metric title="Jobs needing attention" value={jobCount(attention.length)} detail={data.jobs.available ? withPartial(t('{failed} failed · {warnings} warnings', { failed: formatNumber(attention.filter(j => j.lastResult === 'Failed').length), warnings: formatNumber(attention.filter(j => j.lastResult === 'Warning').length) }), data.jobs.complete) : 'Job states unavailable'} href="/vbr/lens/operations?filter=attention" icon={<TriangleAlert size={19} />} accent="warning" />
        <Metric title="Active jobs" value={jobCount(running.length)} detail={data.jobs.available ? t('Across {count} loaded jobs · current state', { count: formatNumber(jobs.length) }) : 'Job states unavailable'} href="/vbr/lens/operations?filter=running" icon={<Activity size={19} />} accent="active" />
        <Metric title="Repositories at risk" value={data.repositories.available ? formatNumber(atRisk.length) : '—'} detail={data.repositories.available ? t('{critical} critical / offline · {measured} measured', { critical: formatNumber(repositories.filter(r => ['Critical', 'Offline'].includes(repositoryRisk(r))).length), measured: formatNumber(capacity.measured) }) : 'Repository states unavailable'} href="/vbr/lens/capacity" icon={<HardDrive size={19} />} />
        </>}
        {view === 'operations' && <>
          <Metric title="Failed jobs" value={jobCount(filterJobs(jobs, 'failed', '').length)} detail={data.jobs.available ? withPartial(t('Latest result failed · active retries excluded'), data.jobs.complete) : 'Job states unavailable'} onClick={() => selectJobMetric('failed')} selected={filter === 'failed'} icon={<XCircle size={19}/>} accent="danger"/>
          <Metric title="Jobs with warnings" value={jobCount(filterJobs(jobs, 'warning', '').length)} detail={data.jobs.available ? withPartial(t('Latest result warning · active runs excluded'), data.jobs.complete) : 'Job states unavailable'} onClick={() => selectJobMetric('warning')} selected={filter === 'warning'} icon={<TriangleAlert size={19}/>} accent="warning"/>
          <Metric title="Active jobs" value={jobCount(running.length)} detail={data.jobs.available ? withPartial(t('Running, starting or stopping'), data.jobs.complete) : 'Job states unavailable'} onClick={() => selectJobMetric('running')} selected={filter === 'running'} icon={<Activity size={19}/>} accent="active"/>
          <Metric title="Disabled jobs" value={jobCount(filterJobs(jobs, 'disabled', '').length)} detail={data.jobs.available ? withPartial(t('Current disabled state · review schedules'), data.jobs.complete) : 'Job states unavailable'} onClick={() => selectJobMetric('disabled')} selected={filter === 'disabled'} icon={<CirclePause size={19}/>}/>
        </>}
        {view === 'capacity' && <>
          <Metric title="Reported capacity" value={hasCapacity ? space(capacity.total) : '—'} detail={data.repositories.available ? hasCapacity ? withSubtotal(t('{count} measured repositories · {percent} used', { count: formatNumber(capacity.measured), percent: percent(capacity.percent) })) : withPartial(t('No measurable capacity'), data.repositories.complete) : 'Repository states unavailable'} onClick={() => selectStorageMetric('measured')} selected={storageFilter === 'measured'} icon={<Database size={19}/>}/>
          <Metric title="Reported free space" value={hasCapacity ? space(capacity.free) : '—'} detail={data.repositories.available ? hasCapacity ? withSubtotal(t('{space} used · repository totals may overlap', { space: space(capacity.used) })) : withPartial(t('No measurable capacity'), data.repositories.complete) : 'Repository states unavailable'} onClick={() => selectStorageMetric('measured')} selected={storageFilter === 'measured'} icon={<HardDrive size={19}/>}/>
          <Metric title="Repositories at risk" value={data.repositories.available ? formatNumber(atRisk.length) : '—'} detail={data.repositories.available ? withPartial(t('{critical} critical or offline · {count} need attention', { critical: formatNumber(repositories.filter(r => ['Critical', 'Offline'].includes(repositoryRisk(r))).length), count: formatNumber(atRisk.length) }), data.repositories.complete) : 'Repository states unavailable'} onClick={() => selectStorageMetric('attention')} selected={storageFilter === 'attention'} icon={<TriangleAlert size={19}/>} accent="warning"/>
          <Metric title="Unmeasured capacity" value={data.repositories.available ? formatNumber(unmeasured) : '—'} detail={data.repositories.available ? withPartial(t('Missing, unlimited or invalid capacity'), data.repositories.complete) : 'Repository states unavailable'} onClick={() => selectStorageMetric('unmeasured')} selected={storageFilter === 'unmeasured'} icon={<CircleHelp size={19}/>}/>
        </>}
      </div>
      {view === 'operations' && <p className={styles.metricNote}><Trans>{"Current job states across the loaded inventory. Disabled jobs can also have failures or warnings; counts are not additive. Select a metric to filter the queue."}</Trans></p>}
      {view === 'capacity' && <p className={styles.metricNote}><Trans>{"Reported repository totals exclude known scale-out parents and unmeasured capacity. Repositories can share storage; these are not unique physical capacity totals. Select a metric to inspect its repositories."}</Trans></p>}
      {view === 'overview' && <>
        <div className={styles.briefing}><span className={styles.briefingIcon}><ListFilter size={22} /></span><div><div className={styles.eyebrow}><Trans>{"Your next move"}</Trans></div><h2>{!data.jobs.available ? t('Restore visibility into your jobs.') : attention.length ? t('Jobs to investigate: {count}. Start with the exceptions.', { count: formatNumber(attention.length) }) : t('No job exceptions in the loaded records.')}</h2><p>{atRisk.length ? t('{count} repositories also need a closer look. Review current results, inspect the evidence, and plan your next action.', { count: formatNumber(atRisk.length) }) : t('Review current results, inspect the evidence, and plan your next action.')}</p></div><Button asChild className={styles.primaryButton}><Link href="/vbr/lens/operations"><Trans>{"Open work queue "}</Trans><ArrowRight size={16} /></Link></Button></div>
        <div className={styles.overviewGrid}><div className={styles.mainColumn}>
          <Panel title="Protection activity" subtitle={data.sessions.complete === false ? t('Loaded backup, copy, replication and log sessions · grouped by start time') : t('Completed backup, copy, replication and log sessions · grouped by start time')} action={<span className={styles.smallTag}>{range === '24h' ? t('HOURLY') : t('DAILY')}</span>}>
            {data.sessions.available && summary?.completed ? <><div className={styles.chartSummary}><strong>{formatNumber(summary.completed)}</strong><span><Trans>{"completed runs"}</Trans></span><div className={styles.legend}>{(['Success', 'Warning', 'Failed'] as const).map((s, i) => <span key={s}><i style={{ background: ['var(--ops-chart-success)', 'var(--ops-chart-warning)', 'var(--ops-chart-danger)'][i] }} />{label(s)}</span>)}</div></div>
              <div className={styles.chart} role="img" aria-label={t('{success} successful, {warning} warning and {failed} failed protection sessions', { success: formatNumber(summary.success), warning: formatNumber(summary.warning), failed: formatNumber(summary.failed) })}><ResponsiveContainer width="100%" height="100%"><BarChart data={buckets} margin={{ top: 8, right: 10, left: -24, bottom: 0 }} barCategoryGap="28%"><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)" /><XAxis dataKey="timestamp" tickFormatter={n => formatDate(n, range === '24h' ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' })} axisLine={false} tickLine={false} minTickGap={26} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><YAxis tickFormatter={n => formatNumber(n)} allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} /><Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.4 }} contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelFormatter={n => date(new Date(Number(n)).toISOString())} formatter={(value, name) => [formatNumber(Number(value)), label(String(name))]} /><Bar name={t("Success")} dataKey="Success" stackId="runs" fill="var(--ops-chart-success)" maxBarSize={32} /><Bar name={t("Warning")} dataKey="Warning" stackId="runs" fill="var(--ops-chart-warning)" maxBarSize={32} /><Bar name={t("Failed")} dataKey="Failed" stackId="runs" fill="var(--ops-chart-danger)" maxBarSize={32} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
              <div className={styles.panelFoot}><Trans>{"Retries count as separate attempts. Session success does not establish RPO compliance."}</Trans></div></> : <Empty>{data.sessions.available ? t('No completed protection sessions in this window. Choose a longer history window.') : t('Session history is unavailable; success rate is unknown.')}</Empty>}
          </Panel>
          <Panel title="Priority work queue" subtitle="Current failed and warning results, with high-priority jobs first." action={<Link className={styles.textLink} href="/vbr/lens/operations"><Trans>{"View all "}</Trans><ArrowRight size={14} /></Link>}>
            {!data.jobs.available ? <Empty><Trans>{"Job states could not be loaded."}</Trans></Empty> : attention.length ? jobTable(filterJobs(jobs, 'attention', '').slice(0, 5), true) : <div className={styles.clear}><CheckCircle2 size={25} /><div><strong><Trans>{"No current job failures or warnings"}</Trans></strong><p><Trans>{"Keep an eye on active runs and repository headroom."}</Trans></p></div></div>}
          </Panel>
        </div><div className={styles.sideColumn}>
          <Panel title="Capacity watch" subtitle="Most urgent repositories first" action={<Link href="/vbr/lens/capacity" className={styles.inspect} aria-label={t('Explore capacity')}><ArrowUpRight size={17} /></Link>}>
            {!data.repositories.available ? <Empty><Trans>{"Repository state is unavailable."}</Trans></Empty> : repositories.length ? <div className={styles.repositoryList}>{repositories.slice(0, 4).map(repo => <Link href={`/vbr/infrastructure/repositories/${repo.id}`} key={repo.id} className={styles.repositoryItem}><div><span className={styles.repositoryName}>{repo.name}</span><strong>{percent(utilization(repo))}</strong></div><div className={styles.capacityBar}><span className={cn(repositoryRisk(repo) === 'Critical' || repo.isOnline === false ? styles.dangerBar : repositoryRisk(repo) === 'Low space' ? styles.warningBar : styles.successBar)} style={{ width: `${utilization(repo) ?? 0}%` }} /></div><div><span>{repo.freeGB != null && repo.freeGB >= 0 ? t('{space} free', { space: space(repo.freeGB) }) : t('Capacity unknown')}</span><span>{label(repositoryRisk(repo))}</span></div></Link>)}</div> : <Empty><Trans>{"No repositories returned by this source."}</Trans></Empty>}
          </Panel>
          <Panel title="Active now" subtitle="Current job state, refreshed every minute" action={<span className={styles.smallTag}>{t('{count} jobs', { count: jobCount(running.length) })}</span>}>
            {!data.jobs.available ? <Empty><Trans>{"Job state is unavailable."}</Trans></Empty> : running.length ? <div className={styles.activeList}>{running.slice(0, 3).map(job => <button key={job.id} onClick={() => setSelectedId(job.id)}><span className={styles.activeIcon}><Activity size={16} /></span><span><strong>{job.name}</strong><small>{job.progressPercent == null ? t('{state} · Progress unknown', { state: label(job.status) }) : t('{state} · {percent} complete', { state: label(job.status), percent: percent(job.progressPercent) })}</small></span><ChevronRight size={15} /></button>)}</div> : <div className={styles.quiet}><Check size={18} /><span><Trans>{"No jobs are currently active."}</Trans></span></div>}
          </Panel>
          <Panel title="Recovery & assurance" subtitle="Follow the evidence beyond job success">
            <div className={styles.quickLinks}><Link href="/vbr/protected-data"><span><Database size={17} /><span><Trans>{"Find a restore point"}</Trans><small><Trans>{"Explore protected data and recovery history"}</Trans></small></span></span><ArrowUpRight size={15} /></Link><Link href="/vbr/topology"><span><Network size={17} /><span><Trans>{"Trace a protection path"}</Trans><small><Trans>{"Workload → job → repository"}</Trans></small></span></span><ArrowUpRight size={15} /></Link><Link href="/vbr/threat-center"><span><ShieldCheck size={17} /><span><Trans>{"Review security signals"}</Trans><small>{data.security.available ? t('{count} security violations · {total} reported', { count: formatNumber(data.security.data.filter(s => s.status === 'Violation').length), total: formatNumber(data.security.data.length) }) : t('Security checks unavailable')}</small></span></span><ArrowUpRight size={15} /></Link></div>
          </Panel>
        </div></div>
        <AiHealthSummary />
      </>}
      {view === 'operations' && <Panel title="Your work queue" subtitle="Job state is current. The history window controls the session evidence available in each investigation." action={<Button variant="outline" size="sm" onClick={download} disabled={!visibleJobs.length || !data.jobs.available}><ArrowDownToLine size={14} /><Trans>{"Export CSV"}</Trans></Button>}>
        <FilterWorkspace label={t('Your work queue filters')} search={<><input aria-label={t("Search jobs")} placeholder={t("Search jobs or repositories…")} value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></>} onClear={()=>{setJobFilter('all');setSearch('');setPage(0)}} filters={<FilterFields><FilterCondition>{filters.map(f => <button key={f.value} aria-pressed={filter === f.value} onClick={() => setJobFilter(f.value)} className={cn(filter === f.value && styles.filterSelected)}>{t(f.label)}<span>{data.jobs.available ? formatNumber(filterJobs(jobs, f.value, '').length) : '—'}</span></button>)}</FilterCondition>
<Search size={16} /></FilterFields>}>
{!data.jobs.available ? <Empty><Trans>{"Job states are unavailable. Reconnect or refresh to try again."}</Trans></Empty> : visibleJobs.length ? jobTable(visibleJobs, false, true) : <Empty><Trans>{"No jobs match this view. Try another filter or search term."}</Trans></Empty>}
<div className={styles.pagination}><span>{withPartial(t('{count} matching jobs', { count: formatNumber(visibleJobs.length) }), data.jobs.complete)}</span><div><Button variant="ghost" size="sm" aria-label={t('Previous page')} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></Button><span>{t('{current} / {total}', { current: formatNumber(currentPage + 1), total: formatNumber(pages) })}</span><Button variant="ghost" size="sm" aria-label={t('Next page')} disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></Button></div></div>
</FilterWorkspace></Panel>}
      {view === 'capacity' && <>
        <div className={styles.capacityIntro}><HardDrive size={22} /><div><strong>{data.repositories.available ? t('{count} repositories need attention', { count: formatNumber(atRisk.length) }) : t('Repository visibility is unavailable')}</strong><p><Trans>{"Critical at 90% used · low space at 80% used · offline and outdated components are flagged independently."}</Trans></p></div><Button asChild variant="outline" size="sm"><Link href="/vbr/infrastructure/repositories"><Trans>{"Manage repositories "}</Trans><ArrowUpRight size={14} /></Link></Button></div>
        <Panel title="Repository headroom" subtitle="Current capacity snapshot. Historical growth and time-to-full forecasts are not available yet.">
          <FilterWorkspace label={t('Repository headroom filters')} search={<><input aria-label={t("Search repositories")} placeholder={t("Search repositories…")} value={search} onChange={e => setSearch(e.target.value)} /></>} onClear={()=>{setStorageFilter('all');setSearch('')}} filters={<FilterFields><label className={styles.storageFilter}><Trans>{"Show"}</Trans><FilterSelect label={t("Filter repositories")} value={storageFilter} onValueChange={e => setStorageFilter(e as RepositoryFilter)}>{repositoryFilters.map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}</FilterSelect><span>{data.repositories.available ? withPartial(t('{count} matching', { count: formatNumber(visibleRepositories.length) }), data.repositories.complete) : t('Unavailable')}</span></label>
<Search size={16} /></FilterFields>}>
{!data.repositories.available ? <Empty><Trans>{"Repository state is unavailable."}</Trans></Empty> : <div className={styles.tableScroll}><SortableGrid rows={visibleRepositories} columns={[{id:'name',value:r=>r.name},{id:'health',value:r=>repositoryRisk(r)},{id:'used',value:r=>utilization(r)},{id:'free',value:r=>utilization(r)===null?null:r.freeGB},{id:'jobs',value:r=>data.jobs.available?jobs.filter(j=>j.repositoryId===r.id).length:null}]}>{(visibleRepositories)=>(<table className={styles.table}><thead><tr><th><Trans>{"Repository"}</Trans></th><th><Trans>{"Health"}</Trans></th><th><Trans>{"Utilization"}</Trans></th><th><Trans>{"Free / total"}</Trans></th><th><Trans>{"Jobs targeting repository"}</Trans></th></tr></thead><tbody>{visibleRepositories.map(repo => <tr key={repo.id}><td><Link href={`/vbr/infrastructure/repositories/${repo.id}`} className={styles.jobName}>{repo.name}</Link><div className={styles.subtext}>{label(repo.type, t('Type not reported'))}</div></td><td><Tone value={repositoryRisk(repo)} /></td><td className={styles.capacityCell}><div><span>{percent(utilization(repo))}</span><div className={styles.capacityBar}><span className={cn((utilization(repo) ?? 0) >= 90 ? styles.dangerBar : (utilization(repo) ?? 0) >= 80 ? styles.warningBar : styles.successBar)} style={{ width: `${utilization(repo) ?? 0}%` }} /></div></div></td><td className={styles.dateCell}>{utilization(repo) === null ? t('Not measurable') : `${space(repo.freeGB!)} / ${space(repo.capacityGB!)}`}</td><td>{data.jobs.available ? t('{count} direct targets', { count: formatNumber(jobs.filter(j => j.repositoryId === repo.id).length) }) : t('Unknown')}</td></tr>)}</tbody></table>)}</SortableGrid>{!visibleRepositories.length && <Empty><Trans>{"No repositories match this view."}</Trans></Empty>}</div>}
<div className={styles.panelFoot}><Trans>{"Repositories can share backing storage, so free space is shown per repository. Unknown or unlimited capacity stays unmeasured. Direct targets do not include jobs assigned to a scale-out parent."}</Trans></div>
</FilterWorkspace></Panel>
      </>}
      <footer className={styles.footer}><span><span className={cn(styles.dot, !error && styles.connected)} />{error ? t('Previous snapshot') : loading ? t('Refreshing snapshot') : t('Connected snapshot')} · {data.sourceName} · {date(data.fetchedAt)}</span><span><Trans>{"60-second refresh · Current state + selected session history"}</Trans></span></footer>
    </>}
    <Dialog open={!!selectedId} onOpenChange={open => { if (!open) setSelectedId(null) }}><DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle className="pr-6 break-words">{selected?.name || t('Job no longer in this snapshot')}</DialogTitle><DialogDescription><Trans>{"Investigate the current state and recorded session evidence before taking action."}</Trans></DialogDescription></DialogHeader>{selected && <>
      <div className={styles.detailMeta}><Tone value={jobStatus(selected)} /><span>{label(selected.type, t('Type not reported'))}</span>{selected.highPriority && <span><Trans>{"High priority"}</Trans></span>}</div>
      <dl className={styles.detailGrid}><div><dt><Trans>{"Latest result"}</Trans></dt><dd>{label(selected.lastResult)}</dd></div><div><dt><Trans>{"Last run"}</Trans></dt><dd>{date(selected.lastRun)}</dd></div><div><dt><Trans>{"Target repository"}</Trans></dt><dd>{selected.repositoryName || t('Not reported')}</dd></div><div><dt><Trans>{"Next run"}</Trans></dt><dd>{selected.nextRun ? date(selected.nextRun) : label(selected.nextRunPolicy, t('Not reported'))}</dd></div></dl>
      <h3 className="font-semibold text-sm mt-2">{t('Recent session evidence · {range}', { range: range === '24h' ? t('Last 24 hours') : range === '7d' ? t('Last 7 days') : t('Last 30 days') })}</h3><div className={styles.evidence}>{data?.sessions.data.filter(s => s.jobId === selected.id).sort((a, b) => Date.parse(b.creationTime) - Date.parse(a.creationTime)).slice(0, 5).map(session => <div key={session.id}><div><Tone value={session.state !== 'Stopped' ? session.state : session.result?.result || 'Unknown'} /><span>{date(session.creationTime)}</span></div><p>{session.result?.message || t('No result message was returned for this session.')}</p><small>{label(session.sessionType)} · {session.id}</small></div>)}{!data?.sessions.data.some(s => s.jobId === selected.id) && <Empty>{data?.sessions.available ? t('No session evidence was loaded for this job in the selected window. Its reported last result may be older.') : t('Session evidence is unavailable.')}</Empty>}</div>
      <div className={styles.detailActions}><p><Trans>{"Continue to the job for task details and available start, retry, or stop controls."}</Trans></p><Button asChild><Link href={`/vbr/jobs/${encodeURIComponent(selected.id)}`}><Trans>{"Open job details "}</Trans><ArrowUpRight size={16} /></Link></Button></div>
    </>}</DialogContent></Dialog>
  </div>
}
