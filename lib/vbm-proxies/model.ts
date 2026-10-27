import { z } from 'zod'
import { jobMatches, type Evidence } from '../vbm-dashboard/model'
import { backupJobSchema as jobSchema } from '../vbm-jobs/model'
import { repositorySchema } from '../vbm-repositories/model'

const text=z.string().nullish(),ref=text.transform(value=>value?.toLowerCase()),bool=z.boolean().nullish()
const numeric=z.union([z.number(),z.string()]).nullish().transform(value=>typeof value==='string' && /^\d+(\.\d+)?$/.test(value) ? Number(value):value)
const percent=numeric.transform(value=>typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100 ? value:null)
const integer=numeric.transform(value=>typeof value==='number' && Number.isSafeInteger(value) && value>=0 ? value:null)
// Allowlist display evidence. Service credentials and connection secrets never reach the browser or exports.
export const proxySchema=z.object({id:z.string().min(1).transform(value=>value.toLowerCase()),hostName:text,fqdn:text,description:text,type:text,operatingSystem:text,
  port:integer,status:text,maintenanceModeState:text,cpuUsagePercent:percent,memoryUsagePercent:percent,version:text,role:z.array(z.string()).nullish(),proxyPoolId:ref,
  enableNetworkThrottling:bool,throttlingValue:integer,throttlingUnit:text,useInternetProxy:bool,internetProxyType:text,threadsNumber:integer,isOutdated:bool})
export type Proxy=z.infer<typeof proxySchema>
export type Snapshot={sourceName:string;fetchedAt:string;proxyId?:string;warnings:string[];proxies:Evidence<Proxy>;
  repositories:Evidence<z.infer<typeof repositorySchema>>;jobs:Evidence<z.infer<typeof jobSchema>>;serverVersion:string|null}
