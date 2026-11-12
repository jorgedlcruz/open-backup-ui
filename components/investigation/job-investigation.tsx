"use client"
// Open Backup UI v1.2.0

import { Trans } from '@/components/providers/i18n-provider'
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { veeamApi } from '@/lib/api/veeam-client'
import { needsInvestigation,recordStatus,tone,validId,type HistoryRange,type InvestigationJob } from '@/lib/investigation/model'
import { Activity,ArrowRight,ChevronDown,Clock3,Database,RefreshCw,Server } from 'lucide-react'
import Link from 'next/link'
import { useRouter,useSearchParams } from 'next/navigation'
import { useCallback,useEffect,useState } from 'react'
import { toast } from 'sonner'
import styles from './investigation.module.css'
import { SessionWorkspace } from './session-investigation'
import { useInvestigationPresentation,Empty,Loading,Notice,Pager,Panel,SearchBox,Status,useEvidence,useRefresh } from './shared'

type Action = 'start' | 'stop' | 'retry' | 'disable' | 'enable'

function JobActions({ job, refresh }: { job: InvestigationJob; refresh: () => void }) {
  const { t, notice } = useInvestigationPresentation()
  const actionLabel: Record<Action, string> = { start: t('Start job'), stop: t('Stop job'), retry: t('Retry job'), disable: t('Disable job'), enable: t('Enable job') }
  const [action, setAction] = useState<Action | null>(null), [pending, setPending] = useState(false)
  async function run() {
    if (!action || pending) return
    setPending(true)
    try {
      const methods = { start: () => veeamApi.startJob(job.id), stop: () => veeamApi.stopJob(job.id), retry: () => veeamApi.retryJob(job.id), disable: () => veeamApi.disableJob(job.id), enable: () => veeamApi.enableJob(job.id) }
      await methods[action](); toast.success(t('{action} request accepted', { action: actionLabel[action] })); setAction(null); refresh()
    } catch (error) { toast.error(notice(error instanceof Error ? error.message : 'The job action failed.')) }
    finally { setPending(false) }
  }
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">{t("Job actions")} <ChevronDown size={14} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{(['start', 'stop', 'retry'] as Action[]).map(item => <DropdownMenuItem key={item} onSelect={() => setAction(item)}>{actionLabel[item]}</DropdownMenuItem>)}{job.status && <DropdownMenuItem onSelect={() => setAction(job.status === 'Disabled' ? 'enable' : 'disable')}>{job.status === 'Disabled' ? t('Enable job') : t('Disable job')}</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
    <Dialog open={!!action} onOpenChange={open => { if (!open && !pending) setAction(null) }}><DialogContent><DialogHeader><DialogTitle>{action ? actionLabel[action] : t('Job action')}</DialogTitle><DialogDescription>{action === 'retry' ? t("Request a job-level retry of failed workloads. VBR determines eligibility; this does not replay the historical session currently selected.") : action === 'stop' ? t("Request that VBR stop the current job run.") : action === 'start' ? t("Start a new run of this job on VBR.") : action === 'disable' ? t("Disable this job’s scheduled execution on VBR.") : t("Enable this job’s scheduled execution on VBR.")}</DialogDescription></DialogHeader><p className="text-sm break-words">{job.name}</p><code className="text-xs text-muted-foreground break-all">{job.id}</code><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setAction(null)}><Trans>{"Cancel"}</Trans></Button><Button disabled={pending} onClick={run}>{pending ? t('Sending…') : action ? actionLabel[action] : t('Confirm')}</Button></DialogFooter></DialogContent></Dialog>
  </>
}

