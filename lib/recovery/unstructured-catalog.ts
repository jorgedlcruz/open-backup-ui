// Open Backup UI v1.2.0
import {z} from 'zod'
import type {VbrReader} from '../server/vbr-read'
import type {RecoverySend} from '../server/vbr-recovery'
import type {RecoveryObject} from '../restore-points/recovery-picker'
import {pointSchema} from '../restore-points/load'
import {readOperationsCollection} from '../operations/load'
import {applicationAccess,applicationObjectSchema,publicBackupObjects,verifiedBackupObjects,type NativeBackupIndex} from './application-eligibility'
import {VbrRecoveryError} from './error'
import {readObjectRestorePointWindow,type PointWindow} from '../restore-points/cached-collection'
import {scopedRecoveryCache,isAbortedRead} from './catalog-cache'

export const unstructuredKinds=['nas-files','nas-entire','nas-rollback','nas-instant','object-files','object-entire','object-rollback'] as const
export type UnstructuredKind=typeof unstructuredKinds[number]
const full=['StartEntireVmRestore','ViewBackupObjects','ViewBackups','ViewInventory','ViewRestorePoints']
const files=['BrowseFlr','DownloadFlrItem','RestoreFlrItem','StartFlrRestore','ViewBackupObjects','ViewRestorePoints','ViewTasks','RestoreGuestFiles']
const native:Record<UnstructuredKind,[string,string[]]>={
  'nas-files':['NasFileLevelRestore',files],'object-files':['NasObjectStorageFileLevelRestore',files],
  'nas-entire':['NasEntireRestore',[...full,'StartUnstructuredDataInstantRecovery','RestoreEntireFileShare']],
  'nas-rollback':['NasRollback',[...full,'StartUnstructuredDataInstantRecovery','RollbackFileShare']],
  'nas-instant':['NasInstantRecovery',[...full,'PerformInstantFileShareRecovery']],
  'object-entire':['NasObjectStorageEntireRestore',[...full,'StartUnstructuredDataInstantRecovery','RestoreEntireBucket']],
  'object-rollback':['NasObjectStorageRollback',[...full,'StartUnstructuredDataInstantRecovery','RollbackObjectStorge']],
}
const target=z.object({id:z.string().uuid(),type:z.string(),name:z.string().nullish(),friendlyName:z.string().nullish()})
const header=z.object({id:z.string().uuid(),platformName:z.string().nullish(),name:z.string().nullish(),jobType:z.string().nullish()})
const fileTypes=new Set(['FileServer','NASFiler','SMBShare','NFSShare','SANSMBShare','SANNFSShare'])
const objectTypes=new Set(['AmazonS3','S3Compatible','AzureBlob','AzureDataLake'])
export const family=(type:string)=>fileTypes.has(type)?'nas':objectTypes.has(type)?'object':undefined
const failure=()=>new VbrRecoveryError('VBR no longer allows this restore operation.',409)
const partial='Some backups could not be checked. Only verified recovery options are shown.'
type Native=z.infer<typeof applicationObjectSchema>
export function unstructuredCapabilities(row:Native,sourceType:string,rights:Set<string>) {
  const workload=family(sourceType)
  if(!workload||row.platformName!=='UnstructuredData'||row.repositoryType==='ArchiveTier'||row.itemIconType==='EntraIdAuditLog')return []
  return unstructuredKinds.filter(kind=>kind.startsWith(workload+'-')&&!(kind==='nas-instant'&&row.tenantName)&&
    (!kind.endsWith('-rollback')||rights.has('PerformRestoreToOriginal'))&&
    rights.has('ViewBackupObjects')&&native[kind][1].every(permission=>rights.has(permission))&&
    row.operations?.some(op=>op.enabled&&op.operation===native[kind][0]))
}
const page=<T extends {id:string}>(read:VbrReader,path:string,schema:z.ZodType<T>,limit:number)=>readOperationsCollection<T>(p=>read(p,'1.3-rev2'),path,schema,limit)
export async function unstructuredTargets(read:VbrReader){
  const rows=await page(read,'/api/v1/inventory/unstructuredDataServers',target,5000)
  return {...rows,data:rows.data.filter(t=>family(t.type)).map(t=>({id:t.id,type:t.type,name:t.name||t.friendlyName||t.id}))}
}
async function members(read:VbrReader,privateSend:RecoverySend,backupId:string,getIndex?:()=>Promise<NativeBackupIndex|undefined>){
  const [publicRows,index]=await Promise.all([publicBackupObjects(read,backupId),getIndex?.()])
  if(!publicRows?.complete)throw failure()
  const native=await verifiedBackupObjects(privateSend,backupId,{ids:publicRows.data.map(o=>o.id),knownEmpty:publicRows.data.length===0},index?.get(backupId))
  return {native:native.rows,publicRows:publicRows.data,complete:native.complete}
}
export async function unstructuredCatalog(read:VbrReader,privateSend?:RecoverySend,getIndex?:()=>Promise<NativeBackupIndex|undefined>) {
  const objects=new Map<string,RecoveryObject>()
  if(!privateSend)return {objects:[],complete:false,notices:[partial]}
  const [backups,targets,rights]=await Promise.all([page(read,'/api/v1/backups?platformNameFilter=UnstructuredData',header,20000),unstructuredTargets(read),applicationAccess(privateSend)])
  const sources=new Map(targets.data.map(t=>[t.id,t]))
  let complete=backups.complete&&targets.complete
  const candidates=backups.data.filter(b=>b.platformName==='UnstructuredData'&&b.jobType!=='EntraIDAuditLogBackup')
  let cursor=0
  await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{
    while(cursor<candidates.length){
      const b=candidates[cursor++]
      try{
        const bindings=await members(read,privateSend,b.id,getIndex)
        if(!bindings.complete)complete=false
        for(const obj of bindings.publicRows){
          const source=obj.fileServerId&&sources.get(obj.fileServerId)
          if(!source)continue
          const row=bindings.native.find(r=>r.objectId===obj.id&&r.fileServerId===source.id)
          const kinds=row?unstructuredCapabilities(row,source.type,rights):[]
          if(!kinds.length)continue
          const found:RecoveryObject=objects.get(obj.id)??{objectId:obj.id,name:obj.name||source.name,platform:source.type,workloadType:family(source.type),copies:[]}
          const path=(row?.path||obj.path)?.trim()
          if(path&&path!==found.name)found.displayPath=path
          found.copies.push({backupId:b.id,name:b.name||b.id,kinds})
          objects.set(obj.id,found)
        }
      }catch(error){if(isAbortedRead(error)||error instanceof Error&&'status' in error&&(error.status===401||error.status===403))throw error;complete=false}
    }
  }))
  return {objects:[...objects.values()],complete,notices:complete?[]:[partial]}
}
export async function unstructuredSelection(read:VbrReader,objectId:string,backupId:string,privateSend:RecoverySend){
  const [binding,targets,rights]=await Promise.all([members(read,privateSend,backupId),unstructuredTargets(read),applicationAccess(privateSend)])
  const obj=binding.publicRows.find(o=>o.id===objectId&&o.platformName==='UnstructuredData')
  const source=obj&&targets.data.find(t=>t.id===obj.fileServerId)
  const row=source&&binding.native.find(r=>r.objectId===objectId&&r.fileServerId===source.id)
  if(!obj||!row||!source)throw failure()
  return {source,kinds:unstructuredCapabilities(row,source.type,rights),targets:targets.data,anchor:row.id,rights,
    onlyMember:binding.complete&&binding.publicRows.length===1&&binding.native.every(r=>r.objectId===objectId)}
}
export async function unstructuredPoints(read:VbrReader,objectId:string,backupId:string,privateSend?:RecoverySend){
  if(!privateSend)return {data:[],complete:false}
  const [binding,points]=await Promise.all([unstructuredSelection(read,objectId,backupId,privateSend),
    page(read,'/api/v1/backupObjects/'+objectId+'/restorePoints?backupIdFilter='+backupId+'&orderColumn=CreationTime&orderAsc=false',pointSchema,20000)])
  const relevant=points.data.filter(p=>p.backupId===backupId&&p.platformName==='UnstructuredData')
  // rev2 can include every sibling share's point even on the object-scoped URL.
  // The private object row explicitly pairs its native point ID and object ID.
  const mapped=relevant.filter(p=>binding.onlyMember||p.id===binding.anchor)
  return {data:mapped.map(p=>({...p,verifiedObjectId:objectId,recoveryKinds:binding.kinds})),complete:points.complete&&mapped.length===relevant.length}
}

