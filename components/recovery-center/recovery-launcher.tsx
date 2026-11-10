'use client'
// Open Backup UI v1.0.2
import {Suspense,useEffect,useRef,useState} from 'react'
import {useRouter,useSearchParams} from 'next/navigation'
import {ArrowLeft,ArrowRight,Database,FolderOpen,FolderTree,HardDrive,MonitorPlay,RotateCcw,Server} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog'
import {isFlagged,type RestorePoint} from '@/lib/restore-points/model'
import type {RestoreLaunch} from '@/lib/restore-points/launch'
import {bulkKind,isRecoveryKind,recoveryKinds,recoveryKindLabel,type PickedVm,type RecoveryKind,type RecoveryObject,type RecoverySeed} from '@/lib/restore-points/recovery-picker'
import {ApplicationExplorerLaunch} from '../restore-points/active-directory-launch'
import {RestoreWorkflow} from '../restore-points/restore-workflow'
import {RecoverySignal} from '../restore-points/recovery-signal'
import {useRecoveryPresentation} from '../restore-points/use-presentation'
import {RecoveryPicker,catalogRequest,suggestedOperation,type Selection} from './recovery-picker'
import {BulkRecovery} from './bulk-recovery'
import {VmIdentity} from './vm-identity'
import styles from './launcher.module.css'

