'use client'
// Open Backup UI v1.0.2

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { sqlRequest, type AdScope } from '@/lib/restore-points/ad-client'
import { uncertainRestore } from '@/lib/restore-points/workflow'
import { requiredSqlChecks } from '@/lib/recovery/sql-checks'
import type { SqlStep } from '@/lib/recovery/sql-actions'
import { useRecoveryPresentation } from './use-presentation'
import { sqlCaptions, type SqlItem, type SqlFlow } from './sql-explorer'
import styles from './active-directory.module.css'

type Files={primaryFile:string;secondaryFiles:string[];blobFolders:string[]}
type Transaction={lsn?:string;time?:string;operation?:string;object?:string;type?:string}
type Result={ok:boolean;errors:string[];warnings:string[];proof?:string;data:{
  existingDatabases?:string[];instances?:{machineName:string;instanceName:string}[]; groups?:string[]
  nodes?:{machineName:string;instanceName?:string;isPrimary?:boolean}[];entries?:{name:string;type:string}[];
  transactions?:Transaction[];count?:number;defaultCompression?:string}}

function timeInput(ms:number){
  const date=new Date(ms)
  return Number.isFinite(ms)?new Date(ms-date.getTimezoneOffset()*60000).toISOString().slice(0,19):''
}
export function sqlTimeWindow(dbs:SqlItem[]) {
  if(!dbs.length)return
  const ranges=dbs.map(db=>[Date.parse(db.timeRange?.from||db.timeRange?.startTime||''),Date.parse(db.timeRange?.to||db.timeRange?.endTime||'')])
  const from=Math.max(...ranges.map(pair=>pair[0])),to=Math.min(...ranges.map(pair=>pair[1]))
  if(Number.isFinite(from)&&Number.isFinite(to)&&to-from>60000)return {from,to}
}
const stepLabels:Partial<Record<SqlStep,string>>={sqlCredentials:'SQL credentials',stagingServerSqlCredentials:'SQL credentials',guestCredentials:'Windows credentials',
  stagingServerGuestCredentials:'Windows credentials',adminShareAccess:'Administrative share',mountAccess:'Mount access',windowsLogBackups:'Transaction logs',
  targetInstance:'Target instance',files:'Database files',filesOnReplicas:'Replica files',freeSpace:'Free space',sqlDatabasesDoNotExist:'Destination databases',
  standByRestoreMode:'Recovery state',alwaysOnAndUpdatePrimaryNode:'Availability group',exportTargetWindowsServer:'Export server',exportTargetPath:'Destination path',
  stagingServerFreeSpaceForExport:'Staging server free space',exportPointInTime:'Recovery time'}

