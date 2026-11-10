'use client'
// Open Backup UI v1.0.2
import {useEffect,useRef,useState} from 'react'
import {Boxes,Check,Folder,Monitor,Search,Server,X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {veeamApi} from '@/lib/api/veeam-client'
import {bulkKind,isRecoveryKind,pointOperations,type PickedVm,type PickerPage,type PickerScope,type RecoveryKind,type RecoveryObject,type RecoverySeed} from '@/lib/restore-points/recovery-picker'
import type {RestorePoint} from '@/lib/restore-points/model'
import {RecoverySignal} from '../restore-points/recovery-signal'
import {useRecoveryPresentation} from '../restore-points/use-presentation'
import styles from './launcher.module.css'
import {VmIdentity} from './vm-identity'
import {PointCalendar} from './point-calendar'

export type Selection={object:RecoveryObject;point?:RestorePoint;operation?:PickedVm['operation'];seed?:RecoverySeed}
export function catalogRequest<T>(sourceKey:string,kind:PickerScope,view:'goals'|'objects'|'points',args:Record<string,string>,signal?:AbortSignal){
  return veeamApi.getRecoveryPickerPage<T>(new URLSearchParams({sourceKey,kind,view,...args}),signal).then(page=>{
    if(page.sourceKey!==sourceKey)throw Error('The connected VBR source changed. Reopen this workflow.')
    return page
  })
}
export function suggestedOperation(point:RestorePoint,kind:RecoveryKind){
  const offered=pointOperations(point,kind)
  const local=point.platformName?.toLowerCase().replace('-','')
  const preferred=local==='hyperv'?(kind==='instant-vm'?'StartHvVMInstantRecovery':'StartEntireVmRestoreHyperV')
    :local==='clouddirector'?'StartEntireVmRestoreCloudDirector':kind==='instant-vm'?'StartViVMInstantRecovery':'StartEntireVmRestore'
  return offered.find(op=>op===preferred)||offered[0]
}
export function RecoveryPlatform({vm,kind,changeOperation}:{vm:Selection;kind:RecoveryKind;changeOperation:(op:PickedVm['operation'])=>void}){
  const {t,label}=useRecoveryPresentation()
  const point=vm.point,operations=point?pointOperations(point,kind):[]
  if(operations.length<2)return null
  return <label className={styles.field}>{t('Recovery platform')}<select value={vm.operation} onChange={e=>{const op=operations.find(v=>v===e.target.value);if(op)changeOperation(op)}}>
    {operations.map(op=><option key={op} value={op}>{label(op)}</option>)}</select></label>
}
export function RecoveryPicker({sourceKey,kind,chosen,setChosen}:{sourceKey:string;kind:PickerScope;chosen:Selection[];setChosen:(items:Selection[])=>void}){
  const {t,diagnostic,formatNumber,date,label}=useRecoveryPresentation()
  const [editing,setEditing]=useState<string>()
  const active=chosen.find(s=>s.object.objectId===editing)||chosen.find(s=>!s.point)||chosen[0]
  const [query,setQuery]=useState(''),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[page,setPage]=useState<PickerPage<RecoveryObject>>(),[error,setError]=useState('')
  const issuedRetry=useRef(0)
  useEffect(()=>{
    const controller=new AbortController();setError('');setPage(undefined)
    const timer=setTimeout(()=>{const refresh=retry!==issuedRetry.current;issuedRetry.current=retry
      catalogRequest<RecoveryObject>(sourceKey,kind,'objects',{query,offset:String(offset),limit:'40',...(refresh&&{refresh:'true'})},controller.signal)
      .then(next=>{if(!controller.signal.aborted)setPage(next)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)})},query?160:0)
    return()=>{clearTimeout(timer);controller.abort()}
  },[sourceKey,kind,query,offset,retry])
  const removed=(vm:Selection)=>setChosen(chosen.filter(s=>s.object.objectId!==vm.object.objectId))
  const batch=kind==='machines'||isRecoveryKind(kind)&&bulkKind(kind)
  const virtual=(vm:RecoveryObject)=>!vm.workloadType||vm.workloadType==='vm'
  const offPage=chosen.filter(s=>!page?.data.some(o=>o.objectId===s.object.objectId))
  return <div className={styles.picker} data-calendar={!!active}><section className={styles.listPane}><div className={styles.rowHead}><h3>{t('Workloads')}</h3>
    {batch&&page?.data.some(virtual)&&<span className={styles.notice}>{chosen.length?t('{count} selected',{count:formatNumber(chosen.length)}):t('Up to {count} VMs',{count:formatNumber(32)})}</span>}</div>
    <label className={styles.search}><Search size={15}/><input type="search" aria-label={t('Search workloads')} placeholder={t('Search workloads')} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0)}}/></label>
    {error?<p role="alert">{diagnostic(error)} <Button size="sm" variant="outline" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</Button></p>:!page?<RecoverySignal stage="data" compact/>:<>
      {page.notices.map(n=><p className={styles.notice} key={n}>{t(n)}</p>)}
      {!page.complete&&<Button size="sm" variant="outline" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</Button>}
      {!page.data.length&&page.complete&&<p className={styles.notice}>{query?t('No matches'):t('No eligible workloads were found.')}</p>}
      <div className={styles.vmList}>{page.data.map(vm=>{
        const id=vm.objectId,picked=chosen.find(v=>v.object.objectId===id)
        const Icon=vm.workloadType==='nas'?Folder:vm.workloadType==='object'?Boxes:vm.workloadType==='physical'?Server:Monitor
        return <div key={id} className={styles.workloadRow} data-focused={active?.object.objectId===id}>
          <button type="button" aria-pressed={!!picked} disabled={!picked&&batch&&(chosen.length>=32||chosen.length>1&&!virtual(vm))} onClick={()=>{
            setEditing(id)
            if(!picked)setChosen(batch&&virtual(vm)&&chosen.every(s=>virtual(s.object))?[...chosen,{object:vm}]:[{object:vm}])
          }}>
            <Icon size={17}/><span><strong>{vm.name}</strong><VmIdentity object={vm}/>
              <small>{picked?.point?date(picked.point.creationTime):[label(vm.platform),...new Set(vm.copies.map(c=>c.name))].filter(Boolean).join(' · ')}</small></span>
            {picked&&<Check size={15} aria-hidden="true"/>}</button>
          {picked&&batch&&<button className={styles.removeWorkload} type="button" aria-label={t('Remove {name}',{name:vm.name})} onClick={()=>removed(picked)}><X size={14}/></button>}
        </div>
      })}</div>
      {page.total>40&&<div className={styles.pager}><span>{t('{start}–{end} of {count}',{start:formatNumber(offset+1),end:formatNumber(offset+page.data.length),count:formatNumber(page.total)})}</span>
        <Button size="sm" variant="outline" disabled={!offset} onClick={()=>setOffset(offset-40)}>{t('Previous')}</Button><Button size="sm" variant="outline" disabled={offset+40>=page.total} onClick={()=>setOffset(offset+40)}>{t('Next')}</Button></div>}
      {!!offPage.length&&<div className={styles.offPage}><strong>{t('Selected workloads')}</strong>{offPage.map(vm=><div className={styles.rowHead} key={vm.object.objectId}>
        <button type="button" className={styles.link} onClick={()=>setEditing(vm.object.objectId)}>{vm.object.name}<VmIdentity object={vm.object}/></button>
        <button type="button" aria-label={t('Remove {name}',{name:vm.object.name})} onClick={()=>removed(vm)}><X size={14}/></button>
      </div>)}</div>}
    </>}</section>
    {active&&<div className={styles.calendarPane}><PointCalendar key={sourceKey+'/'+kind+'/'+active.object.objectId} object={active.object} selected={active.point} sourceKey={sourceKey} kind={kind}
      read={catalogRequest} choose={point=>{
        setEditing(active.object.objectId)
        setChosen(chosen.map(v=>v===active?{...v,point,operation:isRecoveryKind(kind)?suggestedOperation(point,kind):undefined}:v))
      }}/>
      {isRecoveryKind(kind)&&<RecoveryPlatform vm={active} kind={kind} changeOperation={operation=>setChosen(chosen.map(v=>v===active?{...v,operation}:v))}/>}
    </div>}
  </div>
}