type Binding={value:Awaited<ReturnType<typeof unstructuredSelection>>;complete:boolean;stale?:boolean}
const bindings=scopedRecoveryCache<Binding>(128,value=>({...value,complete:false,stale:true}))
const bindingPrefix=(identity:string)=>JSON.stringify([identity]).slice(0,-1)+','
export function invalidateUnstructuredPointBindings(identity:string){bindings.forgetPrefix(bindingPrefix(identity))}
/** Cache raw pages separately from the private capability and membership evidence. */
export async function unstructuredPointWindow(read:VbrReader,objectId:string,backupId:string,privateSend:RecoverySend|undefined,
  options:{identity:string;publicIdentity:string;pointLimit:number;refresh?:boolean;restorePointId?:string;window?:PointWindow}):Promise<PointWindow>{
  if(!privateSend)throw failure()
  const [binding,points]=await Promise.all([
    bindings(JSON.stringify([options.identity,objectId,backupId]),async()=>({value:await unstructuredSelection(read,objectId,backupId,privateSend),complete:true}),options.refresh),
    options.window||readObjectRestorePointWindow(path=>read(path,'1.3-rev2'),options.publicIdentity,objectId,{backupId,pointLimit:options.pointLimit,refresh:options.refresh,restorePointId:options.restorePointId}),
  ])
  const relevant=points.data.filter(p=>p.backupId===backupId&&p.platformName==='UnstructuredData')
  const mapped=relevant.filter(p=>binding.value.onlyMember||p.id===binding.value.anchor)
  return {...points,data:mapped.map(p=>({...p,verifiedObjectId:objectId,recoveryKinds:binding.value.kinds})),
    pointTotal:binding.value.onlyMember?points.pointTotal:undefined,
    complete:points.complete&&binding.complete&&mapped.length===relevant.length,
    ...((points.stale||binding.stale)&&{stale:true})}
}
