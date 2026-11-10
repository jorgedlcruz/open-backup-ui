'use client'
// Open Backup UI v1.0.2
import {useEffect,useRef,useState} from 'react'
import {Disc3,KeyRound,HardDrive,ArrowRight,LoaderCircle} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {beginRestoreLaunch} from '@/lib/restore-points/launch'
import {useRecoveryPresentation} from './use-presentation'
import {control,flagged,FormField,LaunchFooter,pointRef,ReviewPoint,workloadRequest,type WorkloadProps} from './workload-launch-shared'
type Options={point:{id:string;malwareStatus?:string|null};allowRemoteBmr?:boolean;tokenBackupId?:string;volume:boolean;media:boolean;token:boolean;targets:{id:string;name:string}[]}
type Disk={number:number;size:{size:number;unit:string};volumes:string[]}
type Plan={handle:string;ready:boolean;source:Disk[];target:Disk[];mapped:Disk[]}
type Media={handle:string;state:string;result:string;progress?:number}
export function AgentVolumeRecoveryLaunch(props:WorkloadProps<'agent-volumes'>){
 const {t,diagnostic,date}=useRecoveryPresentation(),{object,point,onLaunch,onBack}=props
 const {sourceKey,objectId,backupId,restorePointId}=pointRef(props),scope={sourceKey,objectId,backupId,restorePointId}
 const [options,setOptions]=useState<Options>(),[target,setTarget]=useState(''),[plan,setPlan]=useState<Plan>(),[media,setMedia]=useState<Media>(),[token,setToken]=useState<{token:string;expires:string}>()
 const [remote,setRemote]=useState(false),[intent,setIntent]=useState<'volume'|'media'|'token'>('volume'),[reviewedStatus,setReviewedStatus]=useState<string>(),[confirm,setConfirm]=useState(''),[tokenConfirmed,setTokenConfirmed]=useState(false)
 const [src,setSrc]=useState(''),[dst,setDst]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 const livePoint=options?{...point,malwareStatus:options.point.malwareStatus}:point
 const reviewed=!!livePoint.malwareStatus&&reviewedStatus===livePoint.malwareStatus
 const setReviewed=(value:boolean)=>setReviewedStatus(value?livePoint.malwareStatus||undefined:undefined)
 const lock=useRef(false),targetName=options?.targets.find(row=>row.id===target)?.name,ok=!flagged(livePoint)||reviewed
 useEffect(()=>{const c=new AbortController();setError('');setOptions(undefined);setPlan(undefined);setConfirm('');setTokenConfirmed(false)
 workloadRequest<Options>('agent-volumes',{sourceKey,objectId,backupId,restorePointId,action:'options'},c.signal).then(o=>{if(!c.signal.aborted){
   if(o.point?.id!==restorePointId||!o.volume&&!o.media&&!o.token)throw Error('VBR no longer allows this restore operation.')
   setOptions(o);setIntent(current=>o[current]?current:o.volume?'volume':o.media?'media':'token')
   if(!o.allowRemoteBmr)setRemote(false)
 }}).catch(e=>{if(!c.signal.aborted)setError(e.message)})
 return ()=>c.abort()},[sourceKey,objectId,backupId,restorePointId,revision])
 const handle=media?.handle,done=media?.state==='Stopped'
 useEffect(()=>{if(!handle||done)return;const c=new AbortController();let timer:ReturnType<typeof setTimeout>
 async function tick(){try{const next=await workloadRequest<Omit<Media,'handle'>>('agent-volumes',{sourceKey,objectId,backupId,restorePointId,handle,action:'mediaStatus'},c.signal);if(!c.signal.aborted){setMedia({...next,handle:handle!});if(next.state!=='Stopped')timer=setTimeout(tick,3500)}}
 catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Request failed.')}}
 void tick();return ()=>{clearTimeout(timer);c.abort()}},[handle,done,sourceKey,objectId,backupId,restorePointId,revision])
 async function run(job:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await job()}catch(e){setError(e instanceof Error?e.message:'Request failed.')}finally{lock.current=false;setBusy(false)}}
 function start(){if(!options?.volume||!plan?.ready||!targetName||confirm!==targetName||busy||!ok||lock.current)return;lock.current=true;setBusy(true)
 const draft={sourceKey,operation:'agent-volumes' as const};onLaunch(beginRestoreLaunch(draft,object.name,point.creationTime||undefined,()=>workloadRequest('agent-volumes',{...scope,action:'start',handle:plan.handle,confirm,reviewedMalwareStatus:reviewed?livePoint.malwareStatus:undefined})))}
 const copyName=object.copies.find(c=>c.backupId===backupId)?.name||object.name
 const diskName=(d:Disk)=>t('Disk')+' '+d.number+' · '+d.size.size.toLocaleString()+' '+d.size.unit+(d.volumes.length?' · '+d.volumes.join(', '):'')
 return <div className="grid gap-4"><ReviewPoint {...{point:livePoint,object,reviewed,setReviewed}}/>
 {options?<><div className="flex flex-wrap gap-2">{([['volume',options.volume,HardDrive,'Restore volumes'],['media',options.media,Disc3,'Recovery media'],['token',options.token,KeyRound,'Recovery token']] as const).map(([key,show,Icon,label])=>show&&<Button key={key} size="sm" disabled={busy} variant={intent===key?'default':'outline'} aria-pressed={intent===key} onClick={()=>{setIntent(key);setToken(undefined);setTokenConfirmed(false);setError('')}}><Icon size={16}/>{t(label)}</Button>)}</div>
 {intent==='volume'&&options.volume&&<><FormField label={t('Recovery appliance')}><select className={control} value={target} disabled={busy} onChange={e=>{setTarget(e.target.value);setPlan(undefined);setConfirm('')}}><option value="">{t('Select a target')}</option>{options.targets.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></FormField>
 {!options.targets.length?<p className="rounded-md border p-3 text-sm">{t('Boot the destination computer from Veeam Recovery Media and connect it to this VBR server. Refresh when the appliance is verified.')} <button className="underline" onClick={()=>setRevision(v=>v+1)}>{t('Refresh')}</button></p>:
 !plan&&<Button className="justify-self-start" variant="outline" disabled={!target||busy} onClick={()=>void run(async()=>setPlan(await workloadRequest('agent-volumes',{...scope,action:'map',targetId:target})))}>{t('Review disk mapping')}</Button>}
 {plan&&<><div className="grid gap-2 rounded-lg border p-3"><strong>{t('Disk mapping')} · {targetName}</strong>{plan.mapped.map(d=><span key={d.number} className="text-sm">{diskName(d)}</span>)}
 <details><summary className="cursor-pointer text-sm text-primary">{t('Change disk mapping')}</summary><div className="mt-3 grid gap-2 md:grid-cols-2">
 <FormField label={t('Source disk')}><select value={src} className={control} onChange={e=>setSrc(e.target.value)}><option value="">—</option>{plan.source.map(d=><option value={d.number} key={d.number}>{diskName(d)}</option>)}</select></FormField>
 <FormField label={t('Destination disk')}><select value={dst} className={control} onChange={e=>setDst(e.target.value)}><option value="">—</option>{plan.target.map(d=><option value={d.number} key={d.number}>{diskName(d)}</option>)}</select></FormField></div>
 <Button disabled={busy||src===''||dst===''} className="mt-3" variant="outline" onClick={()=>void run(async()=>{setConfirm('');setPlan(undefined);setPlan(await workloadRequest('agent-volumes',{...scope,handle:plan.handle,action:'stageDisk',sourceDisk:Number(src),targetDisk:Number(dst)}))})}>{t('Review disk mapping')}</Button></details></div>
 <FormField label={t('Restoring overwrites the mapped destination volumes. Type the target computer name to continue.')}><input className={control} value={confirm} placeholder={targetName} autoComplete="off" onChange={e=>setConfirm(e.target.value)}/></FormField></>}</>}
 {intent==='media'&&options.media&&<><p className="text-sm text-muted-foreground">{t('Create a bootable ISO for this computer. When VBR finishes, download it here.')}</p>{options.allowRemoteBmr&&!media&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={remote} onChange={e=>setRemote(e.target.checked)}/>{t('Allow remote bare-metal recovery')}</label>}{media?<div role="status">{t(media.state)} · {t(media.result)} {media.progress!=null&&media.progress+'%'} {done&&media.result==='Success'&&<Button asChild size="sm"><a href={'/api/vbr/restore/agent-volumes?'+new URLSearchParams({...scope,handle:media.handle})} download>{t('Download ISO')}</a></Button>}</div>:
 <Button className="justify-self-start" variant="outline" disabled={busy||!ok} onClick={()=>void run(async()=>setMedia(await workloadRequest('agent-volumes',{...scope,action:'media',allowRemoteBmr:!!options.allowRemoteBmr&&remote,reviewedMalwareStatus:reviewed?livePoint.malwareStatus:undefined})))}>{t('Create recovery media')}</Button>}</>}
 {intent==='token'&&options.token&&<><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={tokenConfirmed} onChange={e=>setTokenConfirmed(e.target.checked)}/><span>{t('Allow recovery access to this backup for one hour.')} <strong>{copyName}</strong>{options.tokenBackupId&&<small className="mt-1 block">{t('Backup ID')}: {options.tokenBackupId}</small>}</span></label>
 {token?<div className="grid gap-2 rounded-lg border p-3"><strong>{t('Recovery token')}</strong><code className="select-all break-all">{token.token}</code><small>{t('Expires')} · {date(token.expires)}</small></div>:
 <Button className="justify-self-start" variant="outline" disabled={!tokenConfirmed||busy||!ok} onClick={()=>void run(async()=>setToken(await workloadRequest('agent-volumes',{...scope,action:'token',confirm:backupId,reviewedMalwareStatus:reviewed?livePoint.malwareStatus:undefined})))}>{t('Create recovery token')}</Button>}</>}
 </>:!error&&<LoaderCircle aria-label={t('Loading…')} className="animate-spin"/>}
 {error&&<p role="alert" className="text-sm text-destructive">{diagnostic(error)} <button className="underline" onClick={()=>setRevision(v=>v+1)}>{t('Refresh')}</button></p>}
 <LaunchFooter onBack={onBack}>{intent==='volume'&&plan&&<Button disabled={busy||!plan.ready||!ok||!targetName||confirm!==targetName} onClick={start}>{t('Restore volumes')}<ArrowRight size={16}/></Button>}</LaunchFooter></div>
}
