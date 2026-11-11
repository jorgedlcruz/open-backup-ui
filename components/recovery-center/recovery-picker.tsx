'use client'
// Open Backup UI v1.2.0
import {useEffect,useMemo,useState} from 'react'
import {Boxes,Check,ChevronDown,Folder,ListFilter,Monitor,Search,Server,X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {veeamApi} from '@/lib/api/veeam-client'
import {bulkKind,isRecoveryKind,pointOperations,type PickedVm,type PickerPage,type PickerScope,type RecoveryKind,type RecoveryObject,type RecoverySeed} from '@/lib/restore-points/recovery-picker'
import type {RestorePoint} from '@/lib/restore-points/model'
import {matchesWorkloadType,searchableText,workloadFilters,workloadSearchText,type WorkloadFilter} from '@/lib/restore-points/workload-search'
import {readWorkloadIndex} from '@/lib/restore-points/workload-index'
import {RecoverySignal} from '../restore-points/recovery-signal'
import {useRecoveryPresentation} from '../restore-points/use-presentation'
import styles from './launcher.module.css'
import {VmIdentity} from './vm-identity'
import {PointCalendar} from './point-calendar'

export type Selection={object:RecoveryObject;point?:RestorePoint;operation?:PickedVm['operation'];seed?:RecoverySeed}
export function catalogRequest<T>(sourceKey:string,kind:PickerScope,view:'goals'|'objects'|'points'|'index',args:Record<string,string>,signal?:AbortSignal){
  return veeamApi.getRecoveryPickerPage<T>(new URLSearchParams({sourceKey,kind,view,...args}),signal).then(page=>{
    if(page.sourceKey!==sourceKey)throw Object.assign(Error('The connected VBR source changed. Reopen this workflow.'),{status:409})
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
  const [query,setQuery]=useState(''),[type,setType]=useState<WorkloadFilter>('all'),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0)
  const [page,setPage]=useState<PickerPage<RecoveryObject>>(),[finished,setFinished]=useState(false),[error,setError]=useState('')
  useEffect(()=>{
    const controller=new AbortController()
    const reset=()=>{setError('');setPage(undefined);setFinished(false)}
    reset()
    void readWorkloadIndex((args,signal)=>catalogRequest<RecoveryObject>(sourceKey,kind,'index',args,signal),
      controller.signal,retry>0,(index,done)=>{setPage(index);setFinished(done)},reset).catch(e=>{
      if(controller.signal.aborted)return
      if(e?.status===401||e?.status===403||e?.status===409)setPage(undefined)
      setError(e instanceof Error?e.message:'Request failed.')
    })
    return()=>controller.abort()
  },[sourceKey,kind,retry])
  const indexed=useMemo(()=>page?.data.map(object=>({object,text:workloadSearchText(object)}))||[],[page])
  const filtered=useMemo(()=>{
    const needle=searchableText(query)
    return indexed.filter(({object,text})=>matchesWorkloadType(object,type)&&text.includes(needle))
  },[indexed,query,type])
  const pageSize=40,first=Math.min(offset,Math.max(0,Math.floor((filtered.length-1)/pageSize)*pageSize))
  const visible=filtered.slice(first,first+pageSize).map(row=>row.object)
  const removed=(vm:Selection)=>setChosen(chosen.filter(s=>s.object.objectId!==vm.object.objectId))
  const batch=kind==='machines'||isRecoveryKind(kind)&&bulkKind(kind)
  const virtual=(vm:RecoveryObject)=>!vm.workloadType||vm.workloadType==='vm'
  const offPage=chosen.filter(s=>!visible.some(o=>o.objectId===s.object.objectId))
  return <div className={styles.picker} data-calendar={!!active}><section className={styles.listPane}><div className={styles.workloadHeading}>
    <div><h3>{t('Workloads')}</h3>{batch&&page?.data.some(virtual)&&<small className={styles.notice}>{chosen.length?t('{count} selected',{count:formatNumber(chosen.length)}):t('Up to {count} VMs',{count:formatNumber(32)})}</small>}</div>
    <label className={styles.typeFilter}><ListFilter size={15} aria-hidden="true"/>
      <select aria-label={t('Workload type')} value={type} onChange={e=>{setType(e.target.value as WorkloadFilter);setOffset(0)}}>
        {Object.entries(workloadFilters).map(([value,caption])=><option key={value} value={value}>{t(caption)}</option>)}
      </select><ChevronDown size={13} aria-hidden="true"/>
    </label></div>
    <label className={styles.search}><Search size={15}/><input type="search" aria-label={t('Search workloads')} placeholder={t('Search workloads')} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0)}}/></label>
    {error&&<p role="alert">{diagnostic(error)} <Button size="sm" variant="outline" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</Button></p>}
    {!page&&!error&&<RecoverySignal stage="data" compact/>}
    {page&&<>
      {page.notices.map(n=><p className={styles.notice} key={n}>{t(n)}</p>)}
      {!error&&!finished&&<span className={styles.notice} role="status">{t('Loading…')}</span>}
      {!error&&finished&&!page.complete&&<Button size="sm" variant="outline" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</Button>}
      {!filtered.length&&finished&&page.complete&&<p className={styles.notice} role="status">{query.trim()||type!=='all'?t('No matches'):t('No eligible workloads were found.')}</p>}
      <div className={styles.vmList}>{visible.map(vm=>{
        const id=vm.objectId,picked=chosen.find(v=>v.object.objectId===id)
        const Icon=vm.workloadType==='nas'?Folder:vm.workloadType==='object'?Boxes:vm.workloadType==='physical'?Server:Monitor
        return <div key={id} className={styles.workloadRow} data-workload-type={vm.workloadType||'vm'} data-focused={active?.object.objectId===id}>
          <button type="button" aria-pressed={!!picked} disabled={!picked&&batch&&(chosen.length>=32||chosen.length>1&&!virtual(vm))} onClick={()=>{
            setEditing(id)
            if(!picked)setChosen(batch&&virtual(vm)&&chosen.every(s=>virtual(s.object))?[...chosen,{object:vm}]:[{object:vm}])
          }}>
            <Icon size={17}/><span><strong>{vm.name}</strong><VmIdentity object={vm} showPath/>
              <small>{picked?.point?date(picked.point.creationTime):[label(vm.platform),...new Set(vm.copies.map(c=>c.name))].filter(Boolean).join(' · ')}</small></span>
            {picked&&<Check size={15} aria-hidden="true"/>}</button>
          {picked&&batch&&<button className={styles.removeWorkload} type="button" aria-label={t('Remove {name}',{name:vm.name})} onClick={()=>removed(picked)}><X size={14}/></button>}
        </div>
      })}</div>
      {filtered.length>pageSize&&<div className={styles.pager}><span>{t('{start}–{end} of {count}',{start:formatNumber(first+1),end:formatNumber(first+visible.length),count:formatNumber(filtered.length)})}</span>
        <Button size="sm" variant="outline" disabled={!first} onClick={()=>setOffset(first-pageSize)}>{t('Previous')}</Button><Button size="sm" variant="outline" disabled={first+pageSize>=filtered.length} onClick={()=>setOffset(first+pageSize)}>{t('Next')}</Button></div>}
      {!!offPage.length&&<div className={styles.offPage}><strong>{t('Selected workloads')}</strong>{offPage.map(vm=><div className={styles.rowHead} key={vm.object.objectId}>
        <button type="button" className={styles.link} onClick={()=>setEditing(vm.object.objectId)}>{vm.object.name}<VmIdentity object={vm.object}/></button>
        <button type="button" aria-label={t('Remove {name}',{name:vm.object.name})} onClick={()=>removed(vm)}><X size={14}/></button>
      </div>)}</div>}
    </>}</section>
    {active&&<section className={styles.calendarPane} aria-label={t('Restore point')}><div className={styles.restorePointHeading}><h3>{t('Restore point')}</h3></div><PointCalendar key={sourceKey+'/'+kind+'/'+active.object.objectId} object={active.object} selected={active.point} sourceKey={sourceKey} kind={kind}
      read={catalogRequest} choose={point=>{
        setEditing(active.object.objectId)
        setChosen(chosen.map(v=>v===active?{...v,point,operation:isRecoveryKind(kind)?suggestedOperation(point,kind):undefined}:v))
      }}/>
      {isRecoveryKind(kind)&&<RecoveryPlatform vm={active} kind={kind} changeOperation={operation=>setChosen(chosen.map(v=>v===active?{...v,operation}:v))}/>}
    </section>}
  </div>
}
