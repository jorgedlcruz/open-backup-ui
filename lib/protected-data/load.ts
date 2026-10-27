import { z } from 'zod'
import type { VbrReader } from '../server/vbr-read'
import { revisionForBuild, validId, uuid, type Evidence } from '../investigation/model'
import { TopologyRequestError } from '../topology/load'
import { readOperationsCollection } from '../operations/load'
import { fileSchema, summarizeFiles, type File } from '../repositories/model'
import { objectSchema, backupSchema, backupKey, type Snapshot, type Latest, type Backup } from './model'

export async function loadProtectedData(raw:VbrReader,sourceName:string,includeTimes=false,now=new Date(),accounting=true):Promise<Snapshot> {
  const warnings:string[]=[]
  let revision:'1.3-rev1'|'1.3-rev2'='1.3-rev1'
  try{revision=revisionForBuild(z.object({buildVersion:z.string()}).parse(await raw('/api/v1/serverInfo')).buildVersion)}
  catch(e){if(e instanceof TopologyRequestError && e.status===401)throw e;warnings.push('Server version unavailable. Using API 1.3-rev1.')}
  const read=(path:string)=>raw(path,revision)
  async function optional<T>(label:string,work:Promise<Evidence<T>>):Promise<Evidence<T>> {
    try {const result=await work;if(!result.complete)warnings.push(`${label}: partial collection. Only loaded records are included.`);return result}
    catch(e){if(e instanceof TopologyRequestError && e.status===401)throw e
      const error=e instanceof TopologyRequestError && e.status===403 ? 'Read permission is unavailable.':'The expected data was not returned.'
      warnings.push(`${label} unavailable. ${error}`);return {data:[],available:false,complete:false,error}}
  }
  const [objects,backups]=await Promise.all([
    readOperationsCollection(read,'/api/v1/backupObjects',objectSchema,20000,backupKey),
    accounting ? optional('Backup inventory',readOperationsCollection(read,'/api/v1/backups',backupSchema)):Promise.resolve<Evidence<Backup>>({data:[],available:false,complete:false}),
  ])
  if(!objects.complete)warnings.push('Protected-object inventory is partial. Counts describe loaded records only.')
  // Per-object backup IDs can differ from the parent backup used by restore points.
  // Resolve this only from explicit membership, never workload or job names.
  const backupLinks:Record<string,string>={},memberships=new Map<string,Set<string>>()
  const unresolved=objects.data.filter(o=>!backups.data.some(b=>b.id===o.backupId))
  const candidates=accounting ? backups.data.filter(b=>['VMware','HyperV','Nutanix','Proxmox','CloudDirector'].includes(b.platformName || '') && unresolved.some(o=>o.platformName===b.platformName)):[]
  let memberIndex=0,membersComplete=backups.complete && candidates.length<=50
  await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{
    while(memberIndex<Math.min(candidates.length,50)){
      const parent=candidates[memberIndex++]
      const members=await optional('Backup membership',readOperationsCollection(read,`/api/v1/backups/${parent.id}/objects`,objectSchema,5000,backupKey))
      if(!members.complete)membersComplete=false
      for(const member of members.data){
        const key=backupKey(member)
        if(!unresolved.some(o=>backupKey(o)===key && o.platformName===member.platformName))continue
        const parents=memberships.get(key)||new Set<string>();parents.add(parent.id);memberships.set(key,parents)
      }
    }
  }))
  if(membersComplete)for(const [key,parents] of memberships)if(parents.size===1)backupLinks[key]=[...parents][0]
  if(candidates.length>50)warnings.push('Backup membership lookup is limited to 50 parents. Unresolved copy relationships remain unknown.')
  // Imported copies without a membership relationship can still expose direct metadata.
  const missing=accounting ? [...new Set(objects.data.map(o=>o.backupId).filter(validId))].filter(id=>!backups.data.some(b=>b.id===id)):[]
  let missingIndex=0
  await Promise.all(Array.from({length:Math.min(4,missing.length)},async()=>{
    while(missingIndex<Math.min(missing.length,50)){
      const id=missing[missingIndex++]
      if(objects.data.filter(o=>o.backupId===id).every(o=>backupLinks[backupKey(o)]))continue
      const result=await optional('Referenced backup metadata',(async()=>{
        const record=backupSchema.parse(await read(`/api/v1/backups/${id}`))
        if(record.id!==id)throw new Error('Backup identity mismatch')
        return {data:[record],available:true,complete:true}
      })())
      backups.data.push(...result.data)
      if(!result.complete)backups.complete=false
    }
  }))
  if(missing.length>50){backups.complete=false;warnings.push('Additional backup metadata is limited to 50 explicit references. Other locations remain unknown.')}
  const allFiles:File[]=[]
  let filesComplete=backups.complete,fileIndex=0
  const fileLimit=100
  const loadFiles=async()=>{
    while(fileIndex<Math.min(backups.data.length,fileLimit)) {
      const backup=backups.data[fileIndex++],observed:File[]=[]
      const files=await optional('Backup file inventory',readOperationsCollection(async path=>{
        const value=await read(path)
        observed.push(...z.object({data:z.array(fileSchema)}).parse(value).data)
        return value
      },`/api/v1/backups/${backup.id}/backupFiles`,fileSchema,3000))
      const ids=new Set(files.data.map(f=>f.id)),scoped=observed.filter(f=>ids.has(f.id) && f.backupId===backup.id)
      allFiles.push(...scoped)
      if(!files.complete || !scoped.length || scoped.length!==observed.length)filesComplete=false
    }
  }
  await Promise.all([
    ...Array.from({length:Math.min(4,backups.data.length)},loadFiles),
  ])
  if(backups.data.length>fileLimit){filesComplete=false;warnings.push('File accounting is limited to 100 backups. Remaining backups stay visible with unmeasured consumption.')}
  const consumption=summarizeFiles(allFiles,filesComplete)
  if(accounting && !consumption.complete)warnings.push('Backup file size is a measured subtotal. Some file inventories, sizes, or backup scopes are unavailable.')
  if(consumption.conflicts)warnings.push(`${consumption.conflicts} conflicting file identities were excluded from storage accounting.`)
  const snapshot:Snapshot={sourceName,fetchedAt:now.toISOString(),apiRevision:revision,warnings:[...new Set(warnings)],data:objects.data,objectsComplete:objects.complete,backups,consumption,latest:{},recoveryTimesRequested:false,backupLinks}
  return includeTimes ? loadProtectedRecoveryTimes(raw,snapshot,now):snapshot
}

