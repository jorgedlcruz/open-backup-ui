// Open Backup UI v1.3.0
import { collection, VbmRequestError, type Reader } from '../vbm-dashboard/load'
import type { Evidence } from '../vbm-dashboard/model'
import { objectKey, objectSchema, summary, types, type Row } from '../vbm-protected/model'

/** Recovery candidates need object identities and components, not tenant-wide point history or storage usage. */
export type RecoveryCandidates = {sourceName:string;fetchedAt:string;warnings:string[];objects:Evidence<Row>}
export async function loadRecoveryCandidates(read:Reader,sourceName:string,now=new Date()):Promise<RecoveryCandidates> {
  // Only four independent collections. Each collection retains bounded, validated pagination.
  const sources=await Promise.all(types.map(type=>collection(read,`/v8/Protected${type}s`,objectSchema,row=>JSON.stringify([row.organizationId,row.backedUpOrganizationId,row.id]))))
  if(sources.every(source=>!source.available))throw new VbmRequestError('Protected objects could not be read. Check the Microsoft 365 connection and permissions.',502)
  const objects=sources.flatMap((source,index)=>source.data.map(object=>{
    const typed={...object,type:types[index]}
    return {...typed,key:objectKey(typed),summary:summary({data:[],available:false,complete:false},now.getTime())}
  }))
  return {sourceName,fetchedAt:now.toISOString(),warnings:sources.flatMap((source,index)=>source.complete?[]:[`${types[index]} objects: ${source.error||'Only the currently loaded objects are available.'}`]),objects:{data:objects,available:true,complete:sources.every(source=>source.complete)}}
}

const ttl=30*60*1000
const snapshots=new Map<string,{value:RecoveryCandidates;expiresAt:number}>()
const pending=new Map<string,Promise<RecoveryCandidates>>()
/** Keys are derived from the configured source and authenticated read scope; callers never provide a URL or tenant. */
export function recoveryCandidates(read:Reader,sourceName:string,scope:string,refresh=false,now=Date.now()):Promise<RecoveryCandidates> {
  const cached=snapshots.get(scope)
  if(!refresh&&cached&&cached.expiresAt>now)return Promise.resolve(cached.value)
  const active=pending.get(scope)
  if(active)return active
  const request=loadRecoveryCandidates(read,sourceName,new Date(now)).then(value=>{
    for(const [key,entry] of snapshots)if(entry.expiresAt<=now)snapshots.delete(key)
    snapshots.delete(scope)
    snapshots.set(scope,{value,expiresAt:now+ttl})
    while(snapshots.size>32)snapshots.delete(snapshots.keys().next().value!)
    return value
  }).finally(()=>pending.delete(scope))
  pending.set(scope,request)
  return request
}
