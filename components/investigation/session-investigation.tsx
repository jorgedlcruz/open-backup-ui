"use client"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableGrid } from '@/components/ui/sortable-grid'
import { useCallback,useState } from 'react'

import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { veeamApi } from '@/lib/api/veeam-client'
import { attemptLabel,duration,needsInvestigation,recordStatus,tone,validId,type SessionInvestigation as Evidence,type Task } from '@/lib/investigation/model'
import { formatBytes } from '@/lib/restore-points/model'
import { cn } from '@/lib/utils'
import { ArrowUpRight,FileText,GitBranch,RefreshCw,Server } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import styles from './investigation.module.css'
import { date,Empty,Loading,LogViewer,Notice,Pager,Panel,SearchBox,Status,useEvidence,useRefresh } from './shared'

function TaskDetails({ sessionId, taskId, refresh }: { sessionId: string; taskId: string; refresh: number }) {
  const [revision, setRevision] = useState(0)
  const load = useCallback((signal: AbortSignal) => veeamApi.getTaskInvestigation(sessionId, taskId, signal), [sessionId, taskId])
  const { data, error, loading } = useEvidence(load, revision + refresh)
  return <>
    <DialogHeader className={styles.drawerHeader}><DialogTitle>{data?.task.name || 'Workload investigation'}</DialogTitle><DialogDescription>Task {taskId} · Results and processing events reported by VBR.</DialogDescription></DialogHeader>
    <div className={styles.drawerBody}>
      <div className={cn(styles.actions, 'px-5 pb-4')}><Button variant="outline" size="sm" disabled={loading} onClick={() => setRevision(n => n + 1)}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh task</Button>{data && <><Status value={recordStatus(data.task)} /><span className={ops.subtext}>Updated {date(data.fetchedAt)}</span></>}</div>
      {error && <Notice error>{error}{data && ' Showing the last successful snapshot.'}</Notice>}{data?.warnings.map(warning => <Notice key={warning}>{warning}</Notice>)}
      {!data && loading && <Loading>Loading workload and task log…</Loading>}
      {data && <>
        <dl className={styles.facts}><div><dt>Task type / platform</dt><dd>{data.task.type || 'Not reported'} · {data.task.platformType || 'Not reported'}</dd></div><div><dt>Duration</dt><dd>{duration(data.task)}</dd></div><div><dt>Read / transferred</dt><dd>{formatBytes(data.task.progress?.readSize)} / {formatBytes(data.task.progress?.transferredSize)}</dd></div><div><dt>Rate / bottleneck</dt><dd>{data.task.progress?.processingRate ?? 'Not reported'} / {data.task.progress?.bottleneck || 'Not reported'}</dd></div><div><dt>Started</dt><dd>{date(data.task.creationTime)}</dd></div><div><dt>Ended</dt><dd>{date(data.task.endTime)}</dd></div><div><dt>Algorithm / state</dt><dd>{data.task.algorithm || 'Not reported'} / {data.task.state || data.task.scanState || 'Not reported'}</dd></div>{data.task.type === 'Antivirus' ? <div><dt>Scan result / engine</dt><dd>{data.task.scanResult || 'Not reported'} / {data.task.antivirusName || 'Not reported'}</dd></div> : <div><dt>Processed size</dt><dd>{formatBytes(data.task.progress?.processedSize)}</dd></div>}</dl>
        {data.task.result?.message && <div className={styles.message} data-tone={tone(recordStatus(data.task))}><small>Workload result message</small>{data.task.result.message}</div>}
        <LogViewer logs={data.logs} title="Task log" id={taskId} />
      </>}
    </div>
  </>
}