// Enrich the existing copy inventory without reloading membership or backup files.
export async function loadProtectedRecoveryTimes(raw:VbrReader,snapshot:Snapshot,now=new Date()):Promise<Snapshot> {
  const warnings=[...snapshot.warnings],objects={data:snapshot.data},backupLinks=snapshot.backupLinks || {},latest:Record<string,Latest>={}
  const read=(path:string)=>raw(path,snapshot.apiRevision==='1.3-rev2' ? '1.3-rev2':'1.3-rev1')
  const timeLimit=100
  let timeIndex=0
  async function optional<T>(label:string,work:Promise<Evidence<T>>):Promise<Evidence<T>> {
    try {const result=await work;if(!result.complete)warnings.push(`${label}: partial collection. Only loaded records are included.`);return result}
    catch(e){if(e instanceof TopologyRequestError && e.status===401)throw e
      const error=e instanceof TopologyRequestError && e.status===403 ? 'Read permission is unavailable.':'The expected data was not returned.'
      warnings.push(`${label} unavailable. ${error}`);return {data:[],available:false,complete:false,error}}
  }
  const loadTimes=async()=>{
    while(timeIndex<Math.min(objects.data.length,timeLimit)) {
      const object=objects.data[timeIndex++],key=backupKey(object)
      const parentId=backupLinks[key] || object.backupId
      if(!validId(parentId)){latest[key]={state:'unavailable',creationTime:null,reason:'No usable backup reference was returned. Open all workload restore points to investigate.'};continue}
      const query=new URLSearchParams({skip:'0',limit:'1',orderColumn:'CreationTime',orderAsc:'false',backupIdFilter:parentId})
      const result=await optional('Latest restore-point times',(async()=>{
        const value=z.object({data:z.array(z.object({id:z.string().regex(uuid),backupId:z.string().transform(v=>v.toLowerCase()),creationTime:z.string().nullish(),platformName:z.string().nullish()}))})
          .parse(await read(`/api/v1/backupObjects/${object.id}/restorePoints?${query}`))
        const point=value.data[0],stamp=point?.creationTime ? Date.parse(point.creationTime):NaN
        // The API filters and sorts this copy. Reject mismatches or invalid/future dates.
        let reason:string|undefined
        if(value.data.length>1)reason='The source did not honor the latest-point limit.'
        else if(point?.backupId!==undefined && point.backupId!==parentId)reason='The returned restore point belongs to a different backup. Its time cannot describe this copy.'
        else if(point?.platformName && point.platformName!==object.platformName)reason='The returned platform does not match this object.'
        else if(point && (!Number.isFinite(stamp) || stamp>now.getTime()))reason='The returned creation time is invalid or in the future.'
        if(reason)return {data:[{state:'unavailable',creationTime:null,reason} as Latest],available:true,complete:false}
        const item:Latest=point ? {state:'verified',creationTime:point.creationTime!}:{state:'empty',creationTime:null}
        return {data:[item],available:true,complete:true}
      })())
      latest[key]=result.data[0] || {state:'unavailable',creationTime:null,reason:result.error || 'Recovery time unavailable.'}
    }
  }
  await Promise.all(Array.from({length:Math.min(4,objects.data.length)},loadTimes))
  if(objects.data.length>timeLimit)warnings.push('Recovery-time lookups are limited to 100 backup-object records. Other RPO states remain unknown.')
  return {...snapshot,latest,recoveryTimesRequested:true,recoveryTimesFetchedAt:now.toISOString(),warnings:[...new Set(warnings)]}
}
