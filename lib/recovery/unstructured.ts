// Open Backup UI v1.2.0
import {createHmac,timingSafeEqual} from 'node:crypto'
import {z} from 'zod'
import type {RecoverySend} from '../server/vbr-recovery'
import type {VbrReader} from '../server/vbr-read'
import {unstructuredReceipts,type UnstructuredReceipts} from '../server/unstructured-receipts'
import {family,unstructuredKinds,unstructuredSelection,unstructuredTargets} from './unstructured-catalog'
import {checkSource,VbrRecoveryError} from './error'
import {collect} from './options'
import {pointSchema} from '../restore-points/load'
import {applicationAccess,publicBackupObjects} from './application-eligibility'
import {targetBrowsePermissions,unstructuredTargetBrowse} from './unstructured-target-browser'

const guid=z.string().uuid().transform(v=>v.toLowerCase()),scope=z.string().regex(/^[\da-f]{64}$/)
const location=z.string().max(8192).refine(v=>!/[\u0000-\u001f]/.test(v)&&!v.split(/[\\/]/).includes('..'))
const text=z.string().trim().min(1).max(256)
const base={sourceKey:scope},point={backupId:guid,objectId:guid,restorePointId:guid},session={...base,sessionId:guid,view:z.enum(['browse','instant']).default('browse')}
const write={requestId:guid,confirmOverwrite:z.boolean().default(false)},range={skip:z.number().int().min(0).max(2_147_483_647).default(0),limit:z.number().int().min(1).max(250).default(100)}
const overwrite=z.enum(['Skip','ReplaceOlder','ReplaceNewer','Overwrite']),policy=z.enum(['Keep','Overwrite','ChangedOnly'])
const shares={destinationId:guid.optional(),path:location.optional(),preserveHierarchy:z.boolean().optional()}
const start=z.object({...base,...point,...write,...shares,action:z.literal('start'),kind:z.enum(unstructuredKinds),reviewedMalwareStatus:text.nullish(),
  newBucketName:text.optional(),regionId:text.optional(),overwriteMode:overwrite.default('Skip'),restorePermissions:z.boolean().optional(),
  overwriteBucketAttributes:z.boolean().optional(),owner:text.optional(),permissionType:z.enum(['DenyEveryone','AllowSelected','AllowEveryone']).default('DenyEveryone'),
  users:z.array(text).max(100).default([]),reason:z.string().max(1000).optional()}).strict()
const item={...session,...write,path:location.optional(),sourcePaths:z.array(location.min(1)).min(1).max(200).optional(),isRecursive:z.boolean().default(false),
  restoreType:policy.default('Keep'),toDateTime:z.iso.datetime({offset:true}).optional(),restorePermissions:z.boolean().optional()}