function Workloads({ evidence, onInspect }: { evidence: Evidence; onInspect: (task: Task) => void }) {
  const [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const { tasks } = evidence
  const rows = tasks.data.filter(task => (filter === 'all' || (filter === 'issues' ? needsInvestigation(task) : recordStatus(task) === filter)) &&
    [task.name, task.result?.message, task.scanResult, task.platformType].join(' ').toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(needsInvestigation(b)) - Number(needsInvestigation(a)) || (a.name || '').localeCompare(b.name || ''))
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1))
  const failed = tasks.data.filter(t => tone(recordStatus(t)) === 'danger').length, warning = tasks.data.filter(t => tone(recordStatus(t)) === 'warning').length
  if (!tasks.available) return <Notice>{tasks.error || 'Workload tasks are unavailable for this run.'} Use Refresh to try again.</Notice>
  return <>
    <div className={styles.taskSummary}><span><strong>{tasks.data.length}</strong> tasks loaded</span><span className={ops.danger}>{failed} failed / infected</span><span className={ops.warning}>{warning} other exceptions</span><span>Exceptions shown first</span></div>
    {(!tasks.complete || tasks.error) && <Notice>{tasks.error || 'Partial workload collection. Counts cover loaded tasks only.'}</Notice>}
    <FilterWorkspace label="Grid filters" search={<><SearchBox label="Search workloads or errors" value={query} onChange={value => { setQuery(value); setPage(0) }} /></>} onClear={()=>{setQuery('');setFilter('all');setPage(0)}} filters={<FilterFields><FilterSelect label={"Workload result"} value={filter} onValueChange={event => { setFilter(event); setPage(0) }}><option value="all">All workloads</option><option value="issues">Needs investigation</option><option value="Failed">Failed</option><option value="Warning">Warning</option><option value="Success">Success</option></FilterSelect></FilterFields>}>
{rows.length ? <div className={ops.tableScroll}><SortableGrid rows={rows} columns={[{id:'name',value:r=>r.name},{id:'result',value:r=>recordStatus(r)},{id:'message',value:r=>r.result?.message},{id:'read',value:r=>r.progress?.readSize},{id:'started',kind:'date',value:r=>r.creationTime},{id:'ended',kind:'date',value:r=>r.endTime},{id:'duration',value:r=>r.endTime&&r.creationTime?Date.parse(r.endTime)-Date.parse(r.creationTime):null}]} onSortChange={()=>setPage(0)}>{(rows)=>(<table className={cn(ops.table, styles.taskTable)}><thead><tr><th>Workload / task</th><th>Result / state</th><th>Message / processing detail</th><th>Read / transferred</th><th>Started</th><th>Ended</th><th>Duration</th><th><span className="sr-only">Task log</span></th></tr></thead><tbody>{rows.slice(current * 10, current * 10 + 10).map(task => <tr key={task.id}>
      <td><button className={styles.taskName} onClick={() => onInspect(task)}>{task.name || 'Unnamed workload'}</button><div className={ops.subtext}>{task.platformType || task.type || 'Type not reported'}</div></td>
      <td><Status value={recordStatus(task)} /><div className={ops.subtext}>{task.state || task.scanState || 'State not reported'}</div></td>
      <td><div className={styles.taskError} data-tone={tone(recordStatus(task))}>{task.result?.message || (needsInvestigation(task) ? 'No result message reported. Open the task log for evidence.' : 'No result message reported.')}</div>{task.progress?.bottleneck && <div className={ops.subtext}>Bottleneck: {task.progress.bottleneck}{task.progress.processingRate ? ` · ${task.progress.processingRate}` : ''}</div>}</td>
      <td>{formatBytes(task.progress?.readSize)}<div className={ops.subtext}>{formatBytes(task.progress?.transferredSize)}</div></td><td>{date(task.creationTime)}</td><td>{date(task.endTime)}</td><td>{duration(task)}</td><td><Button variant="ghost" size="sm" aria-label={`Open task log for ${task.name || task.id}`} onClick={() => onInspect(task)}><FileText size={15} /> Log</Button></td>
    </tr>)}</tbody></table>)}</SortableGrid></div> : <Empty>{tasks.data.length ? 'No workloads match these filters.' : 'VBR returned no workload tasks for this session. Check the session log for run-level activity.'}</Empty>}
<Pager page={current} count={rows.length} onChange={setPage} label="workloads" />
</FilterWorkspace></>
}

