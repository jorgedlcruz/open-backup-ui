'use client'
import { useCallback,useState } from 'react'
import Link from 'next/link'
import { useParams,useRouter,useSearchParams } from 'next/navigation'
import { Activity,ArrowLeft,Clock,Mail,RefreshCw,ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { date,Loading,Notice,Panel,useEvidence } from '@/components/investigation/shared'
import { Tone } from '@/components/vbm-dashboard/session-history'
import { Field,number,value } from '@/components/vbm-dashboard/evidence-panels'
import { veeamApi } from '@/lib/api/veeam-client'
import { sessionStats,status } from '@/lib/vbm-dashboard/model'
import { time } from '@/lib/investigation/model'
import { countLabel,lookup,windowLabel,type Window } from '@/lib/vbm-jobs/model'
import { cn } from '@/lib/utils'
import { JobActions,HistoryWindow } from './shared'
import { SessionTable } from './session-table'
import { SessionInvestigation } from './session-investigation'
import ops from '@/components/operations/operations.module.css'
import shared from '@/components/vbm-dashboard/vbm-dashboard.module.css'
import styles from './jobs.module.css'
const yes=(v?:boolean|null)=>v==null ? 'Not reported':v ? 'Enabled':'Disabled'
export function JobInvestigation() {
  const params=useParams<{id:string}>(),router=useRouter(),search=useSearchParams(),selected=search.get('session'),id=params.id
  const [window,setWindow]=useState<Window>('all'),[revision,setRevision]=useState(0)
  const load=useCallback((signal:AbortSignal)=>veeamApi.getVBMJobOperations(window,id,signal),[window,id])
  const {data,error,loading}=useEvidence(load,revision),refresh=()=>setRevision(n=>n+1)
  const select=(session:string|null)=>router.replace(`/vbm/jobs/${encodeURIComponent(id)}/sessions${session ? `?session=${encodeURIComponent(session)}`:''}`,{scroll:false})
  if(!data || data.jobId!==id.toLowerCase())return <div className={ops.console}><Link href="/vbm/jobs" className={ops.backLink}><ArrowLeft size={14}/>Back to jobs</Link><h1 className="my-6 text-2xl font-semibold">Job investigation</h1>{error ? <><Notice error>{error}</Notice><Button variant="outline" onClick={refresh}>Retry</Button></>:<Loading>Loading job configuration and session history…</Loading>}</div>
  const job=data.jobs.data[0],stats=sessionStats(data.sessions.data)
  const sessions=[...data.sessions.data].sort((a,b)=>(time(b.creationTime) ?? -Infinity)-(time(a.creationTime) ?? -Infinity) || a.id.localeCompare(b.id))
  return <div className={cn(ops.console,styles.page)}><Link href="/vbm/jobs" className={cn(ops.backLink,styles.back)}><ArrowLeft size={14}/>Back to backup jobs</Link><header className={ops.header}><div><h1>{job?.name || 'Backup job investigation'}</h1><p className={ops.subtitle}>{lookup(data.organizations.data,job?.organizationId)} · {lookup(data.repositories.data,job?.repositoryId)}</p></div><div className={ops.headerActions}><HistoryWindow value={window} onChange={setWindow}/><Button size="sm" variant="outline" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'animate-spin':''}/>Refresh</Button>{job && <JobActions job={job} onRefresh={refresh}/>}</div></header>
    {error && <Notice error>{error} Showing the previous snapshot.</Notice>}{loading && <p className={shared.refreshing} role="status">Refreshing · the previous snapshot remains visible.</p>}{!!data.warnings.length && <details className={ops.warnings}><summary>{data.warnings.length} data coverage notices</summary><ul>{data.warnings.map(text=><li key={text}>{text}</li>)}</ul></details>}
    <div className={ops.metrics}><div className={ops.metric}><div className={ops.metricLabel}>Current job result<Activity size={17}/></div><div className={styles.resultMetric}><Tone value={status(job?.lastStatus)}/></div><p>{yes(job?.isEnabled)} · {value(job?.backupType)}</p></div><div className={ops.metric}><div className={ops.metricLabel}>Sessions with issues<ShieldAlert size={17}/></div><div className={cn(ops.metricValue,stats.failed+stats.warning ? ops.warning:ops.neutral)}>{countLabel(data.sessions,stats.failed+stats.warning)}</div><p>{stats.failed} failed · {stats.warning} warnings in loaded history</p></div><div className={ops.metric}><div className={ops.metricLabel}>Successful completed sessions<Clock size={17}/></div><div className={ops.metricValue}>{stats.completedRate===null ? 'Unknown':`${Math.round(stats.completedRate)}%`}</div><p>Success / (success + warning + failed)</p></div><div className={ops.metric}><div className={ops.metricLabel}>Retained sessions<Mail size={17}/></div><div className={ops.metricValue}>{countLabel(data.sessions)}</div><p>{windowLabel(data.window)} · {stats.running} running</p></div></div>
    <div className={styles.stack}>
      <div hidden={!!selected}><Panel title="Job configuration" subtitle="Current policy, target, schedule, and original job details."><div className={styles.configuration}><p>{job?.description || 'Description not reported'}</p><dl className={styles.facts}><Field label="Last run">{date(job?.lastRun)}</Field><Field label="Next run">{date(job?.nextRun)}</Field><Field label="Last backup">{date(job?.lastBackup)}</Field><Field label="Schedule">{yes(job?.schedulePolicy?.scheduleEnabled)} · {value(job?.schedulePolicy?.type)}</Field><Field label="Retry policy">{yes(job?.schedulePolicy?.retryEnabled)} · {number(job?.schedulePolicy?.retryNumber)} retries</Field><Field label="Job ID">{id}</Field></dl><details><summary>All schedule and infrastructure details</summary><dl className={styles.facts}><Field label="Organization">{lookup(data.organizations.data,job?.organizationId)}</Field><Field label="Organization ID">{value(job?.organizationId)}</Field><Field label="Repository">{lookup(data.repositories.data,job?.repositoryId)}</Field><Field label="Repository ID">{value(job?.repositoryId)}</Field><Field label="Daily schedule">{value(job?.schedulePolicy?.dailyType)} · {value(job?.schedulePolicy?.dailyTime)}</Field><Field label="Retry wait interval (API value)">{number(job?.schedulePolicy?.retryWaitInterval)}</Field><Field label="Backup window">{yes(job?.schedulePolicy?.backupWindowEnabled)}</Field><Field label="Periodic window">{yes(job?.schedulePolicy?.periodicallyWindowEnabled)}</Field></dl></details></div></Panel></div>
      <div hidden={!!selected}><SessionTable data={data} onInspect={row=>select(row.id)}/></div>
      {selected && <SessionInvestigation key={`${id}:${selected}`} id={selected} jobId={id} data={data} sessions={sessions} onSelect={select} revision={revision}/>}
    </div>
    <footer className={ops.footer}><span><span className={ops.dot}/>Snapshot {date(data.fetchedAt)} · {data.sourceName}</span><span>Refresh on demand · {windowLabel(data.window)}</span></footer>
  </div>
}
