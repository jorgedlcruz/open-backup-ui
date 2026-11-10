'use client'
// Open Backup UI v1.2.0
import {Suspense,useEffect,useRef,useState} from 'react'
import {useRouter,useSearchParams} from 'next/navigation'
import {ArrowLeft,ArrowRight,RotateCcw} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog'
import {isFlagged,type RestorePoint} from '@/lib/restore-points/model'
import {recoveryPreparingHref,type RestoreLaunch} from '@/lib/restore-points/launch'
import {bulkKind,eligibleMethods,goalLabel,isRecoveryKind,isUnstructuredKind,pointOperations,recoveryKindLabel,scopeKinds,type GoalAvailability,type PickedVm,type PickerScope,type RecoveryKind,type RecoveryObject,type RecoverySeed} from '@/lib/restore-points/recovery-picker'
import {ApplicationExplorerLaunch} from '../restore-points/active-directory-launch'
import {RestoreWorkflow} from '../restore-points/restore-workflow'
import {RecoverySignal} from '../restore-points/recovery-signal'
import {useRecoveryPresentation} from '../restore-points/use-presentation'
import {AgentVolumeRecoveryLaunch} from '../restore-points/agent-volume-recovery-launch'
import {UnstructuredRecoveryLaunch} from '../restore-points/unstructured-recovery-launch'
import {RecoveryPicker,RecoveryPlatform,catalogRequest,suggestedOperation,type Selection} from './recovery-picker'
import {BulkRecovery} from './bulk-recovery'
import {VmIdentity} from './vm-identity'
import {RecoveryGoals,RecoveryMethods} from './recovery-methods'
import styles from './launcher.module.css'

