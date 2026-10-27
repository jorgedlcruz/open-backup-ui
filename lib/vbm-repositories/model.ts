import { z } from 'zod'
import { repositorySchema as baseRepository, jobSchema, organizationSchema, usageSchema, capacity, jobMatches, type Evidence } from '../vbm-dashboard/model'
import { knownSize } from '../restore-points/model'

const text=z.string().nullish(),ref=text.transform(value=>value?.toLowerCase()),bool=z.boolean().nullish()
const size=z.union([z.string(),z.number()]).nullish().transform(value=>knownSize(typeof value==='string' && /^\d+$/.test(value) ? Number(value):value))
export const repositorySchema=baseRepository.extend({proxyId:ref,proxyPoolId:ref,organizationId:ref,isLongTerm:bool,isIndexed:bool,
  objectStorageEncryptionEnabled:bool,retentionFrequencyType:text,dailyTime:text,dailyType:text,monthlyTime:text,monthlyDayNumber:text,monthlyDayOfWeek:text})
export const backedOrganizationSchema=z.object({id:z.string().min(1),name:text,usedSpaceBytes:size})
export const proxySchema=z.object({id:z.string().min(1).transform(value=>value.toLowerCase()),hostName:text,description:text,type:text,status:text})
export type Repository=z.infer<typeof repositorySchema>
export type Snapshot={sourceName:string;fetchedAt:string;repositoryId?:string;warnings:string[];repositories:Evidence<Repository>;
  jobs:Evidence<z.infer<typeof jobSchema>>;organizations:Evidence<z.infer<typeof organizationSchema>>;proxies:Evidence<z.infer<typeof proxySchema>>;
  usage:{organizationId:string;evidence:Evidence<z.infer<typeof usageSchema>>}[];backedOrganizations:Evidence<z.infer<typeof backedOrganizationSchema>>|null}
