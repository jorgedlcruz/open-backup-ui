'use client'
// Open Backup UI v1.3.0
import { createContext,useContext,useEffect,useState,type ReactNode } from 'react'
import { applicationRequest } from '@/lib/api/application-request'
import { useI18n } from '@/components/providers/i18n-provider'
import { isRecord,type NativeRecord } from '@/lib/job-builder/rev3-form'
import s from './builder.module.css'

type Options={hosts:string[];repositories:{id:string;name:string}[]}
type Rows={data:NativeRecord[];nextOffset:number|null}
type Selection={options?:Options;platform:string;sourceKey:string;error:string}
const Context=createContext<Selection|null>(null)
export const usePlatformOptions=()=>useContext(Context)
const endpoint='/api/vbr/job-builder/rev3/inventory?'
export function PlatformOptions({children,platform,sourceKey}:{children:ReactNode;platform?:string;sourceKey:string}){
  const [options,setOptions]=useState<Options>(),[error,setError]=useState('')
  useEffect(()=>{
    if(!platform)return
    const controller=new AbortController()
    applicationRequest<Options>(endpoint+new URLSearchParams({platform,sourceKey}),{signal:controller.signal})
      .then(o=>{if(!controller.signal.aborted)setOptions(o)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)})
    return ()=>controller.abort()
  },[platform,sourceKey])
  return <Context.Provider value={platform?{platform,sourceKey,options,error}:null}>{children}</Context.Provider>
}
function objectKey(v:NativeRecord){return JSON.stringify([v.platform,v.clusterId,v.domainId,v.projectId,v.type,v.objectId])}
export function PlatformObjects({label,value,onChange}:{label:string;value:unknown;onChange:(value:unknown)=>void}){
  const {t}=useI18n(),{platform,sourceKey,options,error}=usePlatformOptions()!
  const [selectedHost,setSelectedHost]=useState(''),[rows,setRows]=useState<NativeRecord[]>([]),[skip,setSkip]=useState(0),
    [more,setMore]=useState<number|null>(null),[problem,setProblem]=useState(''),[busy,setBusy]=useState(false)
  const host=selectedHost||options?.hosts[0]
  const selected=Array.isArray(value)?value.filter(isRecord):[]
  useEffect(()=>{
    if(!host)return
    const controller=new AbortController()
    setBusy(true);setProblem('')
    const params=new URLSearchParams({platform,sourceKey,host,skip:String(skip)})
    applicationRequest<Rows>(endpoint+params,{signal:controller.signal}).then(page=>{
      if(controller.signal.aborted)return
      setRows(previous=>[...new Map([...(skip?previous:[]),...page.data].map(v=>[objectKey(v),v])).values()])
      setMore(page.nextOffset)
    }).catch(e=>{if(!controller.signal.aborted)setProblem(e.message)}).finally(()=>{if(!controller.signal.aborted)setBusy(false)})
    return ()=>controller.abort()
  },[host,skip,platform,sourceKey])
  return <fieldset className="grid gap-3 rounded-lg border p-3"><legend className="px-1">{label}</legend>
    {selected.map(item=><button className={s.link} type="button" key={objectKey(item)}
      onClick={()=>onChange(selected.filter(v=>objectKey(v)!==objectKey(item)))}>{t('Remove')} · {String(item.name)}</button>)}
    <label className={s.field}>{t('Inventory server')}<select value={host||''} onChange={e=>{setSelectedHost(e.target.value);setSkip(0);setRows([]);setMore(null)}}>
      {options?.hosts.map(h=><option key={h}>{h}</option>)}</select></label>
    {rows.length>0&&<div className="max-h-64 overflow-auto">{rows.map(item=><label key={objectKey(item)} className="flex items-center gap-2 p-1 text-sm">
      <input type="checkbox" checked={selected.some(v=>objectKey(v)===objectKey(item))} onChange={e=>onChange(e.target.checked?[...selected,item]:selected.filter(v=>objectKey(v)!==objectKey(item)))}/>
      {String(item.name)} · {String(item.type)}</label>)}</div>}
    {busy&&<span role="status">{t('Loading…')}</span>}
    {more!==null&&<button type="button" className={s.button} disabled={busy} onClick={()=>setSkip(more)}>{t('Load more items')}</button>}
    {(problem||error)&&<p role="alert">{problem||error}</p>}
    {options&&!host&&!error&&<p>{t('No inventory servers found for this platform.')}</p>}
  </fieldset>
}
