'use client'
// Open Backup UI v1.2.0
import {useEffect,useRef,type Dispatch,type SetStateAction} from 'react'
import {applyDefaultPoint,suggestedOperation,type RecoverySelection} from '@/lib/restore-points/default-point'
import {isRecoveryKind,type PickerPage,type PickerScope} from '@/lib/restore-points/recovery-picker'
import type {RestorePoint} from '@/lib/restore-points/model'

type Reader=(sourceKey:string,kind:PickerScope,view:'points',args:Record<string,string>,signal:AbortSignal)=>Promise<PickerPage<RestorePoint>>
type Job={selection:RecoverySelection;controller:AbortController;started:boolean;done:boolean}

/** Resolve each newly selected workload once, including VMs whose calendar is not currently visible. */
export function useDefaultRestorePoints(sourceKey:string,kind:PickerScope,chosen:RecoverySelection[],
  setChosen:Dispatch<SetStateAction<RecoverySelection[]>>,read:Reader){
  const jobs=useRef(new Map<string,Job>())
  useEffect(()=>{
    const current=jobs.current
    return()=>{for(const job of current.values())job.controller.abort();current.clear()}
  },[sourceKey,kind])
  useEffect(()=>{
    const current=jobs.current
    for(const [id,job] of current){
      if(!chosen.includes(job.selection)||job.selection.point){job.controller.abort();current.delete(id)}
    }
    for(const selection of chosen){
      const id=selection.object.objectId
      if(!selection.point&&!selection.seed?.restorePointId&&!current.has(id))
        current.set(id,{selection,controller:new AbortController(),started:false,done:false})
    }
    function pump(){
      let running=[...current.values()].filter(job=>job.started&&!job.done).length
      for(const [id,job] of current){
        if(running>=4)break
        if(job.started)continue
        job.started=true;running++
        const {selection,controller}=job
        const backupId=selection.seed?.backupId||(selection.object.copies.length===1?selection.object.copies[0].backupId:undefined)
        void read(sourceKey,kind,'points',{objectId:id,limit:'1',offset:'0',...(backupId&&{backupId})},controller.signal).then(page=>{
          if(controller.signal.aborted||current.get(id)!==job)return
          setChosen(items=>{
            const next=applyDefaultPoint(items,selection,kind,page.data)
            if(next===items||!isRecoveryKind(kind))return next
            return next.map(item=>item!==selection&&item.object.objectId===id&&item.point
              ?{...item,operation:suggestedOperation(item.point,kind)}:item)
          })
        }).catch(()=>{/* The visible calendar owns the error and retry controls. */}).finally(()=>{
          if(current.get(id)!==job)return
          job.done=true;pump()
        })
      }
    }
    pump()
  },[sourceKey,kind,chosen,setChosen,read])
}