export const count=(evidence:Evidence<unknown>,n=evidence.data.length)=>!evidence.available ? 'Unknown':`${n}${evidence.complete ? '':'+'}`
export function retention(repository:Repository) {
  const period=repository.retentionPeriodType
  const value=period==='Daily' ? repository.dailyRetentionPeriod:period==='Monthly' ? repository.monthlyRetentionPeriod:period==='Yearly' ? repository.yearlyRetentionPeriod:null
  if(value==='KeepForever')return 'Keep forever'
  if(value) {
    const match=value.match(/^(?:Days?|Months?|Years?)?(\d+)$/i)
    if(match) {const n=Number(match[1]),unit=period==='Daily' ? 'day':period==='Monthly' ? 'month':'year';return `${n} ${unit}${n===1 ? '':'s'}`}
    return value
  }
  return period ? `${period} · period not reported`:'Not reported'
}
export function immutability(repository:Repository) {
  const object=repository.objectStorage
  if(!object)return {state:'na',label:'Not applicable',period:'Local repository',mode:'Not applicable'}
  if(object.enableImmutability!==true)return {state:object.enableImmutability===false ? 'disabled':'unknown',label:object.enableImmutability===false ? 'Disabled':'Unknown',period:'',mode:'Not reported'}
  const days=knownSize(object.immutabilityPeriodDays)
  return {state:'enabled',label:'Enabled',period:days===0 ? `Retention-based · ${retention(repository)}`:days!==null ? `${days} days`:'Period not reported',
    mode:object.enableImmutabilityGovernanceMode===true ? 'Governance':object.enableImmutabilityGovernanceMode===false ? 'Compliance':'Mode not reported'}
}
export const repositoryType=(repository:Repository)=>repository.objectStorage?.type || (repository.objectStorage ? 'Object storage':'Local')
export function sum(values:(number|null|undefined)[]) {const measured=values.map(knownSize).filter((value):value is number=>value!==null),total=measured.reduce((a,b)=>a+b,0);return {value:measured.length && Number.isSafeInteger(total) ? total:null,complete:measured.length===values.length && Number.isSafeInteger(total)}}
export function repositoryRow(data:Snapshot,repository:Repository) {
  const cap=capacity(repository),lock=immutability(repository),jobs=data.jobs.data.filter(job=>job.repositoryId===repository.id)
  const usage=data.usage.flatMap(group=>group.evidence.data.filter(row=>row.repositoryId===repository.id).map(row=>({...row,organizationId:group.organizationId})))
  const usageComplete=data.organizations.available && data.organizations.complete && data.usage.length===data.organizations.data.length && data.usage.every(group=>group.evidence.available && group.evidence.complete)
  const cache=sum(usage.map(row=>row.localCacheUsedSpaceBytes)),object=sum(usage.map(row=>row.objectStorageUsedSpaceBytes)),reported=sum(usage.map(row=>row.usedSpaceBytes))
  for(const measurement of [cache,object,reported])measurement.complete &&=usageComplete
  const capacityIssues=[['Disk',cap.disk],['Object quota',cap.quota]].flatMap(([label,value])=>typeof value==='object' && value && value.percent>=80 ? [`${label}: ${value.percent>=90 ? 'critical capacity':'low space'} (${value.percent.toFixed(1)}%)`]:[])
  const healthIssues:string[]=[]
  if(repository.isOutOfOrder)healthIssues.push(`Out of order${repository.outOfOrderReason ? `: ${repository.outOfOrderReason}`:''}`)
  if(repository.isOutOfSync)healthIssues.push('Out of sync')
  if(repository.isOutdated)healthIssues.push('Component update required')
  if(repository.maintenanceMode && !['None','Disabled'].includes(repository.maintenanceMode))healthIssues.push(`Maintenance: ${repository.maintenanceMode}`)
  const unavailable=usage.filter(row=>row.isAvailable===false)
  if(unavailable.length)healthIssues.push(`Unavailable to ${unavailable.length} organization${unavailable.length===1 ? '':'s'}`)
  const securityIssues:string[]=[]
  if(lock.state==='disabled')securityIssues.push('Object-storage immutability disabled')
  if(repository.objectStorage && repository.objectStorageEncryptionEnabled===false)securityIssues.push('Object-storage encryption disabled')
  const attention=jobs.filter(job=>jobMatches(job,'attention'))
  const unknown=!data.jobs.complete || !usageComplete || (!repository.objectStorage && reported.value===null) || [repository.isOutOfOrder,repository.isOutOfSync,repository.isOutdated].some(value=>value==null)
    || (repository.objectStorage ? lock.state==='unknown' || (lock.state==='enabled' && (knownSize(repository.objectStorage.immutabilityPeriodDays)===null || repository.objectStorage.enableImmutabilityGovernanceMode==null)) || repository.objectStorageEncryptionEnabled==null || cap.objectUsed===null || repository.objectStorage.sizeLimitEnabled==null || (repository.objectStorage.sizeLimitEnabled===true && cap.quota===null):cap.disk===null)
    || usage.some(row=>row.isAvailable==null || row.localCacheUsedSpaceBytes==null || row.objectStorageUsedSpaceBytes==null || row.usedSpaceBytes==null)
  const issues=[...healthIssues,...capacityIssues,...securityIssues,...(attention.length ? [`${attention.length} target job${attention.length===1 ? ' needs':'s need'} attention`]:[]),...(unknown ? ['Some evidence is unknown or incomplete']:[])]
  return {repository,cap,lock,jobs,attention,usage,usageComplete,cache,object,reported,capacityIssues,healthIssues,securityIssues,unavailable,unknown,issues,
    noJobs:data.jobs.available && data.jobs.complete && jobs.length===0,proxy:data.proxies.data.find(proxy=>proxy.id===repository.proxyId)}
}
export type Row=ReturnType<typeof repositoryRow>
export const issues=[['all','All repositories'],['attention','Needs attention'],['capacity','Capacity risk'],['health','Availability / health'],['immutability','Immutability disabled'],['governance','Governance mode'],['encryption','Encryption disabled'],['jobs','Job issues'],['noJobs','No target jobs'],['unknown','Unknown evidence']] as const
export type Issue=typeof issues[number][0]
export function matches(row:Row,issue:Issue) {return issue==='all' || (issue==='attention' ? row.issues.length>0:issue==='capacity' ? row.capacityIssues.length>0:issue==='health' ? row.healthIssues.length>0:issue==='immutability' ? row.lock.state==='disabled':issue==='governance' ? row.lock.mode==='Governance':issue==='encryption' ? !!row.repository.objectStorage && row.repository.objectStorageEncryptionEnabled===false:issue==='jobs' ? row.attention.length>0:issue==='noJobs' ? row.noJobs:row.unknown)}
export type Filters={query:string;issue:Issue;types:string[];immutability:string;retention:string;sort:'name'|'used'|'risk'}
export const emptyFilters:Filters={query:'',issue:'all',types:[],immutability:'all',retention:'all',sort:'name'}
export function filterRows(rows:Row[],filters:Filters) {
  return rows.filter(row=>matches(row,filters.issue) && (!filters.types.length || filters.types.includes(repositoryType(row.repository))) && (filters.immutability==='all' || row.lock.state===filters.immutability)
    && (filters.retention==='all' || row.repository.retentionType===filters.retention) && [row.repository.id,row.repository.name,row.repository.description,row.repository.path,repositoryType(row.repository),row.proxy?.hostName,row.repository.proxyId,...row.issues,...row.jobs.map(job=>job.name)].join(' ').toLowerCase().includes(filters.query.trim().toLowerCase()))
    .sort((a,b)=>(filters.sort==='risk' ? b.issues.length-a.issues.length:filters.sort==='used' ? (b.cap.primary?.percent ?? -1)-(a.cap.primary?.percent ?? -1):0) || (a.repository.name || a.repository.id).localeCompare(b.repository.name || b.repository.id))
}
export const jobsHref=(id:string)=>`/vbm/jobs?${new URLSearchParams({repositoryId:id})}`
export function objectTotals(rows:Row[]) {
  // Deduplicate shared object-storage IDs. Conflicting measurements cannot yield a trustworthy total.
  const groups=new Map<string,(number|null)[]>()
  for(const row of rows)if(row.repository.objectStorage){const key=row.repository.objectStorage.id || row.repository.id;groups.set(key,[...(groups.get(key) || []),row.cap.objectUsed])}
  const values=[...groups.values()].map(group=>group.every(value=>value!==null && value===group[0]) ? group[0]:null)
  return {...sum(values),stores:groups.size}
}
