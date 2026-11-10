'use client'
// Open Backup UI v1.0.2
import {useEffect,useRef,useState} from 'react'
import {Check,Monitor,Search,X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {veeamApi} from '@/lib/api/veeam-client'
import {bulkKind,pointOperations,type PickedVm,type PickerPage,type RecoveryKind,type RecoveryObject,type RecoverySeed} from '@/lib/restore-points/recovery-picker'
import type {RestorePoint} from '@/lib/restore-points/model'
import {RecoverySignal} from '../restore-points/recovery-signal'
import {useRecoveryPresentation} from '../restore-points/use-presentation'
import styles from './launcher.module.css'
import {VmIdentity} from './vm-identity'

export type Selection={object:RecoveryObject;point?:RestorePoint;operation?:PickedVm['operation'];seed?:RecoverySeed}
export function catalogRequest<T>(sourceKey:string,kind:RecoveryKind,view:'objects'|'points',args:Record<string,string>,signal?:AbortSignal){
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
function PointChoice({sourceKey,kind,vm,select,remove}:{sourceKey:string;kind:RecoveryKind;vm:Selection;select:(point:RestorePoint,operation?:PickedVm['operation'])=>void;remove:()=>void}){
  const {t,label,date,diagnostic}=useRecoveryPresentation()
  const limit=40
  const [retry,setRetry]=useState(0),[data,setData]=useState<PickerPage<RestorePoint>>(),[error,setError]=useState('')
  const objectId=vm.object.objectId
  useEffect(()=>{
    const controller=new AbortController()
    setError('');setData(undefined)
    catalogRequest<RestorePoint>(sourceKey,kind,'points',{objectId,limit:String(limit),...(retry>0&&{refresh:'true'})},controller.signal)
      .then(next=>{if(!controller.signal.aborted)setData(next)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)})
    return ()=>controller.abort()
  },[sourceKey,kind,objectId,limit,retry])
  const options=data?.data||[],selected=vm.point
  const points=selected&&!options.some(p=>p.id===selected.id)?[selected,...options]:options
  const operations=selected?pointOperations(selected,kind):[]
  return <article className={styles.chosen}><div className={styles.rowHead}><strong><Monitor size={15}/>{vm.object.name}</strong>
    <button type="button" onClick={remove} aria-label={t('Remove {name}',{name:vm.object.name})}><X size={15}/></button></div>
    <VmIdentity object={vm.object}/>
    {error?<p role="alert">{diagnostic(error)} <Button variant="outline" size="sm" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</Button></p>:!data?<RecoverySignal stage="data" compact/>:
      !points.length?<p role="status">{data.complete?t('No eligible restore points for this VM.'):t('The restore-point list is partial.')}</p>:<>
        <label className={styles.field}>{t('Restore point')}<select value={selected?.id||''} onChange={e=>{const point=points.find(p=>p.id===e.target.value);if(point)select(point,suggestedOperation(point,kind))}}>
          <option value="" disabled>{t('Select a restore point')}</option>
          {points.map(point=><option value={point.id} key={point.id}>{date(point.creationTime)} · {label(point.type||'Unknown')} · {vm.object.copies.find(c=>c.backupId===point.backupId)?.name||point.backupId}</option>)}</select></label>
        {operations.length>1&&<label className={styles.field}>{t('Recovery platform')}<select value={vm.operation} onChange={e=>{const op=operations.find(v=>v===e.target.value);if(selected&&op)select(selected,op)}}>
          {operations.map(op=><option key={op} value={op}>{label(op)}</option>)}</select></label>}
        {data.total>limit&&<PointPages sourceKey={sourceKey} kind={kind} objectId={objectId} choose={point=>select(point,suggestedOperation(point,kind))} name={vm.object.name}/>}
      </>}
    {data&&!data.complete&&<div>{!!points.length&&<small>{t('The restore-point list is partial.')} </small>}<Button size="sm" variant="outline" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</Button></div>}
  </article>
}
function PointPages({sourceKey,kind,objectId,choose,name}:{sourceKey:string;kind:RecoveryKind;objectId:string;choose:(p:RestorePoint)=>void;name:string}){
  const {t,date,diagnostic}=useRecoveryPresentation()
  const [offset,setOffset]=useState<number>(),[page,setPage]=useState<PickerPage<RestorePoint>>(),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  useEffect(()=>{if(offset==null)return;const ctrl=new AbortController();setPage(undefined);setError('')
    catalogRequest<RestorePoint>(sourceKey,kind,'points',{objectId,offset:String(offset),limit:'40',...(retry>0&&{refresh:'true'})},ctrl.signal)
      .then(data=>{if(!ctrl.signal.aborted)setPage(data)}).catch(e=>{if(!ctrl.signal.aborted)setError(e.message)})
    return()=>ctrl.abort()
  },[sourceKey,kind,objectId,offset,retry])
  if(offset==null)return <button type="button" className={styles.link} onClick={()=>setOffset(40)}>{t('Browse older points')}</button>
  return <div className={styles.older}><label className={styles.field}>{t('Older restore points')}<select aria-label={t('Older restore points')+' · '+name} value="" disabled={!page} onChange={e=>{
    const p=page?.data.find(row=>row.id===e.target.value);if(p){choose(p);setOffset(undefined)}}}><option value="">{t('Select a restore point')}</option>
    {page?.data.map(p=><option key={p.id} value={p.id}>{date(p.creationTime)} · {p.type} · {p.backupId}</option>)}</select></label>
    {error&&<p role="alert">{diagnostic(error)} <button type="button" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</button></p>}
    <div className={styles.pager}><Button size="sm" variant="outline" onClick={()=>setOffset(offset===40?undefined:offset-40)}>{t('Previous')}</Button>
      <Button size="sm" variant="outline" disabled={!page||offset+40>=page.total} onClick={()=>setOffset(offset+40)}>{t('Next')}</Button></div></div>
}
export function RecoveryPicker({sourceKey,kind,chosen,setChosen}:{sourceKey:string;kind:RecoveryKind;chosen:Selection[];setChosen:(items:Selection[])=>void}){
  const {t,diagnostic,formatNumber}=useRecoveryPresentation()
  const [query,setQuery]=useState(''),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[page,setPage]=useState<PickerPage<RecoveryObject>>(),[error,setError]=useState('')
  const issuedRetry=useRef(0)
  useEffect(()=>{
    const controller=new AbortController();setError('');setPage(undefined)
    const timer=setTimeout(()=>{const refresh=retry!==issuedRetry.current;issuedRetry.current=retry
      catalogRequest<RecoveryObject>(sourceKey,kind,'objects',{query,offset:String(offset),limit:'40',...(refresh&&{refresh:'true'})},controller.signal)
      .then(next=>{if(!controller.signal.aborted)setPage(next)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)})},query?160:0)
    return()=>{clearTimeout(timer);controller.abort()}
  },[sourceKey,kind,query,offset,retry])
  return <div className={styles.picker}><section className={styles.listPane}><h3>{t('Eligible virtual machines')}</h3>
    <label className={styles.search}><Search size={15}/><input type="search" aria-label={t('Search virtual machines')} placeholder={t('Search virtual machines')} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0)}}/></label>
    {error?<p role="alert">{diagnostic(error)} <Button size="sm" variant="outline" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</Button></p>:!page?<RecoverySignal stage="data" compact/>:<>
      {page.notices.map(n=><p className={styles.notice} key={n}>{t(n)}</p>)}
      {!page.complete&&<Button size="sm" variant="outline" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</Button>}
      {!page.data.length&&page.complete&&<p className={styles.notice}>{query?t('No matches'):t('No eligible virtual machines were found for this recovery.')}</p>}
      <div className={styles.vmList}>{page.data.map(vm=>{const id=vm.objectId,picked=chosen.some(v=>v.object.objectId===id)
        return <button type="button" key={id} aria-pressed={picked} disabled={!picked&&bulkKind(kind)&&chosen.length>=32} onClick={()=>setChosen(picked?chosen.filter(s=>s.object.objectId!==id):bulkKind(kind)?[...chosen,{object:vm}]:[{object:vm}])}>
          <Monitor size={17}/><span><strong>{vm.name}</strong><VmIdentity object={vm}/><small>{[vm.platform,...new Set(vm.copies.map(c=>c.name))].filter(Boolean).join(' · ')}</small></span>{picked&&<Check size={15}/>}</button>})}</div>
      {page.total>40&&<div className={styles.pager}><span>{t('{start}–{end} of {count}',{start:formatNumber(offset+1),end:formatNumber(offset+page.data.length),count:formatNumber(page.total)})}</span>
        <Button size="sm" variant="outline" disabled={!offset} onClick={()=>setOffset(offset-40)}>{t('Previous')}</Button><Button size="sm" variant="outline" disabled={offset+40>=page.total} onClick={()=>setOffset(offset+40)}>{t('Next')}</Button></div>}
    </>}</section><section className={styles.selected}><h3>{t('Selected restore points')}</h3>
      {!chosen.length&&<p className={styles.notice}>{t('Choose a VM to see its restore points.')}</p>}
      {chosen.map(vm=><PointChoice key={vm.object.objectId} sourceKey={sourceKey} kind={kind} vm={vm} remove={()=>setChosen(chosen.filter(v=>v.object.objectId!==vm.object.objectId))}
        select={(point,operation)=>setChosen(chosen.map(v=>v.object.objectId===vm.object.objectId?{object:v.object,point,operation}:v))}/>)}
    </section></div>
}