type LauncherProps={sourceKey?:string|null;onCreated?:()=>void;initialKind?:RecoveryKind;seeds?:RecoverySeed[]}
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
  const triggerRef=useRef<HTMLButtonElement>(null)
  useEffect(()=>{
    if(!sourceKey)return
    const controller=new AbortController()
    let lastRead=0
    const interval=5*60_000
    // Keep the server's scoped eligibility catalog warm while Recovery Center is visible.
    // Opening the wizard still authenticates the current user and source.
    const warm=()=>{
      if(document.visibilityState!=='visible'||Date.now()-lastRead<interval)return
      lastRead=Date.now()
      void catalogRequest<GoalAvailability>(sourceKey,'machines','goals',{},controller.signal).catch(()=>{})
    }
    warm()
    const timer=window.setInterval(warm,interval)
    document.addEventListener('visibilitychange',warm)
    return()=>{controller.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',warm)}
  },[sourceKey])
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
  return <><Button ref={triggerRef} type="button" disabled={!sourceKey} onClick={()=>setOpening({kind:initialKind,seeds})}><RotateCcw size={15}/>{t('Start recovery')}</Button>
    {opening&&sourceKey&&<Dialog open onOpenChange={v=>{if(!v)close()}}><DialogContent className={styles.dialog} onCloseAutoFocus={e=>{e.preventDefault();triggerRef.current?.focus({preventScroll:true})}} onInteractOutside={e=>e.preventDefault()} onEscapeKeyDown={e=>{if(locked)e.preventDefault()}}>
      <LauncherContent sourceKey={sourceKey} opening={opening} onBusy={setLocked} onSingle={receipt=>{setOpening(undefined);onCreated?.();router.push(recoveryPreparingHref(receipt))}}
        onBatch={id=>{setOpening(undefined);onCreated?.();router.push('/vbr/recovery-center/batches/'+encodeURIComponent(id)+'?'+new URLSearchParams({sourceKey}))}}/>
    </DialogContent></Dialog>}</>
}
function LauncherContent({sourceKey,opening,onBusy,onSingle,onBatch}:{sourceKey:string;opening:{kind?:RecoveryKind;seeds:RecoverySeed[];mismatch?:boolean};
  onBusy:(busy:boolean)=>void;onSingle:(r:RestoreLaunch)=>void;onBatch:(id:string)=>void}){
  const {t,formatNumber,diagnostic,date}=useRecoveryPresentation()
  const [scope,setScope]=useState<PickerScope|undefined>(opening.kind),[kind,setKind]=useState<RecoveryKind|undefined>(opening.kind)
  const [stage,setStage]=useState<'goals'|'application'|'workloads'|'method'|'platform'|'settings'>(opening.kind?'workloads':'goals')
  const [goal,setGoal]=useState<GoalAvailability>()
  const previousStage=useRef(stage),titleRef=useRef<HTMLHeadingElement>(null)
  useEffect(()=>{
    if(previousStage.current===stage)return
    previousStage.current=stage
    titleRef.current?.focus()
  },[stage])
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
      const exact=kept[0]
      if(!bulkKind(initial)&&opening.seeds.length===1&&opening.seeds[0].backupId&&opening.seeds[0].restorePointId&&
        !omitted.length&&exact?.point&&eligibleMethods(exact.object,exact.point,initial).includes(initial)){
        setStage(pointOperations(exact.point,initial).length>1?'platform':'settings')
      }
      if(omitted.length||opening.seeds.length>cap){
        setNotices(['Some requested VMs or restore points are unavailable. Review the selection.'])
        setUnavailable([...new Set([...omitted,...opening.seeds.slice(cap).map(s=>s.objectId)].filter(Boolean))])
      }
    }
    void seed();return()=>ctrl.abort()
  },[sourceKey,opening])
  const selection=chosen.filter((item):item is PickedVm=>!!item.point)
  const methods=scope&&selection.length&&selection.length===chosen.length?scopeKinds(scope).filter(k=>
    (selection.length===1||bulkKind(k)&&selection.every(item=>!item.object.workloadType||item.object.workloadType==='vm'))&&
    selection.every(item=>eligibleMethods(item.object,item.point,scope).includes(k))):[]
  const vm=selection[0]
  function openScope(value:PickerScope){
    if(scope!==value){setChosen([]);setNotices([]);setUnavailable([])}
    setScope(value);setKind(isRecoveryKind(value)?value:undefined);setStage('workloads')
  }
  function openGoal(group:GoalAvailability){
    setGoal(group)
    if(group.goal==='apps'&&group.kinds.length>1)setStage('application')
    else openScope(group.kinds.length===1?group.kinds[0]:group.goal)
  }
  const selectMethod=(next:RecoveryKind)=>{
    setKind(next)
    setChosen(chosen.map(item=>({...item,operation:scope===next&&item.operation?item.operation:suggestedOperation(item.point!,next)})))
    const needsPlatform=scope!==next&&selection.some(item=>pointOperations(item.point,next).length>1)
    setStage(needsPlatform?'platform':'settings')
  }
  const backFromSettings=()=>{
    if(scope!==kind&&kind&&selection.some(item=>pointOperations(item.point,kind).length>1))setStage('platform')
    else setStage(methods.length>1?'method':'workloads')
  }
  const back=(step:typeof stage)=><Button type="button" variant="outline" onClick={()=>setStage(step)}><ArrowLeft size={14}/>{t('Back')}</Button>
  const scopeTitle=scope?t(isRecoveryKind(scope)?recoveryKindLabel[scope]:goalLabel[scope]):t('Start recovery')
  return <><DialogHeader className={styles.methodHeader}><DialogTitle ref={titleRef} tabIndex={-1}>{
    stage==='goals'?t('What do you want to recover?'):stage==='application'?t('Application items'):stage==='method'?t('Choose a recovery method'):
    stage==='workloads'?scopeTitle:kind?t(recoveryKindLabel[kind]):scopeTitle}</DialogTitle>
    <DialogDescription className={stage==='goals'?'sr-only':undefined}>{stage==='goals'?t('Start recovery'):stage==='application'?t('Choose an application.'):
      stage==='workloads'?(scope&&isRecoveryKind(scope)&&bulkKind(scope)&&!goal?t('Select up to 32 VMs and a restore point for each.'):t('Select a workload and restore point.')):
      chosen.length>1?t('{count} virtual machines',{count:formatNumber(chosen.length)}):[vm?.object.name,vm&&date(vm.point.creationTime)].filter(Boolean).join(' · ')}</DialogDescription>
      {stage==='settings'&&chosen.length===1&&vm&&<VmIdentity object={vm.object}/>}</DialogHeader>
    <div className={styles.body}>
      {stage==='goals'?<RecoveryGoals sourceKey={sourceKey} onChoose={openGoal}/>:
        stage==='application'&&goal?<><RecoveryMethods kinds={goal.kinds} onChoose={openScope}/><div className={styles.actions}>{back('goals')}</div></>:
        loading?<RecoverySignal stage="options"/>:stage==='workloads'&&scope?<>{opening.mismatch&&<p role="alert" className={styles.warning}>{t('The connected VBR source changed. Reopen this workflow.')}</p>}
        {notices.map(n=><p key={n} role="alert" className={styles.warning}>{diagnostic(n)}</p>)}
        {!!unavailable.length&&<details className={styles.notice}><summary>{t('Details')}</summary><ul>{unavailable.map(v=><li key={v}>{v}</li>)}</ul></details>}
        <RecoveryPicker key={sourceKey+'/'+scope} sourceKey={sourceKey} kind={scope} chosen={chosen} setChosen={setChosen}/>
        {chosen.length>1&&selection.length===chosen.length&&!methods.length&&<p role="status" className={styles.notice}>{t('These restore points have no common recovery method. Change a point or remove a workload.')}</p>}
        <div className={styles.actions}>{back(goal?.goal==='apps'&&goal.kinds.length>1?'application':'goals')}
          <Button disabled={!methods.length} onClick={()=>methods.length===1?selectMethod(methods[0]):setStage('method')}>{t('Continue')}<ArrowRight size={14}/></Button></div>
        </>:stage==='method'?<><RecoveryMethods kinds={methods} onChoose={selectMethod}/><div className={styles.actions}>{back('workloads')}</div></>:
        stage==='platform'&&kind?<>{selection.filter(item=>pointOperations(item.point,kind).length>1).map(item=><div className={styles.chosen} key={item.object.objectId}><strong>{item.object.name}</strong><VmIdentity object={item.object}/>
          <RecoveryPlatform vm={item} kind={kind} changeOperation={operation=>setChosen(chosen.map(v=>v.object.objectId===item.object.objectId?{...v,operation}:v))}/></div>)}
          <div className={styles.actions}>{back(methods.length>1?'method':'workloads')}<Button onClick={()=>setStage('settings')}>{t('Continue')}<ArrowRight size={14}/></Button></div></>:
        stage==='settings'&&vm&&kind?selection.length>1&&bulkKind(kind)?<BulkRecovery sourceKey={sourceKey} vms={selection} onBack={backFromSettings} onBusy={onBusy} onAccepted={onBatch}/>:
          kind==='sql'||kind==='active-directory'?<ApplicationExplorerLaunch sql={kind==='sql'} point={vm.point} backupObjectId={vm.object.objectId} sourceKey={sourceKey} onBack={backFromSettings} onLaunch={onSingle}/>:
          isUnstructuredKind(kind)?<UnstructuredRecoveryLaunch kind={kind} point={vm.point} object={vm.object} sourceKey={sourceKey} onBack={backFromSettings} onLaunch={onSingle}/>:
          kind==='agent-volumes'?<AgentVolumeRecoveryLaunch kind={kind} point={vm.point} object={vm.object} sourceKey={sourceKey} onBack={backFromSettings} onLaunch={onSingle}/>:
            vm.operation?<RestoreWorkflow point={vm.point} operation={vm.operation} sourceKey={sourceKey} flagged={isFlagged(vm.point.malwareStatus)} onBack={backFromSettings} onLaunch={onSingle}/>:null:null}
    </div></>
}
