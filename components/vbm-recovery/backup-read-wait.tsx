'use client'
// Open Backup UI v1.3.0
import { useEffect, useState } from 'react'
import { DataLoading } from '@/components/ui/data-loading'
import { useI18n } from '@/components/providers/i18n-provider'
import css from './workspace.module.css'

export function BackupReadWait({label,initialLabel,limitMinutes}:{label:string;initialLabel?:string;limitMinutes?:number}) {
  const {t}=useI18n()
  const [seconds,setSeconds]=useState(0)
  useEffect(()=>{
    const start=performance.now()
    const timer=setInterval(()=>setSeconds(Math.floor((performance.now()-start)/1000)),1000)
    return ()=>clearInterval(timer)
  },[])
  const initial=!!initialLabel && seconds<3
  return <div className={`${css.explorerStateBody} mx-auto grid justify-items-center gap-2 text-center`}>
    <DataLoading compact status={initial ? initialLabel : label}/>
    {!initial&&<span className={css.sub} aria-live="off">{limitMinutes
      ? t('{elapsed} elapsed · {minutes} min limit',{elapsed:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,minutes:limitMinutes})
      : t('Elapsed: {seconds}s',{seconds})}</span>}
  </div>
}
