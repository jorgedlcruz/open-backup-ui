'use client'
// Open Backup UI v1.0.2

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Database, File, HardDrive, Layers, MonitorPlay, RotateCcw, Server, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { sqlRequest, type AdScope } from '@/lib/restore-points/ad-client'
import { uncertainRestore } from '@/lib/restore-points/workflow'
import { useRecoveryPresentation } from './use-presentation'
import { RecoverySignal } from './recovery-signal'
import { SqlRecoveryWorkflow } from './sql-recovery-workflow'
import { SqlRecoveryContext } from './sql-recovery-context'
import styles from './active-directory.module.css'

export type SqlItem = {key:string; type:string; id?:string; name?:string; serverName?:string; vmName?:string; fullVersion?:string; sqlServerName?:{machineName?:string;instanceName?:string};
  instanceId?:string; recoveryModel?:string; isReadOnly?:boolean; isSystem?:boolean; primaryFile?:string; secondaryFiles?:string[]; blobFolders?:string[];
  timeRange?:{from?:string;to?:string;startTime?:string;endTime?:string}; allowedOperations?:string[]; guestBackupStartTime?:string;guestBackupEndTime?:string}
export type SqlIntent='restore'|'export'|'instant'|'publish'|'exportPublished'
export type SqlFlow={id:string;key:string;intent:SqlIntent}
type SqlJob={jobId:string;key:string;permanentSessionId?:string;name?:string;state?:string;operationStatus?:string;intent:SqlIntent;database?:string|{sourceDatabase:string};targetHost?:string;targetName?:string;allowedOperations:string[]}
const jobName=(job:SqlJob)=>(typeof job.database==='string'?job.database:job.database?.sourceDatabase)||job.name||job.jobId
const databaseId=(db:SqlItem)=>JSON.stringify([db.instanceId||db.sqlServerName?.instanceName,db.sqlServerName?.machineName,db.id??db.name??db.key])
type SqlPage={items:SqlItem[];total:number|null;nextSkip?:number}
type ExplorerProps=AdScope&{operationsOnly?:boolean;showFinish?:boolean;onClose?:()=>void;onOperation?:()=>void}
type View='servers'|'instances'|'databases'|'files'
const pageSize=40
export const sqlCaptions:Record<SqlIntent,string>={restore:'Restore databases',instant:'Instant database recovery',publish:'Publish databases',export:'Export database backups',exportPublished:'Export published backup'}

function BrowsePage({scope,view,parent,selected,toggle,open,revision,refreshSelection}: {scope:AdScope;view:View;parent?:SqlItem;selected:SqlItem[];toggle:(row:SqlItem)=>void;open:(row:SqlItem)=>void;revision:number;refreshSelection:(rows:SqlItem[])=>void}) {
  const {t,formatNumber,diagnostic}=useRecoveryPresentation()
  const [offsets,setOffsets]=useState([0]),[page,setPage]=useState<SqlPage>(),[error,setError]=useState('')
  const skip=offsets[offsets.length-1]
  const {sourceKey,sessionId}=scope,parentKey=parent?.key
  useEffect(()=>{
    const controller=new AbortController();setPage(undefined);setError('')
    sqlRequest<SqlPage>({action:'browse',sourceKey,sessionId,view,parent:parentKey,skip,limit:pageSize},controller.signal)
      .then(rows=>{if(!controller.signal.aborted){setPage(rows);if(view==='databases')refreshSelection(rows.items)}}).catch(err=>{if(!controller.signal.aborted)setError(err.message)})
    return ()=>controller.abort()
  },[sourceKey,sessionId,view,parentKey,skip,revision,refreshSelection])
  if(error)return <p className={styles.error} role="alert">{diagnostic(error)}</p>
  if(!page)return <RecoverySignal stage="data" compact status={t('Loading…')}/>
  const Icon=view==='servers'?Server:view==='instances'?Layers:view==='databases'?Database:File
  return <>{page.items.length===0?<p className={styles.empty}>{t('No results')}</p>:<table className={styles.table}><thead><tr>{view==='databases'&&<th><span className="sr-only">{t('Select')}</span></th>}
    <th>{view==='files'?t('Database files'):t('Name')}</th>{view==='instances'&&<th>{t('Version')}</th>}{view==='databases'&&<th>{t('Recovery model')}</th>}</tr></thead>
    <tbody>{page.items.map((row,index)=>{
      const name=row.name||row.serverName||row.vmName||row.primaryFile||t('Not reported'),checked=view==='databases'&&selected.some(db=>databaseId(db)===databaseId(row))
      return <tr key={row.key||index} data-selected={checked||undefined}>
        {view==='databases'&&<td><input type="checkbox" disabled={!row.key} aria-label={t('Select {name}',{name})} checked={checked} onChange={()=>toggle(row)}/></td>}
        <td>{view!=='files'?<button type="button" className={styles.object} onClick={()=>open(row)}><Icon size={16}/>{name}</button>:
          <div>{[row.primaryFile,...row.secondaryFiles||[],...row.blobFolders||[]].filter(Boolean).map(path=><div key={path}>{path}</div>)}
            {!row.primaryFile&&!row.secondaryFiles?.length&&!row.blobFolders?.length&&name}</div>}</td>
        {view==='instances'&&<td>{row.fullVersion||'—'}</td>}{view==='databases'&&<td>{row.recoveryModel||'—'}</td>}
      </tr>
    })}</tbody></table>}
    {(skip>0||page.nextSkip!=null)&&<div className={styles.pager}><span>{t('{count} results',{count:formatNumber(page.items.length)})}</span>
      <Button size="sm" variant="outline" disabled={!skip} onClick={()=>setOffsets(stack=>stack.slice(0,-1))}>{t('Previous')}</Button>
      <Button size="sm" variant="outline" disabled={page.nextSkip==null} onClick={()=>{if(page.nextSkip!=null)setOffsets(stack=>[...stack,page.nextSkip!])}}>{t('Next')}</Button></div>}
  </>
}

