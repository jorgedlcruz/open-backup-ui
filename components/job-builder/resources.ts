"use client"
import { useCallback,useEffect,useState } from 'react'
import { applicationRequest } from '@/lib/api/application-request'
import type { BuilderOptions } from '@/lib/job-builder/load'
import type { Profile,ProfileInput } from '@/lib/job-builder/model'

export const message=(error:unknown)=>error instanceof Error?error.message:'The request could not be completed.'
export function downloadJson(name:string,value:unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}))
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function useBuilderResources() {
  const [options,setOptions]=useState<BuilderOptions|null>(null),[profiles,setProfiles]=useState<Profile[]>([])
  const [error,setError]=useState(''),[profileError,setProfileError]=useState(''),[loading,setLoading]=useState(true),[version,setVersion]=useState(0)
  const refresh=useCallback(()=>setVersion(v=>v+1),[])
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setProfileError('')
    void (async()=>{
      const [environment,library]=await Promise.allSettled([
        applicationRequest<BuilderOptions>('/api/vbr/job-builder/options',{signal:controller.signal}),
        applicationRequest<{sourceKey:string;profiles:Profile[]}>('/api/vbr/job-builder/profiles',{signal:controller.signal}),
      ])
      if(controller.signal.aborted)return
      if(environment.status==='fulfilled') {
        setOptions(environment.value)
        if(library.status==='fulfilled'&&library.value.sourceKey===environment.value.sourceKey)setProfiles(library.value.profiles)
        else {setProfiles([]);setProfileError(library.status==='rejected'?message(library.reason):'The selected source changed. Refresh to load its profiles.')}
      } else {setOptions(null);setProfiles([]);setError(message(environment.reason))}
      setLoading(false)
    })()
    return ()=>controller.abort()
  },[version])
  async function saveProfile(input:ProfileInput,id?:string,revision?:number) {
    if(!options)throw new Error('Load a VBR source first.')
    const result=await applicationRequest<{profile:Profile}>('/api/vbr/job-builder/profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceKey:options.sourceKey,profile:input,...(id?{id,revision}:{})})})
    setProfiles(current=>[...current.filter(p=>p.id!==result.profile.id),result.profile]);return result.profile
  }
  return {options,profiles,error,profileError,loading,refresh,saveProfile}
}
