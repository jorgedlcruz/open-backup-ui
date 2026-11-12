'use client'
// Open Backup UI v1.2.0

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { sessionHomeFor, sessionHref } from '@/lib/navigation/recovery'
import { ClipboardList, Database, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import css from './sql-browse-workspace.module.css'
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
type SqlJob={jobId:string;key:string;permanentSessionId?:string;name?:string;state?:string;operationStatus?:string;sessionStatus?:string;intent:SqlIntent;database?:string|{sourceDatabase:string};targetHost?:string;targetName?:string;allowedOperations:string[]}
const jobName=(job:SqlJob)=>(typeof job.database==='string'?job.database:job.database?.sourceDatabase)||job.name||job.jobId
type ExplorerProps=AdScope&{operationsOnly?:boolean;showFinish?:boolean;onClose?:()=>void;onOperation?:()=>void}
export const sqlCaptions:Record<SqlIntent,string>={restore:'Restore databases',instant:'Instant database recovery',publish:'Publish databases',export:'Export database backups',exportFiles:'Export database files',exportPublished:'Export published backup'}

export function SqlExplorer(props:ExplorerProps){return <SqlSession key={props.sourceKey+props.sessionId} {...props}/>}
function SqlSession({sourceKey,sessionId,operationsOnly=false,showFinish=true,onClose,onOperation}:ExplorerProps){
  const home = sessionHomeFor(usePathname())
  const {t,label,diagnostic}=useRecoveryPresentation()
  const scope={sourceKey,sessionId}
  const [operationsOpen,setOperationsOpen]=useState(false)
  const [revision,setRevision]=useState(0),[jobs,setJobs]=useState<SqlJob[]>(),[jobsError,setJobsError]=useState(''),[keepAliveError,setKeepAliveError]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [plan,setPlan]=useState<{flow:SqlFlow;dbs:SqlItem[];preset?:SqlRecoveryPreset}>(),[command,setCommand]=useState<{job:SqlJob;action:string}>()
  const [schedule,setSchedule]=useState('Manual'),[scheduledAt,setScheduledAt]=useState(''),[finish,setFinish]=useState(false),[closed,setClosed]=useState(false)
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),lock=useRef(false)
  const ended=closed||operationsOnly,readOperations=ended||operationsOpen
  const lastKeepAlive=useRef(Date.now())
  const [selectionReset,resetSelection]=useState(0)
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>,running=false
    const read=async()=>{
      if(document.hidden||controller.signal.aborted||running)return
      running=true
      if(readOperations){
        try{const response=await sqlRequest<{jobs:SqlJob[]}>({sourceKey,sessionId,action:'operations'},controller.signal)
          if(!controller.signal.aborted){setJobs(response.jobs);setJobsError('')}}
        catch(err){if(!controller.signal.aborted)setJobsError(err instanceof Error?err.message:String(err))}
      }
      if(!controller.signal.aborted&&!ended&&Date.now()-lastKeepAlive.current>=55000){
        try{
          await sqlRequest({sourceKey,sessionId,action:'keepAlive'},controller.signal)
          if(!controller.signal.aborted){lastKeepAlive.current=Date.now();setKeepAliveError('')}
        }catch(err){if(!controller.signal.aborted)setKeepAliveError(err instanceof Error?err.message:String(err))}
      }
      running=false;if(!controller.signal.aborted)timer=setTimeout(read,readOperations?7000:60000)
    }
    if(readOperations)void read();else timer=setTimeout(read,60000)
    const visible=()=>{if(!document.hidden&&!running){clearTimeout(timer);void read()}}
    document.addEventListener('visibilitychange',visible)
    return()=>{controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}
  },[readOperations,sourceKey,sessionId,revision,ended])
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
  function committed(clearSelection=true){setPlan(undefined);if(clearSelection)resetSelection(value=>value+1);setNotice(t('VBR accepted the request.'));setOperationsOpen(true);setRevision(r=>r+1);onOperation?.()}
  const mountedLabel=(s:string)=>s==='stop'?t('Stop'):s==='switchover'?t('Switch over'):s==='edit'?t('Edit switchover'):t('Export published backup')
  const refresh=<Button type="button" size="icon-sm" variant="outline" aria-label={t('Refresh')} title={t('Refresh')} onClick={()=>setRevision(n=>n+1)}><RefreshCw size={15}/></Button>
  const feedback=<>{(error||(readOperations&&jobsError)||keepAliveError)&&<p role="alert" className={styles.error}>{error||diagnostic(jobsError||keepAliveError)}</p>}
    {uncertain&&<p role="alert">{t('Check Sessions before submitting another request.')}</p>}{notice&&<p role="status" className={styles.feedback}>{notice}</p>}</>
  const operations=<div className={css.jobs}>{feedback}{!jobs?(!jobsError&&<RecoverySignal stage="data" compact/>):!jobs.length?<p className={styles.empty}>{t('No SQL operations have been reported for this session.')}</p>:
      jobs.map(job=><article key={job.jobId} className={css.job}><div><h4>{jobName(job)}</h4>
        <p>{t(sqlCaptions[job.intent])} · {job.sessionStatus?`${t('Session')}: ${label(job.sessionStatus)}`:label(job.operationStatus||job.state||'Not reported')}{job.targetHost&&' · '+job.targetHost}{job.targetName&&' · '+job.targetName}</p></div><div className={css.jobActions}>
        {job.permanentSessionId&&<Button size="sm" variant="outline" asChild><Link href={sessionHref(home,job.permanentSessionId,sourceKey)+'#session-log'}>{t('Session log')}</Link></Button>}
        {(job.allowedOperations||[]).filter(action=>['stop','edit','switchover','exportPublished'].includes(action)).map(action=><Button size="sm" variant="outline" key={action} disabled={busy||uncertain||!!jobsError}
          onClick={()=>{if(action==='exportPublished')prepare('exportPublished',[{key:job.key,type:'SQLDatabase',name:jobName(job)}],undefined,job);else{setSchedule('Manual');setScheduledAt('');setCommand({job,action})}}}>{mountedLabel(action)}</Button>)}</div></article>)}</div>
  const panelOpen=operationsOpen&&!ended&&!plan&&!command
  return <section className={styles.explorer+' '+css.explorer} aria-label={t('Microsoft SQL Server')}>
    {ended?<><div className={css.commandBar}><div className={css.commandHeading}><h3><Database size={18}/>{t('Microsoft SQL Server')}</h3></div>{refresh}</div>
      <h4>{t('Operations')}</h4>{operations}</>:
      <Sheet open={panelOpen} onOpenChange={setOperationsOpen}><SqlBrowseWorkspace scope={scope} revision={revision} selectionReset={selectionReset}
        disabled={busy||uncertain} onPrepare={(intent,preset,dbs)=>prepare(intent,dbs,preset)} commands={<div className={css.sessionCommands}>
          <SheetTrigger asChild><Button size="sm" variant="outline"><ClipboardList size={15}/>{t('Operations')}</Button></SheetTrigger>
          {refresh}{showFinish&&<Button size="sm" variant="outline" disabled={busy||uncertain} onClick={()=>setFinish(true)}><X size={15}/>{t('End browsing')}</Button>}</div>}/>
        {!operationsOpen&&feedback}
        <SheetContent aria-describedby={undefined} className={css.operationsPanel}><SheetHeader className={css.operationsTitle}><SheetTitle><ClipboardList size={18}/>{t('Operations')}</SheetTitle>{refresh}</SheetHeader>{operations}</SheetContent>
      </Sheet>}
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
            setCommand(undefined);committed(false)}
        })}>{t('Confirm')}</Button></div></DialogContent></Dialog>}
  </section>
}
