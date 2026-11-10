'use client'
// Open Backup UI v1.2.0
import {useEffect,useState} from 'react'
import {veeamApi} from '@/lib/api/veeam-client'
import {ApplicationRequestError} from '@/lib/api/application-request'
import type {loadRecoverySnapshot} from '@/lib/recovery-center/load'
import type {RecoveryBatchSummary,ExplorerRequestRow} from '@/lib/recovery-center/model'
import {canCheckExplorerLaunch,observeRestoreLaunch,recentRestoreLaunches,type RestoreLaunch} from '@/lib/restore-points/launch'

export type RecoveryFeedPage=Awaited<ReturnType<typeof loadRecoverySnapshot>>&{sourceName:string;sourceKey:string;batches:RecoveryBatchSummary[];explorerRequests?:ExplorerRequestRow[]}
export function useRecoveryFeed(revision:number,expectedSource?:string) {
  const [feed,setFeed]=useState<RecoveryFeedPage>()
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const [receipts,setReceipts]=useState<RestoreLaunch[]>([])
  useEffect(()=>{
    const controller=new AbortController()
    let running=false,timer:ReturnType<typeof setTimeout>
    async function refresh(){
      if(running||controller.signal.aborted)return
      running=true;setBusy(true)
      let accumulated:RecoveryFeedPage|undefined
      try{
        const get=(params:URLSearchParams)=>veeamApi.requestActivity<RecoveryFeedPage>('/api/vbr/recovery-center?'+params,{signal:controller.signal})
        let combined=await get(new URLSearchParams(expectedSource?{sourceKey:expectedSource}:undefined))
        if(controller.signal.aborted)return
        setError('')
        accumulated=combined
        const first=combined
        setFeed(previous=>previous?.sourceKey===first.sourceKey&&first.nextSkip!==null?previous:first)
        let skip=0
        while(combined.nextSkip!==null){
          if(combined.nextSkip<=skip)throw Error('Session history unavailable')
          skip=combined.nextSkip
          const page=await get(new URLSearchParams({skip:String(skip),before:combined.before,mode:combined.mode,sourceKey:combined.sourceKey}))
          if(controller.signal.aborted)return
          if(page.sourceKey!==combined.sourceKey||page.before!==combined.before)throw Error('The connected VBR source changed. Reopen this workflow.')
          combined={...combined,nextSkip:page.nextSkip,history:combined.history.concat(page.history),
            warnings:[...new Set([...combined.warnings,...page.warnings])]}
          accumulated=combined
        }
        setFeed(combined)
      }catch(err){if(!controller.signal.aborted){
        if(accumulated&&!(err instanceof ApplicationRequestError&&[401,403,409].includes(err.status))){
          setFeed({...accumulated,nextSkip:null,warnings:[...new Set([...accumulated.warnings,'Session history'])]})
        }else setFeed(undefined)
        setError(err instanceof Error?err.message:'Session history unavailable')
      }}
      finally{running=false;if(!controller.signal.aborted){setBusy(false);timer=setTimeout(()=>{if(!document.hidden)void refresh()},30000)}}
    }
    const visible=()=>{if(!document.hidden){clearTimeout(timer);void refresh()}}
    void refresh();document.addEventListener('visibilitychange',visible)
    return ()=>{controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}
  },[revision,expectedSource])
  useEffect(()=>{
    if(!feed?.sourceKey){setReceipts([]);return}
    const sourceKey=feed.sourceKey
    const read=()=>setReceipts(recentRestoreLaunches(sourceKey))
    read();window.addEventListener('restore-launch-change',read)
    for(const launch of recentRestoreLaunches(sourceKey)){
      if(!document.hidden&&canCheckExplorerLaunch(launch))void observeRestoreLaunch(launch.requestId)
    }
    return ()=>window.removeEventListener('restore-launch-change',read)
  },[feed?.sourceKey,feed?.before])
  return {feed:!expectedSource||feed?.sourceKey===expectedSource?feed:undefined,busy,error,receipts}
}
