'use client'
// Open Backup UI v1.2.0
import {useEffect,useMemo,useRef,useState} from 'react'
import Link from 'next/link'
import {ArrowLeft,ChevronRight,Monitor,RefreshCw} from 'lucide-react'
import {veeamApi} from '@/lib/api/veeam-client'
import {recoveryCenterPath,sessionHref} from '@/lib/navigation/recovery'
import {recoveryRows} from '@/lib/recovery-center/model'
import type {BatchReceipt} from '@/lib/restore-points/batch'
import {useRecoveryPresentation} from '@/components/restore-points/use-presentation'
import {Button} from '@/components/ui/button'
import {DataLoading} from '@/components/ui/data-loading'
import {useRecoveryFeed} from './use-recovery-feed'
import ops from '@/components/operations/operations.module.css'
import css from './recovery-center.module.css'

export function RecoveryGroup({sourceKey,id}:{sourceKey:string;id:string}) {
  const {t,date,diagnostic,label,formatNumber}=useRecoveryPresentation()
  const [revision,refresh]=useState(0),[batch,setBatch]=useState<BatchReceipt>(),[readError,setReadError]=useState('')
  const [resuming,setResuming]=useState(false),[resumeError,setResumeError]=useState('')
  const resumingRef=useRef(false)
  const {feed,error:feedError}=useRecoveryFeed(revision,sourceKey)
  useEffect(()=>{
    let active=true,reading=false,timer:ReturnType<typeof setTimeout>
    async function read(){
      if(!active||reading)return
      reading=true
      let pollDelay=15000
      try{
        const next=await veeamApi.getRestoreBatch(sourceKey,id)
        if(!active)return
        if(next.sourceKey!==sourceKey||next.id!==id)throw Error('The connected VBR source changed. Reopen this workflow.')
        setBatch(next);setReadError('')
        if(next.items.some(item=>item.status==='queued'||item.status==='submitting'))pollDelay=2500
        else if(!next.items.some(item=>item.status==='notStarted'))pollDelay=0
      }catch(err){if(active){setReadError(err instanceof Error?err.message:'Request failed.');setBatch(undefined)}}
      finally {
        reading=false
        if(active&&pollDelay)timer=setTimeout(()=>{if(!document.hidden)void read()},pollDelay)
      }
    }
    const visible=()=>{if(!document.hidden){clearTimeout(timer);void read()}}
    void read()
    document.addEventListener('visibilitychange',visible)
    return ()=>{active=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}
  },[sourceKey,id,revision])

  const native=useMemo(()=>{
    const rows=feed?recoveryRows(sourceKey,feed.history,feed.mounts,[],[]):[]
    return new Map(rows.flatMap(row=>row.sessionId?[[row.sessionId.toLowerCase(),row] as const]:[]))
  },[feed,sourceKey])
  async function resume() {
    if(resumingRef.current||!batch||readError)return
    resumingRef.current=true;setResuming(true);setResumeError('')
    try{await veeamApi.resumeRestoreBatch(sourceKey,id)}
    catch(err){setResumeError(err instanceof Error?err.message:'Request failed.')}
    finally{refresh(v=>v+1);resumingRef.current=false;setResuming(false)}
  }
  const pending=batch?.items.some(item=>item.status==='notStarted')
  const localRows=batch?recoveryRows(sourceKey,[],[],[batch],[]):[]
  return <main className={ops.console}>
    <Link href={recoveryCenterPath} className="inline-flex items-center gap-2 text-sm text-primary mb-4"><ArrowLeft size={15}/>{t('Recovery Center')}</Link>
    <header className={ops.header+' '+css.header}><div><h1>{batch?t(batch.kind==='instant'?'Instant VM Recovery':'Entire VM restore'):t('VM recovery group')}</h1>
      {batch&&<p className={css.source}>{t('Mass recovery')} · {date(batch.createdAt)}</p>}</div>
      <div className={css.headerActions}><Button variant="outline" size="sm" onClick={()=>refresh(v=>v+1)}><RefreshCw size={15}/>{t('Refresh')}</Button>
        {pending&&<Button size="sm" disabled={resuming||!!readError} onClick={()=>void resume()}>{t('Continue unsubmitted VMs')}</Button>}</div>
    </header>
    {(readError||resumeError||feedError)&&<p role="alert" className={ops.notice}>{diagnostic(readError||resumeError||feedError)}</p>}
    {batch?<section className={ops.panel} aria-label={t('Virtual machines')}>
      <div className={css.panelHead+' '+css.groupHeading}><h2>{t('Virtual machines')} · {formatNumber(batch.items.length)}</h2></div>
      <div className={ops.tableScroll}><table className={ops.table+' '+css.table}><thead><tr>
        {[t('Virtual machine'),t('Destination'),t('Status'),t('Progress'),t('Session')].map(text=><th key={text}>{text}</th>)}
      </tr></thead><tbody>{batch.items.map((item,index)=>{
        const row=item.sessionId?native.get(item.sessionId.toLowerCase()):undefined
        const receiptRow=localRows.find(entry=>entry.key==='batch/'+id+'/'+index)
        const state=row?.state||receiptRow?.state||'Not reported'
        const href=item.sessionId&&(row?.href||sessionHref(recoveryCenterPath,item.sessionId,sourceKey))
        const placement=[item.targetHost,item.targetFolder,item.targetDatastore,item.storagePath].filter(Boolean).join(' · ')
        return <tr key={item.objectId}><td><div className={css.identity}><span className={css.workload}><Monitor size={16}/></span>
          <div><strong>{item.name}</strong>{item.pointTime&&<small>{date(item.pointTime)}</small>}</div></div></td><td>{item.targetName||item.name}<small className="block text-muted-foreground">{t(item.mode==='Customized'?'New location':'Original location')}</small>
            {placement&&<small className="block text-muted-foreground">{placement}</small>}
            {item.writeCacheDatastore&&<small className="block text-muted-foreground">{t('Write cache datastore')} · {item.writeCacheDatastore}</small>}</td>
          <td><span className={css.badge} data-tone={row?.category||receiptRow?.category}><i aria-hidden/>{row?label(state):t(state)}</span>
            {item.message&&<small className="block max-w-sm mt-1 text-muted-foreground">{diagnostic(item.message)}</small>}</td>
          <td>{row?.category==='active'&&row.progress!=null?<span className={css.progress}><progress value={row.progress} max={100} aria-label={t('Progress')}/>{formatNumber(row.progress/100,{style:'percent'})}</span>:'—'}</td>
          <td>{href?<Link href={href} prefetch={false} className="inline-flex items-center gap-1 text-primary whitespace-nowrap">{t('Open session')}<ChevronRight size={14}/></Link>:'—'}</td></tr>
      })}</tbody></table></div>
    </section>:!readError&&<DataLoading status={t('Loading recovery history…')} compact/>}
  </main>
}
