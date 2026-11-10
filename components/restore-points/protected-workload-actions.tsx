'use client'
// Open Backup UI v1.2.0
import {useEffect,useState} from 'react'
import Link from 'next/link'
import {ArrowUpRight,LoaderCircle} from 'lucide-react'
import {veeamApi} from '@/lib/api/veeam-client'
import {applicationRequest} from '@/lib/api/application-request'
import {eligibleMethods,recoveryGoals,recoveryKindLabel,isUnstructuredKind,type RecoveryKind,type RecoveryObject} from '@/lib/restore-points/recovery-picker'
import {recoveryPickerHref} from '@/lib/restore-points/recovery-selection'
import type {RestorePoint} from '@/lib/restore-points/model'
import {useRecoveryPresentation} from './use-presentation'
import styles from './workflow.module.css'
export function ProtectedWorkloadActions({sourceKey,point,objectId}:{sourceKey:string;point:RestorePoint;objectId:string}){
 const {t,diagnostic}=useRecoveryPresentation(),[kinds,setKinds]=useState<RecoveryKind[]>(),[error,setError]=useState('')
 useEffect(()=>{const c=new AbortController(),{backupId,id:restorePointId}=point
 async function load(){
  if(point.platformName==='UnstructuredData'){
   const result=await applicationRequest<{sourceKey:string;kinds:RecoveryKind[]}>('/api/vbr/restore/unstructured?'+new URLSearchParams({sourceKey,objectId,backupId,restorePointId}),{signal:c.signal})
   if(result.sourceKey!==sourceKey)throw Error('The connected VBR source changed. Reopen this workflow.')
   return result.kinds.filter(isUnstructuredKind)
  }
  const pages=await Promise.all(recoveryGoals.map(async kind=>{
    const params=new URLSearchParams({sourceKey,kind,view:'objects',objectId,backupId,limit:'1'})
    const objects=await veeamApi.getRecoveryPickerPage<RecoveryObject>(params,c.signal)
    const obj=objects.sourceKey===sourceKey&&objects.data.find(o=>o.workloadType==='physical'&&o.objectId===objectId)
    if(!obj)return []
    params.set('view','points');params.set('restorePointId',restorePointId)
    const points=await veeamApi.getRecoveryPickerPage<RestorePoint>(params,c.signal)
    const exact=points.sourceKey===sourceKey&&points.data.find(p=>p.id===restorePointId&&p.backupId===backupId)
    return exact?eligibleMethods(obj,exact,kind):[]
  }))
  return [...new Set(pages.flat())]
 }
 void load().then(k=>{if(!c.signal.aborted)setKinds(k)},e=>{if(!c.signal.aborted)setError(e.message)});return ()=>c.abort()},[sourceKey,objectId,point])
 return error?<p role="status">{diagnostic(error)}</p>:!kinds?<LoaderCircle className="animate-spin" aria-label={t('Loading…')}/>:!kinds.length?<p>{t('VBR reported no available operations.')}</p>:
 <ul className={styles.operations}>{kinds.map(k=><li key={k}><Link className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent" href={recoveryPickerHref(k,sourceKey,[{objectId,backupId:point.backupId,restorePointId:point.id}])}>{t(recoveryKindLabel[k])}<ArrowUpRight size={14}/></Link></li>)}</ul>
}
