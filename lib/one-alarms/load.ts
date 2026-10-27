import { createHash } from 'node:crypto'
import { z } from 'zod'
import { type Alarm, type Detail, type Evidence, type Filters, type HistoryDay, type Snapshot, type Template, dateMs, id, normalizeAlarm, number, object, startTime, text } from './model'

export class AlarmError extends Error { constructor(message:string, public status=502) { super(message) } }
export type Execute = (path:string, method?:'GET'|'POST', body?:unknown, mutation?:boolean) => Promise<unknown>
export type Query = { offset:number; limit:number; filter?:string; sort?:string; groupBy?:string }
export const root = '/api/v2.3/alarms'
export const expr = (property:string, value:unknown, operation='equals') => ({property,value,operation,collation:'ignorecase'})
const and = (items:unknown[]) => items.length===1 ? items[0] : {operation:'and',items}
export const revision = (alarm:Alarm) => createHash('sha256').update(JSON.stringify([alarm.triggeredAlarmId,alarm.triggeredSubAlarmId,alarm.entityId,alarm.entityType,alarm.isVid,alarm.alarmId,alarm.time,alarm.status,alarm.description,alarm.source])).digest('hex')
export function apiFilter(filters:Filters, now:number) {
  const items:unknown[] = [], start=startTime(filters.range,now)
  if(start!==null) items.push(expr('time',new Date(start).toISOString(),'greaterThanOrEqual'))
  if(filters.from) items.push(expr('time',`${filters.from}T00:00:00.000Z`,'greaterThanOrEqual'))
  if(filters.to) items.push(expr('time',new Date(Date.parse(`${filters.to}T00:00:00Z`)+86400000).toISOString(),'lessThan'))
  // The history enum omits Remediated, although current child alarms support it.
  if(filters.statuses.length) {
    const supported=filters.statuses.filter(status=>status!=='Remediated')
    if(supported.length)items.push(expr('status',supported,'in'))
    else items.push(expr('status','Error'),expr('status','Warning')) // Valid, empty intersection.
  }
  if(['attention','aged'].includes(filters.issue))items.push(expr('status',['Error','Warning'],'in'))
  if(filters.issue==='aged')items.push(expr('time',new Date(now-86400000).toISOString(),'lessThanOrEqual'))
  if(filters.issue==='unresolved')items.push(expr('status',['Error','Warning','Information','Acknowledged'],'in'))
  if(filters.issue==='resolved')items.push(expr('status',['Resolved','Success'],'in'))
  if(filters.issue==='unknown')items.push({operation:'not',items:[expr('status',['Error','Warning','Information','Acknowledged','Resolved','Success'],'in')]})
  if(filters.type!=='all')items.push(expr('entityType',filters.type))
  if(filters.source!=='all')items.push(expr('source',filters.source))
  if(filters.entity!=='all') {
    const entity=z.tuple([z.number().int().nonnegative().safe(),z.string().min(1),z.boolean().nullable()]).parse(JSON.parse(filters.entity))
    items.push(expr('entityId',entity[0]),expr('entityType',entity[1]),expr('isVid',entity[2]))
  }
  if(filters.location!=='all') {
    const parts=z.tuple([z.string(),z.string(),z.string()]).parse(JSON.parse(filters.location))
    for(const [index,property]of ['cityName','subregion','region'].entries())items.push(parts[index] ? expr(property,parts[index]) : {operation:'or',items:[expr(property,null),expr(property,'')]})
  }
  if(filters.query.trim())items.push({operation:'or',items:['alarmName','entityName','source','description'].map(field=>expr(field,filters.query.trim(),'contains'))})
  return items.length ? JSON.stringify(and(items)) : undefined
}
export async function query(execute:Execute, resource:'triggeredChildAlarms'|'triggeredAlarmsHistory', value:Query) {
  try { return await execute(`${root}/${resource}`,'POST',{onlyVid:false,query:value}) }
  catch(error) {
    // Older ONE builds expose the same read resources as GET queries.
    if(!(error instanceof AlarmError) || ![404,405].includes(error.status))throw error
    const params=new URLSearchParams();for(const [key,item]of Object.entries(value))if(item!==undefined)params.set(key[0].toUpperCase()+key.slice(1),String(item))
    return execute(`${root}/${resource}?${params}`)
  }
}
const pageSchema=z.object({items:z.array(z.unknown()),totalCount:z.number().int().nonnegative().optional()})
const issue=(label:string,error:unknown)=>`${label} could not be read${error instanceof AlarmError && error.status===403 ? ' with this account’s permissions':''}. Missing evidence is unknown.`
export async function collection<T>(read:(offset:number,limit:number)=>Promise<unknown>, normalize:(value:unknown)=>T, key:(value:T)=>string, label:string, max=5000):Promise<Evidence<T[]>> {
  const values=new Map<string,T>();let offset=0,total:number|null=null
  try {
    for(let page=0;page<100;page++) {
      const result=pageSchema.parse(await read(offset,Math.min(200,max-offset)));total=result.totalCount??null
      const before=values.size
      for(const raw of result.items) {const item=normalize(raw);if(values.size<max)values.set(key(item),item)}
      offset+=result.items.length
      if(result.items.length && (values.size===before || values.size<offset))break
      if(total!==null && offset>=total || total===null && result.items.length<200) return {data:[...values.values()],complete:offset<=max,error:offset>max ? `${label} reached the view limit.`:null,total}
      if(!result.items.length)break
      if(values.size>=max)break
    }
    return {data:[...values.values()],complete:false,error:`${label} are partial: pagination repeated, ended early or reached the ${max.toLocaleString()} record limit.`,total}
  }catch(error) {if(error instanceof AlarmError && [401,409].includes(error.status))throw error;return {data:[...values.values()],complete:false,error:issue(label,error),total}}
}
export function normalizeDay(value:unknown):HistoryDay {
  const row=object(value),count=number(row.status_Count),time=dateMs(text(row.time))
  if(count===null || !Number.isSafeInteger(count) || count<0 || time===null)throw Error('Invalid daily total')
  return {time:new Date(time).toISOString(),status:text(row.status)||'Unknown',count}
}
export async function historyPage(execute:Execute, filter:string|undefined, page:number):Promise<Evidence<Alarm[]>> {
  try {
    const result=pageSchema.parse(await query(execute,'triggeredAlarmsHistory',{offset:page*20,limit:20,filter,sort:JSON.stringify([{property:'time',direction:'descending'}])}))
    return {data:result.items.map(normalizeAlarm),complete:true,error:null,total:result.totalCount??null}
  }catch(error){if(error instanceof AlarmError && [401,409].includes(error.status))throw error;return {data:[],complete:false,error:issue('Alarm history',error),total:null}}
}
export async function loadOverview(execute:Execute,filters:Filters,page:number,sourceName:string,sourceKey:string,now=Date.now()):Promise<Snapshot> {
  const filter=apiFilter(filters,now),sort=JSON.stringify([{property:'time',direction:'descending'}])
  const currentFilter=apiFilter({...filters,query:'',statuses:[],issue:'all',type:'all',source:'all',entity:'all',location:'all',from:'',to:''},now)
  const [current,days,history]=await Promise.all([
    collection((offset,limit)=>query(execute,'triggeredChildAlarms',{offset,limit,filter:currentFilter,sort}),normalizeAlarm,row=>row.key,'Current alarms'),
    collection((offset,limit)=>query(execute,'triggeredAlarmsHistory',{offset,limit,filter,groupBy:JSON.stringify({groupBy:['time','status'],aggregations:[{distinct:false,function:'Count',property:'status'}],options:[{option:'Day',propertyName:'time'}]})}),normalizeDay,row=>`${row.time}:${row.status}`,'Daily history totals'),
    historyPage(execute,filter,page),
  ])
  return {current:{...current,data:current.data.map(row=>({...row,revision:revision(row)}))},days,history,historyPage:page,sourceName,sourceKey,fetchedAt:new Date(now).toISOString(),filters}
}
export async function loadDetail(execute:Execute,alarmId:number|null,parentId:number,childId:number,sourceKey:string):Promise<Detail> {
  const templateRead=async():Promise<Evidence<Template|null>>=>{
    if(alarmId===null)return {data:null,complete:false,total:null,error:'No alarm template ID was reported.'}
    try {const row=object(await execute(`${root}/templates/${alarmId}`));if(id(row.alarmTemplateId)!==alarmId)throw Error('Wrong template');return {data:{id:alarmId,name:text(row.name),type:text(row.type),enabled:typeof row.isEnabled==='boolean'?row.isEnabled:null,predefined:typeof row.isPredefined==='boolean'?row.isPredefined:null,summary:text(row.knowledgeSummary),cause:text(row.knowledgeCause),resolution:text(row.knowledgeResolution),custom:text(row.knowledgeCustom),external:text(row.knowledgeExternal)},complete:true,error:null,total:1}}
    catch(error){if(error instanceof AlarmError && [401,409].includes(error.status))throw error;return {data:null,complete:false,total:null,error:issue('Knowledge base',error)}}
  }
  const filter=JSON.stringify(and([expr('triggeredAlarmId',parentId),expr('triggeredSubAlarmId',childId)]))
  const [template,history]=await Promise.all([templateRead(),collection((offset,limit)=>query(execute,'triggeredAlarmsHistory',{offset,limit,filter,sort:JSON.stringify([{property:'time',direction:'descending'}])}),normalizeAlarm,row=>row.key,'This trigger’s history',1000)])
  return {template,history,sourceKey}
}
export const resolveSchema=z.object({sourceKey:z.string().regex(/^[a-f0-9]{64}$/),parentId:z.number().int().positive().safe(),childId:z.number().int().positive().safe(),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),comment:z.string().trim().min(1).max(1024)}).strict()
export async function resolveAlarm(execute:Execute,input:z.infer<typeof resolveSchema>) {
  const filter=JSON.stringify(and([expr('triggeredAlarmId',input.parentId),expr('triggeredSubAlarmId',input.childId)]))
  const result=pageSchema.parse(await query(execute,'triggeredChildAlarms',{offset:0,limit:2,filter}))
  if(result.items.length!==1)throw new AlarmError('The alarm is no longer uniquely available. Refresh and review it before resolving.',409)
  const current=normalizeAlarm(result.items[0])
  if(current.triggeredAlarmId!==input.parentId || current.triggeredSubAlarmId!==input.childId || revision(current)!==input.expectedRevision || !['Error','Warning','Information','Acknowledged'].includes(current.status))throw new AlarmError('The alarm changed or is already resolved. Refresh before continuing.',409)
  await execute(`${root}/triggeredChildAlarms/resolve`,'POST',{triggeredChildAlarmIds:[input.childId],comment:input.comment,resolveType:'Resolve'},true)
  return {accepted:true}
}
