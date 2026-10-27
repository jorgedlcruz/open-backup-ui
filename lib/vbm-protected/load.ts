import { z } from 'zod'
import { validId } from '../investigation/model'
import { collection,VbmRequestError,type Reader } from '../vbm-dashboard/load'
import { organizationSchema,repositorySchema,jobSchema,usageSchema,type Evidence } from '../vbm-dashboard/model'
import { objectSchema,pointSchema,objectType,opaqueId,objectKey,pointKey,summary,types,type ProtectedObject,type ObjectType,type Context,type Inventory,type Detail,type Point } from './model'

function limited(raw:Reader):Reader {let active=0;const queue:(()=>void)[]=[];return async path=>{if(active>=4)await new Promise<void>(resolve=>queue.push(resolve));active++;try{return await raw(path)}finally{active--;queue.shift()?.()}}}
const missing=<T>(error:string):Evidence<T>=>({data:[],available:false,complete:false,error})
function collector(read:Reader,warnings:string[]) {return async<T>(label:string,path:string,schema:z.ZodType<T>,key:(row:T)=>string,max=5000)=>{const result=await collection(read,path,schema,key,max);if(!result.complete)warnings.push(`${label}: ${result.error || 'Partial collection. Counts cover loaded records.'}`);return result}}
async function context(read:Reader,sourceName:string,now:Date):Promise<Context> {
  const warnings:string[]=[],collect=collector(read,warnings)
  const [organizations,repositories,jobs]=await Promise.all([collect('Organizations','/v8/Organizations',organizationSchema,row=>row.id),collect('Repositories','/v8/BackupRepositories',repositorySchema,row=>row.id),collect('Jobs','/v8/Jobs',jobSchema,row=>row.id)])
  return {sourceName,fetchedAt:now.toISOString(),warnings,organizations,repositories,jobs}
}
export async function pointsFor(read:Reader,type:ObjectType,id:string,organizationId?:string|null):Promise<Evidence<Point>> {
  objectType.parse(type);opaqueId.parse(id)
  const query=new URLSearchParams({[`${type.toLowerCase()}Id`]:id,orderAsc:'false'})
  if(organizationId && validId(organizationId))query.set('organizationId',organizationId)
  const result=await collection(read,`/v8/RestorePoints?${query}`,pointSchema,pointKey)
  // Reject cross-tenant evidence even if an upstream server ignores its scope filter.
  if(organizationId && result.data.some(point=>point.organizationId && point.organizationId.toLowerCase()!==organizationId.toLowerCase()))return {...result,data:result.data.filter(point=>!point.organizationId || point.organizationId.toLowerCase()===organizationId.toLowerCase()),complete:false,error:'Restore points from a different organization were excluded.'}
  return result
}
export async function loadInventory(raw:Reader,sourceName:string,now=new Date()):Promise<Inventory> {
  const read=limited(raw),base=await context(read,sourceName,now),collect=collector(read,base.warnings)
  const sources=await Promise.all(types.map(type=>collect(`Protected ${type.toLowerCase()}s`,`/v8/Protected${type}s`,objectSchema,row=>JSON.stringify([row.organizationId,row.backedUpOrganizationId,row.id]))))
  if(sources.every(source=>!source.available))throw new VbmRequestError('Protected objects could not be read. Check the Microsoft 365 connection and permissions.',502)
  const objects:ProtectedObject[]=sources.flatMap((source,index)=>source.data.map(row=>({...row,type:types[index]})))
  const rows=await Promise.all(objects.map(async(object,index)=>({ ...object,key:objectKey(object),summary:summary(index<200 ? await pointsFor(read,object.type,object.id,object.organizationId):missing('Open restore points to load this object.'),now.getTime()) })))
  if(objects.length>200)base.warnings.push('Restore-point summaries are limited to the first 200 objects. Open an object to investigate its full retained history.')
  const incomplete=rows.filter(row=>!row.summary.complete).length
  if(incomplete)base.warnings.push(`${incomplete} objects have incomplete restore-point evidence. Unknown or partial counts are not zero.`)
  const usage=await Promise.all(base.organizations.data.slice(0,50).map(async org=>({organizationId:org.id,evidence:validId(org.id) ? await collect(`Storage for ${org.name || org.id}`,`/v8/Organizations/${encodeURIComponent(org.id)}/usedRepositories`,usageSchema,row=>row.repositoryId):missing<z.infer<typeof usageSchema>>('Invalid organization ID.')})))
  if(base.organizations.data.length>50)base.warnings.push('Storage measurements cover the first 50 organizations.')
  return {...base,objects:{data:rows,available:sources.some(source=>source.available),complete:sources.every(source=>source.complete)},usage}
}
export async function loadDetail(raw:Reader,sourceName:string,type:ObjectType,id:string,now=new Date()):Promise<Detail> {
  objectType.parse(type);opaqueId.parse(id)
  const read=limited(raw),base=await context(read,sourceName,now)
  let object:ProtectedObject|null=null
  try {const parsed=objectSchema.parse(await read(`/v8/Protected${type}s/${encodeURIComponent(id)}`));if(parsed.id!==id)throw new Error('Mismatched object');object={...parsed,type}}catch(error){if(error instanceof VbmRequestError && error.status===401)throw error;base.warnings.push('Object details are unavailable. Restore points remain scoped to the requested object ID.')}
  const points=await pointsFor(read,type,id,object?.organizationId)
  if(!points.complete)base.warnings.push(points.error || 'Restore points are partial; counts cover loaded records.')
  return {...base,object,points,summary:summary(points,now.getTime())}
}
