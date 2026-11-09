'use client'
// Open Backup UI v1.0.2

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Database, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { sqlRequest, type AdScope } from '@/lib/restore-points/ad-client'
import { uncertainRestore } from '@/lib/restore-points/workflow'
import { useRecoveryPresentation } from './use-presentation'
import { RecoverySignal } from './recovery-signal'
import { SqlRecoveryWorkflow } from './sql-recovery-workflow'
import { SqlBrowseWorkspace } from './sql-browse-workspace'
import type { SqlRecoveryPreset } from '@/lib/restore-points/sql-action-presets'
import styles from './active-directory.module.css'

export type SqlItem = {key:string; type:string; id?:string; name?:string; serverName?:string; vmName?:string; fullVersion?:string; sqlServerName?:{machineName?:string;instanceName?:string};
  instanceId?:string; recoveryModel?:string; isReadOnly?:boolean; isSystem?:boolean; primaryFile?:string; secondaryFiles?:string[]; blobFolders?:string[];
  timeRange?:{from?:string;to?:string;startTime?:string;endTime?:string}; allowedOperations?:string[]; guestBackupStartTime?:string;guestBackupEndTime?:string;backupCreated?:string}
export type SqlIntent='restore'|'exportFiles'|'export'|'instant'|'publish'|'exportPublished'
export type SqlFlow={id:string;key:string;intent:SqlIntent}
type SqlJob={jobId:string;key:string;permanentSessionId?:string;name?:string;state?:string;operationStatus?:string;intent:SqlIntent;database?:string|{sourceDatabase:string};targetHost?:string;targetName?:string;allowedOperations:string[]}
const jobName=(job:SqlJob)=>(typeof job.database==='string'?job.database:job.database?.sourceDatabase)||job.name||job.jobId
type ExplorerProps=AdScope&{operationsOnly?:boolean;showFinish?:boolean;onClose?:()=>void;onOperation?:()=>void}
export const sqlCaptions:Record<SqlIntent,string>={restore:'Restore databases',instant:'Instant database recovery',publish:'Publish databases',export:'Export database backups',exportFiles:'Export database files',exportPublished:'Export published backup'}

