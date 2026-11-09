'use client'
// Open Backup UI v1.0.2

import { useVbmPresentation } from '@/components/vbm-jobs/presentation'

import { Trans } from '@/components/providers/i18n-provider'
import { Empty,Loading,Notice,Pager,Panel,SearchBox,useEvidence } from '@/components/investigation/shared'
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterFields,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/vbm-dashboard/evidence-panels'
import { Tone } from '@/components/vbm-dashboard/session-history'
import shared from '@/components/vbm-dashboard/vbm-dashboard.module.css'
import { veeamApi } from '@/lib/api/veeam-client'
import { validId } from '@/lib/investigation/model'

import { cn } from '@/lib/utils'
import { status } from '@/lib/vbm-dashboard/model'
import { filterLogs,logIssue,retryChain,workload,workloads,workloadTarget,type JobsSnapshot,type LogFilters,type Session,type SessionDetail } from '@/lib/vbm-jobs/model'
import { ArrowLeft,ChevronLeft,ChevronRight,RefreshCw } from 'lucide-react'
import { useCallback,useState } from 'react'
import styles from './jobs.module.css'
import { Export } from './shared'

export function SessionInvestigation({id,jobId,data,sessions,onSelect,revision}:{id:string;jobId:string;data:JobsSnapshot;sessions:Session[];onSelect:(id:string|null)=>void;revision:number}) {
  const {t,formatNumber,date,number,bytes,localLabel,localValue,localLookup,localDuration,diagnostic}=useVbmPresentation()



  const [retry,setRetry]=useState(0),load=useCallback((signal:AbortSignal)=>veeamApi.getVBMSessionInvestigation(id,jobId,signal),[id,jobId])
  const {data:detail,error,loading}=useEvidence(load,revision+retry)
  const position=sessions.findIndex(row=>row.id===id.toLowerCase()),session=detail?.session
  const chain=session ? retryChain(session,[...new Map([...sessions,session].map(row=>[row.id,row])).values()]):[]
  return <div><div className={styles.navigation}><Button variant="outline" size="sm" onClick={()=>onSelect(null)}><ArrowLeft size={14}/><Trans>{"Back to session history"}</Trans></Button><div><Button size="sm" variant="outline" aria-label={t("Previous session")} disabled={position<=0} onClick={()=>onSelect(sessions[position-1].id)}><ChevronLeft size={14}/><Trans>{"Newer"}</Trans></Button><span className={ops.subtext}>{position>=0 ? `${formatNumber(position+1)} / ${formatNumber(sessions.length)}`:t("Outside history window")}</span><Button size="sm" variant="outline" aria-label={t("Next session")} disabled={position<0 || position>=sessions.length-1} onClick={()=>onSelect(sessions[position+1].id)}><Trans>{"Older"}</Trans><ChevronRight size={14}/></Button><Button size="icon" variant="ghost" aria-label={t("Refresh session details")} disabled={loading} onClick={()=>setRetry(n=>n+1)}><RefreshCw size={14}/></Button></div></div>
    {error && <Notice error>{diagnostic(error)}</Notice>}{loading && <Loading>{detail ? t("Refreshing session evidence…"):t("Loading session details and workload logs…")}</Loading>}
    {detail && session && <><div className={styles.stack}><Panel title={t("Session result")} subtitle={`${date(session.creationTime)} · ${localLabel(localValue(session.jobType))} · ${localLabel(localValue(session.jobSessionConfigType))}`} action={<Tone value={status(session.status)}/>}><div className={styles.result}><p>{session.details || t("No result message reported.")}</p></div></Panel>
      <div className={shared.context}><span><Trans>{"Duration"}</Trans>{' '}<strong>{localDuration(session)}</strong></span><span><Trans>{"Transferred"}</Trans> <strong>{bytes(session.statistics?.transferredDataBytes)}</strong></span><span><Trans>{"Processed"}</Trans> <strong>{t("{count} objects",{count:number(session.statistics?.processedObjects)})}</strong></span><span><Trans>{"Bottleneck"}</Trans> <strong>{localLabel(localValue(session.statistics?.bottleneck))}</strong></span></div>
    </div><div className={styles.detailGrid}><WorkloadLogs key={session.id} detail={detail}/><div className={styles.stack}><Panel title={t("Session evidence")} subtitle={t("Reported values for this execution.")}><dl className={styles.sideFacts}><Field label={t("Session ID")}>{session.id}</Field><Field label={t("Started")}>{date(session.creationTime)}</Field><Field label={t("Ended")}>{date(session.endTime)}</Field><Field label={t("Repository")}>{localLookup(data.repositories.data,session.repositoryId)}</Field><Field label={t("Repository ID")}>{localValue(session.repositoryId)}</Field><Field label={t("Proxy ID")}>{localValue(session.proxyId)}</Field><Field label={t("Proxy pool ID")}>{localValue(session.proxyPoolId)}</Field><Field label={t("Job ID")}>{localValue(session.jobId)}</Field><Field label={t("Processing rate")}>{t("{rate}/s · {items} items/s",{rate:bytes(session.statistics?.processingRateBytesPS),items:number(session.statistics?.processingRateItemsPS)})}</Field><Field label={t("Read rate")}>{t("{rate}/s",{rate:bytes(session.statistics?.readRateBytesPS)})}</Field><Field label={t("Write rate")}>{t("{rate}/s",{rate:bytes(session.statistics?.writeRateBytesPS)})}</Field><Field label={t("Progress (API value)")}>{number(session.progress)}</Field></dl></Panel>
      <Panel title={t("Retry evidence")} subtitle={t("Relationships supplied by the API.")}><dl className={styles.sideFacts}><Field label={t("Retry count")}>{number(session.retryCount)}</Field><Field label={t("Will be retried (reported)")}>{session.jobWillBeRetried==null ? t("Not reported"):session.jobWillBeRetried ? t("Yes"):t("No")}</Field><Field label={t("Main session ID")}>{validId(session.mainSessionId) ? session.mainSessionId:t("No explicit parent reported")}</Field></dl>{chain.length ? <div className={styles.chain}>{chain.map(row=><button key={row.id} aria-pressed={row.id===session.id} onClick={()=>onSelect(row.id)}><Tone value={status(row.status)}/><span>{date(row.creationTime)}</span><span><Trans>{"Retry"}</Trans>{' '}{number(row.retryCount)} · {row.id}</span></button>)}</div>:<p className={ops.panelFoot}><Trans>{"No explicit retry chain in loaded history. Nearby runs are not assumed to be retries."}</Trans></p>}{validId(session.mainSessionId) && !chain.some(row=>row.id===session.mainSessionId) && <p className={ops.panelFoot}><Trans>{"The main session is outside the loaded history."}</Trans> <button className={ops.textLink} onClick={()=>onSelect(session.mainSessionId!)}><Trans>{"Inspect main session"}</Trans></button></p>}</Panel></div></div></>}
  </div>
}

