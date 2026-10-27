import { z } from 'zod'
import { collection,VbmRequestError,type Reader } from '../vbm-dashboard/load'
import { jobSchema,organizationSchema,usageSchema,type Evidence } from '../vbm-dashboard/model'
import { validId } from '../investigation/model'
import { repositorySchema,backedOrganizationSchema,proxySchema,type Snapshot } from './model'

export async function loadRepositories(raw:Reader,sourceName:string,repositoryId?:string,now=new Date()):Promise<Snapshot> {
  if(repositoryId && !validId(repositoryId))throw new VbmRequestError('Invalid repository ID.',400)
  repositoryId=repositoryId?.toLowerCase()
  let active=0;const queue:(()=>void)[]=[]
  const read:Reader=async path=>{if(active>=4)await new Promise<void>(resolve=>queue.push(resolve));active++;try{return await raw(path)}finally{active--;queue.shift()?.()}}
  const warnings:string[]=[]
  const collect=async<T>(label:string,path:string,schema:z.ZodType<T>,key:(row:T)=>string)=>{const result=await collection(read,path,schema,key);if(!result.complete)warnings.push(`${label}: ${result.error || 'Partial collection. Only loaded records are counted.'}`);return result}
  let repositories:Snapshot['repositories']
  if(repositoryId) {
    const repository=repositorySchema.parse(await read(`/v8/BackupRepositories/${encodeURIComponent(repositoryId)}`))
    if(repository.id!==repositoryId)throw new VbmRequestError('The source returned a different repository. Refresh to retry.',502)
    repositories={data:[repository],available:true,complete:true}
  } else repositories=await collect('Repositories','/v8/BackupRepositories',repositorySchema,row=>row.id)
  if(!repositories.available)throw new VbmRequestError('Repositories could not be read. Check your Microsoft 365 connection and permissions.',502)
  const [jobs,organizations,proxies]=await Promise.all([
    collect('Target jobs','/v8/Jobs',jobSchema,row=>row.id),collect('Organizations','/v8/Organizations?extendedView=false',organizationSchema,row=>row.id),
    collect('Assigned proxies','/v8/Proxies',proxySchema,row=>row.id)
  ])
  const unattributed=jobs.data.filter(job=>!job.repositoryId).length
  if(unattributed){jobs.complete=false;warnings.push(`${unattributed} jobs have no repository ID and cannot be attributed to a target.`)}
  // At most fifty tenant usage reads per snapshot, four concurrent requests. Detail retains the independent repository-side organization inventory.
  const [usage,backedOrganizations]=await Promise.all([Promise.all(organizations.data.slice(0,50).map(async organization=>({organizationId:organization.id,evidence:validId(organization.id)
    ? await collect(`Usage for ${organization.name || organization.id}`,`/v8/Organizations/${encodeURIComponent(organization.id)}/usedRepositories`,usageSchema,row=>row.repositoryId)
    : {data:[],available:false,complete:false,error:'Invalid organization ID.'} as Evidence<z.infer<typeof usageSchema>>}))),
    repositoryId ? collect('Backed-up organizations',`/v8/BackupRepositories/${encodeURIComponent(repositoryId)}/backedupOrganizations`,backedOrganizationSchema,row=>row.id):Promise.resolve(null)])
  if(organizations.data.length>50)warnings.push('Organization usage covers the first 50 configured organizations. Repository-side backed-up organization records remain available in each detail view.')
  if(usage.some(group=>!validId(group.organizationId)))warnings.push('Usage could not be read for an invalid organization ID.')
  return {sourceName,fetchedAt:now.toISOString(),repositoryId,warnings,repositories,jobs,organizations,proxies,usage,backedOrganizations}
}