export function SqlExplorer(props:ExplorerProps){return <SqlSession key={props.sourceKey+props.sessionId} {...props}/>}
function SqlSession({sourceKey,sessionId,operationsOnly=false,showFinish=true,onClose,onOperation}:ExplorerProps){
  const {t,label,diagnostic}=useRecoveryPresentation()
  const scope={sourceKey,sessionId}
  const [tab,setSection]=useState<'browse'|'operations'>('browse')
  const [revision,setRevision]=useState(0),[jobs,setJobs]=useState<SqlJob[]>(),[jobsError,setJobsError]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [plan,setPlan]=useState<{flow:SqlFlow;dbs:SqlItem[];preset?:SqlRecoveryPreset}>(),[command,setCommand]=useState<{job:SqlJob;action:string}>()
  const [schedule,setSchedule]=useState('Manual'),[scheduledAt,setScheduledAt]=useState(''),[finish,setFinish]=useState(false),[closed,setClosed]=useState(false)
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),lock=useRef(false)
  const ended=closed||operationsOnly,section=ended?'operations':tab
  const lastKeepAlive=useRef(Date.now())
  const [selectionReset,resetSelection]=useState(0)
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>,running=false
    const read=async()=>{
      if(document.hidden||controller.signal.aborted||running)return
      running=true
      try{
        if(section==='operations'){const response=await sqlRequest<{jobs:SqlJob[]}>({sourceKey,sessionId,action:'operations'},controller.signal)
          if(!controller.signal.aborted){setJobs(response.jobs);setJobsError('')}}
        if(!ended && Date.now()-lastKeepAlive.current>=55000){
          await sqlRequest({sourceKey,sessionId,action:'keepAlive'},controller.signal)
          if(!controller.signal.aborted){lastKeepAlive.current=Date.now();setJobsError('')}
        }
      }catch(err){if(!controller.signal.aborted)setJobsError(err instanceof Error?err.message:String(err))}
      finally{running=false;if(!controller.signal.aborted)timer=setTimeout(read,section==='operations'?7000:60000)}
    }
    if(section==='operations')void read();else timer=setTimeout(read,60000)
    const visible=()=>{if(!document.hidden&&!running){clearTimeout(timer);void read()}}
    document.addEventListener('visibilitychange',visible)
    return()=>{controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}
  },[section,sourceKey,sessionId,revision,ended])
  async function run(action:()=>Promise<void>){
    if(lock.current||uncertain)return
    lock.current=true;setBusy(true);setError('');setNotice('')
    try{await action()}catch(err){setError(diagnostic(err instanceof Error?err.message:String(err)));if(uncertainRestore(err))setUncertain(true)}
    finally{lock.current=false;setBusy(false)}
  }
  function prepare(intent:SqlIntent,dbs:SqlItem[],preset?:SqlRecoveryPreset,job?:SqlJob) {
    if(!dbs.length)return
    void run(async()=>{
      const response=await sqlRequest<{workflow:SqlFlow}>({action:'prepare',...scope,intent,...(job?{jobs:[job.key]}:{databases:dbs.map(db=>db.key)})})
      setPlan({flow:response.workflow,dbs,preset})
    })
  }
  function committed(){setPlan(undefined);resetSelection(value=>value+1);setNotice(t('VBR accepted the request.'));setSection('operations');setRevision(r=>r+1);onOperation?.()}
  const mountedLabel=(s:string)=>s==='stop'?t('Stop'):s==='switchover'?t('Switch over'):s==='edit'?t('Edit switchover'):t('Export published backup')
  return <section className={styles.explorer} aria-label={t('Microsoft SQL Server')}>
    <div className={styles.header}><h3><Database size={18}/>{t('Microsoft SQL Server')}</h3><div className={styles.toolbar}>
      <Button size="sm" variant="outline" onClick={()=>setRevision(n=>n+1)}>{t('Refresh')}</Button>
      {!ended&&showFinish&&<Button size="sm" variant="outline" disabled={busy||uncertain} onClick={()=>setFinish(true)}><X size={15}/>{t('End browsing')}</Button>}</div></div>
    {ended?<h4>{t('Operations')}</h4>:<div className={styles.toolbar} role="group" aria-label={t('SQL Explorer')}>
      <Button size="sm" variant={section==='browse'?'default':'outline'} aria-pressed={section==='browse'} onClick={()=>setSection('browse')}>{t('Databases')}</Button>
      <Button size="sm" variant={section==='operations'?'default':'outline'} aria-pressed={section==='operations'} onClick={()=>setSection('operations')}>{t('Operations')}</Button>
    </div>}
    {(error||jobsError)&&<p role="alert" className={styles.error}>{error||diagnostic(jobsError)}</p>}
    {uncertain&&<p role="alert">{t('Check Sessions before submitting another request.')}</p>}{notice&&<p role="status">{notice}</p>}
    {!ended&&<div hidden={section!=='browse'}><SqlBrowseWorkspace scope={scope} active={section==='browse'} revision={revision} selectionReset={selectionReset}
      disabled={busy||uncertain} onPrepare={(intent,preset,dbs)=>prepare(intent,dbs,preset)}/></div>}
    {section==='operations'&&<>{!jobs?<RecoverySignal stage="data" compact/>:!jobs.length?<p className={styles.empty}>{t('No SQL operations have been reported for this session.')}</p>:
      jobs.map(job=><article key={job.jobId} className={styles.selection}><div><strong>{jobName(job)}</strong>
        <p>{t(sqlCaptions[job.intent])} · {label(job.operationStatus||job.state||'Not reported')}{job.targetHost&&' · '+job.targetHost}{job.targetName&&' · '+job.targetName}</p></div>
        {job.permanentSessionId&&<Button size="sm" variant="outline" asChild><Link href={'/vbr/activity/'+encodeURIComponent(job.permanentSessionId)+'?sourceKey='+encodeURIComponent(sourceKey)+'#session-log'}>{t('Session log')}</Link></Button>}
        {(job.allowedOperations||[]).filter(action=>['stop','edit','switchover','exportPublished'].includes(action)).map(action=><Button size="sm" variant="outline" key={action} disabled={busy||uncertain}
          onClick={()=>{if(action==='exportPublished')prepare('exportPublished',[{key:job.key,type:'SQLDatabase',name:jobName(job)}],undefined,job);else{setSchedule('Manual');setScheduledAt('');setCommand({job,action})}}}>{mountedLabel(action)}</Button>)}</article>)}</>}
    {busy&&<RecoverySignal stage="data" compact/>}
    {plan&&<SqlRecoveryWorkflow key={plan.flow.id} scope={scope} flow={plan.flow} databases={plan.dbs} preset={plan.preset} onClose={()=>setPlan(undefined)} onAccepted={committed}/>}
    {(command||finish)&&<Dialog open onOpenChange={open=>{if(!open&&!busy){setCommand(undefined);setFinish(false)}}}><DialogContent className={styles.dialog}><DialogHeader>
      <DialogTitle>{finish?t('End browsing'):mountedLabel(command!.action)}</DialogTitle>
      <DialogDescription>{finish?t('Close this SQL browsing session?'):(command&&jobName(command.job))}</DialogDescription></DialogHeader>
      {command?.action==='edit'&&<div className={styles.form}><label>{t('Switchover')}<select value={schedule} onChange={e=>setSchedule(e.target.value)}>
        <option value="Auto">{t('Automatic')}</option><option value="Manual">{t('Manual')}</option><option value="ScheduledAt">{t('Scheduled')}</option></select></label>
        {schedule==='ScheduledAt'&&<label>{t('Scheduled time')}<input type="datetime-local" value={scheduledAt} onChange={e=>setScheduledAt(e.target.value)}/></label>}</div>}
      {error&&<p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}><Button variant="outline" disabled={busy} onClick={()=>{setCommand(undefined);setFinish(false)}}>{t('Cancel')}</Button>
        <Button disabled={busy||uncertain||(command?.action==='edit'&&schedule==='ScheduledAt'&&!scheduledAt)} onClick={()=>void run(async()=>{
          if(finish){await sqlRequest({...scope,action:'finish'});setClosed(true);setFinish(false);onClose?.()}
          else if(command){await sqlRequest({...scope,action:'mounted',command:command.action,job:command.job.key,settings:command.action==='edit'?{schedule,scheduledAt:schedule==='ScheduledAt'?new Date(scheduledAt).toISOString():undefined}:{}})
            setCommand(undefined);committed()}
        })}>{t('Confirm')}</Button></div></DialogContent></Dialog>}
  </section>
}
