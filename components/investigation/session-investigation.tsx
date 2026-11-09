"use client"

import { Trans } from '@/components/providers/i18n-provider'
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableGrid } from '@/components/ui/sortable-grid'
import { useCallback,useState } from 'react'

import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { veeamApi } from '@/lib/api/veeam-client'
import { needsInvestigation,recordStatus,tone,validId,type SessionInvestigation as Evidence,type Task } from '@/lib/investigation/model'

import { cn } from '@/lib/utils'
import { ArrowUpRight,FileText,GitBranch,RefreshCw,Server } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import styles from './investigation.module.css'
import { useInvestigationPresentation,Empty,Loading,LogViewer,Notice,Pager,Panel,SearchBox,Status,useEvidence,useRefresh } from './shared'

export function TaskDetails({ sessionId, taskId, refresh, sourceKey }: { sessionId: string; taskId: string; refresh: number; sourceKey?: string }) {
  const { t, date, label, rate, notice, duration, bytes } = useInvestigationPresentation()
  const [revision, setRevision] = useState(0)
  const load = useCallback((signal: AbortSignal) => veeamApi.getTaskInvestigation(sessionId, taskId, signal, sourceKey), [sessionId, taskId, sourceKey])
  const { data, error, loading } = useEvidence(load, revision + refresh)
  return <>
    <DialogHeader className={styles.drawerHeader}><DialogTitle>{data?.task.name || t("Workload investigation")}</DialogTitle><DialogDescription>{t('Task {id} · Results and processing events reported by VBR.', { id: taskId })}</DialogDescription></DialogHeader>
    <div className={styles.drawerBody}>
      <div className={cn(styles.actions, 'px-5 pb-4')}><Button variant="outline" size="sm" disabled={loading} onClick={() => setRevision(n => n + 1)}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t("Refresh task")}</Button>{data && <><Status value={recordStatus(data.task)} /><span className={ops.subtext}>{t('Updated {date}', { date: date(data.fetchedAt) })}</span></>}</div>
      {error && <Notice error>{notice(error)}{data && <> {t('Showing the last successful snapshot.')}</>}</Notice>}{data?.warnings.map(warning => <Notice key={warning}>{notice(warning)}</Notice>)}
      {!data && loading && <Loading>{t("Loading workload and task log…")}</Loading>}
      {data && <>
        <dl className={styles.facts}><div><dt>{t("Task type / platform")}</dt><dd>{label(data.task.type)} · {label(data.task.platformType)}</dd></div><div><dt><Trans>{"Duration"}</Trans></dt><dd>{duration(data.task)}</dd></div><div><dt>{t("Read / transferred")}</dt><dd>{bytes(data.task.progress?.readSize)} / {bytes(data.task.progress?.transferredSize)}</dd></div><div><dt>{t("Rate / bottleneck")}</dt><dd>{rate(data.task.progress?.processingRate)} / {label(data.task.progress?.bottleneck)}</dd></div><div><dt>{t("Started")}</dt><dd>{date(data.task.creationTime)}</dd></div><div><dt>{t("Ended")}</dt><dd>{date(data.task.endTime)}</dd></div><div><dt>{t("Algorithm / state")}</dt><dd>{label(data.task.algorithm)} / {label(data.task.state || data.task.scanState)}</dd></div>{data.task.type === 'Antivirus' ? <div><dt>{t("Scan result / engine")}</dt><dd>{label(data.task.scanResult)} / {data.task.antivirusName || t("Not reported")}</dd></div> : <div><dt>{t("Processed size")}</dt><dd>{bytes(data.task.progress?.processedSize)}</dd></div>}</dl>
        {data.task.result?.message && <div className={styles.message} data-tone={tone(recordStatus(data.task))}><small>{t("Workload result message")}</small>{data.task.result.message}</div>}
        <LogViewer logs={data.logs} title={t("Task log")} id={taskId} />
      </>}
    </div>
  </>
}