export const pointQuery=z.object({...base,...point}).strict()
export const unstructuredCommand=z.discriminatedUnion('action',[
  start,z.object({...session,action:z.literal('status')}).strict(),z.object({...session,action:z.literal('targets')}).strict(),
  z.object({...session,action:z.literal('startTargetBrowse'),destinationId:guid}).strict(),
  z.object({...session,...range,limit:z.number().int().min(1).max(200).default(200),action:z.literal('browseTarget'),destinationId:guid,browseSessionId:guid,browseKey:z.string().max(256),path:location}).strict(),
  z.object({...session,action:z.literal('stopTargetBrowse'),destinationId:guid,browseSessionId:guid,browseKey:z.string().max(256)}).strict(),
  z.object({...session,...range,action:z.literal('browse'),path:location.default('')}).strict(),
  z.object({...session,...range,action:z.literal('versions'),path:location.min(1)}).strict(),
  z.object({...session,action:z.literal('search'),path:location.default(''),query:text}).strict(),
  z.object({...session,...range,action:z.literal('results'),taskId:guid,taskKey:z.string().max(256)}).strict(),
  z.object({...session,action:z.literal('task'),taskId:guid,taskKey:z.string().max(256)}).strict(),
  z.object({...item,action:z.literal('restore')}).strict(),z.object({...item,action:z.literal('copy'),destinationId:guid,targetPath:location.min(1)}).strict(),
  z.object({...session,...write,action:z.literal('finish')}).strict(),z.object({...session,...write,action:z.literal('switchover')}).strict(),
  z.object({...session,...write,...shares,action:z.literal('migrate'),destinationId:guid,path:location.min(1),overwriteMode:z.enum(['Overwrite','ReplaceOlder']),
    switchover:z.enum(['Auto','Manual','Scheduled']).default('Manual'),scheduleTime:z.iso.datetime({offset:true}).optional()}).strict()
])
type Context={sourceKey:string;cacheKey:string;secret:string;send:RecoverySend;privateSend:RecoverySend;receipts?:UnstructuredReceipts}
const asRead=(send:RecoverySend):VbrReader=>(path)=>send(path)
const deny=(message='VBR no longer allows this restore operation.')=>new VbrRecoveryError(message,409)
const missing=()=>new VbrRecoveryError('VBR could not confirm the operation. Check Sessions before trying again.',502,true)
const idModel=z.object({id:guid}),browseId=z.object({sessionId:guid})
const mount=browseId.extend({properties:z.object({pathSeparator:z.string().optional()}).nullish(),sourceProperties:z.object({backupId:guid.optional()}).nullish()})
const instant=idModel.extend({sessionId:guid,state:z.string(),unstructuredServerId:guid.nullish(),unstructuredServerName:z.string().nullish()})
const flr='/api/v1/backupBrowser/flr/unstructuredData',ir='/api/v1/restore/instantRecovery/unstructuredData'
const viewItem=z.object({name:z.string(),type:z.string(),location:z.string().nullish(),size:z.number().nullish(),versionsCount:z.number().nullish(),
  modifiedDate:z.string().nullish(),itemState:z.string().nullish()})
