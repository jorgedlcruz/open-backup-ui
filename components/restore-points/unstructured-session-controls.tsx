'use client'
// Open Backup UI v1.2.0
import {useCallback,useEffect,useRef,useState} from 'react'
import {v4 as uuid} from 'uuid'
import {FolderOpen,Square} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {readStorageValue,storageSelectionValid,writeStorageValue,type StorageAction,type StorageEntry,type StorageScope,type StorageStatus,type StorageTask,type StorageView} from '@/lib/restore-points/unstructured-workspace'
import {uncertainRestore} from '@/lib/restore-points/workflow'
import {control,FormField,workloadRequest} from './workload-launch-shared'
import {useRecoveryPresentation} from './use-presentation'
import {StorageTargetFolderPicker} from './storage-target-folder-picker'
import {acceptedStorageOperation,importLegacyStorageRequests,queueStorageOperation,readStorageOperations,updateStorageOperation,type StorageOperation} from '@/lib/restore-points/storage-operations'

export async function storageRequest<T>(scope:StorageScope,command:Record<string,unknown>,signal?:AbortSignal){
  const result=await workloadRequest<T & {sourceKey:string}>('unstructured',{...command,...scope},signal)
  if(result.sourceKey!==scope.sourceKey)throw new Error('The selected data source has changed.')
  return result
}
export function useStorageStatus(sourceKey:string|undefined,sessionId:string,view:StorageView|undefined,revision:number) {
  const [status,setStatus]=useState<StorageStatus>(),[error,setError]=useState(''),[tick,setTick]=useState(0)
  const refresh=useCallback(()=>setTick(i=>i+1),[])
  useEffect(()=>{
    setStatus(undefined);setError('')
    if(!sourceKey||!view)return
    const scope={sourceKey,sessionId,view},controller=new AbortController()
    let timer:ReturnType<typeof setTimeout>|undefined
    async function read(){
      try {
        if(document.visibilityState==='visible'){
          const current=await storageRequest<StorageStatus>(scope,{action:'status'},controller.signal)
          if(current.sessionId!==sessionId||current.view!==view||!Array.isArray(current.actions))throw new Error('This mounted recovery is no longer available.')
          if(!controller.signal.aborted){setStatus(current);setError('')}
        }
      }catch(e){if(!controller.signal.aborted){setStatus(undefined);setError(e instanceof Error?e.message:'Request failed.')}}
      if(!controller.signal.aborted)timer=setTimeout(read,20000)
    }
    void read()
    return ()=>{controller.abort();clearTimeout(timer)}
  },[sourceKey,sessionId,view,revision,tick])
  return {status:status?.sourceKey===sourceKey&&status?.sessionId===sessionId&&status?.view===view?status:undefined,error,refresh}
}
export const storageActionLabels={copy:'Copy to…',restore:'Restore to original location',finish:'End browsing',migrate:'Migrate to production',switchover:'Switch to production'} as const
type NativeTarget={id:string;type:string;name?:string;friendlyName?:string}
type Accepted=Partial<StorageTask> & {sessionId?:string}
type CommandProps={status:StorageStatus;action:StorageAction;items?:StorageEntry[];onClose:()=>void;onAccepted:(r:Accepted)=>void;onQueued?:()=>void}
export function StorageCommand({status,action,items=[],onClose,onAccepted,onQueued}:CommandProps){
  const {t,diagnostic,date}=useRecoveryPresentation()
  const {sessionId,sourceKey,view}=status
  const [targets,setTargets]=useState<NativeTarget[]>(),[target,setTarget]=useState(''),[path,setPath]=useState('')
  const [folderPicker,setFolderPicker]=useState(false)
  const [mode,setMode]=useState(action==='migrate'?'ReplaceOlder':'Keep'),[switchMode,setSwitchMode]=useState('Manual'),[schedule,setSchedule]=useState('')
  const [confirmed,setConfirmed]=useState(false),[recursive,setRecursive]=useState(items.some(r=>r.type==='Folder'||r.type==='Drive'))
  const [hierarchy,setHierarchy]=useState(true),[permissions,setPermissions]=useState(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[targetError,setTargetError]=useState(''),[reload,setReload]=useState(0)
  const lock=useRef(false)
  const destination=action==='copy'||action==='migrate',selection=action==='copy'||action==='restore'
  const warning=action==='migrate'||action==='switchover'||(selection&&mode!=='Keep')
  const label=action==='finish'&&view==='instant'?t('Stop publishing'):t(storageActionLabels[action])
  const selectedTarget=targets?.find(row=>row.id===target)
  const canBrowse=action==='copy'&&status.actions.includes('startTargetBrowse')&&!!selectedTarget&&['FileServer','NASFiler','SMBShare','NFSShare','SANSMBShare','SANNFSShare'].includes(selectedTarget.type)
  useEffect(()=>{
    if(!destination)return
    const controller=new AbortController()
    setTargetError('')
    storageRequest<{targets:NativeTarget[]}>({sourceKey,sessionId,view},{action:'targets'},controller.signal)
      .then(r=>{if(!controller.signal.aborted)setTargets(r.targets)}).catch(e=>{if(!controller.signal.aborted)setTargetError(e instanceof Error?e.message:'Request failed.')})
    return ()=>controller.abort()
  },[sourceKey,sessionId,view,destination,reload])
  const allowed=status.actions.includes(action)&&(!selection||storageSelectionValid(items))&&(!destination||!!targets?.some(r=>r.id===target)&&!!path.trim())&&
    (!warning||confirmed)&&(action!=='migrate'||switchMode!=='Scheduled'||!!schedule&&Number.isFinite(new Date(schedule).valueOf())&&new Date(schedule).valueOf()>Date.now())
  async function submit(){
    if(!allowed||lock.current)return
    const scope={sourceKey,sessionId,view}
    const cmd:Record<string,unknown>={action,confirmOverwrite:warning&&confirmed}
    if(selection)Object.assign(cmd,{sourcePaths:items.map(r=>r.path),toDateTime:items[0]?.version,isRecursive:recursive,restoreType:mode,restorePermissions:permissions})
    if(action==='copy')Object.assign(cmd,{destinationId:target,targetPath:path})
    if(action==='migrate')Object.assign(cmd,{destinationId:target,path:path.trim(),preserveHierarchy:hierarchy,overwriteMode:mode,switchover:switchMode,
      scheduleTime:switchMode==='Scheduled'?new Date(schedule).toISOString():undefined})
    const fingerprint=JSON.stringify(cmd),key='request-'+action,prior=readStorageValue<{fingerprint:string;requestId:string}>(scope,key)
    const journaled=selection&&!!onQueued
    // Older previews kept one unresolved command per action. Retain its identity
    // without replaying it or blocking a different selection/destination.
    if(journaled&&prior){
      importLegacyStorageRequests(scope)
      if(prior.fingerprint===fingerprint&&!readStorageOperations(scope).some(row=>row.requestId===prior.requestId)){
        setError('Check the operation status before submitting the same files again.');return
      }
    }
    if(!journaled&&prior&&prior.fingerprint!==fingerprint){setError('Check Sessions before submitting another request.');return}
    const requestId=journaled?uuid():prior?.requestId||uuid()
    if(journaled){
      const now=Date.now(),operation:StorageOperation={requestId,action:action as 'copy'|'restore',fingerprint,createdAt:now,updatedAt:now,phase:'submitting',items:items.map(item=>({...item})),
        ...(action==='copy'?{destination:{id:target,name:selectedTarget?.friendlyName||selectedTarget?.name||target,path}}:{})}
      try{queueStorageOperation(scope,operation)}catch(e){setError(e instanceof Error?e.message:'Request failed.');return}
    }else writeStorageValue(scope,key,{requestId,fingerprint})
    lock.current=true;setBusy(true);setError('')
    if(journaled)onQueued?.()
    try{
      const result=await storageRequest<Accepted>(scope,{...cmd,requestId})
      if(selection?(!result.taskId||!result.taskKey):!result.sessionId)throw Object.assign(new Error('Check Sessions before submitting another request.'),{uncertain:true})
      if(journaled)acceptedStorageOperation(scope,requestId,{taskId:result.taskId!,taskKey:result.taskKey!})
      else{writeStorageValue(scope,key);onAccepted(result)}
    }catch(e){
      if(journaled)updateStorageOperation(scope,requestId,{phase:uncertainRestore(e)?'unknown':'rejected',error:e instanceof Error?e.message:'Request failed.'})
      else{if(!uncertainRestore(e))writeStorageValue(scope,key);setError(e instanceof Error?e.message:'Request failed.')}
    }
    finally{lock.current=false;if(!journaled)setBusy(false)}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose()}}><DialogContent className="max-h-[85dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>
      {selection?t('{count} items',{count:items.length}):action==='finish'?(view==='instant'?t('VBR will stop publishing this file share.'):t('VBR will close this file browsing session.')):status.name||t('Published share')}
    </DialogDescription></DialogHeader>
    {selection&&<ul className="max-h-32 space-y-1 overflow-auto rounded-md border p-3 text-sm">{items.map(r=><li className="break-all" key={r.path}>{r.path}{r.version&&' · '+date(r.version)}</li>)}</ul>}
    {destination&&<><FormField label={t('Destination')}><select className={control} value={target} onChange={e=>{setTarget(e.target.value);setPath('');setFolderPicker(false)}}>
      <option value="">{targets?t('Select a destination'):t('Loading…')}</option>{targets?.map(r=><option key={r.id} value={r.id}>{r.friendlyName||r.name||r.id} · {r.type}</option>)}</select></FormField>
      {targetError&&<p role="alert" className="text-sm">{diagnostic(targetError)} <Button variant="outline" size="sm" onClick={()=>setReload(v=>v+1)}>{t('Retry')}</Button></p>}
      <FormField label={t('Destination path')}><div className="flex min-w-0 gap-2"><input className={control+' min-w-0 flex-1'} value={path} onChange={e=>setPath(e.target.value)}/>
        {canBrowse&&<Button type="button" variant="outline" disabled={busy} onClick={()=>setFolderPicker(true)}><FolderOpen aria-hidden size={16}/>{t('Browse')}</Button>}</div></FormField></>}
    {folderPicker&&canBrowse&&selectedTarget&&<StorageTargetFolderPicker key={sourceKey+sessionId+target} scope={{sourceKey,sessionId,view}} destinationId={target}
      serverName={selectedTarget.friendlyName||selectedTarget.name||target} onClose={()=>setFolderPicker(false)} onChoose={value=>{setPath(value);setFolderPicker(false)}}/>}
    {(selection||action==='migrate')&&<FormField label={t('Existing items')}><select className={control} value={mode} onChange={e=>{setMode(e.target.value);setConfirmed(false)}}>
      {(selection?[['Keep','Keep'],['ChangedOnly','Changed items only'],['Overwrite','Overwrite']]:[['ReplaceOlder','Replace older items'],['Overwrite','Overwrite']]).map(([value,text])=><option key={value} value={value}>{t(text)}</option>)}</select></FormField>}
    {selection&&<><label className="flex gap-2 text-sm"><input type="checkbox" checked={recursive} onChange={e=>setRecursive(e.target.checked)}/>{t('Include subfolders')}</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={permissions} onChange={e=>setPermissions(e.target.checked)}/>{t('Restore permissions')}</label></>}
    {action==='migrate'&&<><label className="flex gap-2 text-sm"><input type="checkbox" checked={hierarchy} onChange={e=>setHierarchy(e.target.checked)}/>{t('Preserve folder hierarchy')}</label>
      <FormField label={t('Switchover')}><select className={control} value={switchMode} onChange={e=>setSwitchMode(e.target.value)}>{['Manual','Auto','Scheduled'].map(v=><option key={v} value={v}>{t(v)}</option>)}</select></FormField>
      {switchMode==='Scheduled'&&<FormField label={t('Scheduled time')}><input type="datetime-local" className={control} value={schedule} onChange={e=>setSchedule(e.target.value)}/></FormField>}</>}
    {warning&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('I confirm the changes to the production destination.')}</label>}
    {error&&<p role="alert" className="text-sm">{diagnostic(error)}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{t('Cancel')}</Button><Button disabled={!allowed||busy} onClick={submit}>{busy?t('Submitting…'):label}</Button></DialogFooter>
  </DialogContent></Dialog>
}
export function EndStorageSession({status,onEnded}:{status:StorageStatus;onEnded:()=>void}){
  const {t}=useRecoveryPresentation(),[confirm,setConfirm]=useState(false)
  if(!status.actions.includes('finish'))return null
  return <><Button variant="outline" size="sm" onClick={()=>setConfirm(true)}><Square size={14}/>{status.view==='instant'?t('Stop publishing'):t('End browsing')}</Button>
    {confirm&&<StorageCommand action="finish" status={status} onClose={()=>setConfirm(false)} onAccepted={()=>{writeStorageValue(status,'cart');writeStorageValue(status,'transfer');setConfirm(false);onEnded()}}/>}</>
}