export { count } from '../vbm-repositories/model'
export const normalized=(value?:string|null)=>(value || '').toLowerCase()
export function availability(proxy:Proxy) {
  const status=normalized(proxy.status),maintenance=normalized(proxy.maintenanceModeState)
  return {online:status==='online',offline:status==='offline',unknown:!['online','offline'].includes(status),
    maintenance:!!maintenance && maintenance!=='disabled' && maintenance!=='none',maintenanceUnknown:!maintenance || !['disabled','none','enabled','enabling','disabling'].includes(maintenance),
    ready:status==='online' && ['disabled','none'].includes(maintenance)}
}
export function component(proxy:Proxy,serverVersion:string|null) {
  const parse=(value?:string|null)=>{const parts=value && /^\d+(\.\d+){1,5}$/.test(value) ? value.split('.').map(Number):null;return parts?.every(Number.isSafeInteger) ? parts:null}
  const a=parse(proxy.version),b=parse(serverVersion)
  let comparison:number|null=null
  if(a && b){comparison=0;for(let i=0;i<Math.max(a.length,b.length);i++){const delta=(a[i] || 0)-(b[i] || 0);if(delta){comparison=Math.sign(delta);break}}}
  if(proxy.isOutdated===true)return {state:'update',label:'Update required',detail:'Reported by the source',review:true}
  if(comparison!==null && comparison<0)return {state:'older',label:'Older than server',detail:`Server ${serverVersion}`,review:true}
  if(comparison!==null && comparison>0)return {state:'different',label:'Newer than server',detail:`Server ${serverVersion} · check compatibility`,review:true}
  if(comparison===0)return {state:'matching',label:'Matches server build',detail:`Server ${serverVersion}`,review:false}
  if(proxy.isOutdated===false)return {state:'reported',label:'No update reported',detail:'Reported by the source · build comparison unavailable',review:false}
  return {state:'unknown',label:'Update status unknown',detail:'Build comparison unavailable',review:false}
}
export function proxyRow(data:Snapshot,proxy:Proxy) {
  const state=availability(proxy),update=component(proxy,data.serverVersion)
  // A direct assignment takes precedence over pool membership. Shared pool dependencies are not proof of execution on this host.
  const repositories=data.repositories.data.filter(repository=>repository.proxyId ? repository.proxyId===proxy.id:!!proxy.proxyPoolId && repository.proxyPoolId===proxy.proxyPoolId)
  const ids=new Set(repositories.map(repository=>repository.id)),jobs=data.jobs.data.filter(job=>!!job.repositoryId && ids.has(job.repositoryId)),attention=jobs.filter(job=>jobMatches(job,'attention'))
  const pressure=[['CPU',proxy.cpuUsagePercent],['Memory',proxy.memoryUsagePercent]].flatMap(([label,value])=>typeof value==='number' && value>=80 ? [`${label}: ${value>=90 ? 'critical pressure':'high usage'} (${value.toFixed(1)}%)`]:[])
  const dependencyAvailable=data.repositories.available && data.jobs.available,dependencyComplete=dependencyAvailable && data.repositories.complete && data.jobs.complete
  const unknown=state.unknown || state.maintenanceUnknown || update.state==='unknown' || proxy.cpuUsagePercent===null || proxy.memoryUsagePercent===null || !proxy.role?.length || !dependencyComplete
  const issues=[...(state.offline ? ['Proxy offline']:state.unknown ? [`Availability: ${proxy.status || 'not reported'}`]:[]),...(state.maintenance ? [`Maintenance: ${proxy.maintenanceModeState}`]:[]),
    ...(update.review ? [update.label]:[]),...pressure,...(attention.length ? [`${attention.length} dependent job${attention.length===1 ? ' needs':'s need'} attention`]:[]),...(unknown ? ['Some evidence is unknown or incomplete']:[])]
  return {proxy,state,update,repositories,jobs,attention,pressure,dependencyAvailable,dependencyComplete,unknown,issues}
}
export type Row=ReturnType<typeof proxyRow>
export const jobCount=(row:Row)=>!row.dependencyAvailable ? 'Unknown':`${row.jobs.length}${row.dependencyComplete ? '':'+'}`
export const issues=[['all','All proxies'],['attention','Needs attention'],['unavailable','Unavailable / unknown'],['maintenance','Maintenance'],['updates','Component review'],['pressure','Resource pressure'],['jobs','Job issues'],['unknown','Unknown evidence']] as const
export type Issue=typeof issues[number][0]
export function matches(row:Row,issue:Issue) {return issue==='all' || (issue==='attention' ? row.issues.length>0:issue==='unavailable' ? !row.state.ready:issue==='maintenance' ? row.state.maintenance:issue==='updates' ? row.update.review:issue==='pressure' ? row.pressure.length>0:issue==='jobs' ? row.attention.length>0:row.unknown)}
export type Filters={query:string;issue:Issue;statuses:string[];roles:string[];os:string;type:string;sort:'name'|'issues'|'cpu'|'memory'}
export const emptyFilters:Filters={query:'',issue:'all',statuses:[],roles:[],os:'all',type:'all',sort:'name'}
export function filterRows(rows:Row[],filters:Filters) {
  return rows.filter(row=>matches(row,filters.issue) && (!filters.statuses.length || filters.statuses.includes(row.proxy.status || 'Not reported')) && (!filters.roles.length || row.proxy.role?.some(role=>filters.roles.includes(role)))
    && (filters.os==='all' || (row.proxy.operatingSystem || 'Not reported')===filters.os) && (filters.type==='all' || (row.proxy.type || 'Not reported')===filters.type)
    && [row.proxy.id,row.proxy.hostName,row.proxy.fqdn,row.proxy.description,row.proxy.version,row.proxy.proxyPoolId,...(row.proxy.role || []),...row.issues,...row.repositories.map(repository=>repository.name),...row.jobs.map(job=>job.name)].join(' ').toLowerCase().includes(filters.query.trim().toLowerCase()))
    .sort((a,b)=>(filters.sort==='issues' ? b.issues.length-a.issues.length:filters.sort==='cpu' ? (b.proxy.cpuUsagePercent ?? -1)-(a.proxy.cpuUsagePercent ?? -1):filters.sort==='memory' ? (b.proxy.memoryUsagePercent ?? -1)-(a.proxy.memoryUsagePercent ?? -1):0) || (a.proxy.hostName || a.proxy.id).localeCompare(b.proxy.hostName || b.proxy.id))
}
export const taskLimit={label:'Not exposed by v8 API',detail:'Concurrent task limits are not returned by this API. Job counts and legacy processing threads are not task limits.'}
