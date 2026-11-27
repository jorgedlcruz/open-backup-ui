'use client'
// Open Backup UI v1.3.0
import { useEffect,useState } from 'react'
import Link from 'next/link'
import { Activity,ArrowUpRight } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import { recoveryGet } from './client'
import css from './center.module.css'

type ActivitySummary={runningJobs:number;hasMore:boolean;checkedAt:string;sourceName:string}

/** This optional hint never blocks recovery or interprets unavailable activity as idle. */
export function SourceActivityNotice({sourceName}:{sourceName:string}) {
  const {t,formatNumber}=useI18n(),[activity,setActivity]=useState<ActivitySummary>()
  useEffect(()=>{
    setActivity(undefined)
    if(!sourceName)return
    let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,request:AbortController|undefined
    const read=async()=>{
      if(document.hidden){setActivity(undefined);timer=setTimeout(()=>void read(),60000);return}
      request=new AbortController()
      const timeout=setTimeout(()=>request?.abort(),12000)
      try {
        const value=await recoveryGet<ActivitySummary>({action:'activity'},request.signal)
        if(disposed)return
        const age=Date.now()-Date.parse(value.checkedAt)
        setActivity(value.sourceName===sourceName&&Number.isInteger(value.runningJobs)&&value.runningJobs>=0&&Number.isFinite(age)&&age>=-60000&&age<120000?value:undefined)
      }catch{if(!disposed)setActivity(undefined)}
      finally{clearTimeout(timeout);if(!disposed)timer=setTimeout(()=>void read(),60000)}
    }
    void read()
    return()=>{disposed=true;clearTimeout(timer);request?.abort()}
  },[sourceName])
  if(!activity?.runningJobs)return null
  const count=formatNumber(activity.runningJobs)+(activity.hasMore?'+':'')
  return <aside className={css.activityNotice} role="status">
    <Activity size={17} aria-hidden="true"/>
    <div><strong>{activity.runningJobs===1&&!activity.hasMore?t('A backup or backup copy job is running.'):t('{count} backup or backup copy jobs are running.',{count})}</strong><span>{t('Recovery shares resources with backup jobs. Browsing and stop requests may take longer while jobs are running.')}</span></div>
    <Link href="/vbm/jobs">{t('See Backup Jobs')}<ArrowUpRight size={13} aria-hidden="true"/></Link>
  </aside>
}