function WorkloadLogs({detail}:{detail:SessionDetail}) {
  const {t,formatNumber,date,number,localLabel,localValue,diagnostic}=useVbmPresentation()



  const [filters,setFilters]=useState<LogFilters>({query:'',severity:'issues',workload:'all',order:'oldest'}),[page,setPage]=useState(0)
  const update=(patch:Partial<LogFilters>)=>{setFilters(old=>({...old,...patch}));setPage(0)}
  const logs=detail.logs,rows=filterLogs(logs.data,filters),current=Math.min(page,Math.max(0,Math.ceil(rows.length/12)-1)),issues=logs.data.filter(logIssue)
  return <Panel title={t("Workload errors & session log")} subtitle={t("Full messages from the selected execution, grouped by the workload named in each message.")} action={<Export rows={rows.map(row=>({...row,workload:workload(row),referencedObject:workloadTarget(row)}))} name={`microsoft365-${detail.session.id}-log`}/>}>
    {!!detail.warnings.length && <div className={styles.logList}>{detail.warnings.map(text=><Notice key={text}>{diagnostic(text)}</Notice>)}</div>}
    <FilterWorkspace label={t("Grid filters")} search={<><SearchBox label={t("Search workload names, URLs, or errors")} value={filters.query} onChange={query=>update({query})}/></>} onClear={()=>{setFilters(current=>({...current,query:'',severity:'all',workload:'all'}));setPage(0)}} filters={<FilterFields><FilterSelect label={t("Workload")} value={filters.workload} onValueChange={event=>update({workload:event})}><option value="all"><Trans>{"All workloads"}</Trans></option>{workloads.map(name=><option key={name} value={name}>{t("{workload} · {entries} entries · {issues} issues",{workload:localLabel(name),entries:formatNumber(logs.data.filter(row=>workload(row)===name).length),issues:formatNumber(issues.filter(row=>workload(row)===name).length)})}</option>)}</FilterSelect>
<FilterSelect defaultOpen label={t("Severity")} value={filters.severity} onValueChange={event=>update({severity:event})}><option value="issues"><Trans>{"Errors / warnings"}</Trans></option><option value="all"><Trans>{"All severities"}</Trans></option>{[...new Set(logs.data.map(row=>row.type || 'Not reported'))].sort().map(type=><option key={type} value={type}>{localLabel(type)}</option>)}</FilterSelect></FilterFields>} actions={<><GridViewMenu><label><Trans>{"Order"}</Trans><select aria-label={t("Log order")} value={filters.order} onChange={event=>update({order:event.target.value as 'oldest'|'newest'})}><option value="oldest"><Trans>{"Oldest first"}</Trans></option><option value="newest"><Trans>{"Newest first"}</Trans></option></select></label></GridViewMenu></>}>
{!logs.available ? <Empty><Trans>{"Session logs are unavailable. Refresh the session to retry."}</Trans></Empty>:!rows.length ? <Empty><Trans>{"No log entries match these filters."}</Trans>{filters.severity==='issues' && <Button size="sm" variant="outline" onClick={()=>update({severity:'all',workload:'all',query:''})}><Trans>{"Show all log entries"}</Trans></Button>}</Empty>:<div className={styles.logList}>{rows.slice(current*12,current*12+12).map(row=><article key={row.id} className={styles.logEntry} data-issue={logIssue(row)} data-error={['Error','Failed'].includes(row.type || '')}><header><span className={cn(ops.badge,logIssue(row) ? row.type==='Warning' ? ops.warning:ops.danger:row.type==='Success' ? ops.success:ops.neutral)}><span className={ops.dot}/>{localLabel(localValue(row.type))}</span><span>{localLabel(workload(row))}</span><time>{date(row.creationTime)}</time></header>{workloadTarget(row) && <strong>{t("Referenced workload · {name}",{name:workloadTarget(row)!})}</strong>}<p>{row.message || t("No message reported")}</p><details><summary><Trans>{"Log entry details"}</Trans></summary><p><Trans>{"ID:"}</Trans> {row.id}<br/><Trans>{"Sequence:"}</Trans> {number(row.usn)}<br/><Trans>{"Created:"}</Trans> {date(row.creationTime)}<br/><Trans>{"Ended:"}</Trans> {date(row.endTime)}</p></details></article>)}</div>}
<Pager page={current} count={rows.length} size={12} onChange={setPage} label={t("log entries")}/>
<p className={ops.panelFoot}>{logs.complete ? t("Complete returned log."):t("Partial / unavailable log.")}  <Trans>{"Workload labels come from message text; counts represent log entries, not unique failed objects. Ambiguous messages remain in Other / session. Exports contain all filtered entries across pages."}</Trans></p>
</FilterWorkspace></Panel>
}