export function SqlExplorer(props:ExplorerProps){return <SqlSession key={props.sourceKey+props.sessionId} {...props}/>}
function SqlSession({sourceKey,sessionId,operationsOnly=false,showFinish=true,onClose,onOperation}:ExplorerProps){
  const {t,label,diagnostic,formatNumber}=useRecoveryPresentation()
  const scope={sourceKey,sessionId}
  const [tab,setSection]=useState<'browse'|'operations'>('browse'),[path,setPath]=useState<SqlItem[]>([]),[selected,setSelected]=useState<SqlItem[]>([])
  const [revision,setRevision]=useState(0),[jobs,setJobs]=useState<SqlJob[]>(),[jobsError,setJobsError]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [plan,setPlan]=useState<{flow:SqlFlow;dbs:SqlItem[]}>(),[command,setCommand]=useState<{job:SqlJob;action:string}>()
  const [schedule,setSchedule]=useState('Manual'),[scheduledAt,setScheduledAt]=useState(''),[finish,setFinish]=useState(false),[closed,setClosed]=useState(false)
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),lock=useRef(false)
  const ended=closed||operationsOnly,section=ended?'operations':tab
  const lastKeepAlive=useRef(Date.now())
  const refreshSelection=useCallback((rows:SqlItem[])=>{
    const current=new Map(rows.map(row=>[databaseId(row),row]))
    setSelected(previous=>previous.length?previous.map(db=>current.get(databaseId(db))||db):previous)
  },[])
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
  function prepare(intent:SqlIntent,job?:SqlJob) {
    const dbs=job?[{key:job.key,type:'SQLDatabase',name:jobName(job)}]:selected
    void run(async()=>{
      const response=await sqlRequest<{workflow:SqlFlow}>({action:'prepare',...scope,intent,...(job?{jobs:[job.key]}:{databases:dbs.map(db=>db.key)})})
      setPlan({flow:response.workflow,dbs})
    })
  }
  function navigate(next:SqlItem[]){setPath(next);setSelected([]);setNotice('')}
  function committed(){setPlan(undefined);setSelected([]);setNotice(t('VBR accepted the request.'));setSection('operations');setRevision(r=>r+1);onOperation?.()}
  const views:View[]=['servers','instances','databases','files'],view=views[path.length],parent=path[path.length-1]
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
    {section==='browse'?<>
      <SqlRecoveryContext path={path} selected={selected}/>
      <nav aria-label={t('SQL location')} className={styles.crumbs}><button onClick={()=>navigate([])}>{t('Servers')}</button>
        {path.map((node,i)=><Fragment key={node.key}><ChevronRight size={12}/><button aria-current={i===path.length-1?'location':undefined}
          onClick={()=>navigate(path.slice(0,i+1))}>{node.name||node.serverName||node.vmName}</button></Fragment>)}</nav>
      {selected.length>0&&<div className={styles.selection}><span>{t('{count} selected',{count:formatNumber(selected.length)})}</span>
        {(['restore','instant','publish','export'] as const).map(intent=>{
          const Icon={restore:RotateCcw,instant:MonitorPlay,publish:Upload,export:HardDrive}[intent]
          return <Button type="button" key={intent} size="sm" variant={intent==='restore'?'default':'outline'} disabled={busy||uncertain} onClick={()=>prepare(intent)}>
            <Icon size={14}/>{t(sqlCaptions[intent])}</Button>})}</div>}
      {view==='files'&&parent&&<div className={styles.toolbar}><Button size="sm" variant="outline" onClick={()=>{setPath(path.slice(0,-1));setSelected([parent])}}>{t('Select database for recovery')}</Button></div>}
      <BrowsePage key={parent?.key||'root'} scope={scope} view={view} parent={parent} selected={selected} refreshSelection={refreshSelection}
        toggle={row=>setSelected(list=>list.some(db=>databaseId(db)===databaseId(row))?list.filter(db=>databaseId(db)!==databaseId(row)):[...list,row])} open={row=>navigate([...path,row])} revision={revision}/>
    </>:<>{!jobs?<RecoverySignal stage="data" compact/>:!jobs.length?<p className={styles.empty}>{t('No SQL operations have been reported for this session.')}</p>:
      jobs.map(job=><article key={job.jobId} className={styles.selection}><div><strong>{jobName(job)}</strong>
        <p>{t(sqlCaptions[job.intent])} · {label(job.operationStatus||job.state||'Not reported')}{job.targetHost&&' · '+job.targetHost}{job.targetName&&' · '+job.targetName}</p></div>
        {job.permanentSessionId&&<Button size="sm" variant="outline" asChild><Link href={'/vbr/activity/'+encodeURIComponent(job.permanentSessionId)+'?sourceKey='+encodeURIComponent(sourceKey)+'#session-log'}>{t('Session log')}</Link></Button>}
        {(job.allowedOperations||[]).filter(action=>['stop','edit','switchover','exportPublished'].includes(action)).map(action=><Button size="sm" variant="outline" key={action} disabled={busy||uncertain}
          onClick={()=>{if(action==='exportPublished')prepare('exportPublished',job);else{setSchedule('Manual');setScheduledAt('');setCommand({job,action})}}}>{mountedLabel(action)}</Button>)}</article>)}</>}
    {busy&&<RecoverySignal stage="data" compact/>}
    {plan&&<SqlRecoveryWorkflow key={plan.flow.id} scope={scope} flow={plan.flow} databases={plan.dbs} onClose={()=>setPlan(undefined)} onAccepted={committed}/>}
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