type LauncherProps={sourceKey?:string|null;onCreated?:()=>void;initialKind?:RecoveryKind;seeds?:RecoverySeed[]}
const icons={'instant-vm':MonitorPlay,'entire-vm':RotateCcw,'guest-files':FolderOpen,'active-directory':FolderTree,sql:Database,'instant-disk':HardDrive,'publish-disks':Server}
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
function urlSeeds(params:URLSearchParams){
  const seeds:RecoverySeed[]=[],objectId=params.get('objectId'),backupId=params.get('backupId')||undefined,restorePointId=params.get('restorePointId')||undefined
  if(objectId||backupId||restorePointId)seeds.push({objectId:objectId||'',backupId,restorePointId})
  for(const token of params.getAll('point')){
    const [objectId,backupId,restorePointId,...extra]=token.split('.')
    seeds.push(extra.length||!backupId||!restorePointId?{objectId:''}:{objectId,backupId,restorePointId})
  }
  return seeds
}
export function RecoveryLauncherButton(props:LauncherProps){
  return <Suspense fallback={null}><Launcher key={props.sourceKey||'offline'} {...props}/></Suspense>
}
function Launcher({sourceKey,onCreated,initialKind,seeds=[]}:LauncherProps){
  const {t}=useRecoveryPresentation(),router=useRouter(),query=useSearchParams()?.toString()||''
  const [opening,setOpening]=useState<{kind?:RecoveryKind;seeds:RecoverySeed[];mismatch?:boolean}>(),[locked,setLocked]=useState(false),handled=useRef('')
  useEffect(()=>{
    const params=new URLSearchParams(query),kind=params.get('recover')
    if(!sourceKey||!isRecoveryKind(kind)||handled.current===query)return
    handled.current=query
    const requested=urlSeeds(params),expected=params.get('sourceKey')
    const mismatch=expected?expected!==sourceKey:requested.length>0
    setOpening({kind,seeds:mismatch?[]:requested,mismatch})
  },[query,sourceKey])
  function close(){
    if(locked)return
    setOpening(undefined)
    const params=new URLSearchParams(query)
    if(params.has('recover')){
      for(const key of ['recover','objectId','backupId','restorePointId','sourceKey','point'])params.delete(key)
      handled.current=''
      router.replace(window.location.pathname+(params.size?'?'+params:''),{scroll:false})
    }
  }
  return <><Button type="button" disabled={!sourceKey} onClick={()=>setOpening({kind:initialKind,seeds})}><RotateCcw size={15}/>{t('Start recovery')}</Button>
    {opening&&sourceKey&&<Dialog open onOpenChange={v=>{if(!v)close()}}><DialogContent className={styles.dialog} onInteractOutside={e=>e.preventDefault()} onEscapeKeyDown={e=>{if(locked)e.preventDefault()}}>
      <LauncherContent sourceKey={sourceKey} opening={opening} onBusy={setLocked} onSingle={receipt=>{setOpening(undefined);onCreated?.();router.push('/vbr/recovery-center/preparing?'+new URLSearchParams({request:receipt.requestId}))}}
        onBatch={id=>{setOpening(undefined);onCreated?.();router.push('/vbr/recovery-center/batches/'+encodeURIComponent(id)+'?'+new URLSearchParams({sourceKey}))}}/>
    </DialogContent></Dialog>}</>
}
function LauncherContent({sourceKey,opening,onBusy,onSingle,onBatch}:{sourceKey:string;opening:{kind?:RecoveryKind;seeds:RecoverySeed[];mismatch?:boolean};
  onBusy:(busy:boolean)=>void;onSingle:(r:RestoreLaunch)=>void;onBatch:(id:string)=>void}){
  const {t,formatNumber,diagnostic,date}=useRecoveryPresentation()
  const [kind,setKind]=useState<RecoveryKind|undefined>(opening.kind),[stage,setStage]=useState<'type'|'vms'|'settings'>(opening.kind?'vms':'type')
  const [chosen,setChosen]=useState<Selection[]>([]),[loading,setLoading]=useState(Boolean(opening.seeds.length)),[notices,setNotices]=useState<string[]>([]),[unavailable,setUnavailable]=useState<string[]>([])
  useEffect(()=>{
    if(!opening.kind||!opening.seeds.length)return
    const ctrl=new AbortController(),initial=opening.kind
    async function seed(){
      const kept:Selection[]=[],omitted:string[]=[]
      const seen=new Set<string>()
      const cap=bulkKind(initial)?32:1
      const allowed=opening.seeds.slice(0,cap)
      let cursor=0
      await Promise.all(Array.from({length:Math.min(4,allowed.length)},async()=>{
        while(cursor<allowed.length&&!ctrl.signal.aborted){
          const index=cursor++,s=allowed[index]
          if(!uuid.test(s.objectId)||s.backupId&&!uuid.test(s.backupId)||s.restorePointId&&!uuid.test(s.restorePointId)||seen.has(s.objectId)){omitted.push(s.objectId);continue}
          seen.add(s.objectId)
          try{
            const identity={objectId:s.objectId,...(s.backupId&&{backupId:s.backupId})}
            const page=await catalogRequest<RecoveryObject>(sourceKey,initial,'objects',identity,ctrl.signal)
            const object=page.data.find(vm=>vm.objectId===s.objectId)
            if(!object){omitted.push(s.objectId);continue}
            if(!s.restorePointId){kept[index]={object};continue}
            const matches=await catalogRequest<RestorePoint>(sourceKey,initial,'points',{...identity,restorePointId:s.restorePointId},ctrl.signal)
            const point=matches.data.find(p=>p.id===s.restorePointId&&(!s.backupId||p.backupId===s.backupId))
            if(!point){omitted.push(object.name+' · '+s.restorePointId);kept[index]={object};continue}
            kept[index]={object,point,operation:suggestedOperation(point,initial)}
          }catch{if(!ctrl.signal.aborted)omitted.push(s.objectId)}
        }
      }))
      if(ctrl.signal.aborted)return
      setChosen(kept.filter(Boolean));setLoading(false)
      if(omitted.length||opening.seeds.length>cap){
        setNotices(['Some requested VMs or restore points are unavailable. Review the selection.'])
        setUnavailable([...new Set([...omitted,...opening.seeds.slice(cap).map(s=>s.objectId)].filter(Boolean))])
      }
    }
    void seed();return()=>ctrl.abort()
  },[sourceKey,opening])
  const selection=chosen.filter((item):item is PickedVm=>!!item.point&&(!!item.operation||kind==='sql'||kind==='active-directory'))
  const vm=selection[0]
  function chooseType(next:RecoveryKind){setKind(next);setChosen([]);setNotices([]);setUnavailable([]);setStage('vms')}
  return <><DialogHeader><DialogTitle>{stage==='type'?t('Start recovery'):kind?t(recoveryKindLabel[kind]):t('Start recovery')}</DialogTitle>
    <DialogDescription>{stage==='type'?t('Choose what to recover.'):stage==='vms'?(bulkKind(kind!)?t('Select up to 32 VMs and a restore point for each.'):t('Select a VM and restore point.')):
      chosen.length>1?t('{count} virtual machines',{count:formatNumber(chosen.length)}):[vm?.object.name,vm&&date(vm.point.creationTime)].filter(Boolean).join(' · ')}</DialogDescription>
      {stage==='settings'&&chosen.length===1&&vm&&<VmIdentity object={vm.object}/>}</DialogHeader>
    <div className={styles.body}>
      {stage==='type'?<div className={styles.kindGrid}>{recoveryKinds.map(k=>{const Icon=icons[k];return <button type="button" key={k} onClick={()=>chooseType(k)}><Icon size={21}/><strong>{t(recoveryKindLabel[k])}</strong><ArrowRight size={14}/></button>})}</div>:
        loading?<RecoverySignal stage="options"/>:stage==='vms'&&kind?<>{opening.mismatch&&<p role="alert" className={styles.warning}>{t('The connected VBR source changed. Reopen this workflow.')}</p>}
        {notices.map(n=><p key={n} role="alert" className={styles.warning}>{diagnostic(n)}</p>)}
        {!!unavailable.length&&<details className={styles.notice}><summary>{t('Details')}</summary><ul>{unavailable.map(v=><li key={v}>{v}</li>)}</ul></details>}
        <RecoveryPicker sourceKey={sourceKey} kind={kind} chosen={chosen} setChosen={setChosen}/>
        <div className={styles.actions}><Button variant="outline" onClick={()=>setStage('type')}><ArrowLeft size={14}/>{t('Recovery type')}</Button>
          <Button disabled={!selection.length||selection.length!==chosen.length} onClick={()=>setStage('settings')}>{t('Continue')}<ArrowRight size={14}/></Button></div>
        </>:stage==='settings'&&vm&&kind?selection.length>1&&bulkKind(kind)?<BulkRecovery sourceKey={sourceKey} vms={selection} onBack={()=>setStage('vms')} onBusy={onBusy} onAccepted={onBatch}/>:
          kind==='sql'||kind==='active-directory'?<ApplicationExplorerLaunch sql={kind==='sql'} point={vm.point} backupObjectId={vm.object.objectId} sourceKey={sourceKey} onBack={()=>setStage('vms')} onLaunch={onSingle}/>:
            vm.operation?<RestoreWorkflow point={vm.point} operation={vm.operation} sourceKey={sourceKey} flagged={isFlagged(vm.point.malwareStatus)} onBack={()=>setStage('vms')} onLaunch={onSingle}/>:null:null}
    </div></>
}
