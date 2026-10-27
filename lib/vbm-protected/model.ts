import { z } from 'zod'
import { time } from '../investigation/model'
import { organizationSchema, repositorySchema, jobSchema, usageSchema, type Evidence } from '../vbm-dashboard/model'

const text=z.string().nullish(),bool=z.boolean().nullish()
// Protected-object IDs are opaque, often tenant-qualified strings, not UUIDs.
export const opaqueId=z.string().min(1).max(2048).refine(value=>!/[\u0000-\u001f\u007f]/.test(value) && value!=='.' && value!=='..')
const component=z.object({id:opaqueId,displayName:text,email:text,url:text,isArchive:bool})
export const objectSchema=z.object({id:opaqueId,msid:text,displayName:text,name:text,accountType:text,organizationId:text,backedUpOrganizationId:text,url:text,description:text,
  mailboxes:z.array(component).nullish(),oneDrives:z.array(component).nullish(),sites:z.array(component).nullish(),eTag:z.number().nullish()})
export const pointSchema=z.object({id:opaqueId,isDeleted:bool,repositoryId:text,backupTime:text,jobId:text,organizationId:text,isExchange:bool,isSharePoint:bool,isOneDrive:bool,isTeams:bool,isLongTermCopy:bool,isCopy:bool,isRetrieved:bool,retrievalId:text,immutabilityExpiresOn:text,eTag:z.number().nullish(),objectsEtag:z.number().nullish()})
export const types=['User','Group','Site','Team'] as const
export type ObjectType=typeof types[number]
export const objectType=z.enum(types)
export type ProtectedObject=z.infer<typeof objectSchema> & {type:ObjectType}
export type Point=z.infer<typeof pointSchema>
export type Summary={available:boolean;complete:boolean;error?:string;count:number|null;deleted:number;unknownDeletion:number;latest:string|null;invalidDates:number;repositories:string[];jobs:string[];content:string[];copies:number;archives:number}
export type Row=ProtectedObject & {key:string;summary:Summary}
export type Context={sourceName:string;fetchedAt:string;warnings:string[];organizations:Evidence<z.infer<typeof organizationSchema>>;repositories:Evidence<z.infer<typeof repositorySchema>>;jobs:Evidence<z.infer<typeof jobSchema>>}
export type Inventory=Context & {objects:Evidence<Row>;usage:{organizationId:string;evidence:Evidence<z.infer<typeof usageSchema>>}[]}
export type Detail=Context & {object:ProtectedObject|null;points:Evidence<Point>;summary:Summary}
export const objectKey=(object:ProtectedObject)=>JSON.stringify([object.type,object.organizationId || '',object.backedUpOrganizationId || '',object.id])
export const pointKey=(point:Point)=>JSON.stringify([point.organizationId || '',point.repositoryId || '',point.id])
export const name=(object:ProtectedObject)=>object.displayName || object.name || object.id
export const lookup=(rows:{id:string;name?:string|null}[],id?:string|null)=>rows.find(row=>row.id.toLowerCase()===id?.toLowerCase())?.name || id || 'Not reported'
export const organization=(row:ProtectedObject,context:Context)=>lookup(context.organizations.data,row.organizationId || row.backedUpOrganizationId?.split(':')[0])
export const contentTypes=['Exchange','SharePoint','OneDrive','Teams'] as const
export const content=(point:Point)=>contentTypes.filter(kind=>point[`is${kind}`]===true)
export function summary(evidence:Evidence<Point>,now:number):Summary {
  const active=evidence.data.filter(point=>point.isDeleted===false),unknownDeletion=evidence.data.filter(point=>point.isDeleted==null).length
  const valid=active.filter(point=>time(point.backupTime)!==null && time(point.backupTime)!<=now).sort((a,b)=>time(b.backupTime)!-time(a.backupTime)!)
  return {available:evidence.available,complete:evidence.complete,error:evidence.error,count:evidence.available ? active.length:null,
    deleted:evidence.data.filter(point=>point.isDeleted===true).length,unknownDeletion,latest:valid[0]?.backupTime || null,invalidDates:active.length-valid.length,
    repositories:[...new Set(active.flatMap(point=>point.repositoryId ? [point.repositoryId]:[]))],jobs:[...new Set(active.flatMap(point=>point.jobId ? [point.jobId]:[]))],content:[...new Set(active.flatMap(content))],copies:active.filter(point=>point.isCopy===true && point.isLongTermCopy!==true).length,archives:active.filter(point=>point.isLongTermCopy===true).length}
}
export function coverage(value:Summary) {
  return value.count!==null && value.count>0 ? 'Restore points available':value.available && value.complete && !value.unknownDeletion ? 'No restore points':'Unknown'
}
export function freshness(value:Summary,hours:number,now:number) {
  if(coverage(value)==='No restore points')return 'No restore points'
  const latest=time(value.latest)
  if(latest!==null && latest<=now && now-latest<=hours*3600000)return 'Within threshold'
  if(value.complete && !value.unknownDeletion && !value.invalidDates && latest!==null && latest<=now)return 'Outside threshold'
  return 'Unknown'
}
export const countLabel=(value:Summary)=>value.count===null ? 'Unknown':`${value.count}${!value.complete || value.unknownDeletion ? '+':''}`
export const copyKind=(point:Point)=>point.isLongTermCopy===true ? 'Archive':point.isCopy===true ? 'Copy':point.isCopy===false && point.isLongTermCopy===false ? 'Primary':'Not reported'
export const pointState=(point:Point)=>point.isDeleted===true ? 'Deleted':point.isDeleted===false ? 'Retained':'Unknown'
export function restoreHref(row:ProtectedObject) {return `/vbm/protected-items/restore-points?${new URLSearchParams({type:row.type,id:row.id,name:name(row)})}`}
export type Filters={query:string;types:string[];organizations:string[];statuses:string[];issue:string;repository:string}
export const emptyFilters:Filters={query:'',types:[],organizations:[],statuses:[],issue:'all',repository:'all'}
export function matches(row:Row,issue:string,hours:number,now:number) {
  const state=freshness(row.summary,hours,now)
  return issue==='all' || (issue==='attention' ? state!=='Within threshold':issue==='available' ? coverage(row.summary)==='Restore points available':issue==='stale' ? state==='Outside threshold':issue==='none' ? state==='No restore points':issue==='unknown' ? state==='Unknown':issue==='partial' ? !row.summary.complete:false)
}
export function filterObjects(data:Inventory,filters:Filters,hours:number,now:number) {
  return data.objects.data.filter(row=>(!filters.types.length || filters.types.includes(row.type)) && (!filters.organizations.length || filters.organizations.includes(row.organizationId || row.backedUpOrganizationId || ''))
    && (!filters.statuses.length || filters.statuses.includes(freshness(row.summary,hours,now))) && matches(row,filters.issue,hours,now)
    && (filters.repository==='all' || row.summary.repositories.includes(filters.repository))
    && [name(row),row.id,row.msid,row.type,organization(row,data),row.backedUpOrganizationId,row.url,row.description,row.accountType,...(row.mailboxes || []).flatMap(item=>[item.email,item.displayName]),...(row.oneDrives || []).flatMap(item=>[item.url,item.displayName]),...(row.sites || []).flatMap(item=>[item.url,item.displayName])].join(' ').toLowerCase().includes(filters.query.trim().toLowerCase()))
}
export function filterPoints(data:Detail,filters:{query:string;content:string[];repository:string;kind:string;state:string}) {
  return data.points.data.filter(point=>(!filters.content.length || content(point).some(kind=>filters.content.includes(kind))) && (filters.repository==='all' || point.repositoryId===filters.repository)
    && (filters.kind==='all' || copyKind(point)===filters.kind) && (filters.state==='all' || pointState(point)===filters.state)
    && [point.id,lookup(data.jobs.data,point.jobId),lookup(data.repositories.data,point.repositoryId),lookup(data.organizations.data,point.organizationId),...content(point)].join(' ').toLowerCase().includes(filters.query.trim().toLowerCase()))
}
export function storageSummary(data:Inventory,organizations:string[]) {
  const scope=data.usage.filter(org=>!organizations.length || organizations.includes(org.organizationId))
  const rows=scope.flatMap(org=>org.evidence.data.map(row=>({...row,organizationId:org.organizationId,complete:org.evidence.complete})))
  // Used space can overlap cache/object measurements; never add it to these two components.
  const measurements=rows.flatMap(row=>[row.localCacheUsedSpaceBytes,row.objectStorageUsedSpaceBytes]).filter((value):value is number=>typeof value==='number')
  const sum=measurements.reduce((a,b)=>a+b,0)
  const complete=data.organizations.complete && data.usage.length===data.organizations.data.length && scope.every(org=>org.evidence.complete) && measurements.length===rows.length*2 && Number.isSafeInteger(sum)
  return {rows,total:measurements.length && Number.isSafeInteger(sum) ? sum:null,complete}
}
