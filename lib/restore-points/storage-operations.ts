// Open Backup UI v1.2.0
import type {StorageEntry,StorageScope,StorageTask,StorageTransfer} from './unstructured-workspace'
import {finishedStorageTask,readStorageValue,writeStorageValue} from './unstructured-workspace'

export type StorageTaskLog={id?:string|number;status?:string|null;startTime?:string|null;updateTime?:string|null;title?:string|null;description?:string|null;additionalInfo?:{field:string;data:string}[]|null}
export type StorageTaskState={id?:string;type?:string;state:string;result?:string|null;progressPercent?:number|null;name?:string|null;
  creationTime?:string|null;endTime?:string|null;additionalInfo?:{message?:string|null};logs?:{totalRecords?:number;records:StorageTaskLog[]}}
export type StorageOperation={requestId:string;action:'copy'|'restore';createdAt:number;updatedAt:number;fingerprint:string;items:StorageEntry[];
  destination?:{id:string;name:string;path:string};phase:'submitting'|'tracking'|'unknown'|'rejected'|'finished';task?:StorageTask;
  snapshot?:StorageTaskState;error?:string;readError?:string;persistError?:boolean}
export type StorageOperationReceipt={phase:'accepted'|'pending'|'unknown'|'missing';taskId?:string;taskKey?:string}
export const storageOperationsEvent='open-backup-ui:storage-operations'
const memory=new Map<string,StorageOperation[]>()
export const storageOperationsScope=(scope:StorageScope)=>[scope.sourceKey,scope.sessionId,scope.view].join('.')
const key=(scope:StorageScope)=>'open-backup-ui.storage-operations.'+storageOperationsScope(scope)
const isText=(value:unknown):value is string=>typeof value==='string'&&value.length>0
const valid=(value:unknown):value is StorageOperation=>{
  if(!value||typeof value!=='object')return false
  const row=value as StorageOperation
  return isText(row.requestId)&&['copy','restore'].includes(row.action)&&Number.isFinite(row.createdAt)&&Number.isFinite(row.updatedAt)&&
    typeof row.fingerprint==='string'&&['submitting','tracking','unknown','rejected','finished'].includes(row.phase)&&Array.isArray(row.items)&&row.items.length<=200&&
    row.items.every(item=>item&&isText(item.path)&&isText(item.type))&&(!row.task||isText(row.task.taskId)&&isText(row.task.taskKey))&&
    (!row.snapshot||isText(row.snapshot.state)&&(!row.snapshot.logs||Array.isArray(row.snapshot.logs.records)&&row.snapshot.logs.records.every(log=>log&&typeof log==='object'&&
      (log.id==null||typeof log.id==='string'||typeof log.id==='number')&&['title','description','status','startTime','updateTime'].every(field=>
        (log as unknown as Record<string,unknown>)[field]==null||typeof (log as unknown as Record<string,unknown>)[field]==='string')&&
      (!log.additionalInfo||Array.isArray(log.additionalInfo)&&log.additionalInfo.every(entry=>entry&&typeof entry.field==='string'&&typeof entry.data==='string')))))&&
    (!row.destination||isText(row.destination.id)&&isText(row.destination.name)&&typeof row.destination.path==='string')
}
export function readStorageOperations(scope:StorageScope):StorageOperation[]{
  const remembered=memory.get(key(scope))
  if(remembered)return remembered
  try{
    const parsed:unknown=JSON.parse(sessionStorage.getItem(key(scope))||'[]')
    if(Array.isArray(parsed))return parsed.filter(valid).slice(-100)
  }catch{}
  return []
}
const notify=(scope:StorageScope)=>{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(storageOperationsEvent,{detail:storageOperationsScope(scope)}))}
function save(scope:StorageScope,rows:StorageOperation[],required=false){
  try{sessionStorage.setItem(key(scope),JSON.stringify(rows))}
  catch{
    if(required)throw new Error('The operation could not be saved in this browser. Free browser storage and try again.')
    rows=rows.map(row=>({...row,persistError:true}))
  }
  memory.set(key(scope),rows);notify(scope)
}
export function unresolvedStorageOperation(row:StorageOperation){return row.phase==='submitting'||row.phase==='unknown'}
export function activeStorageOperation(row:StorageOperation){return row.phase==='submitting'||row.phase==='tracking'}
export function queueStorageOperation(scope:StorageScope,row:StorageOperation){
  const rows=readStorageOperations(scope)
  if(rows.some(item=>item.requestId===row.requestId||item.fingerprint===row.fingerprint&&unresolvedStorageOperation(item)))
    throw new Error('This request is already being checked. Open Operations to review its status.')
  const next=[...rows,row]
  while(next.length>100){
    const index=next.findIndex(item=>item.phase==='finished'||item.phase==='rejected')
    if(index<0)throw new Error('Too many operations are still open. Review Operations before starting another.')
    next.splice(index,1)
  }
  save(scope,next,true)
}
export function updateStorageOperation(scope:StorageScope,id:string,update:Partial<Omit<StorageOperation,'requestId'|'createdAt'|'action'|'fingerprint'|'items'|'destination'>>){
  const rows=readStorageOperations(scope)
  save(scope,rows.map(row=>{
    if(row.requestId!==id)return row
    // An older receipt check or late POST response must never roll a known task
    // back to uncertainty or undo its already-observed terminal result.
    if(row.task&&(update.phase==='submitting'||update.phase==='unknown'||update.phase==='rejected'))return row
    if(row.task&&update.task&&row.task.taskId!==update.task.taskId)return row
    if(row.phase==='finished'&&update.phase&&update.phase!=='finished')return row
    return {...row,...update,updatedAt:Date.now()}
  }))
}
export function acceptedStorageOperation(scope:StorageScope,id:string,task:StorageTask){
  updateStorageOperation(scope,id,{phase:'tracking',task,error:undefined,readError:undefined})
}
export function observedStorageOperation(scope:StorageScope,id:string,snapshot:StorageTaskState){
  const phase=finishedStorageTask(snapshot)==='working'?'tracking':'finished'
  updateStorageOperation(scope,id,{phase,snapshot,error:undefined,readError:undefined})
}
export function importLegacyStorageTransfer(scope:StorageScope){
  const task=readStorageValue<StorageTransfer>(scope,'transfer')
  if(!task||!['copy','restore'].includes(task.action)||!isText(task.taskId)||!isText(task.taskKey))return
  if(!readStorageOperations(scope).some(row=>row.task?.taskId===task.taskId)){
    const now=Date.now()
    try{queueStorageOperation(scope,{requestId:task.taskId,action:task.action,createdAt:now,updatedAt:now,fingerprint:'legacy:'+task.taskId,
      items:[],phase:'tracking',task:{taskId:task.taskId,taskKey:task.taskKey}})}catch{return}
  }
  writeStorageValue(scope,'transfer')
}
export function importLegacyStorageRequests(scope:StorageScope){
  for(const action of ['copy','restore'] as const){
    const prior=readStorageValue<{requestId:string;fingerprint:string}>(scope,'request-'+action)
    if(!prior||!isText(prior.requestId)||!isText(prior.fingerprint))continue
    if(readStorageOperations(scope).some(row=>row.requestId===prior.requestId)){writeStorageValue(scope,'request-'+action);continue}
    try{
      const command=JSON.parse(prior.fingerprint),now=Date.now()
      if(command.action!==action)continue
      queueStorageOperation(scope,{requestId:prior.requestId,action,fingerprint:prior.fingerprint,createdAt:now,updatedAt:now,phase:'unknown',
        items:Array.isArray(command.sourcePaths)?command.sourcePaths.slice(0,200).filter(isText).map((path:string)=>({path,type:'File'})):[],
        ...(isText(command.destinationId)?{destination:{id:command.destinationId,name:command.destinationId,path:typeof command.targetPath==='string'?command.targetPath:''}}:{})})
      writeStorageValue(scope,'request-'+action)
    }catch{/* Keep the old receipt intact if it cannot be safely imported. */}
  }
}
export function storageOperationProgress(row:StorageOperation):number|undefined{
  const value=row.snapshot?.progressPercent
  return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:undefined
}
export function storageOperationSummary(rows:StorageOperation[]){
  const active=rows.filter(activeStorageOperation)
  return {active:active.length,attention:rows.filter(row=>row.readError||row.phase==='unknown'||row.phase==='rejected'||row.phase==='finished'&&row.snapshot&&finishedStorageTask(row.snapshot)==='failed').length,
    progress:active.length===1?storageOperationProgress(active[0]):undefined}
}
