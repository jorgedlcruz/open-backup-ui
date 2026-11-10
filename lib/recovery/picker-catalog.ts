// Open Backup UI v1.0.2
import {z} from 'zod'
import type {VbrReader} from '../server/vbr-read'
import type {RecoverySend} from '../server/vbr-recovery'
import {readOperationsCollection} from '../operations/load'
import {objectSchema,backupKey} from '../protected-data/model'
import {pointSchema} from '../restore-points/load'
import type {RestorePoint} from '../restore-points/model'
import {recoveryKinds,pointOperations,type RecoveryKind,type RecoveryObject} from '../restore-points/recovery-picker'
import {applicationAccess,publicBackupObjects,supportedApplications,verifiedBackupObjects} from './application-eligibility'
import {collect} from './options'
import {TopologyRequestError} from '../topology/load'

const backup=z.object({id:z.string().uuid(),name:z.string().nullish(),platformName:z.string().nullish(),objectsCount:z.number().int().nonnegative().nullish()})
const nativeKinds:Record<string,RecoveryKind>={InstantRecoveryToVi:'instant-vm',InstantRecoveryToHv:'instant-vm',
  EntireVmRestoreToVi:'entire-vm',EntireVmRestoreToHv:'entire-vm',FileLevelRestore:'guest-files',InstantDiskRecovery:'instant-disk',DiskPublish:'publish-disks'}
type Catalog={objects:RecoveryObject[];complete:boolean;notices:string[]}
type PointSet={data:RestorePoint[];complete:boolean}
const passthrough=(e:unknown)=>e instanceof Error && 'status' in e && e.status===401

async function parallel<T>(rows:T[],work:(r:T)=>Promise<void>) {
  let cursor=0
  await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{while(cursor<rows.length)await work(rows[cursor++])}))
}
function include(map:Map<string,RecoveryObject>,id:string,name:string,platform:string,copy:RecoveryObject['copies'][number]){
  if(!copy.kinds.length)return
  let vm=map.get(id)
  if(!vm){vm={objectId:id,name,platform,copies:[]};map.set(id,vm)}
  const existing=vm.copies.find(c=>c.backupId===copy.backupId)
  if(existing)existing.kinds=[...new Set([...existing.kinds,...copy.kinds])]
  else vm.copies.push(copy)
}
async function objectPoints(read:VbrReader,id:string):Promise<PointSet>{
  const result=await readOperationsCollection(p=>read(p,'1.3-rev2'),'/api/v1/backupObjects/'+id+'/restorePoints?orderColumn=CreationTime&orderAsc=false',pointSchema,20000)
  return {data:result.data,complete:result.complete}
}
export async function recoveryCatalog(read:VbrReader,privateSend?:RecoverySend):Promise<Catalog>{
  const objects=new Map<string,RecoveryObject>(),notices:string[]=[]
  const paths=new Map<string,string>()
  let complete=true
  if(privateSend){
    const [backups,rights]=await Promise.all([collect(privateSend,'/private-api/v1/backups',backup),applicationAccess(privateSend)])
    if(!rights.has('ViewBackupObjects')||!rights.has('ViewRestorePoints'))throw new TopologyRequestError('Your VBR account cannot read the required backup records.',403)
    await parallel(backups.filter(b=>!['UnstructuredData','WindowsPhysical','LinuxPhysical','LinuxPhysicalPpc'].includes(b.platformName||'')),async b=>{
      try{
        const inventory=await publicBackupObjects(read,b.id)
        const ids=(inventory?.data||[]).filter(o=>['vm','virtualmachine'].includes(o.type?.toLowerCase()||'')).map(o=>o.id)
        for(const o of inventory?.data||[])if(o.path)paths.set(o.id,o.path)
        const {rows,complete:verified}=await verifiedBackupObjects(privateSend,b.id,{ids,minimum:b.objectsCount??undefined,
          knownEmpty:!!inventory?.complete&&!ids.length&&!b.objectsCount})
        if(!verified)complete=false
        for(const row of rows){
          if(!row.objectId||row.backupId!==b.id||!['Vm','AzureVm'].includes(row.itemIconType||''))continue
          const kinds=new Set<RecoveryKind>()
          for(const op of row.operations||[])if(op.enabled&&Object.hasOwn(nativeKinds,op.operation))kinds.add(nativeKinds[op.operation])
          for(const app of supportedApplications(row,rights))kinds.add(app.kind==='sql'?'sql':'active-directory')
          if(row.path)paths.set(row.objectId,row.path)
          include(objects,row.objectId,row.name||row.objectId,row.platformName||'',{backupId:b.id,name:b.name||b.id,kinds:[...kinds]})
        }
      }catch(e){if(passthrough(e))throw e;complete=false}
    })
  }else{
    notices.push('Application recovery requires a configured VBR web console connection.')
    const inventory=await readOperationsCollection(p=>read(p,'1.3-rev2'),'/api/v1/backupObjects',objectSchema,20000,backupKey)
    complete=inventory.complete
    const vms=new Map(inventory.data.filter(row=>row.type?.toLowerCase()==='vm'&&z.string().uuid().safeParse(row.id).success).map(row=>[row.id,row]))
    await parallel([...vms.values()],async vm=>{
      try{
        if(vm.path)paths.set(vm.id,vm.path)
        const points=await objectPoints(read,vm.id)
        if(!points.complete)complete=false
        for(const point of points.data){
          const kinds=recoveryKinds.filter(kind=>pointOperations(point,kind).length>0)
          include(objects,vm.id,vm.name||vm.id,vm.platformName||'',{backupId:point.backupId,name:point.backupId,kinds})
        }
      }catch(e){if(passthrough(e))throw e;complete=false}
    })
  }
  if(!complete)notices.push('Some backups could not be checked. Only verified recovery options are shown.')
  // Homonymous VMs can share a friendly backup name. Resolve the native inventory
  // path only for these objects, before pagination or filtering can hide a sibling.
  const byName=new Map<string,RecoveryObject[]>()
  for(const vm of objects.values()){
    const name=vm.name.trim().toLowerCase(),group=byName.get(name)||[]
    group.push(vm);byName.set(name,group)
  }
  const ambiguous=[...byName.values()].filter(group=>group.length>1)
  await parallel(ambiguous.flat().filter(vm=>!paths.has(vm.objectId)),async vm=>{
    try{
      const details=objectSchema.parse(await read('/api/v1/backupObjects/'+vm.objectId,'1.3-rev2'))
      if(details.id===vm.objectId&&details.path)paths.set(vm.objectId,details.path)
    }catch(e){if(passthrough(e))throw e}
  })
  for(const group of ambiguous){
    const labels=group.map(vm=>{
      const parts=paths.get(vm.objectId)?.split(/[\\/]/).filter(Boolean)||[]
      if(parts.at(-1)?.toLowerCase()===vm.name.toLowerCase())parts.pop()
      return parts.join(' / ')
    })
    group.forEach((vm,i)=>{
      const location=labels[i]
      if(location&&labels.indexOf(location)===labels.lastIndexOf(location)){vm.distinguishingLocation=location;return}
      let length=8
      while(length<vm.objectId.length&&group.some(other=>other!==vm&&other.objectId.endsWith(vm.objectId.slice(-length))))length++
      vm.distinguishingLocation=[location,vm.objectId.slice(-length)].filter(Boolean).join(' · ')
    })
  }
  return {objects:[...objects.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.objectId.localeCompare(b.objectId)),complete,notices}
}

