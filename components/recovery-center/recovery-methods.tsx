'use client'
// Open Backup UI v1.0.2
import {useEffect,useId,useState} from 'react'
import {ChevronRight,Database,FolderOpen,HardDrive,Monitor} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {goalLabel,recoveryKindLabel,type GoalAvailability,type PickerPage,type RecoveryKind} from '@/lib/restore-points/recovery-picker'
import {RecoverySignal} from '../restore-points/recovery-signal'
import {useRecoveryPresentation} from '../restore-points/use-presentation'
import {catalogRequest} from './recovery-picker'
import {RecoveryKindArt} from './recovery-kind-art'
import styles from './launcher.module.css'

const goalIcons={machines:Monitor,files:FolderOpen,apps:Database,disks:HardDrive}
const methodDescription:Partial<Record<RecoveryKind,string>>={
  'instant-vm':'Run a VM directly from backup.', 'entire-vm':'Restore the VM, its disks, and its configuration.',
  'guest-files':'Browse and recover individual files and folders.', 'instant-disk':'Mount a backed-up disk as a vSphere First Class Disk.',
  'publish-disks':'Expose backup disks through a mount server.', sql:'Recover databases from a SQL Server instance.',
  'active-directory':'Recover directory objects and their attributes.',
}
// Describe only the workload families that actually have a route on this VBR source.
function goalDetail({goal,kinds,workloadTypes}:GoalAvailability){
  if(goal==='apps')return kinds.map(k=>recoveryKindLabel[k])
  if(goal==='files')return [
    ...(kinds.includes('guest-files')?['Guest files']:[]),...(kinds.includes('nas-files')?['File shares']:[]),...(kinds.includes('object-files')?['Object storage']:[]),
  ]
  if(goal==='disks')return kinds.map(k=>recoveryKindLabel[k])
  return [...(workloadTypes.includes('vm')?['Virtual machines']:[]),...(workloadTypes.includes('physical')?['Physical machines']:[]),
    ...(kinds.some(k=>k.startsWith('nas-'))?['File shares']:[]),...(kinds.some(k=>k.startsWith('object-'))?['Object storage']:[])]
}

export function RecoveryGoals({sourceKey,onChoose}:{sourceKey:string;onChoose:(goal:GoalAvailability)=>void}){
  const {t,diagnostic}=useRecoveryPresentation(),id=useId()
  const [page,setPage]=useState<PickerPage<GoalAvailability>>(),[error,setError]=useState(''),[revision,retry]=useState(0)
  useEffect(()=>{
    const controller=new AbortController()
    setError('');setPage(undefined)
    catalogRequest<GoalAvailability>(sourceKey,'machines','goals',revision?{refresh:'true'}:{},controller.signal).then(result=>{
      if(!controller.signal.aborted)setPage(result)
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message)})
    return ()=>controller.abort()
  },[sourceKey,revision])
  if(!page&&!error)return <RecoverySignal stage="data" compact/>
  return <>{page&&<div className={styles.methodChooser}>
    {page.data.map(group=>{
      const Icon=goalIcons[group.goal]
      return <button key={group.goal} data-goal={group.goal} className={styles.methodCard} type="button"
        aria-labelledby={id+group.goal} aria-describedby={id+group.goal+'-detail'} onClick={()=>onChoose(group)}>
        <span className={styles.artTile} aria-hidden="true"><Icon size={30} strokeWidth={1.65}/></span>
        <span className={styles.methodCopy}><strong id={id+group.goal}>{t(goalLabel[group.goal])}</strong>
          <span id={id+group.goal+'-detail'}>{goalDetail(group).map(key=>t(key)).join(' · ')}</span></span>
        <ChevronRight className={styles.cardArrow} size={16} aria-hidden="true"/>
      </button>
    })}
  </div>}
    {page?.complete&&!page.data.length&&<p role="status">{t('No eligible workloads were found.')}</p>}
    {page?.notices.map(n=><p key={n} className={styles.notice}>{t(n)}</p>)}
    {error&&<p role="alert">{diagnostic(error)}</p>}
    {(error||page&&!page.complete)&&<div><Button type="button" variant="outline" size="sm" onClick={()=>retry(v=>v+1)}>{t('Retry')}</Button></div>}
  </>
}

export function RecoveryMethods({kinds,onChoose}:{kinds:RecoveryKind[];onChoose:(kind:RecoveryKind)=>void}){
  const {t}=useRecoveryPresentation(),id=useId()
  return <div className={styles.methodChooser}>{kinds.map(kind=>{
    const description=methodDescription[kind]
    return <button key={kind} data-recovery-kind={kind} type="button" className={styles.methodCard}
      aria-labelledby={id+kind} aria-describedby={description?id+kind+'-detail':undefined} onClick={()=>onChoose(kind)}>
      <span className={styles.artTile} aria-hidden="true"><RecoveryKindArt kind={kind}/></span>
      <span className={styles.methodCopy}><strong id={id+kind}>{t(recoveryKindLabel[kind])}</strong>{description&&<span id={id+kind+'-detail'}>{t(description)}</span>}</span>
      <ChevronRight className={styles.cardArrow} size={16} aria-hidden="true"/>
    </button>
  })}</div>
}