export function Workloads({ evidence, onInspect }: { evidence: Pick<Evidence, 'tasks'>; onInspect: (task: Task) => void }) {
  const { t, formatNumber, date, label, rate, notice, duration, bytes } = useInvestigationPresentation()
  const [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const { tasks } = evidence
  const rows = tasks.data.filter(task => (filter === 'all' || (filter === 'issues' ? needsInvestigation(task) : recordStatus(task) === filter)) &&
    [task.name, task.result?.message, task.scanResult, task.platformType].join(' ').toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(needsInvestigation(b)) - Number(needsInvestigation(a)) || (a.name || '').localeCompare(b.name || ''))
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1))
  const failed = tasks.data.filter(t => tone(recordStatus(t)) === 'danger').length, warning = tasks.data.filter(t => tone(recordStatus(t)) === 'warning').length
  if (!tasks.available) return <Notice>{tasks.error ? notice(tasks.error) : t('Workload tasks are unavailable for this run.')} {t("Use Refresh to try again.")}</Notice>
  return <>
    <div className={styles.taskSummary}><span>{t('{count} tasks loaded', { count: formatNumber(tasks.data.length) })}</span><span className={ops.danger}>{t('{count} failed / infected', { count: formatNumber(failed) })}</span><span className={ops.warning}>{t('{count} other exceptions', { count: formatNumber(warning) })}</span><span>{t("Exceptions shown first")}</span></div>
    {(!tasks.complete || tasks.error) && <Notice>{tasks.error ? notice(tasks.error) : t('Partial workload collection. Counts cover loaded tasks only.')}</Notice>}
    <FilterWorkspace label={t("Grid filters")} search={<><SearchBox label={t("Search workloads or errors")} value={query} onChange={value => { setQuery(value); setPage(0) }} /></>} onClear={()=>{setQuery('');setFilter('all');setPage(0)}} filters={<FilterFields><FilterSelect label={"Workload result"} value={filter} onValueChange={event => { setFilter(event); setPage(0) }}><option value="all">{t("All workloads")}</option><option value="issues">{t("Needs investigation")}</option><option value="Failed">{t("Failed")}</option><option value="Warning">{t("Warning")}</option><option value="Success">{t("Success")}</option></FilterSelect></FilterFields>}>
{rows.length ? <div className={ops.tableScroll}><SortableGrid rows={rows} columns={[{id:'name',value:r=>r.name},{id:'result',value:r=>recordStatus(r)},{id:'message',value:r=>r.result?.message},{id:'read',value:r=>r.progress?.readSize},{id:'started',kind:'date',value:r=>r.creationTime},{id:'ended',kind:'date',value:r=>r.endTime},{id:'duration',value:r=>r.endTime&&r.creationTime?Date.parse(r.endTime)-Date.parse(r.creationTime):null}]} onSortChange={()=>setPage(0)}>{(rows)=>(<table className={cn(ops.table, styles.taskTable)}><thead><tr><th>{t("Workload / task")}</th><th>{t("Result / state")}</th><th>{t("Message / processing detail")}</th><th>{t("Read / transferred")}</th><th>{t("Started")}</th><th>{t("Ended")}</th><th><Trans>{"Duration"}</Trans></th><th><span className="sr-only">{t("Task log")}</span></th></tr></thead><tbody>{rows.slice(current * 10, current * 10 + 10).map(task => <tr key={task.id}>
      <td><button className={styles.taskName} onClick={() => onInspect(task)}>{task.name || t("Unnamed workload")}</button><div className={ops.subtext}>{label(task.platformType || task.type || 'Type not reported')}</div></td>
      <td><Status value={recordStatus(task)} /><div className={ops.subtext}>{label(task.state || task.scanState || 'State not reported')}</div></td>
      <td><div className={styles.taskError} data-tone={tone(recordStatus(task))}>{task.result?.message || (needsInvestigation(task) ? t("No result message reported. Open the task log for evidence.") : t("No result message reported."))}</div>{task.progress?.bottleneck && <div className={ops.subtext}>{t('Bottleneck: {bottleneck}{rate}', { bottleneck: label(task.progress.bottleneck), rate: task.progress.processingRate ? ` · ${rate(task.progress.processingRate)}` : '' })}</div>}</td>
      <td>{bytes(task.progress?.readSize)}<div className={ops.subtext}>{bytes(task.progress?.transferredSize)}</div></td><td>{date(task.creationTime)}</td><td>{date(task.endTime)}</td><td>{duration(task)}</td><td><Button variant="ghost" size="sm" aria-label={t('Open task log for {name}', { name: task.name || task.id })} onClick={() => onInspect(task)}><FileText size={15} /> {t("Log")}</Button></td>
    </tr>)}</tbody></table>)}</SortableGrid></div> : <Empty>{tasks.data.length ? t("No workloads match these filters.") : t("VBR returned no workload tasks for this session. Check the session log for run-level activity.")}</Empty>}
