'use client'
// Open Backup UI v1.2.0
import {useCallback,useEffect,useState} from 'react'
import {ApplicationRequestError} from '@/lib/api/application-request'
import type {StorageScope} from '@/lib/restore-points/unstructured-workspace'
import {acceptedStorageOperation,importLegacyStorageRequests,importLegacyStorageTransfer,observedStorageOperation,readStorageOperations,storageOperationsEvent,storageOperationsScope,updateStorageOperation,
  type StorageOperation,type StorageOperationReceipt,type StorageTaskState} from '@/lib/restore-points/storage-operations'
import {storageRequest} from './unstructured-session-controls'

export function useStorageOperationJournal(scope:StorageScope|undefined){
  const sourceKey=scope?.sourceKey,sessionId=scope?.sessionId,view=scope?.view
  const scopeKey=scope?storageOperationsScope(scope):undefined
  const [current,setCurrent]=useState<{key?:string;operations:StorageOperation[]}>({operations:[]})
  useEffect(()=>{
    if(!sourceKey||!sessionId||!view){setCurrent({operations:[]});return}
    const address={sourceKey,sessionId,view}
    const read=()=>setCurrent({key:storageOperationsScope(address),operations:readStorageOperations(address)})
    const changed=(event:Event)=>{if((event as CustomEvent<string>).detail===storageOperationsScope(address))read()}
    importLegacyStorageTransfer(address);importLegacyStorageRequests(address);read()
    window.addEventListener(storageOperationsEvent,changed)
    return ()=>window.removeEventListener(storageOperationsEvent,changed)
  },[sourceKey,sessionId,view])
  return {operations:current.key===scopeKey?current.operations:[]}
}

export function useStorageOperations(scope:StorageScope){
  const {operations}=useStorageOperationJournal(scope),{sourceKey,sessionId,view}=scope
  const [revision,setRevision]=useState(0)
  const retry=useCallback(()=>setRevision(value=>value+1),[])
  useEffect(()=>{
    const address={sourceKey,sessionId,view},controller=new AbortController()
    const backoff=new Map<string,{next:number;failures:number}>()
    let timer:ReturnType<typeof setTimeout>|undefined,running=false
    async function check(row:StorageOperation){
      if(controller.signal.aborted)return
      try{
        if(row.task){
          const snapshot=await storageRequest<StorageTaskState>(address,{action:'task',...row.task},controller.signal)
          if(controller.signal.aborted)return
          if(snapshot.id&&snapshot.id!==row.task.taskId)throw new Error('VBR could not verify this recovery request.')
          observedStorageOperation(address,row.requestId,snapshot)
        }else{
          const receipt=await storageRequest<StorageOperationReceipt>(address,{action:'operationReceipt',operation:row.action,requestId:row.requestId},controller.signal)
          if(controller.signal.aborted)return
          if(receipt.phase==='accepted'&&receipt.taskId&&receipt.taskKey){
            acceptedStorageOperation(address,row.requestId,{taskId:receipt.taskId,taskKey:receipt.taskKey})
          }else if(receipt.phase==='pending'){
            updateStorageOperation(address,row.requestId,{phase:'submitting',readError:undefined})
          }else if(receipt.phase==='unknown'||receipt.phase==='missing'&&Date.now()-row.createdAt>15_000){
            updateStorageOperation(address,row.requestId,{phase:'unknown',readError:undefined})
          }
        }
        backoff.delete(row.requestId)
      }catch(error){
        if(controller.signal.aborted)return
        updateStorageOperation(address,row.requestId,{readError:error instanceof Error?error.message:'Request failed.'})
        const failures=(backoff.get(row.requestId)?.failures||0)+1
        const denied=error instanceof ApplicationRequestError&&(error.status===401||error.status===403||error.kind==='access')
        backoff.set(row.requestId,{failures,next:denied?Infinity:Date.now()+Math.min(30_000,2500*2**failures)})
      }
    }
    async function poll(){
      if(running||controller.signal.aborted)return
      running=true
      try{
        if(document.visibilityState!=='hidden'){
          const rows=readStorageOperations(address).filter(row=>row.phase!=='finished'&&row.phase!=='rejected'&&
            (backoff.get(row.requestId)?.next||0)<=Date.now()&&(row.task||Date.now()-row.createdAt>=5000))
          // Bound status traffic without blocking an unrelated operation on a slow one.
          let cursor=0
          await Promise.all(Array.from({length:Math.min(3,rows.length)},async()=>{while(cursor<rows.length&&!controller.signal.aborted)await check(rows[cursor++])}))
        }
      }finally{
        running=false
        if(!controller.signal.aborted)timer=setTimeout(poll,2500)
      }
    }
    const resume=()=>{if(document.visibilityState!=='hidden'&&!running){clearTimeout(timer);void poll()}}
    document.addEventListener('visibilitychange',resume)
    void poll()
    return ()=>{controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',resume)}
  },[sourceKey,sessionId,view,revision])
  return {operations,retry}
}