export function SqlRecoveryWorkflow({scope,flow,databases,onClose,onAccepted}:{
  scope:AdScope;flow:SqlFlow;databases:SqlItem[];onClose:()=>void;onAccepted:()=>void
}){
  const {t,date,diagnostic}=useRecoveryPresentation()
  const exporting=flow.intent==='export'||flow.intent==='exportPublished',published=flow.intent==='exportPublished',instant=flow.intent==='instant'
  const canMap=instant||flow.intent==='restore'
  const [stage,setStage]=useState<'destination'|'options'|'review'>('destination'),[busy,setBusy]=useState(false),[checking,setChecking]=useState(''),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false)
  const [host,setHost]=useState(''),[instance,setInstance]=useState(''),[custom,setCustom]=useState(false),[instances,setInstances]=useState<{machineName:string;instanceName:string}[]>([])
  const [targetNames,setTargetNames]=useState(databases.map(db=>db.name||'')),[auth,setAuth]=useState<'saved'|'windows'|'sql'>('saved')
  const [user,setUser]=useState(''),[password,setPassword]=useState(''),[winOverride,setWinOverride]=useState(false),[winUser,setWinUser]=useState(''),[winPass,setWinPass]=useState('')
  const [exportHost,setExportHost]=useState(''),[exportUser,setExportUser]=useState(''),[exportPass,setExportPass]=useState(''),[exportPath,setExportPath]=useState('')
  const [compression,setCompression]=useState<'Default'|'WithCompression'|'NoCompression'>('Default'),[defaultCompression,setDefaultCompression]=useState('')
  const [folderEntries,setFolderEntries]=useState<{name:string;type:string}[]>([])
  const [files,setFiles]=useState<(Files|null)[]>(databases.map(()=>null)),[mapping,setMapping]=useState(false)
  const [state,setState]=useState('Recovery'),[standby,setStandby]=useState(''),[schedule,setSchedule]=useState<'Auto'|'Manual'|'ScheduledAt'>('Manual'),[scheduledAt,setScheduledAt]=useState('')
  const [group,setGroup]=useState(''),[groups,setGroups]=useState<string[]>([]),[replicas,setReplicas]=useState<string[]>([])
  const range=published?undefined:sqlTimeWindow(databases)
  const [pit,setPit]=useState(false),[at,setAt]=useState(timeInput(range?.to??NaN)),[lsn,setLsn]=useState(''),[direction,setDirection]=useState<'Before'|'After'>('Before')
  const [transactions,setTransactions]=useState<{rows:Transaction[];skip:number;count:number}>()
  const [proofs,setProofs]=useState<string[]>([]),[warnings,setWarnings]=useState<string[]>([]),[collisions,setCollisions]=useState<string[]>([]),[overwrite,setOverwrite]=useState(false)
  const lock=useRef(false),server=host.trim(),source=databases[0]?.sqlServerName
  const connectionReady=useRef(false)
  const destinationValid=(!custom||!!server)&&(auth==='saved'||(!!user.trim()&&!!password))&&(!winOverride||(!!winUser.trim()&&!!winPass))&&
    (!exporting||(!!exportHost.trim()&&!!exportUser.trim()&&!!exportPass&&!!exportPath.trim()))&&(exporting||targetNames.every(name=>!!name.trim()))
  const atMs=Date.parse(at),validTime=!pit||!!range&&(atMs>=range.from&&atMs<=range.to)
  const optionsValid=validTime&&(!canMap||state!=='StandBy'||!!standby.trim())&&(!instant||schedule!=='ScheduledAt'||Date.parse(scheduledAt)>Date.now())&&
    (!mapping||files.every(file=>file&&[file.primaryFile,...file.secondaryFiles,...file.blobFolders].every(p=>!!p.trim())))
  const request=<T,>(action:string,fields:Record<string,unknown>={})=>sqlRequest<T>({...scope,action,workflow:flow,...fields})
  const settings={pointInTime:pit,...(exporting?{compression}:{}),...(instant?{schedule,scheduledAt:schedule==='ScheduledAt'&&scheduledAt?new Date(scheduledAt).toISOString():undefined}:{}),...(!exporting?{overwrite}: {})}
  const target=custom?{machineName:server,instanceName:instance.trim()}:{}
  const when=pit&&Number.isFinite(atMs)?{restoreToDate:new Date(atMs).toISOString(),restoreBeforeLsn:lsn||undefined}:{}
  async function run(job:()=>Promise<void>,commit=false) {
    if(lock.current)return
    lock.current=true;setBusy(true);setError('')
    try{await job()}catch(err){setError(diagnostic(err instanceof Error?err.message:String(err)));if(commit&&uncertainRestore(err))setUncertain(true)}
    finally{lock.current=false;setBusy(false);setChecking('')}
  }
  async function check(step:SqlStep,data:Record<string,unknown>={},reset=false){
    const result=await request<Result>('check',{step,data,...(reset&&{resetValidation:true})})
    if(!result.ok)throw Error(result.errors?.join('\n')||t('Validation failed.'))
    return result
  }
  function inputs(step:SqlStep):Record<string,unknown>{
    switch(step){
      case 'guestCredentials':return {...target,...(winOverride?{username:winUser.trim(),password:winPass}:auth==='windows'?{username:user.trim(),password}:{})}
      case 'sqlCredentials':return {...target,...(auth==='saved'?{}:{auth,username:user.trim(),password})}
      case 'exportTargetWindowsServer':return {machineName:exportHost.trim(),username:exportUser.trim(),password:exportPass}
      case 'exportTargetPath':return {targetPath:exportPath.trim()}
      case 'targetInstance':return exporting?{}:{targetNames:targetNames.map(name=>name.trim())}
      case 'files':return {targetFiles:mapping?files:databases.map(()=>null)}
      case 'windowsLogBackups':case 'exportPointInTime':return when
      case 'standByRestoreMode':return {recoveryState:state,standbyFilePath:state==='StandBy'?standby.trim():undefined}
      case 'alwaysOnAndUpdatePrimaryNode':return {availabilityGroupName:group.trim()||undefined}
      default:return {}
    }
  }
  async function ensureConnection(){
    if(connectionReady.current)return
    for(const step of requiredSqlChecks(flow.intent,settings)){
      if(step==='windowsLogBackups'||step==='exportTargetWindowsServer')break
      setChecking(t(stepLabels[step]||'Validation'))
      await check(step,inputs(step))
    }
    connectionReady.current=true
  }
  async function validate(){
    const grants:string[]=[],messages:string[]=[]
    setOverwrite(false);setCollisions([])
    const steps=requiredSqlChecks(flow.intent,settings)
    for(const step of steps){
      setChecking(t(stepLabels[step]||'Validation'))
      const result=await check(step,inputs(step),step===steps[0]);if(result.proof)grants.push(result.proof)
      messages.push(...result.warnings||[])
      if(step==='sqlDatabasesDoNotExist')setCollisions(result.data.existingDatabases||[])
    }
    setProofs(grants);setWarnings([...new Set(messages)]);setStage('review')
  }
  function cancel(){if(!busy){if(uncertain){onClose();return}void run(async()=>{await request('cancelWorkflow');onClose()})}}
  async function mapFiles(){
    const rows=await Promise.all(databases.map(async db=>{
      const page=await sqlRequest<{items:SqlItem[];total:number|null}>({...scope,action:'browse',view:'files',parent:db.key,skip:0,limit:200})
      const list=page.items.filter(item=>item.primaryFile)
      if(list.length!==1)throw Error(t('VBR did not return a complete file mapping for {name}.',{name:db.name||''}))
      return {primaryFile:list[0].primaryFile!,secondaryFiles:list[0].secondaryFiles||[],blobFolders:list[0].blobFolders||[]}
    }))
    setFiles(rows);setMapping(true)
  }
  function setFile(db:number,field:keyof Files,index:number,value:string){
    setFiles(old=>old.map((row,i)=>!row||i!==db?row:{...row,[field]:field==='primaryFile'?value:row[field].map((p,j)=>j===index?value:p)}))
  }
  async function loadTransactions(skip:number){
    await ensureConnection()
    await check('windowsLogBackups',{restoreToDate:new Date(atMs).toISOString()})
    await check('fineTuning')
    const r=await check('transactions',{dateTime:new Date(atMs).toISOString(),direction,skip,limit:25})
    setTransactions({rows:r.data.transactions||[],skip,count:r.data.count||0})
  }
  const box=(text:string,enabled:boolean,change:(next:boolean)=>void)=><label className={styles.check}><input type="checkbox" checked={enabled} onChange={e=>change(e.target.checked)}/>{text}</label>
  const hostLabel=exporting?t('Staging SQL Server'):t('Target SQL Server')
  const backupTime=databases[0]?.guestBackupEndTime||databases[0]?.timeRange?.from||databases[0]?.timeRange?.startTime
  const textField=(title:string,value:string,change:(value:string)=>void,secret=false)=><label>{title}<input value={value} type={secret?'password':'text'}
    autoComplete="off" onChange={event=>change(event.target.value)}/></label>
  return <Dialog open onOpenChange={v=>{if(!v)cancel()}}><DialogContent className={styles.dialog} onInteractOutside={e=>e.preventDefault()}
    onEscapeKeyDown={e=>{if(busy)e.preventDefault()}}><DialogHeader><DialogTitle>{t(sqlCaptions[flow.intent])}</DialogTitle>
    <DialogDescription>{databases.map(db=>db.name).filter(Boolean).join(', ')} · {stage==='destination'?t('Destination'):stage==='options'?t('Recovery options'):t('Review')}</DialogDescription></DialogHeader>
    {error&&<p role="alert" className={styles.error}>{error}</p>}{uncertain&&<p role="alert">{t('Check Sessions before submitting another request.')}</p>}
    <form className={styles.form} onSubmit={event=>{event.preventDefault();if(busy||uncertain)return
      if(stage==='destination'&&destinationValid){connectionReady.current=false;setStage('options')}
      else if(stage==='options'&&optionsValid)void run(validate)
      else if(stage==='review'&&(!collisions.length||overwrite))void run(async()=>{await request('submit',{proofs,settings});onAccepted()},true)
    }}><fieldset disabled={busy||uncertain}>
    {stage==='destination'&&<>
      {exporting?<p>{t('Use the staging server configured in VBR.')}</p>:<><label>{hostLabel}<select value={custom?'custom':'original'} onChange={e=>setCustom(e.target.value==='custom')}>
        <option value="original">{t('Original location')}{source?.machineName?' · '+[source.machineName,source.instanceName].filter(Boolean).join('\\'):''}</option>
        <option value="custom">{t('New location')}</option></select></label>
      {custom&&<>
        {textField(t('Server'),host,setHost)}{textField(t('Instance name'),instance,setInstance)}
        {!exporting&&<Button type="button" size="sm" variant="outline" onClick={()=>void run(async()=>setInstances((await check('targetInstances')).data.instances||[]))}>{t('Browse instances')}</Button>}
        {!!instances.length&&<select aria-label={t('Instances')} value="" onChange={e=>{const next=instances[Number(e.target.value)];setHost(next.machineName);setInstance(next.instanceName||'')}}><option value="">{t('Select')}</option>
          {instances.map((entry,index)=><option key={index} value={index}>{[entry.machineName,entry.instanceName].filter(Boolean).join('\\')}</option>)}</select>}
      </>}
      {!exporting&&<fieldset><legend>{t('Destination databases')}</legend>{databases.map((db,i)=><label key={db.key}>{db.name}<input required value={targetNames[i]}
        onChange={e=>setTargetNames(old=>old.map((v,j)=>j===i?e.target.value:v))}/></label>)}</fieldset>}
      <details><summary>{t('Credentials')}</summary><label>{t('SQL credentials')}<select value={auth} onChange={e=>setAuth(e.target.value as typeof auth)}>
        <option value="saved">{t('Use VBR credentials')}</option><option value="windows">{t('Windows authentication')}</option><option value="sql">{t('SQL authentication')}</option></select></label>
        {auth!=='saved'&&<>{textField(t('Username'),user,setUser)}{textField(t('Password'),password,setPassword,true)}</>}
        {box(t('Specify Windows credentials'),winOverride,setWinOverride)}
        {winOverride&&<>{textField(t('Windows username'),winUser,setWinUser)}{textField(t('Windows password'),winPass,setWinPass,true)}</>}</details></>}
      {exporting&&<fieldset><legend>{t('Export destination')}</legend>{textField(t('Export server'),exportHost,setExportHost)}
        {textField(t('Windows username'),exportUser,setExportUser)}{textField(t('Windows password'),exportPass,setExportPass,true)}{textField(t('Destination path'),exportPath,setExportPath)}
        <Button type="button" variant="outline" size="sm" disabled={!exportHost.trim()||!exportUser.trim()||!exportPass} onClick={()=>void run(async()=>{
          await check('exportTargetWindowsServer',inputs('exportTargetWindowsServer'));setFolderEntries((await check('fileSystem',{parentPath:exportPath.trim()||undefined,fileType:'AllFiles'})).data.entries||[])
        })}>{t('Browse folders')}</Button>
        {!!folderEntries.length&&<select value="" aria-label={t('Folders')} onChange={e=>{const next=e.target.value;setExportPath(/^[A-Za-z]:|^\\\\/.test(next)?next:exportPath.replace(/[\\/]$/,'')+'\\'+next);setFolderEntries([])}}>
          <option value="">{t('Select')}</option>{folderEntries.filter(entry=>entry.type!=='File').map(entry=><option key={entry.name}>{entry.name}</option>)}</select>}
      </fieldset>}
    </>}
    {stage==='options'&&<>
      {!published&&<fieldset><legend>{t('Recovery time')}</legend><span>{t('Backup time')}{backupTime?' · '+date(backupTime):''}</span>
        {range&&<>{box(t('Choose a point in time'),pit,next=>{setPit(next);setLsn('');setTransactions(undefined)})}
          {pit&&<><label>{t('Recovery time')}<input type="datetime-local" step="1" min={timeInput(range.from)} max={timeInput(range.to)} required value={at}
            onChange={e=>{setAt(e.target.value);setLsn('');setTransactions(undefined)}}/></label><small>{date(range.from)} – {date(range.to)}</small>
            {databases.length===1&&<><label>{t('Transactions')}<select value={direction} onChange={e=>{setDirection(e.target.value as typeof direction);setLsn('');setTransactions(undefined)}}>
              <option value="Before">{t('Before')}</option><option value="After">{t('After')}</option></select></label>
              <Button type="button" size="sm" variant="outline" disabled={!validTime} onClick={()=>void run(()=>loadTransactions(0))}>{t('Find transactions')}</Button>
              {transactions&&<><label>{t('Stop before transaction')}<select value={lsn} onChange={e=>setLsn(e.target.value)}><option value="">{t('Use selected time')}</option>
                {transactions.rows.filter(row=>row.lsn).map(row=><option key={row.lsn} value={row.lsn}>{[row.time&&date(row.time),row.operation,row.object,row.lsn].filter(Boolean).join(' · ')}</option>)}</select></label>
                <div className={styles.toolbar}><Button type="button" size="sm" variant="outline" disabled={!transactions.skip} onClick={()=>void run(()=>loadTransactions(transactions.skip-25))}>{t('Previous')}</Button>
                  <Button type="button" size="sm" variant="outline" disabled={transactions.skip+transactions.rows.length>=transactions.count} onClick={()=>void run(()=>loadTransactions(transactions.skip+25))}>{t('Next')}</Button></div></>}
            </>}
          </>}</>}
      </fieldset>}
      {canMap&&<><label>{t('Recovery state')}<select value={state} onChange={e=>setState(e.target.value)}>
        <option value="Recovery">{t('Bring database online')}</option><option value="NoRecovery">{t('Leave database restoring')}</option><option value="StandBy">{t('Standby (read-only)')}</option></select></label>
        {state==='StandBy'&&textField(t('Standby file path'),standby,setStandby)}
        {box(t('Change database file paths'),mapping,on=>{if(on)void run(mapFiles);else setMapping(false)})}
        {mapping&&files.map((file,i)=>file&&<fieldset key={databases[i].key}><legend>{databases[i].name}</legend>
          {textField(t('Primary file'),file.primaryFile,p=>setFile(i,'primaryFile',0,p))}
          {file.secondaryFiles.map((p,j)=><label key={j}>{t('Secondary file')} {j+1}<input value={p} onChange={e=>setFile(i,'secondaryFiles',j,e.target.value)}/></label>)}
          {file.blobFolders.map((p,j)=><label key={j}>{t('BLOB folder')} {j+1}<input value={p} onChange={e=>setFile(i,'blobFolders',j,e.target.value)}/></label>)}</fieldset>)}</>}
      {flow.intent==='restore'&&<details><summary>{t('Availability group')}</summary>{textField(t('Availability group'),group,value=>{setGroup(value);setReplicas([])})}
        <Button type="button" size="sm" variant="outline" onClick={()=>void run(async()=>{await ensureConnection();setGroups((await check('availabilityGroups')).data.groups||[])})}>{t('Browse availability groups')}</Button>
        {!!groups.length&&<select value="" aria-label={t('Availability group')} onChange={e=>{setGroup(e.target.value);setReplicas([])}}><option value="">{t('Select')}</option>
          {groups.map(name=><option key={name}>{name}</option>)}</select>}
        {group&&<Button type="button" size="sm" variant="outline" onClick={()=>void run(async()=>{await ensureConnection();setReplicas(((await check('replicaNodes',{availabilityGroupName:group})).data.nodes||[]).map(n=>[n.machineName,n.instanceName].filter(Boolean).join('\\')))})}>{t('Show replica nodes')}</Button>}
        {replicas.length>0&&<p>{replicas.join(', ')}</p>}</details>}
      {instant&&<><label>{t('Switchover')}<select value={schedule} onChange={e=>setSchedule(e.target.value as typeof schedule)}>
        <option value="Auto">{t('Automatic')}</option><option value="Manual">{t('Manual')}</option><option value="ScheduledAt">{t('Scheduled')}</option></select></label>
        {schedule==='ScheduledAt'&&<label>{t('Scheduled time')}<input type="datetime-local" required value={scheduledAt} onChange={e=>setScheduledAt(e.target.value)}/></label>}</>}
      {exporting&&<><label>{t('Backup compression')}<select value={compression} onChange={e=>setCompression(e.target.value as typeof compression)}>
        <option value="Default">{t('Server default')}</option><option value="WithCompression">{t('Enable')}</option><option value="NoCompression">{t('Disable')}</option></select></label>
        <Button type="button" size="sm" variant="outline" onClick={()=>void run(async()=>{await ensureConnection();setDefaultCompression((await check('exportDefaultCompressionSetting')).data.defaultCompression||t('Not reported'))})}>{t('Check server default')}</Button>
        {defaultCompression&&<small>{defaultCompression}</small>}</>}
    </>}
    {stage==='review'&&<><dl className={styles.attributes}>
      <div><dt>{hostLabel}</dt><dd>{exporting?t('Use the staging server configured in VBR.'):custom?[server,instance].filter(Boolean).join('\\'):[source?.machineName,source?.instanceName].filter(Boolean).join('\\')||t('Original location')}</dd></div>
      <div><dt>{t('Databases')}</dt><dd>{databases.map((db,i)=>exporting||targetNames[i]===db.name?db.name:db.name+' → '+targetNames[i]).join('\n')}</dd></div>
      {!published&&<div><dt>{t('Recovery time')}</dt><dd>{pit?date(atMs):backupTime?date(backupTime):t('Backup time')}{pit&&lsn?' · '+lsn:''}</dd></div>}
      {canMap&&<div><dt>{t('Recovery state')}</dt><dd>{state==='Recovery'?t('Bring database online'):state==='StandBy'?t('Standby (read-only)')+' · '+standby:t('Leave database restoring')}</dd></div>}
      {mapping&&files.map((file,i)=>file&&<div key={databases[i].key}><dt>{databases[i].name}</dt><dd>{[file.primaryFile,...file.secondaryFiles,...file.blobFolders].join('\n')}</dd></div>)}
      {instant&&<div><dt>{t('Switchover')}</dt><dd>{schedule==='ScheduledAt'?date(scheduledAt):schedule==='Manual'?t('Manual'):t('Automatic')}</dd></div>}
      {exporting&&<><div><dt>{t('Export destination')}</dt><dd>{exportHost} · {exportPath}</dd></div><div><dt>{t('Backup compression')}</dt><dd>{compression==='Default'?t('Server default'):compression==='WithCompression'?t('Enable'):t('Disable')}</dd></div></>}
      {group&&<div><dt>{t('Availability group')}</dt><dd>{group}</dd></div>}
      </dl>{warnings.map((msg,i)=><p className={styles.feedback} key={i}>{diagnostic(msg)}</p>)}
      {collisions.length>0&&<div className={styles.feedback}><strong>{t('Existing destination databases')}</strong><p>{collisions.join(', ')}</p>
        {box(t('Overwrite these databases'),overwrite,setOverwrite)}</div>}</>}
    </fieldset>
    {checking&&<p role="status">{t('Validating {step}…',{step:checking})}</p>}
    <div className={styles.actions}><Button type="button" variant="ghost" disabled={busy} onClick={cancel}>{uncertain?t('Close'):t('Cancel')}</Button>
      {stage!=='destination'&&!uncertain&&<Button type="button" variant="outline" disabled={busy} onClick={()=>{setError('');setStage(stage==='review'?'options':'destination')}}>{t('Back')}</Button>}
      {!uncertain&&<Button type="submit" disabled={busy||(stage==='destination'&&!destinationValid)||(stage==='options'&&!optionsValid)||(stage==='review'&&collisions.length>0&&!overwrite)}>
        {busy?t('Working…'):stage==='destination'?t('Continue'):stage==='options'?t('Validate and review'):t(sqlCaptions[flow.intent])}</Button>}
    </div></form>
  </DialogContent></Dialog>
}
