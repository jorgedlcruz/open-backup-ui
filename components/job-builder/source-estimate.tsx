'use client'
// Open Backup UI v1.3.0
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/components/providers/i18n-provider'
import { applicationRequest } from '@/lib/api/application-request'
import { formatBytes } from '@/lib/utils'
import type { Draft } from '@/lib/job-builder/model'
import type { SourceEstimate } from '@/lib/job-builder/rev3-validation'
import { message } from './resources'

export function SourceSizeEstimate({draft}:{draft:Draft}) {
  const {t}=useI18n()
  const [task,setTask]=useState<SourceEstimate|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>controller.current?.abort(),[])
  async function calculate(){
    if(controller.current)return
    const active=new AbortController()
    controller.current=active
    setTask(null);setError('');setBusy(true)
    try{
      let value=await applicationRequest<SourceEstimate>('/api/vbr/job-builder/rev3/estimate',{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(draft), signal:active.signal})
      while(!active.signal.aborted){
        setTask(value)
        if(value.state==='Stopped')break
        await new Promise<void>(resolve=>{
          const done=()=>{clearTimeout(timer);active.signal.removeEventListener('abort',done);resolve()}
          const timer=setTimeout(done,1500)
          active.signal.addEventListener('abort',done,{once:true})
        })
        active.signal.throwIfAborted()
        const params=new URLSearchParams({task:value.id,sourceKey:draft.sourceKey})
        value=await applicationRequest<SourceEstimate>('/api/vbr/job-builder/rev3/estimate?'+params,{signal:active.signal})
      }
    }catch(e){if(!active.signal.aborted)setError(message(e))}
    finally{if(!active.signal.aborted)setBusy(false);controller.current=null}
  }
  return <div className="space-y-2 pt-2">
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={calculate}>{t('Calculate protected size')}</Button>
    {task && <p role="status">{task.state==='Stopped' && task.result==='Success'
      ? formatBytes(task.totalSize)
      : task.state==='Stopped' ? t('Size calculation ended: {result}',{result:t(task.result)})
      : t('{count} of {total} calculated · {size} so far',{count:task.calculated,total:task.total,size:formatBytes(task.totalSize)})}</p>}
    {busy && !task && <p role="status">{t('Calculating protected size…')}</p>}{error&&<p role="alert">{error}</p>}
  </div>
}