export function SessionWorkspace({ id, jobId, revision, onSelect }: { id: string; jobId?: string; revision: number; onSelect: (id: string) => void }) {
  const load = useCallback((signal: AbortSignal) => veeamApi.getSessionInvestigation(id, signal), [id])
  const { data, error, loading } = useEvidence(load, revision)
  const [tab, setTab] = useState<'workloads' | 'logs'>('workloads'), [taskId, setTaskId] = useState<string | null>(null)
  if (!data) return <section className={ops.panel}>{error ? <Notice error>{error}</Notice> : <Loading />}</section>
  if (jobId && data.session.jobId !== jobId) return <Notice error>This session belongs to a different job. <Link href={`/vbr/sessions/${id}`}>Open its session investigation.</Link></Notice>
  const session = data.session
  const status = recordStatus(session)
  return <div className={styles.workspace} aria-busy={loading}>
    {error && <Notice error>{error} Showing the last successful snapshot from {date(data.fetchedAt)}.</Notice>}
    {data.warnings.map(warning => <Notice key={warning}>{warning}</Notice>)}
    <section className={ops.panel} aria-label="Selected session">
      <header className={styles.sessionHead}><div><div className={ops.eyebrow}>Session investigation</div><h2 className="mt-2">{session.name || 'Unnamed session'}</h2><p>{date(session.creationTime)} · {session.sessionType || 'Type not reported'}</p><code>{session.id}</code></div><div className={styles.actions}><Status value={status} /><Button asChild variant="outline" size="sm"><Link href={`/vbr/sessions/${id}`}>Session link <ArrowUpRight size={14} /></Link></Button></div></header>
      <dl className={styles.facts}><div><dt>Duration</dt><dd>{duration(session)}</dd></div><div><dt>Transferred</dt><dd>{formatBytes(session.progress?.transferredSize)}</dd></div><div><dt>Processing rate</dt><dd>{session.progress?.processingRate ?? 'Not reported'}</dd></div><div><dt>Bottleneck</dt><dd>{session.progress?.bottleneck || 'Not reported'}</dd></div></dl>
      {session.result?.message && <div className={styles.message} data-tone={tone(status)}><small>Session result message</small>{session.result.message}</div>}
      <div className={styles.relations}>{!jobId && validId(session.jobId) && <Link href={session.sessionType === 'AgentDiscovery' ? `/vbr/inventory/protection-groups/${session.jobId}` : `/vbr/jobs/${session.jobId}?session=${session.id}`}>{session.sessionType === 'AgentDiscovery' ? 'Open protection group' : 'Open job investigation'} ↗</Link>}<span>State: {session.state || 'Not reported'}</span><span>Ended: {date(session.endTime)}</span><span>Initiated by: {session.initiatedBy || 'Not reported'}</span>{validId(session.parentSessionId) && session.parentSessionId !== id && <Link href={`/vbr/sessions/${session.parentSessionId}`}>Parent session ↗</Link>}{validId(session.relatedSessionId) && session.relatedSessionId !== id && <Link href={`/vbr/sessions/${session.relatedSessionId}`}>Related session ↗</Link>}</div>
    </section>
    <Panel title="Run & retry chain" subtitle={data.chain.originalId ? `${data.chain.data.length} linked ${data.chain.data.length === 1 ? 'run' : 'runs'} · original ${data.chain.originalId}` : 'Retry linkage requires VBR to report an original-session ID.'} action={<GitBranch size={17} className={ops.neutral} />}>
      {!!data.chain.data.length && <div className={styles.chain}>{data.chain.data.map(attempt => <button key={attempt.id} className={styles.attempt} aria-pressed={attempt.id === id} onClick={() => onSelect(attempt.id)}><strong>{attemptLabel(attempt)}</strong><time>{date(attempt.creationTime)}</time><Status value={recordStatus(attempt)} /></button>)}</div>}
      <p className={styles.chainNote}>{data.chain.note}{!data.chain.originalId && session.retryInfo ? ` VBR identifies this run as ${attemptLabel(session).toLowerCase()}.` : ''}</p>
    </Panel>
    <section className={ops.panel} aria-label="Session evidence">
      <div className={styles.tabs} role="tablist" aria-label="Session evidence type"><button id="workloads-tab" role="tab" aria-selected={tab === 'workloads'} aria-controls="workloads-panel" tabIndex={tab === 'workloads' ? 0 : -1} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { setTab('logs'); document.getElementById('logs-tab')?.focus() } }} onClick={() => setTab('workloads')}><Server size={15} /> Workloads <span>{data.tasks.available ? data.tasks.data.length : '—'}</span></button><button id="logs-tab" role="tab" aria-selected={tab === 'logs'} aria-controls="logs-panel" tabIndex={tab === 'logs' ? 0 : -1} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { setTab('workloads'); document.getElementById('workloads-tab')?.focus() } }} onClick={() => setTab('logs')}><FileText size={15} /> Session log <span>{data.logs.available ? data.logs.data.length : '—'}</span></button></div>
      <div role="tabpanel" tabIndex={0} id={tab === 'workloads' ? 'workloads-panel' : 'logs-panel'} aria-labelledby={tab === 'workloads' ? 'workloads-tab' : 'logs-tab'}>{tab === 'workloads' ? <Workloads evidence={data} onInspect={task => setTaskId(task.id)} /> : <LogViewer logs={data.logs} title="Session log" id={id} />}</div>
      <div className={ops.panelFoot}>Updated {date(data.fetchedAt)} · {data.sourceName} · API {data.apiRevision}{data.progressSource === 'history' ? ' · Performance reported in session history' : ''}{loading ? ' · Refreshing…' : ''}</div>
    </section>
    <Dialog open={!!taskId} onOpenChange={open => { if (!open) setTaskId(null) }}><DialogContent className={styles.drawer}>{taskId && <TaskDetails key={taskId} sessionId={id} taskId={taskId} refresh={revision} />}</DialogContent></Dialog>
  </div>
}

export function SessionPage({ id }: { id: string }) {
  const { revision, refresh } = useRefresh(), router = useRouter()
  return <main className={cn(ops.console, styles.standalone)}>
    <div className={styles.breadcrumbs}><Link className={ops.backLink} href="/vbr/lens/operations">Job Operations</Link></div>
    <header className={ops.header}><div><h1>Session investigation</h1><p>Follow the run, isolate the workload, inspect the evidence.</p></div><Button variant="outline" onClick={refresh}><RefreshCw size={15} /> Refresh</Button></header>
    <SessionWorkspace key={id} id={id} revision={revision} onSelect={next => router.push(`/vbr/sessions/${next}`)} />
  </main>
}