// Cache only successful scoped reads. Each request still authenticates its principal and VBR source.
function scopedCache<T>(limit:number){
  const store=new Map<string,{expires:number,result:Promise<T>}>()
  return (key:string,load:()=>Promise<T>,refresh=false)=>{
    const old=store.get(key)
    if(!refresh&&old&&old.expires>Date.now())return old.result
    const result=load(),entry={expires:Date.now()+60_000,result}
    store.set(key,entry)
    while(store.size>limit)store.delete(store.keys().next().value!)
    const forget=()=>{if(store.get(key)===entry)store.delete(key)}
    void result.then(value=>{if(value&&typeof value==='object'&&'complete' in value&&!value.complete)forget()},forget)
    return result
  }
}
const cachedCatalog=scopedCache<Catalog>(32),cachedPoints=scopedCache<PointSet>(128)
export async function pickerPage(read:VbrReader,send:RecoverySend|undefined,identity:string,request:{
  kind:RecoveryKind;view:'objects'|'points';objectId?:string;backupId?:string;restorePointId?:string;query?:string;offset:number;limit:number;refresh?:boolean
}){
  const {kind,objectId,backupId,restorePointId,view,offset,limit,refresh}=request
  if(!send&&(kind==='sql'||kind==='active-directory')){
    if(view==='points')throw new TopologyRequestError('Application recovery requires a configured VBR web console connection.',409)
    return {data:[],total:0,complete:true,notices:['Application recovery requires a configured VBR web console connection.']}
  }
  const catalog=await cachedCatalog(identity,()=>recoveryCatalog(read,send),refresh)
  const subset=catalog.objects.filter(o=>(!objectId||o.objectId===objectId)&&o.copies.some(c=>c.kinds.includes(kind)&&(!backupId||c.backupId===backupId)))
  if(view==='objects'){
    const q=request.query?.trim().toLocaleLowerCase()
    const rows=subset.map(o=>({...o,copies:o.copies.filter(c=>c.kinds.includes(kind)&&(!backupId||c.backupId===backupId))})).filter(o=>!q||[o.name,o.objectId,o.platform,o.distinguishingLocation||'',...o.copies.map(c=>c.name)].some(n=>n.toLocaleLowerCase().includes(q)))
    return {data:rows.slice(offset,offset+limit),total:rows.length,complete:catalog.complete,notices:catalog.notices}
  }
  const vm=subset[0]
  if(!objectId||!vm)throw new TopologyRequestError('This VM is unavailable for the selected recovery.',409)
  const copies=new Set(vm.copies.filter(c=>c.kinds.includes(kind)&&(!backupId||c.backupId===backupId)).map(c=>c.backupId))
  const points=await cachedPoints(identity+'/'+objectId,()=>objectPoints(read,objectId),refresh)
  const app=kind==='sql'?'sql':kind==='active-directory'?'activeDirectory':undefined
  const rows=points.data.filter(p=>copies.has(p.backupId)&&(!restorePointId||restorePointId===p.id)&&(app||pointOperations(p,kind).length>0))
    .map(p=>app?{...p,applications:[{kind:app,objectId}]}:p).sort((a,b)=>(Date.parse(b.creationTime||'')||0)-(Date.parse(a.creationTime||'')||0)||a.id.localeCompare(b.id))
  return {data:rows.slice(offset,offset+limit),total:rows.length,complete:points.complete&&catalog.complete,notices:points.complete?catalog.notices:[...catalog.notices,'The restore-point list is partial.']}
}
