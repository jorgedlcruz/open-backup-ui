'use client'
// Open Backup UI v1.2.0

import { useVbmPresentation } from '@/components/vbm-jobs/presentation'

import { Trans } from '@/components/providers/i18n-provider'
import { useCallback,useState } from 'react'
import Link from 'next/link'
import { useParams,useRouter,useSearchParams } from 'next/navigation'
import { Activity,ArrowLeft,Clock,Mail,RefreshCw,ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Loading,Notice,Panel,useEvidence } from '@/components/investigation/shared'
import { Tone } from '@/components/vbm-dashboard/session-history'
import { Field } from '@/components/vbm-dashboard/evidence-panels'
import { veeamApi } from '@/lib/api/veeam-client'
import { sessionStats,status } from '@/lib/vbm-dashboard/model'
import { time } from '@/lib/investigation/model'
import { type Window } from '@/lib/vbm-jobs/model'
import { cn } from '@/lib/utils'
import { JobActions,HistoryWindow } from './shared'
import { SessionTable } from './session-table'
import { SessionInvestigation } from './session-investigation'
import ops from '@/components/operations/operations.module.css'
import shared from '@/components/vbm-dashboard/vbm-dashboard.module.css'
import styles from './jobs.module.css'
const yes=(v?:boolean|null)=>v==null ? 'Not reported':v ? 'Enabled':'Disabled'
export function JobInvestigation() {
  const {t,formatNumber,date,number,localLabel,localValue,localLookup,localCount,localWindow,diagnostic}=useVbmPresentation()



  const params=useParams<{id:string}>(),router=useRouter(),search=useSearchParams(),selected=search.get('session'),id=params.id
  const [window,setWindow]=useState<Window>('all'),[revision,setRevision]=useState(0)
  const load=useCallback((signal:AbortSignal)=>veeamApi.getVBMJobOperations(window,id,signal),[window,id])
  const {data,error,loading}=useEvidence(load,revision),refresh=()=>setRevision(n=>n+1)
  const select=(session:string|null)=>router.replace(`/vbm/jobs/${encodeURIComponent(id)}/sessions${session ? `?session=${encodeURIComponent(session)}`:''}`,{scroll:false})
  if(!data || data.jobId!==id.toLowerCase())return <div className={ops.console}><Link href="/vbm/jobs" className={ops.backLink}><ArrowLeft size={14}/><Trans>{"Back to jobs"}</Trans></Link><h1 className="my-6 text-2xl font-semibold"><Trans>{"Job Investigation"}</Trans></h1>{error ? <><Notice error>{diagnostic(error)}</Notice><Button variant="outline" onClick={refresh}><Trans>{"Retry"}</Trans></Button></>:<Loading><Trans>{"Loading job configuration and session history…"}</Trans></Loading>}</div>
  const job=data.jobs.data[0],stats=sessionStats(data.sessions.data)
  const sessions=[...data.sessions.data].sort((a,b)=>(time(b.creationTime) ?? -Infinity)-(time(a.creationTime) ?? -Infinity) || a.id.localeCompare(b.id))
  return <div className={cn(ops.console,styles.page)}><Link href="/vbm/jobs" className={cn(ops.backLink,styles.back)}><ArrowLeft size={14}/><Trans>{"Back to backup jobs"}</Trans></Link><header className={ops.header}><div><h1>{job?.name || t("Backup job investigation")}</h1><p className={ops.subtitle}>{localLookup(data.organizations.data,job?.organizationId)} · {localLookup(data.repositories.data,job?.repositoryId)}</p></div><div className={ops.headerActions}><HistoryWindow value={window} onChange={setWindow}/><Button size="sm" variant="outline" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'animate-spin':''}/><Trans>{"Refresh"}</Trans></Button>{job && <JobActions job={job} onRefresh={refresh}/>}</div></header>
    {error && <Notice error>{diagnostic(error)}  <Trans>{"Showing the previous snapshot."}</Trans></Notice>}{loading && <p className={shared.refreshing} role="status"><Trans>{"Refreshing · the previous snapshot remains visible."}</Trans></p>}{!!data.warnings.length && <details className={ops.warnings}><summary>{t("{count} data coverage notices",{count:formatNumber(data.warnings.length)})}</summary><ul>{data.warnings.map(text=><li key={text}>{diagnostic(text)}</li>)}</ul></details>}
    <div className={ops.metrics}><div className={ops.metric}><div className={ops.metricLabel}><Trans>{"Current job result"}</Trans><Activity size={17}/></div><div className={styles.resultMetric}><Tone value={status(job?.lastStatus)}/></div><p>{localLabel(yes(job?.isEnabled))} · {localLabel(localValue(job?.backupType))}</p></div><div className={ops.metric}><div className={ops.metricLabel}><Trans>{"Sessions with issues"}</Trans><ShieldAlert size={17}/></div><div className={cn(ops.metricValue,stats.failed+stats.warning ? ops.warning:ops.neutral)}>{localCount(data.sessions,stats.failed+stats.warning)}</div><p>{t("{failed} failed · {warnings} warnings in loaded history",{failed:formatNumber(stats.failed),warnings:formatNumber(stats.warning)})}</p></div><div className={ops.metric}><div className={ops.metricLabel}><Trans>{"Successful completed sessions"}</Trans><Clock size={17}/></div><div className={ops.metricValue}>{stats.completedRate===null ? t("Unknown"):formatNumber(stats.completedRate/100,{style:'percent',maximumFractionDigits:0})}</div><p><Trans>{"Success / (success + warning + failed)"}</Trans></p></div><div className={ops.metric}><div className={ops.metricLabel}><Trans>{"Retained sessions"}</Trans><Mail size={17}/></div><div className={ops.metricValue}>{localCount(data.sessions)}</div><p>{localWindow(data.window)} · {t("{count} running",{count:formatNumber(stats.running)})}</p></div></div>
    <div className={styles.stack}>
      <div hidden={!!selected}><Panel title={t("Job configuration")} subtitle={t("Current policy, target, schedule, and original job details.")}><div className={styles.configuration}><p>{job?.description || t("Description not reported")}</p><dl className={styles.facts}><Field label={t("Last run")}>{date(job?.lastRun)}</Field><Field label={t("Next run")}>{date(job?.nextRun)}</Field><Field label={t("Last backup")}>{date(job?.lastBackup)}</Field><Field label={t("Schedule")}>{localLabel(yes(job?.schedulePolicy?.scheduleEnabled))} · {localLabel(localValue(job?.schedulePolicy?.type))}</Field><Field label={t("Retry policy")}>{localLabel(yes(job?.schedulePolicy?.retryEnabled))} · {t("{count} retries",{count:number(job?.schedulePolicy?.retryNumber)})}</Field><Field label={t("Job ID")}>{id}</Field></dl><details><summary><Trans>{"All schedule and infrastructure details"}</Trans></summary><dl className={styles.facts}><Field label={t("Organization")}>{localLookup(data.organizations.data,job?.organizationId)}</Field><Field label={t("Organization ID")}>{localValue(job?.organizationId)}</Field><Field label={t("Repository")}>{localLookup(data.repositories.data,job?.repositoryId)}</Field><Field label={t("Repository ID")}>{localValue(job?.repositoryId)}</Field><Field label={t("Daily schedule")}>{localLabel(localValue(job?.schedulePolicy?.dailyType))} · {localValue(job?.schedulePolicy?.dailyTime)}</Field><Field label={t("Retry wait interval (API value)")}>{number(job?.schedulePolicy?.retryWaitInterval)}</Field><Field label={t("Backup window")}>{localLabel(yes(job?.schedulePolicy?.backupWindowEnabled))}</Field><Field label={t("Periodic window")}>{localLabel(yes(job?.schedulePolicy?.periodicallyWindowEnabled))}</Field></dl></details></div></Panel></div>
      <div hidden={!!selected}><SessionTable data={data} onInspect={row=>select(row.id)}/></div>
      {selected && <SessionInvestigation key={`${id}:${selected}`} id={selected} jobId={id} data={data} sessions={sessions} onSelect={select} revision={revision}/>}
    </div>
    <footer className={ops.footer}><span><span className={ops.dot}/><Trans>{"Snapshot"}</Trans> {date(data.fetchedAt)} · {data.sourceName}</span><span>{t("Refresh on demand · {window}",{window:localWindow(data.window)})}</span></footer>
  </div>
}
