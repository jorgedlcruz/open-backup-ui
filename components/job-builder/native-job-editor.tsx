'use client'
// Open Backup UI v1.3.0
import { useEffect,useRef,useState } from 'react'
import Link from 'next/link'
import { useI18n } from '@/components/providers/i18n-provider'
import { DataLoading } from '@/components/ui/data-loading'
import { applicationRequest,ApplicationRequestError } from '@/lib/api/application-request'
import { type NativeJobType,nativeJobNames } from '@/lib/job-builder/native-job-types'
import { jobDefinition,initialField,isRecord,type NativeRecord } from '@/lib/job-builder/rev3-form'
import { NativeField } from './native-fields'
import { PlatformOptions } from './platform-options'
import s from './builder.module.css'

type Setup={revision:string;sourceName:string;sourceKey:string;job?:NativeRecord;version?:string}
const path='/api/vbr/job-builder/rev3'
export function NativeJobEditor({type,jobId}:{type:NativeJobType;jobId?:string}){
  const {t}=useI18n()
  const [setup,setSetup]=useState<Setup>(),[data,setData]=useState<NativeRecord>(),[error,setError]=useState(''),
    [review,setReview]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[saved,setSaved]=useState('')
  const lock=useRef(false)
  const definition=jobDefinition(type,!!jobId)
  const preferred=type==='RedHatOpenStackBackupJob'?'RedHatOpenStack':type==='VirtuozzoBackupJob'?'Virtuozzo':undefined
  useEffect(()=>{
    const controller=new AbortController()
    const params=new URLSearchParams({type,...(jobId?{id:jobId}:{})})
    applicationRequest<Setup>(path+'?'+params,{signal:controller.signal}).then(value=>{
      if(controller.signal.aborted)return
      setSetup(value)
      const initial=value.job || initialField(jobDefinition(type,false),preferred)
      if(isRecord(initial))setData(initial)
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message)})
    return ()=>controller.abort()
  },[type,jobId,preferred])
  async function submit(){
    if(!setup||!data||lock.current||uncertain||saved)return
    const action=review?'save':'validate'
    lock.current=true;setBusy(true);setError('')
    try{
      const result=await applicationRequest<{id?:string}>(path,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,type,sourceKey:setup.sourceKey,id:jobId,version:setup.version,job:data})})
      if(review){if(!result.id)throw new Error('VBR returned no confirmed job identity.');setSaved(result.id)}
      else setReview(true)
    }catch(e){
      if(action==='save' && (!(e instanceof ApplicationRequestError) || e.kind==='network' || !e.status || e.status>=500))setUncertain(true)
      setError(e instanceof Error?e.message:String(e))
    }finally{setBusy(false);lock.current=false}
  }
  return <main className={s.page}><Link href="/vbr/jobs" className={s.link}>{t('Jobs & policies')}</Link>
    <header className={s.header}><div><h1>{t(nativeJobNames[type])}</h1>{setup&&<p>{setup.sourceName} · {setup.revision}</p>}</div></header>
    {error&&<p className={s.notice} role="alert">{error}</p>}
    {!setup&&!error&&<DataLoading status={t('Loading job settings…')}/>}
    {saved?<Link className={s.button} href={'/vbr/jobs/'+saved}>{t('View job')}</Link>:
    data&&<section className={s.panel}><div className={s.panelHead}><h2>{review?t('Review'):t('Job settings')}</h2></div>
      <div className={s.panelBody}>{review?<pre className={s.code}>{JSON.stringify(data,null,2)}</pre>:
      <PlatformOptions platform={preferred} sourceKey={setup!.sourceKey}><NativeField name="Job settings" schema={{...definition,properties:Object.fromEntries(Object.entries(definition.properties||{}).filter(([k])=>k!=='id'&&k!=='type'))}}
        value={data} onChange={v=>{if(isRecord(v))setData(v);setError('')}} preferred={preferred}/></PlatformOptions>}
      {uncertain&&<Link className={s.link} href="/vbr/jobs">{t('Check Jobs & Policies before trying again.')}</Link>}
      <div className={s.saveBar}>
        {review&&<button className={s.button} disabled={busy||uncertain} onClick={()=>setReview(false)}>{t('Back')}</button>}
        <button className={s.primary} disabled={busy||uncertain} onClick={submit}>
          {busy?t('Working…'):review?(jobId?t('Save changes'):t('Create Backup Job')):t('Check selections')}</button>
      </div></div></section>}
  </main>
}
