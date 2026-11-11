'use client'
// Open Backup UI v1.2.0
import {useEffect,useRef,useState} from 'react'
import type {GoalAvailability} from '@/lib/restore-points/recovery-picker'
import {recoveryCatalogInterval,recoveryCatalogUpdated} from '@/lib/restore-points/catalog-refresh'
import {catalogRequest} from './recovery-picker'

/** Warm the authenticated server cache without blocking the recovery activity grid. */
export function useRecoveryCatalog(sourceKey?:string){
  const [refreshing,setRefreshing]=useState(false),[error,setError]=useState('')
  const refreshRef=useRef<()=>Promise<void>>(async()=>{})
  useEffect(()=>{
    if(!sourceKey){setRefreshing(false);setError('');return}
    setError('')
    const controller=new AbortController()
    let pending:Promise<void>|undefined,queuedForce:Promise<void>|undefined,pendingForced=false,lastRead=0
    const update=(force=false):Promise<void>=>{
      if(controller.signal.aborted)return Promise.resolve()
      if(pending){
        if(!force||pendingForced)return pending
        // An explicit refresh must not silently become a cache read because the
        // initial warm-up happened to be in flight. Queue one forced scan.
        return queuedForce??=pending.then(()=>update(true)).finally(()=>{queuedForce=undefined})
      }
      pendingForced=force
      setRefreshing(true)
      pending=catalogRequest<GoalAvailability>(sourceKey,'machines','goals',force?{refresh:'true'}:{},controller.signal)
        .then(async result=>{
          // Each visited history gets its own request deadline. Refresh two at a
          // time rather than tying all restore-point I/O to the catalog scan.
          const targets=result.pointRefreshes||[]
          let cursor=0,incomplete=!result.complete
          await Promise.all(Array.from({length:Math.min(2,targets.length)},async()=>{
            while(cursor<targets.length&&!controller.signal.aborted){
              const target=targets[cursor++]
              try{
                const page=await catalogRequest(sourceKey,target.kind,'points',{objectId:target.objectId,
                  ...(target.backupId?{backupId:target.backupId}:{}),pointLimit:String(target.pointLimit),refresh:'true'},controller.signal)
                if(!page.complete)incomplete=true
              }catch{incomplete=true}
            }
          }))
          if(controller.signal.aborted)return
          lastRead=Date.now();setError(incomplete?'Some recovery options could not be refreshed.':'')
          if(force)window.dispatchEvent(new CustomEvent(recoveryCatalogUpdated,{detail:{sourceKey}}))
        }).catch(e=>{
          if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Request failed.')
        }).finally(()=>{pending=undefined;if(!controller.signal.aborted)setRefreshing(false)})
      return pending
    }
    refreshRef.current=()=>update(true)
    void update()
    // Keep refreshing even when the wizard is closed. Visibility catches up after
    // a suspended browser; there is never more than one scan for this page.
    const timer=window.setInterval(()=>{void update(true)},recoveryCatalogInterval)
    const visible=()=>{if(!document.hidden&&Date.now()-lastRead>=recoveryCatalogInterval)void update(true)}
    document.addEventListener('visibilitychange',visible)
    return()=>{controller.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);refreshRef.current=async()=>{}}
  },[sourceKey])
  return {refreshing,error,refresh:()=>refreshRef.current()}
}
