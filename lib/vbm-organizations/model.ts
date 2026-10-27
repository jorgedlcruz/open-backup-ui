import { z } from 'zod'
import { time } from '../investigation/model'
import { organizationSchema as baseOrganization,repositorySchema,usageSchema,licensedSchema,jobMatches,status,licensedIssue,capacity,kinds,type Kind,type Evidence,type Job } from '../vbm-dashboard/model'
import { opaqueId } from '../vbm-protected/model'
const text=z.string().nullish(),bool=z.boolean().nullish()
export const organizationSchema=baseOrganization.extend({region:text,officeName:text,msid:text,isExchangeOnline:bool,isSharePointOnline:bool,isTeamsOnline:bool})
export const protectedSchema=z.object({id:opaqueId,displayName:text,name:text,organizationId:text,backedUpOrganizationId:text})
export const userSchema=licensedSchema.extend({id:opaqueId})
export type Organization=z.infer<typeof organizationSchema>
export type Snapshot={sourceName:string;fetchedAt:string;warnings:string[];organizationId?:string;organizations:Evidence<Organization>;jobs:Evidence<Job>;repositories:Evidence<z.infer<typeof repositorySchema>>;licensed:Evidence<z.infer<typeof userSchema>>;protected:Record<Kind,Evidence<z.infer<typeof protectedSchema>>>;usage:{organizationId:string;evidence:Evidence<z.infer<typeof usageSchema>>}[]}
const normalized=(value?:string|null)=>value?.trim().toLowerCase() || ''
type Scoped={organizationId?:string|null;backedUpOrganizationId?:string|null}
export function belongs(row:Scoped,org:Organization,organizations:Organization[]) {
  // An explicit configured organization ID wins. Never join tenants by display name.
  if(row.organizationId && row.organizationId!=='00000000-0000-0000-0000-000000000000')return normalized(row.organizationId)===org.id
  const backed=normalized(row.backedUpOrganizationId)
  return !!backed && normalized(org.backedUpOrganizationId)===backed && organizations.filter(item=>normalized(item.backedUpOrganizationId)===backed).length===1
}
export const services=[{key:'isExchangeOnline',name:'Exchange',short:'EX'},{key:'isSharePointOnline',name:'SharePoint',short:'SP'},{key:'isTeamsOnline',name:'Teams',short:'TM'}] as const
export function measured(rows:z.infer<typeof usageSchema>[],key:'localCacheUsedSpaceBytes'|'objectStorageUsedSpaceBytes'|'usedSpaceBytes',evidenceComplete:boolean) {
  const numbers=rows.map(row=>row[key]).filter((n):n is number=>typeof n==='number'),sum=numbers.reduce((a,b)=>a+b,0),safe=Number.isSafeInteger(sum)
  return {value:safe && numbers.length ? sum:null,complete:evidenceComplete && numbers.length===rows.length && safe}
}
export function organizationRow(data:Snapshot,org:Organization,hours=24) {
  const inScope=(row:Scoped)=>belongs(row,org,data.organizations.data)
  const jobs=data.jobs.data.filter(inScope),licensed=data.licensed.data.filter(inScope)
  const protectedRows=Object.fromEntries(kinds.map(kind=>[kind,data.protected[kind].data.filter(inScope)])) as Record<Kind,z.infer<typeof protectedSchema>[]>
  const usage=data.usage.find(row=>row.organizationId===org.id)?.evidence || {data:[],available:false,complete:false,error:'Usage not loaded. Open this organization to load its measurements.'}
  const cache=measured(usage.data,'localCacheUsedSpaceBytes',usage.complete),object=measured(usage.data,'objectStorageUsedSpaceBytes',usage.complete),local=measured(usage.data,'usedSpaceBytes',usage.complete)
  const values=[cache.value,object.value].filter((n):n is number=>n!==null),total=values.reduce((a,b)=>a+b,0)
  const storage={value:values.length && Number.isSafeInteger(total) ? total:null,complete:cache.complete && object.complete}
  const now=time(data.fetchedAt) || Date.now(),missing=licensed.filter(row=>row.isBackedUp===false),stale=licensed.filter(row=>licensedIssue(row,now,hours).startsWith('Older')),unknownUsers=licensed.filter(row=>licensedIssue(row,now,hours)==='Unknown evidence')
  const backed=licensed.filter(row=>row.isBackedUp===true).length,confirmedUsers=licensed.filter(row=>row.isBackedUp!=null).length
  const rate=data.licensed.complete && !licensed.some(row=>row.isBackedUp==null) && licensed.length ? backed/licensed.length*100:null
  const attention=jobs.filter(job=>jobMatches(job,'attention')),unknownJobs=jobs.filter(job=>jobMatches(job,'unknown') || job.schedulePolicy?.scheduleEnabled==null)
  const noJobs=data.jobs.complete && !jobs.length,noProtected=kinds.every(kind=>data.protected[kind].complete && !protectedRows[kind].length)
  const repositoryIds=[...new Set([...usage.data.map(row=>row.repositoryId),...jobs.flatMap(job=>job.repositoryId ? [job.repositoryId]:[])])]
  const repositoryProblems=repositoryIds.flatMap(id=>{
    const repo=data.repositories.data.find(row=>row.id===id),reasons:string[]=[]
    if(usage.data.some(row=>row.repositoryId===id && row.isAvailable===false))reasons.push('Unavailable to organization')
    if(repo) {if(repo.isOutOfOrder)reasons.push('Out of order');if(repo.isOutOfSync)reasons.push('Out of sync');if(repo.isOutdated)reasons.push('Update required');if(repo.maintenanceMode && !['None','Disabled'].includes(repo.maintenanceMode))reasons.push(`Maintenance: ${repo.maintenanceMode}`)
      const cap=capacity(repo);if(cap.disk && cap.disk.percent>=80)reasons.push('Low disk space');if(cap.quota && cap.quota.percent>=80)reasons.push('Low object quota headroom')}
    return reasons.map(reason=>({repositoryId:id,name:repo?.name || id,reason}))
  })
  const unknown=!data.jobs.complete || !data.licensed.complete || kinds.some(kind=>!data.protected[kind].complete) || !usage.complete || !data.repositories.complete || !!unknownUsers.length || !!unknownJobs.length || services.some(service=>org[service.key]==null) || usage.data.some(row=>row.isAvailable==null) || (usage.data.length>0 && !storage.complete) || repositoryIds.some(id=>!data.repositories.data.some(repo=>repo.id===id))
  const issues:string[]=[]
  if(attention.length)issues.push(`${attention.length} ${attention.length===1 ? 'job needs':'jobs need'} attention`)
  if(noJobs)issues.push('No configured backup jobs')
  if(missing.length)issues.push(`${missing.length} licensed users have no backup reported`)
  if(stale.length)issues.push(`${stale.length} licensed-user backups older than ${hours}h`)
  if(noProtected)issues.push('No retained protected objects')
  if(repositoryProblems.length)issues.push(`${new Set(repositoryProblems.map(row=>row.repositoryId)).size} repositories need attention`)
  if(unknown)issues.push('Unknown or incomplete evidence')
  const lastBackup=jobs.map(job=>job.lastBackup).filter((value):value is string=>time(value)!==null && time(value)!<=now).sort((a,b)=>time(b)!-time(a)!)[0] || null
  return {org,jobs,licensed,protected:protectedRows,usage,cache,object,local,storage,missing,stale,unknownUsers,backed,confirmedUsers,rate,attention,unknownJobs,noJobs,noProtected,repositoryIds,repositoryProblems,unknown,issues,lastBackup,running:jobs.filter(job=>status(job.lastStatus)==='Running').length}
}
export type Row=ReturnType<typeof organizationRow>
export const count=(evidence:{available:boolean;complete:boolean},n:number)=>!evidence.available ? 'Unknown':`${n}${evidence.complete ? '':'+'}`
export const issues=[['all','All organizations'],['attention','Needs attention'],['jobs','Job issues'],['coverage','Coverage gaps'],['stale','Older backups'],['storage','Storage issues'],['no-jobs','No jobs'],['unknown','Unknown evidence']] as const
export type Issue=typeof issues[number][0]
export function matches(row:Row,issue:string) {return issue==='all' || (issue==='attention' ? row.issues.length>0:issue==='jobs' ? row.attention.length>0:issue==='coverage' ? row.missing.length>0 || row.noProtected:issue==='stale' ? row.stale.length>0:issue==='storage' ? row.repositoryProblems.length>0:issue==='no-jobs' ? row.noJobs:issue==='unknown' ? row.unknown:false)}
export type Filters={query:string;regions:string[];types:string[];services:string[];issue:string}
export const emptyFilters:Filters={query:'',regions:[],types:[],services:[],issue:'all'}
export function filterRows(rows:Row[],filters:Filters) {return rows.filter(row=>matches(row,filters.issue) && (!filters.regions.length || filters.regions.includes(row.org.region || 'Not reported')) && (!filters.types.length || filters.types.includes(row.org.type || 'Not reported')) && (!filters.services.length || filters.services.some(name=>services.some(service=>service.name===name && row.org[service.key]===true))) && [row.org.name,row.org.id,row.org.officeName,row.org.region,row.org.type,...row.issues].join(' ').toLowerCase().includes(filters.query.trim().toLowerCase()))}
export const protectedHref=(org:Organization)=>`/vbm/protected-items?${new URLSearchParams({organizationId:org.id})}`
export const jobsHref=(org:Organization)=>`/vbm/jobs?${new URLSearchParams({organizationId:org.id})}`
export function legacyOrganizationIds(organizations:{id:string;name?:string|null}[],legacyName:string,complete=true) {
  const matches=organizations.filter(org=>normalized(org.name)===normalized(legacyName))
  return complete && matches.length===1 ? [matches[0].id]:['__unresolved_organization__']
}
