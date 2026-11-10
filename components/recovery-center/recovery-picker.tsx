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
import {PointCalendar} from './point-calendar'

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
function PointChoice({vm,kind,active,edit,remove,changeOperation}:{vm:Selection;kind:RecoveryKind;active:boolean;edit:()=>void;remove:()=>void;changeOperation:(op:PickedVm['operation'])=>void}){
  const {t,date,label}=useRecoveryPresentation()
  const point=vm.point,operations=point?pointOperations(point,kind):[]
  return <article className={styles.chosen} data-active={active}><div className={styles.rowHead}><strong><Monitor size={15}/>{vm.object.name}</strong>
    <button type="button" onClick={remove} aria-label={t('Remove {name}',{name:vm.object.name})}><X size={15}/></button></div>
    <VmIdentity object={vm.object}/>
    {point&&<small>{date(point.creationTime)} · {vm.object.copies.find(c=>c.backupId===point.backupId)?.name||point.backupId}</small>}
    <button type="button" className={styles.link} aria-pressed={active} onClick={edit}>{point?t('Change restore point'):t('Select a restore point')}</button>
    {operations.length>1&&<label className={styles.field}>{t('Recovery platform')}<select value={vm.operation} onChange={e=>{const op=operations.find(v=>v===e.target.value);if(op)changeOperation(op)}}>
      {operations.map(op=><option key={op} value={op}>{label(op)}</option>)}</select></label>}
  </article>
}
export function RecoveryPicker({sourceKey,kind,chosen,setChosen}:{sourceKey:string;kind:RecoveryKind;chosen:Selection[];setChosen:(items:Selection[])=>void}){
  const {t,diagnostic,formatNumber}=useRecoveryPresentation()
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
  return <div className={styles.picker}><section className={styles.listPane}><h3>{t('Eligible virtual machines')}</h3>
    <label className={styles.search}><Search size={15}/><input type="search" aria-label={t('Search virtual machines')} placeholder={t('Search virtual machines')} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0)}}/></label>
    {error?<p role="alert">{diagnostic(error)} <Button size="sm" variant="outline" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</Button></p>:!page?<RecoverySignal stage="data" compact/>:<>
      {page.notices.map(n=><p className={styles.notice} key={n}>{t(n)}</p>)}
      {!page.complete&&<Button size="sm" variant="outline" onClick={()=>setRetry(n=>n+1)}>{t('Retry')}</Button>}
      {!page.data.length&&page.complete&&<p className={styles.notice}>{query?t('No matches'):t('No eligible virtual machines were found for this recovery.')}</p>}
      <div className={styles.vmList}>{page.data.map(vm=>{const id=vm.objectId,picked=chosen.some(v=>v.object.objectId===id)
        return <button type="button" key={id} aria-pressed={picked} disabled={!picked&&bulkKind(kind)&&chosen.length>=32} onClick={()=>{
          if(!picked)setEditing(id)
          setChosen(picked?chosen.filter(s=>s.object.objectId!==id):bulkKind(kind)?[...chosen,{object:vm}]:[{object:vm}])
        }}>
          <Monitor size={17}/><span><strong>{vm.name}</strong><VmIdentity object={vm}/><small>{[vm.platform,...new Set(vm.copies.map(c=>c.name))].filter(Boolean).join(' · ')}</small></span>{picked&&<Check size={15}/>}</button>})}</div>
      {page.total>40&&<div className={styles.pager}><span>{t('{start}–{end} of {count}',{start:formatNumber(offset+1),end:formatNumber(offset+page.data.length),count:formatNumber(page.total)})}</span>
        <Button size="sm" variant="outline" disabled={!offset} onClick={()=>setOffset(offset-40)}>{t('Previous')}</Button><Button size="sm" variant="outline" disabled={offset+40>=page.total} onClick={()=>setOffset(offset+40)}>{t('Next')}</Button></div>}
    </>}</section><section className={styles.selected}><h3>{t('Selected restore points')}</h3>
      {!chosen.length&&<p className={styles.notice}>{t('Choose a VM to see its restore points.')}</p>}
      {chosen.map(vm=><PointChoice key={vm.object.objectId} kind={kind} vm={vm} active={active===vm} edit={()=>setEditing(vm.object.objectId)}
        remove={()=>setChosen(chosen.filter(v=>v!==vm))} changeOperation={operation=>setChosen(chosen.map(v=>v===vm?{...v,operation}:v))}/>)}
    </section>
    {active&&<PointCalendar key={sourceKey+'/'+kind+'/'+active.object.objectId} object={active.object} selected={active.point} sourceKey={sourceKey} kind={kind}
      read={catalogRequest} choose={point=>{
        setEditing(active.object.objectId)
        setChosen(chosen.map(v=>v===active?{...v,point,operation:suggestedOperation(point,kind)}:v))
      }}/>}
  </div>
}
