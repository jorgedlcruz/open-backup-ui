'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { veeamApi } from '@/lib/api/veeam-client'
import type { Snapshot } from '@/lib/protected-data/model'

export function useProtectedData() {
  const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState<string|null>(null),[recoveryError,setRecoveryError]=useState<string|null>(null)
  const [loading,setLoading]=useState(true),[recoveryLoading,setRecoveryLoading]=useState(false),[now,setNow]=useState(Date.now)
  const [request,setRequest]=useState({revision:0,force:false}),snapshot=useRef(data),pending=useRef(false)
  const refresh=useCallback(()=>setRequest(previous=>({revision:previous.revision+1,force:true})),[])
  useEffect(()=>{snapshot.current=data},[data])
  useEffect(()=>{
    const controller=new AbortController()
    pending.current=true;setLoading(true);setRecoveryLoading(false);setError(null);setRecoveryError(null)
    async function load() {
      try {
        const base=await veeamApi.getProtectedDataOperations(false,controller.signal,request.force)
        if(controller.signal.aborted)return
        setData(base);setNow(Date.now());setLoading(false)
        // Warm recovery evidence while the grid is usable. Switching views never starts a new inventory read.
        if(!base.recoveryTimesRequested) {
          setRecoveryLoading(true)
          try {
            const enriched=await veeamApi.getProtectedDataOperations(true,controller.signal)
            if(!controller.signal.aborted){setData(enriched);setNow(Date.now())}
          } catch(error) {
            if(!controller.signal.aborted)setRecoveryError(error instanceof Error ? error.message:'Recovery times could not be loaded.')
          }
        }
      } catch(error) {
        if(!controller.signal.aborted)setError(error instanceof Error ? error.message:'Protected data could not be loaded.')
      } finally {
        if(!controller.signal.aborted){pending.current=false;setLoading(false);setRecoveryLoading(false)}
      }
    }
    void load()
    return ()=>controller.abort()
  },[request])
  useEffect(()=>{
    const tick=()=>{
      if(document.hidden)return
      setNow(Date.now())
      const expires=Date.parse(snapshot.current?.cacheExpiresAt || '')
      if(!pending.current && Number.isFinite(expires) && expires<=Date.now())setRequest(previous=>({revision:previous.revision+1,force:false}))
    }
    const timer=setInterval(tick,60000)
    document.addEventListener('visibilitychange',tick)
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick)}
  },[])
  return {data,error,recoveryError,loading,recoveryLoading,now,refresh}
}
