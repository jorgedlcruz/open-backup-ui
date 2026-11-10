// Open Backup UI v1.0.2
import {createHash,randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {RecoverySend} from '../server/vbr-recovery'
import {VbrRecoveryError} from './error'
import {collect,findPoint} from './options'
import {applicationAccess,publicBackupObjects,verifiedBackupObjects} from './application-eligibility'
const guid=z.string().uuid(), ids=z.object({sourceKey:z.string().regex(/^[a-f0-9]{64}$/),objectId:guid,backupId:guid,restorePointId:guid})
const disk=z.object({number:z.number().int(),size:z.object({size:z.number(),unit:z.string()}),partitions:z.array(z.object({name:z.string().nullish(),description:z.string().nullish(),additionalInfo:z.object({displayName:z.string()}).nullish()}).passthrough())}).passthrough()
const context=z.object({version:z.number().int(),disks:z.array(disk)}).passthrough()
const layout=z.object({id:guid,diskManagementSessionId:guid,sourceLayout:context.nullish(),targetLayout:context.nullish(),volumeMatchingResults:context})
const appliance=z.object({id:guid,hostName:z.string(),platformType:z.string(),isVerified:z.boolean(),isDetached:z.boolean()})
const mediaTask=z.object({id:guid,type:z.literal('RecoveryMedia'),state:z.string(),result:z.string(),progressPercent:z.number().optional()})
export const volumeCommand=ids.extend({action:z.enum(['options','map','remap','stageDisk','start','media','mediaStatus','download','token']),
 targetId:guid.optional(),handle:guid.optional(),sourceDisk:z.number().int().nonnegative().optional(),targetDisk:z.number().int().nonnegative().optional(),
 confirm:z.string().max(500).optional(),reviewedMalwareStatus:z.string().max(64).optional(),allowRemoteBmr:z.boolean().optional(),reason:z.string().max(1000).optional()}).strict()
type Input=z.infer<typeof volumeCommand>
type Ticket={scope:string;until:number;type:'layout'|'media';id:string;target?:string;digest?:string;ready?:boolean;used?:boolean}
const tickets=new Map<string,Ticket>()
const idsMatch=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase()
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const fail=(text:string,status=409):never=>{throw new VbrRecoveryError(text,status)}
function reserve(t:Omit<Ticket,'until'>){
 const now=Date.now();for(const [k,v] of tickets)if(v.until<=now)tickets.delete(k)
 if(tickets.size>=2000)throw new VbrRecoveryError('Too many recovery preparations are open.',429)
 const id=randomUUID();tickets.set(id,{...t,until:now+(t.type==='layout'?15:120)*60000});return id
}
const present=(ctx:z.infer<typeof context>|null|undefined)=>ctx?.disks.map(d=>({number:d.number,size:d.size,volumes:d.partitions.map(p=>p.additionalInfo?.displayName||p.name||p.description).filter(Boolean)}))||[]
export async function agentVolumes(send:RecoverySend,priv:RecoverySend,principal:string,input:Input){
 const {objectId,backupId,restorePointId,action}=input
 const [point,rows,rights,members,inventory]=await Promise.all([findPoint(send,restorePointId,backupId),verifiedBackupObjects(priv,backupId,{ids:[objectId]}),applicationAccess(priv),
 collect(send,'/api/v1/backupObjects/'+objectId+'/restorePoints?backupIdFilter='+backupId,z.object({id:guid,backupId:guid})),
 publicBackupObjects((path)=>send(path),backupId)])
 const row=rows.rows.find(r=>r.objectId===objectId&&r.backupId===backupId&&r.platformName==='WindowsPhysical'&&r.repositoryType!=='ArchiveTier')
 const onlyComputer=inventory?.complete&&inventory.data.length===1&&inventory.data[0].id===objectId
 if(!row||!rows.complete||!inventory?.complete||!inventory.data.some(o=>o.id===objectId&&o.platformName==='WindowsPhysical')||
    point.platformName!=='WindowsPhysical'||(!onlyComputer&&row.id!==restorePointId)||!members.some(p=>p.id===restorePointId&&p.backupId===backupId)||
    !rights.has('ViewBackupObjects')||!rights.has('ViewRestorePoints'))return fail('This recovery point is unavailable for this computer.')
 const offered=(k:string)=>!!row.operations?.some(o=>o.operation===k&&o.enabled)
 const token=offered('CreateRecoveryToken')&&rights.has('CreateComputerRecoveryToken')&&rights.has('ViewBackups')&&!!(row.childBackupId||onlyComputer),media=offered('CreateRecoveryMedia'),
   volume=['PerformVolumeRestore','ViewAgentsRecoveryAppliances','DiskManagement'].every(right=>rights.has(right))
 const scope=digest([principal,input.sourceKey,objectId,backupId,restorePointId])
 const list=async()=>volume?(await collect(send,'/api/v1/agents/recoveryAppliances',appliance)).filter(a=>a.isVerified&&!a.isDetached&&a.platformType==='WindowsPhysical').map(a=>({id:a.id,name:a.hostName})): []
 const tokenBackupId=row.childBackupId??backupId
 const allowRemoteBmr=media&&rights.has('PerformRemoteBareMetalRecovery')
 if(action==='options')return {point:{id:point.id,malwareStatus:point.malwareStatus},token,media,volume,allowRemoteBmr,
   tokenBackupId:token?tokenBackupId:undefined,targets:await list()}
 const post=(path:string,body?:unknown)=>send('/api/v1/'+path,{method:'POST',body,mutation:true})
 const flagged=['Suspicious','Infected'].includes(point.malwareStatus||'')
 if((action==='start'||action==='token'||action==='media')&&flagged&&input.reviewedMalwareStatus!==point.malwareStatus)return fail('VBR flagged this restore point for malware. Reopen the workflow and review its current status.')
 if(action==='token'){
   if(!token||input.confirm!==backupId)return fail('Confirm recovery access for the selected backup.',403)
   const expiry=new Date(Date.now()+3600000).toISOString()
   const result=z.object({recoveryToken:z.string().min(1),expirationDate:z.string()}).parse(await post('agents/recoveryTokens',{backupIds:[tokenBackupId],expirationDate:expiry}))
   return {token:result.recoveryToken,expires:result.expirationDate}
 }
 if(action==='media'){
   if(!media||input.allowRemoteBmr&&!allowRemoteBmr)return fail('Recovery media is unavailable for this computer.',403)
   const task=mediaTask.parse(await post('backupObjects/'+objectId+'/createRecoveryMedia?format=Iso&allowRemoteBmr='+String(input.allowRemoteBmr===true)))
   return {handle:reserve({scope,type:'media',id:task.id}),state:task.state,result:task.result}
 }
 const ticket=input.handle?tickets.get(input.handle):undefined
 if(action!=='map'&&(!ticket||ticket.scope!==scope||ticket.until<=Date.now()))return fail('This preparation expired. Open the selected restore point again.')
 if(action==='mediaStatus'||action==='download'){
   if(!media||ticket!.type!=='media')return fail('Recovery media is unavailable for this computer.',403)
   const task=mediaTask.parse(await send('/api/v1/tasks/'+ticket!.id))
   if(task.id!==ticket!.id)return fail('VBR returned a different task.')
   if(action==='mediaStatus')return {state:task.state,result:task.result,progress:task.progressPercent}
   if(task.state!=='Stopped'||task.result!=='Success')return fail('Recovery media is not ready.')
   return send('/api/v1/recoveryMedia/'+task.id+'/download',{iso:true})
 }
 if(!volume)return fail('Volume recovery is unavailable.',403)
 const target=(await list()).find(a=>a.id===(action==='map'?input.targetId:ticket!.target))
 if(!target)return fail('Choose a connected, verified recovery appliance.')
 async function validate(name:string,values:Record<string,unknown>){
   const result=z.object({result:z.string(),message:z.string().nullish(),interaction:z.array(z.object({question:z.string().nullish()})).nullish()}).parse(
     await priv('/private-api/v1/agents/recoveryAppliances/validation/'+name,{method:'POST',body:{...values,interaction:[]}}))
   if(result.result!=='Success')return fail(result.message?.slice(0,600)||result.interaction?.at(-1)?.question?.slice(0,600)||'VBR could not verify this recovery request.')
 }
 let sessionId:string
 if(action==='map'){
  await validate('checkRecoveryApplianceRestoreDeadline',{recoveryApplianceIds:[target.id]})
  await validate('checkDiskExistence',{shortInfos:[{machineId:target.id,machineName:target.name,backupId,backupObjectId:objectId,
    backupObjectName:row.name,restorePointId,restorePointCreationTime:point.creationTime}]})
  const init=z.object({id:guid,diskManagementSessionId:guid}).parse(await post('diskManagement/init',{id:target.id,oibId:restorePointId,hostType:'RecoveryAppliance'}))
  if(!idsMatch(init.id,target.id))return fail('VBR returned a different target.')
  sessionId=init.diskManagementSessionId
 }else{
  if(ticket!.type!=='layout'||ticket!.used)return fail('This disk layout is no longer available.')
  sessionId=ticket!.id
 }
 async function getLayout(){const l=layout.parse(await send('/api/v1/diskManagement/'+sessionId));if(l.diskManagementSessionId!==sessionId||l.id!==target!.id)return fail('VBR returned a different disk layout.');return l}
 if(action==='start'){
   if(input.confirm!==target.name||!ticket!.ready)return fail('Confirm the target computer and disk mapping.')
   await validate('checkVolumeMapping',{diskManagementSessionIds:[sessionId]})
   const current=await getLayout()
   if(ticket!.digest!==digest(current.volumeMatchingResults))return fail('The disk layout changed. Review the mapping again.')
   if(ticket!.used)return fail('This layout has already been submitted.')
   ticket!.used=true
   const result=z.object({id:guid}).parse(await post('restore/startVolumeRestore',{diskManagementSessionId:sessionId,diskMappingContext:current.volumeMatchingResults,reason:input.reason||''}))
   return {sourceKey:input.sourceKey,id:result.id}
 }
 // Rotate the authority before any native layout edit. Parallel remaps or a
 // submit cannot use the old handle while this request is staging target disks.
 if(ticket){if(ticket.used)return fail('This disk layout is no longer available.');ticket.used=true}
 let current:z.infer<typeof layout>,ready:boolean
 if(action==='stageDisk'){
   const before=await getLayout()
   if(ticket!.digest!==digest(before.volumeMatchingResults)||!before.sourceLayout?.disks.some(d=>d.number===input.sourceDisk)||!before.targetLayout?.disks.some(d=>d.number===input.targetDisk))return fail('Choose a source and destination disk from this layout.')
   ticket!.ready=false
   await post('diskManagement/'+sessionId+'/applyDiskLayout',{sourceDiskNumber:input.sourceDisk,targetDiskNumber:input.targetDisk})
   current=await getLayout();ready=current.volumeMatchingResults.disks.some(d=>d.partitions.length>0)
 }else{
   const mapped=z.object({success:z.boolean(),restoreLayout:layout}).parse(await post('diskManagement/automap',{diskManagementSessionId:sessionId,mappingType:'ToOriginalLayout'}))
   current=mapped.restoreLayout;ready=mapped.success&&current.volumeMatchingResults.disks.some(d=>d.partitions.length>0)
 }
 if(current.id!==target.id||current.diskManagementSessionId!==sessionId)return fail('VBR returned a different disk layout.')
 return {handle:reserve({scope,type:'layout',id:sessionId,target:target.id,digest:digest(current.volumeMatchingResults),ready}),ready,source:present(current.sourceLayout),target:present(current.targetLayout),mapped:present(current.volumeMatchingResults)}
}