<Pager page={current} count={rows.length} onChange={setPage} label={t("workloads")} />
</FilterWorkspace></>
}

export function SessionWorkspace({ id, jobId, revision, onSelect }: { id: string; jobId?: string; revision: number; onSelect: (id: string) => void }) {
  const { t, formatNumber, date, label, rate, notice, attemptLabel, duration, bytes } = useInvestigationPresentation()
  const load = useCallback((signal: AbortSignal) => veeamApi.getSessionInvestigation(id, signal), [id])
  const { data, error, loading } = useEvidence(load, revision)
  const [tab, setTab] = useState<'workloads' | 'logs'>('workloads'), [taskId, setTaskId] = useState<string | null>(null)
  if (!data) return <section className={ops.panel}>{error ? <Notice error>{notice(error)}</Notice> : <Loading />}</section>
  if (jobId && data.session.jobId !== jobId) return <Notice error>{t("This session belongs to a different job.")} <Link href={`/vbr/sessions/${id}`}>{t("Open its session investigation.")}</Link></Notice>
  const session = data.session
  const status = recordStatus(session)
  return <div className={styles.workspace} aria-busy={loading}>
    {error && <Notice error>{notice(error)} {t('Showing the last successful snapshot from {date}.', { date: date(data.fetchedAt) })}</Notice>}
    {data.warnings.map(warning => <Notice key={warning}>{notice(warning)}</Notice>)}
    <section className={ops.panel} aria-label={t("Selected session")}>
      <header className={styles.sessionHead}><div><div className={ops.eyebrow}><Trans>{"Session Investigation"}</Trans></div><h2 className="mt-2">{session.name || t("Unnamed session")}</h2><p>{date(session.creationTime)} · {label(session.sessionType || 'Type not reported')}</p><code>{session.id}</code></div><div className={styles.actions}><Status value={status} /><Button asChild variant="outline" size="sm"><Link href={`/vbr/sessions/${id}`}>{t("Session link")} <ArrowUpRight size={14} /></Link></Button></div></header>
      <dl className={styles.facts}><div><dt><Trans>{"Duration"}</Trans></dt><dd>{duration(session)}</dd></div><div><dt>{t("Transferred")}</dt><dd>{bytes(session.progress?.transferredSize)}</dd></div><div><dt>{t("Processing rate")}</dt><dd>{rate(session.progress?.processingRate)}</dd></div><div><dt>{t("Bottleneck")}</dt><dd>{label(session.progress?.bottleneck)}</dd></div></dl>
      {session.result?.message && <div className={styles.message} data-tone={tone(status)}><small>{t("Session result message")}</small>{session.result.message}</div>}
      <div className={styles.relations}>{!jobId && validId(session.jobId) && <Link href={session.sessionType === 'AgentDiscovery' ? `/vbr/inventory/protection-groups/${session.jobId}` : `/vbr/jobs/${session.jobId}?session=${session.id}`}>{session.sessionType === 'AgentDiscovery' ? t("Open protection group") : t("Open job investigation")} ↗</Link>}<span>{t('State: {state}', { state: label(session.state) })}</span><span>{t('Ended: {date}', { date: date(session.endTime) })}</span><span>{t('Initiated by: {name}', { name: session.initiatedBy || t("Not reported") })}</span>{validId(session.parentSessionId) && session.parentSessionId !== id && <Link href={`/vbr/sessions/${session.parentSessionId}`}>{t("Parent session")} ↗</Link>}{validId(session.relatedSessionId) && session.relatedSessionId !== id && <Link href={`/vbr/sessions/${session.relatedSessionId}`}>{t("Related session")} ↗</Link>}</div>
    </section>
    <Panel title={t("Run & retry chain")} subtitle={data.chain.originalId ? t('{count} linked runs · original {id}', { count: formatNumber(data.chain.data.length), id: data.chain.originalId }) : t('Retry linkage requires VBR to report an original-session ID.')} action={<GitBranch size={17} className={ops.neutral} />}>
      {!!data.chain.data.length && <div className={styles.chain}>{data.chain.data.map(attempt => <button key={attempt.id} className={styles.attempt} aria-pressed={attempt.id === id} onClick={() => onSelect(attempt.id)}><strong>{attemptLabel(attempt)}</strong><time>{date(attempt.creationTime)}</time><Status value={recordStatus(attempt)} /></button>)}</div>}
      <p className={styles.chainNote}>{notice(data.chain.note)}{!data.chain.originalId && session.retryInfo ? <> {t('VBR identifies this run as {attempt}.', { attempt: attemptLabel(session) })}</> : null}</p>
    </Panel>
    <section className={ops.panel} aria-label={t("Session evidence")}>
      <div className={styles.tabs} role="tablist" aria-label={t("Session evidence type")}><button id="workloads-tab" role="tab" aria-selected={tab === 'workloads'} aria-controls="workloads-panel" tabIndex={tab === 'workloads' ? 0 : -1} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { setTab('logs'); document.getElementById('logs-tab')?.focus() } }} onClick={() => setTab('workloads')}><Server size={15} /> {t("Workloads")} <span>{data.tasks.available ? formatNumber(data.tasks.data.length) : '—'}</span></button><button id="logs-tab" role="tab" aria-selected={tab === 'logs'} aria-controls="logs-panel" tabIndex={tab === 'logs' ? 0 : -1} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { setTab('workloads'); document.getElementById('workloads-tab')?.focus() } }} onClick={() => setTab('logs')}><FileText size={15} /> {t("Session log")} <span>{data.logs.available ? formatNumber(data.logs.data.length) : '—'}</span></button></div>
      <div role="tabpanel" tabIndex={0} id={tab === 'workloads' ? 'workloads-panel' : 'logs-panel'} aria-labelledby={tab === 'workloads' ? 'workloads-tab' : 'logs-tab'}>{tab === 'workloads' ? <Workloads evidence={data} onInspect={task => setTaskId(task.id)} /> : <LogViewer logs={data.logs} title={t("Session log")} id={id} />}</div>
      <div className={ops.panelFoot}>{t('Updated {date}', { date: date(data.fetchedAt) })} · {data.sourceName} · <span>API</span> {data.apiRevision}{data.progressSource === 'history' ? <> · {t('Performance reported in session history')}</> : null}{loading ? <> · {t('Refreshing…')}</> : null}</div>
    </section>
    <Dialog open={!!taskId} onOpenChange={open => { if (!open) setTaskId(null) }}><DialogContent className={styles.drawer}>{taskId && <TaskDetails key={taskId} sessionId={id} taskId={taskId} refresh={revision} />}</DialogContent></Dialog>
  </div>
}

export function SessionPage({ id }: { id: string }) {
  const { t } = useInvestigationPresentation()
  const { revision, refresh } = useRefresh(), router = useRouter()
  return <main className={cn(ops.console, styles.standalone)}>
    <div className={styles.breadcrumbs}><Link className={ops.backLink} href="/vbr/lens/operations"><Trans>{"Job Operations"}</Trans></Link></div>
    <header className={ops.header}><div><h1><Trans>{"Session Investigation"}</Trans></h1><p>{t("Follow the run, isolate the workload, inspect the evidence.")}</p></div><Button variant="outline" onClick={refresh}><RefreshCw size={15} /> {' '}<Trans>{"Refresh"}</Trans></Button></header>
    <SessionWorkspace key={id} id={id} revision={revision} onSelect={next => router.push(`/vbr/sessions/${next}`)} />
  </main>
}
