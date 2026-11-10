'use client'
// Open Backup UI v1.0.2
import {useEffect,useRef,useState} from 'react'
import {ArrowRight,FolderOpen,History,LoaderCircle,Share2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {applicationRequest} from '@/lib/api/application-request'
import {beginRestoreLaunch} from '@/lib/restore-points/launch'
import {recoveryKindLabel,type RecoveryKind} from '@/lib/restore-points/recovery-picker'
import {useRecoveryPresentation} from './use-presentation'
import {control,flagged,FormField,LaunchFooter,pointRef,ReviewPoint,workloadRequest,type WorkloadProps} from './workload-launch-shared'
type Kind=Extract<RecoveryKind,`nas-${string}`|`object-${string}`>
type Options={originalAllowed:boolean;kinds:string[];sourceKey:string;targets:{id:string;type:string;name:string}[];point:{id:string;malwareStatus?:string|null}}
export function UnstructuredRecoveryLaunch(props:WorkloadProps<Kind>){
 const {t,diagnostic}=useRecoveryPresentation(),{kind,point,object,onLaunch,onBack}=props
 const {sourceKey,backupId,objectId,restorePointId}=pointRef(props)
 const [options,setOptions]=useState<Options>(),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 const [dest,setDest]=useState(''),[path,setPath]=useState(''),[bucket,setBucket]=useState(''),[region,setRegion]=useState(''),[mode,setMode]=useState<'original'|'new'>('original')
 const [overwrite,setOverwrite]=useState('Skip'),[hierarchy,setHierarchy]=useState(true),[permissions,setPermissions]=useState(false),[confirm,setConfirm]=useState(false),[reviewedStatus,setReviewedStatus]=useState<string>(),[owner,setOwner]=useState(''),[access,setAccess]=useState('DenyEveryone'),[users,setUsers]=useState('')
 const lock=useRef(false)
 const files=kind.endsWith('-files'),instant=kind==='nas-instant',rollback=kind.endsWith('-rollback'),whole=kind.endsWith('-entire'),os=kind.startsWith('object-')
 useEffect(()=>{const c=new AbortController();setError('');setOptions(undefined)
 applicationRequest<Options>('/api/vbr/restore/unstructured?'+new URLSearchParams({sourceKey,backupId,objectId,restorePointId}),{signal:c.signal})
 .then(o=>{if(!c.signal.aborted){
   if(o.sourceKey!==sourceKey||o.point?.id!==restorePointId||!o.kinds.includes(kind)||kind.endsWith('-rollback')&&!o.originalAllowed)throw Error('VBR no longer allows this restore operation.')
   if(kind.endsWith('-entire')&&!o.originalAllowed&&!o.targets.length)throw Error('Select a destination from the connected VBR source.')
   setOptions(o);setConfirm(false);if(!o.originalAllowed)setMode('new')
 }})
 .catch(e=>{if(!c.signal.aborted)setError(e.message)});return ()=>c.abort()},[sourceKey,backupId,objectId,restorePointId,kind,revision])
 const livePoint=options?{...point,malwareStatus:options.point.malwareStatus}:point
 const reviewed=!!livePoint.malwareStatus&&reviewedStatus===livePoint.malwareStatus
 const setReviewed=(value:boolean)=>setReviewedStatus(value?livePoint.malwareStatus||undefined:undefined)
 const accounts=access==='AllowSelected'?users.split(/[,;\n]/).map(u=>u.trim()).filter(Boolean):[]
 const accountsValid=access!=='AllowSelected'||accounts.length>0&&accounts.length<=100&&accounts.every(u=>u.length<=256)
 const risky=rollback||whole&&(mode==='original'||overwrite!=='Skip'||permissions)||instant&&access==='AllowEveryone'
 const canStart=!!options&&(!flagged(livePoint)||reviewed)&&(!risky||confirm)&&(!whole||mode==='original'&&options.originalAllowed||mode==='new'&&options.targets.some(t=>t.id===dest))&&(!rollback||options.originalAllowed)&&(!instant||!!owner.trim()&&accountsValid)
 function start(){
  if(!canStart||lock.current)return;lock.current=true
  const command={action:'start',sourceKey,backupId,objectId,restorePointId,kind,reviewedMalwareStatus:reviewed?livePoint.malwareStatus:undefined,
   ...(whole&&{overwriteMode:overwrite,...(os?{overwriteBucketAttributes:permissions}:{restorePermissions:permissions}),...(mode==='new'&&{destinationId:dest,...(!os&&{preserveHierarchy:hierarchy}),...(path.trim()&&{path:path.trim()}),...(os&&bucket.trim()&&{newBucketName:bucket.trim()}),...(os&&bucket.trim()&&region.trim()&&{regionId:region.trim()})})}),
   ...(instant&&{owner:owner.trim(),permissionType:access,users:accounts}),...(confirm&&{confirmOverwrite:true})}
  onLaunch(beginRestoreLaunch({sourceKey,operation:kind},object.name,point.creationTime||undefined,(_,requestId)=>workloadRequest('unstructured',{...command,requestId})))
 }
 return <div className="grid gap-4"><ReviewPoint {...{point:livePoint,object,reviewed,setReviewed}}/>
 <div className="flex items-start gap-3">{files?<FolderOpen className="text-primary"/>:rollback?<History className="text-primary"/>:<Share2 className="text-primary"/>}
 <div><h3 className="font-semibold">{t(recoveryKindLabel[kind])}</h3><p className="text-sm text-muted-foreground">{t(files?'Open this point to browse and select individual items.':rollback?'Return the original location to its state at this restore point.':instant?'Publish this share directly from the backup.':'Choose where VBR will write the recovered data.')}</p></div></div>
 {!options&&!error&&<LoaderCircle aria-label={t('Loading…')} className="animate-spin"/>}
 {options&&whole&&<><div className="grid gap-3 md:grid-cols-2"><FormField label={t('Destination')}><select className={control} value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setConfirm(false)}}><option value="original" disabled={!options.originalAllowed}>{t('Original location')}</option><option value="new" disabled={!options.targets.length}>{t('New location')}</option></select></FormField>
 <FormField label={t('Existing items')}><select className={control} value={overwrite} onChange={e=>{setOverwrite(e.target.value);setConfirm(false)}}>{Object.entries({Skip:'Skip existing items',ReplaceOlder:'Replace older items',ReplaceNewer:'Replace newer items',Overwrite:'Overwrite'}).map(([v,l])=><option value={v} key={v}>{t(l)}</option>)}</select></FormField>
 {mode==='new'&&<><FormField label={t('Destination server')}><select value={dest} className={control} onChange={e=>{setDest(e.target.value);setConfirm(false)}}><option value="">{t('Select a target')}</option>{options.targets.map(x=><option key={x.id} value={x.id}>{x.name} · {x.type}</option>)}</select></FormField><FormField label={t('Destination path')}><input value={path} maxLength={8192} className={control} onChange={e=>{setPath(e.target.value);setConfirm(false)}}/></FormField>
 {os&&<><FormField label={t('New bucket name (optional)')}><input className={control} value={bucket} maxLength={256} onChange={e=>{setBucket(e.target.value);setConfirm(false)}}/></FormField>{bucket&&<FormField label={t('Region (optional)')}><input className={control} value={region} maxLength={256} onChange={e=>{setRegion(e.target.value);setConfirm(false)}}/></FormField>}</>}</>}</div>
 {mode==='new'&&!os&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hierarchy} onChange={e=>{setHierarchy(e.target.checked);setConfirm(false)}}/>{t('Preserve folder hierarchy')}</label>}
 <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={permissions} onChange={e=>{setPermissions(e.target.checked);setConfirm(false)}}/>{t(os?'Restore bucket attributes':'Restore permissions')}</label></>}
 {options&&instant&&<div className="grid gap-3 md:grid-cols-2"><FormField label={t('Share owner')}><input className={control} value={owner} maxLength={256} placeholder={'DOMAIN\\user'} onChange={e=>setOwner(e.target.value)}/></FormField>
 <FormField label={t('Share access')}><select className={control} value={access} onChange={e=>{setAccess(e.target.value);setConfirm(false)}}>{Object.entries({DenyEveryone:'Deny everyone',AllowSelected:'Allow selected accounts',AllowEveryone:'Allow everyone'}).map(([k,v])=><option key={k} value={k}>{t(v)}</option>)}</select></FormField>
 {access==='AllowSelected'&&<FormField label={t('Accounts (one per line)')}><textarea className={control} value={users} onChange={e=>setUsers(e.target.value)}/></FormField>}</div>}
 {risky&&options&&<label className="flex items-start gap-2 rounded-lg border border-amber-400/50 p-3 text-sm"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>{t(rollback?'I confirm the rollback of this original location.':instant?'I confirm that everyone may access this published share.':'I confirm the destination and replacement settings.')}</label>}
 {error&&<p role="alert">{diagnostic(error)} <button className="underline" onClick={()=>setRevision(v=>v+1)}>{t('Retry')}</button></p>}
 <LaunchFooter onBack={onBack}><Button disabled={!canStart} onClick={start}>{t(files?'Start browsing':instant?'Publish share':rollback?'Start rollback':'Start recovery')}<ArrowRight size={15}/></Button></LaunchFooter></div>
}