export function JobInvestigationPage({ id }: { id: string }) {
  const { t, formatNumber, date, label, notice, attemptLabel, duration } = useInvestigationPresentation()
  const [range, setRange] = useState<HistoryRange>('7d'), [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(0)
  const { revision, refresh } = useRefresh(), router = useRouter(), searchParams = useSearchParams()
  const load = useCallback((signal: AbortSignal) => veeamApi.getJobInvestigation(id, range, signal), [id, range])
  const { data: snapshot, loading, error } = useEvidence(load, revision)
  const [initialSessionId, setInitialSessionId] = useState<string | null>(null)
  useEffect(() => {
    if (!initialSessionId && snapshot?.sessions.data[0]) setInitialSessionId(snapshot.sessions.data[0].id)
  }, [snapshot, initialSessionId])
  const data = snapshot?.range === range ? snapshot : null
  const sessions = data?.sessions.data || [], job = data?.job
  const selectedId = searchParams.get('session')?.toLowerCase() || initialSessionId || sessions[0]?.id
  const rows = sessions.filter(session => (filter === 'all' || (filter === 'issues' ? needsInvestigation(session) : tone(recordStatus(session)) === 'active')) &&
    [session.name, session.result?.message, session.id, attemptLabel(session)].join(' ').toLowerCase().includes(query.toLowerCase()))
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1))
  const selectSession = (sessionId: string) => { const params = new URLSearchParams(searchParams.toString()); params.set('session', sessionId); router.replace(`/vbr/jobs/${id}?${params}`, { scroll: false }) }
  const issueCount = sessions.filter(needsInvestigation).length
  return <main className={ops.console}>
    <div className={styles.breadcrumbs}><Link className={ops.backLink} href="/vbr/lens/operations"><Trans>{"Job Operations"}</Trans></Link></div>
    <header className={ops.header}><div><h1>{job?.name || t('Job investigation')}</h1><p>{t("Trace exceptions from the run to the workload and its processing log.")}</p><div className={styles.jobMeta}>{job && <><Status value={job.status || 'State not reported'} /><span>{label(job.type || 'Type not reported')}</span></>}<code>{id}</code></div></div><div className={styles.actions}>{job && <JobActions job={job} refresh={refresh} />}<Button variant="outline" disabled={loading} onClick={refresh}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> {' '}<Trans>{"Refresh"}</Trans></Button></div></header>
    {error && <Notice error>{notice(error)}{data && <> {t('Showing the last successful snapshot from {date}.', { date: date(data.fetchedAt) })}</>}</Notice>}
    {data?.warnings.map(warning => <Notice key={warning}>{notice(warning)}</Notice>)}
    <div className={ops.metrics}>
      <div className={ops.metric}><div className={ops.metricLabel}>{t("Last job result")}<Activity size={16} /></div><div className={styles.metricText}><Status value={job?.lastResult && job.lastResult !== 'None' ? job.lastResult : 'Not reported'} /></div><p>{t('Last run · {date}', { date: date(job?.lastRun) })}</p></div>
      <div className={ops.metric}><div className={ops.metricLabel}>{t("Sessions to investigate")}<Clock3 size={16} /></div><div className={ops.metricValue}>{data?.sessions.available ? formatNumber(issueCount) : '—'}</div><p>{data?.sessions.available ? (data.sessions.complete ? t('{count} loaded runs · {days} days of history', { count: formatNumber(sessions.length), days: formatNumber(Number(range.slice(0, -1))) }) : t('{count} loaded runs · {days} days of history · partial', { count: formatNumber(sessions.length), days: formatNumber(Number(range.slice(0, -1))) })) : t('History not available')}</p></div>
      <div className={ops.metric}><div className={ops.metricLabel}>{t("Configured objects")}<Server size={16} /></div><div className={ops.metricValue}>{job?.objectsCount != null && job.objectsCount >= 0 ? formatNumber(job.objectsCount) : '—'}</div><p>{t('Next run · {date}', { date: job?.status === 'Disabled' ? t('Job disabled') : date(job?.nextRun) })}</p></div>
      <div className={ops.metric}><div className={ops.metricLabel}>{t("Target repository")}<Database size={16} /></div><div className={styles.metricText}>{validId(job?.repositoryId) ? <Link className="hover:underline" href={`/vbr/infrastructure/repositories/${job.repositoryId}`}>{job.repositoryName || job.repositoryId}</Link> : job?.repositoryName || t('Not reported')}</div><p>{job?.nextRunPolicy ? label(job.nextRunPolicy) : t('Schedule policy not reported')}</p></div>
    </div>
    {!data && loading ? <Loading>{t("Loading job and retained session history…")}</Loading> : <div className={styles.layout}>
      <Panel title={t("Session history")} subtitle={t("Select a run to investigate.")} action={<Clock3 size={17} className={ops.neutral} />}>
        <FilterWorkspace label={t("Grid filters")} search={<><SearchBox label={t("Search sessions")} value={query} onChange={value => { setQuery(value); setPage(0) }} /></>} onClear={()=>{setQuery('');setFilter('all');setPage(0)}} filters={<FilterFields><FilterSelect label={"Session history range"} value={range} onValueChange={e => { setRange(e as HistoryRange); setPage(0) }}><option value="7d">{t("Last 7 days")}</option><option value="30d">{t("Last 30 days")}</option><option value="90d">{t("Last 90 days")}</option></FilterSelect>
<FilterSelect label={"Session history filter"} value={filter} onValueChange={e => { setFilter(e); setPage(0) }}><option value="all">{t("All results")}</option><option value="issues">{t("Needs investigation")}</option><option value="active">{t("Active sessions")}</option></FilterSelect></FilterFields>}>
{data?.sessions.error && <Notice>{notice(data.sessions.error)}</Notice>}
{data?.sessions.available && !data.sessions.complete && <Notice>{t("Partial history. More runs may exist.")}</Notice>}
{rows.length ? <div className={styles.historyList} role="region" aria-label={t("Session history results")} tabIndex={0}>{rows.slice(current * 10, current * 10 + 10).map(session => <button className={styles.historyItem} key={session.id} aria-pressed={selectedId === session.id} aria-label={t('Investigate {date} {status}', { date: date(session.creationTime), status: label(recordStatus(session)) })} onClick={() => selectSession(session.id)}><div><Status value={recordStatus(session)} /><ArrowRight size={14} className={ops.neutral} /></div><time>{date(session.creationTime)}</time><small>{duration(session)}</small><small>{attemptLabel(session)}</small></button>)}</div> : <Empty>{data?.sessions.available ? t('No sessions match this history range and filter.') : t('Session history is unavailable.')}</Empty>}
<Pager page={current} count={rows.length} onChange={setPage} label={t("sessions")} />
{selectedId && !rows.slice(current * 10, current * 10 + 10).some(session => session.id === selectedId) && <div className={ops.panelFoot}>{t("The selected run is outside this page or history filter. Its investigation remains open.")}</div>}
</FilterWorkspace></Panel>
      {selectedId ? <SessionWorkspace key={selectedId} id={selectedId} jobId={id} revision={revision} onSelect={selectSession} /> : <section className={ops.panel}><Empty>{t("Select a session from retained history to inspect workloads, retries and logs.")}</Empty></section>}
    </div>}
    <footer className={ops.footer}><span><Activity size={12} /> {data?.sourceName || 'VBR'} · {data ? t('Updated {date}', { date: date(data.fetchedAt) }) : t('Waiting for source')}</span><span>{t("Refreshes every 60 seconds while visible · Times shown in your local time zone")}</span></footer>
  </main>
}