const paging=z.object({total:z.number().int().nonnegative().optional()}).nullish()
const version=z.object({id:guid,creationTime:z.string(),fileSize:z.number().nullish(),fileModificationDate:z.string().nullish()})
const task=z.object({id:guid,type:z.string(),state:z.string(),result:z.string().nullish(),progressPercent:z.number().nullish()})
const post=(send:RecoverySend,path:string,body?:unknown,mutation=false)=>send(path,{method:'POST',body,mutation})
export async function unstructuredOptions(ctx:Context,input:z.infer<typeof pointQuery>){
  checkSource(input.sourceKey,ctx.sourceKey)
  const [binding,raw]=await Promise.all([unstructuredSelection(asRead(ctx.send),input.objectId,input.backupId,ctx.privateSend),ctx.send('/api/v1/restorePoints/'+input.restorePointId)])
  const p=pointSchema.parse(raw)
  if(p.id!==input.restorePointId||p.backupId!==input.backupId||p.platformName!=='UnstructuredData'||!binding.onlyMember&&binding.anchor!==p.id)throw deny()
  return {sourceKey:ctx.sourceKey,kinds:binding.kinds,targets:binding.targets.filter(t=>family(t.type)===family(binding.source.type)),sourceType:binding.source.type,sourceId:binding.source.id,
    originalAllowed:binding.rights.has('PerformRestoreToOriginal'),point:{id:p.id,name:p.name,creationTime:p.creationTime,malwareStatus:p.malwareStatus}}
}
type Options=Awaited<ReturnType<typeof unstructuredOptions>>
export function buildUnstructuredStart(input:z.infer<typeof start>,options:Options){
  if(!options.kinds.includes(input.kind))throw deny()
  const risk=options.point.malwareStatus
  if((risk==='Infected'||risk==='Suspicious')&&input.reviewedMalwareStatus!==risk)throw deny('VBR flagged this restore point for malware. Reopen the workflow and review its current status.')
  const rp={restorePointId:input.restorePointId}
  if(input.kind.endsWith('-files'))return {path:'/api/v1/restore/flr/unstructuredData',body:rp}
  const to=options.targets.find(t=>t.id===input.destinationId)
  const object=input.kind.startsWith('object-'),rollback=input.kind.endsWith('-rollback')
  if(input.destinationId&&(!to||family(to.type)!==family(options.sourceType)))throw deny('Select a destination from the connected VBR source.')
  if(input.kind==='nas-instant'){
    if(!input.owner||input.permissionType==='AllowSelected'&&!input.users.length||input.permissionType!=='AllowSelected'&&input.users.length)
      throw deny('Review the file share access permissions.')
    return {path:ir,body:{autoSelectMountServers:true,restoreOptions:[{...rp,permissions:{owner:input.owner,permissionType:input.permissionType,permissionScope:input.users}}],reason:input.reason}}
  }
  if(rollback&&(input.destinationId||input.path||input.newBucketName||input.regionId))throw deny('Rollback uses the original location.')
  if(!input.destinationId&&!options.originalAllowed)throw deny()
  if((rollback||input.overwriteMode!=='Skip'||input.overwriteBucketAttributes)&&!input.confirmOverwrite)throw deny('Confirm the overwrite before continuing.')
  if(!to&&(input.path||input.regionId||input.newBucketName))throw deny('Select a destination from the connected VBR source.')
  if(!object&&(input.newBucketName||input.regionId||input.overwriteBucketAttributes))throw deny()
  return {path:'/api/v1/restore/unstructuredData/'+(object?'objectStorage':'fileShare'),body:{...rp,
    ...(to?{destination:{unstructuredDataServerId:to.id,path:input.path,...(object?{newBucketName:input.newBucketName,regionId:input.regionId}:{preserveHierarchy:input.preserveHierarchy})}}:{}),
    restoreOptions:rollback?{rollback:true}:{overwriteMode:input.overwriteMode,...(object?{overwriteBucketAttributes:input.overwriteBucketAttributes}:{restorePermissions:input.restorePermissions})}}}
}
function taskKey(ctx:Context,sid:string,id:string,type:string){
  return createHmac('sha256',ctx.secret).update(JSON.stringify(['unstructured-task',ctx.sourceKey,ctx.cacheKey,sid,id,type])).digest('base64url')
}
function checkedTask(ctx:Context,sid:string,id:string,key:string,types:string[]) {
  return types.some(type=>{const expected=Buffer.from(taskKey(ctx,sid,id,type)),supplied=Buffer.from(key);return expected.length===supplied.length&&timingSafeEqual(expected,supplied)})
}
function taskReceipt(raw:unknown,ctx:Context,sid:string,type:string){
  const t=task.safeParse(raw)
  if(!t.success||t.data.type!==type)throw missing()
  return {id:t.data.id,taskId:t.data.id,taskKey:taskKey(ctx,sid,t.data.id,type)}
}
export async function unstructuredAction(ctx:Context,input:z.infer<typeof unstructuredCommand>){
  checkSource(input.sourceKey,ctx.sourceKey)
  const {send}=ctx,receipts=ctx.receipts??unstructuredReceipts
  if(input.action==='start'){
    return receipts.submit(ctx.sourceKey,ctx.cacheKey,input.requestId,input,async()=>{
      const options=await unstructuredOptions(ctx,input),plan=buildUnstructuredStart(input,options)
      const raw=await post(send,plan.path,plan.body,true)
      const match=input.kind.endsWith('-files')?browseId.safeParse(raw).data?.sessionId:input.kind==='nas-instant'
        ?z.object({data:z.array(idModel).length(1)}).safeParse(raw).data?.data[0]?.id:idModel.safeParse(raw).data?.id
      if(!match)throw missing()
      return {id:match,sessionId:match,kind:input.kind}
    })
  }
  const sid=input.sessionId,base=flr+'/'+sid,rights=await applicationAccess(ctx.privateSend)
  // Destination inventory cleanup must still work after the source FLR mount ends.
  if(input.action==='stopTargetBrowse')return unstructuredTargetBrowse(ctx,input,rights)
  if(input.view==='instant'){
    const mounts=(await collect(send,ir,instant)).filter(m=>m.sessionId===sid)
    if(mounts.length!==1)throw deny('This mounted recovery is no longer available.')
    const m=mounts[0],path=ir+'/'+m.id
    if(!rights.has('ViewIRMountedUnstructuredDataShares'))throw deny()
    const actions:string[]=[]
    if(['Published','PublishFailed','UnpublishFailed'].includes(m.state)&&rights.has('UnmountIRUnstructuredDataShare'))actions.push('finish')
    if(m.state==='Published'&&rights.has('MigrateIRMountedUnstructuredDataShares'))actions.push('migrate')
    if(input.action==='status'){
      // A switchover setting exists for a mount migrating to production.
      let manual=false
      try{const settings=z.object({type:z.string()}).safeParse(await send(path+'/switchoverSettings'));manual=settings.data?.type==='Manual'}catch{}
      return {sessionId:sid,view:'instant',mountId:m.id,state:m.state,name:m.unstructuredServerName,actions:manual&&m.state==='Published'&&rights.has('SwitchIRMountedUnstructuredDataShares')?[...actions,'switchover']:actions}
    }
    if(input.action==='targets'){if(!actions.includes('migrate'))throw deny();return {targets:(await unstructuredTargets(asRead(send))).data.filter(v=>family(v.type)==='nas')}}
    if(input.action!=='finish'&&input.action!=='migrate'&&input.action!=='switchover')throw deny()
    if(input.action!=='switchover'&&!actions.includes(input.action))throw deny()
    return receipts.submit(ctx.sourceKey,ctx.cacheKey,input.requestId,input,async()=>{
      let body:unknown
      if(input.action==='migrate'){
        if(!input.confirmOverwrite||input.switchover==='Scheduled'&&!input.scheduleTime)throw deny('Confirm the overwrite before continuing.')
        const to=(await unstructuredTargets(asRead(send))).data.find(t=>t.id===input.destinationId&&family(t.type)==='nas')
        if(!to)throw deny('Select a destination from the connected VBR source.')
        body={destination:{unstructuredDataServerId:to.id,path:input.path,preserveHierarchy:input.preserveHierarchy},overwriteMode:input.overwriteMode,
          switchoverSettings:{type:input.switchover,...(input.switchover==='Scheduled'?{scheduleTime:input.scheduleTime}:{})}}
      }else if(input.action==='switchover'){
        const settings=z.object({type:z.string()}).parse(await send(path+'/switchoverSettings'))
        if(!rights.has('SwitchIRMountedUnstructuredDataShares')||!input.confirmOverwrite||settings.type!=='Manual'||m.state!=='Published')throw deny()
      }
      const id=idModel.safeParse(await post(send,path+'/'+(input.action==='finish'?'unmount':input.action),body,true)).data?.id
      if(!id)throw missing()
      return {id,sessionId:id}
    })
  }
  const m=mount.safeParse(await send(base))
  if(!m.success||m.data.sessionId!==sid)throw deny('This mounted recovery is no longer available.')
  const browseAllowed=rights.has('BrowseFLRUnstructuredData'),searchAllowed=browseAllowed&&rights.has('UnstructuredDataFlrSearchFor')&&rights.has('ViewTasks')
  const actions:string[]=[]
  if(browseAllowed)actions.push('browse','versions')
  if(searchAllowed)actions.push('search','results')
  if(rights.has('ViewTasks'))actions.push('task')
  if(rights.has('CopyUnstructuredDataFlrItem'))actions.push('copy','targets')
  if(targetBrowsePermissions.every(right=>rights.has(right)))actions.push('startTargetBrowse','browseTarget')
  if(rights.has('UnmountUnstructuredDataFLRVolumes'))actions.push('finish')
  let workloadType:'nas'|'object'|undefined
  const backupId=m.data.sourceProperties?.backupId
  if(backupId&&(input.action==='status'||input.action==='restore')){
    const backup=await publicBackupObjects(asRead(send),backupId),sources=await unstructuredTargets(asRead(send))
    const families=new Set(backup?.data.map(obj=>family(sources.data.find(t=>t.id===obj.fileServerId)?.type||'')))
    if(backup?.complete&&families.size===1)workloadType=[...families][0]
  }
  if(workloadType&&rights.has('PerformRestoreToOriginal')&&rights.has(workloadType==='nas'?'RestoreFileShareFiles':'RestoreObjects'))actions.push('restore')
  if(input.action==='status')return {sessionId:sid,view:'browse',workloadType,pathSeparator:m.data.properties?.pathSeparator,backupId,actions}
  if(!actions.includes(input.action))throw deny()
  if(input.action==='startTargetBrowse'||input.action==='browseTarget')return unstructuredTargetBrowse(ctx,input,rights)
  if(input.action==='targets')return {targets:(await unstructuredTargets(asRead(send))).data}
  if(input.action==='browse'||input.action==='results'){
    if(input.action==='results'&&!checkedTask(ctx,sid,input.taskId,input.taskKey,['FlrSearch']))throw deny()
    const route=input.action==='browse'?base+'/browse':base+'/search/'+input.taskId+'/browse'
    const result=z.object({items:z.array(viewItem),pagination:paging}).parse(await post(send,route,{
      ...(input.action==='browse'?{path:input.path}:{}),pagination:{skip:input.skip,limit:input.limit}}))
    return {items:result.items,total:result.pagination?.total??null}
  }
  if(input.action==='versions'){
    const result=z.object({data:z.array(version),pagination:paging}).parse(await post(send,base+'/restorePoints',{path:input.path,pagination:{skip:input.skip,limit:input.limit}}))
    return {versions:result.data,total:result.pagination?.total??null}
  }
  if(input.action==='search')return taskReceipt(await post(send,base+'/search',{path:input.path,searchString:input.query,disableRecursiveSearch:false}),ctx,sid,'FlrSearch')
  if(input.action==='task'){
    if(!checkedTask(ctx,sid,input.taskId,input.taskKey,['FlrSearch','FlrRestore']))throw deny()
    const t=task.parse(await send('/api/v1/tasks/'+input.taskId))
    if(t.id!==input.taskId||!checkedTask(ctx,sid,t.id,input.taskKey,[t.type]))throw deny()
    return t
  }
  if(input.action!=='restore'&&input.action!=='copy'&&input.action!=='finish')throw deny()
  return receipts.submit(ctx.sourceKey,ctx.cacheKey,input.requestId,input,async()=>{
    if(input.action==='finish'){
      const id=idModel.safeParse(await post(send,'/api/v1/restore/unstructuredData/'+sid+'/unmount',undefined,true)).data?.id
      if(!id)throw missing()
      return {id,sessionId:id}
    }
    const paths=input.sourcePaths??(input.path?[input.path]:[])
    if(!paths.length||paths.some(p=>!p.trim()||p==='/'||p==='\\')||input.path&&input.sourcePaths)throw deny('Select files or folders to restore.')
    if(input.restoreType!=='Keep'&&!input.confirmOverwrite)throw deny('Confirm the overwrite before continuing.')
    if(input.toDateTime&&paths.length!==1)throw deny('Select a single item version.')
    if(input.toDateTime){
      let found=false
      for(let skip=0;skip<5000;skip+=250){
        const result=z.object({data:z.array(version),pagination:paging}).parse(await post(send,base+'/restorePoints',{path:paths[0],pagination:{skip,limit:250}}))
        found=result.data.some(v=>v.creationTime===input.toDateTime)
        if(found||result.data.length<250||skip+250>=(result.pagination?.total??Infinity))break
      }
      if(!found)throw deny('Select a single item version.')
    }
    if(input.action==='copy'){
      const targets=await unstructuredTargets(asRead(send))
      if(!targets.data.some(t=>t.id===input.destinationId))throw deny('Select a destination from the connected VBR source.')
    }
    const body={sourcePath:paths,isRecursive:input.isRecursive,restoreType:input.restoreType,restorePermissions:input.restorePermissions,
      restoreMode:input.toDateTime?'Custom':'LatestPoint',toDateTime:input.toDateTime,...(input.action==='copy'?{unstructuredDataServerId:input.destinationId,path:input.targetPath}:{})}
    return taskReceipt(await post(send,base+'/'+(input.action==='copy'?'copyTo':'restore'),body,true),ctx,sid,'FlrRestore')
  })
}
