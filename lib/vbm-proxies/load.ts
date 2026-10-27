import { z } from 'zod'
import { collection,VbmRequestError,type Reader } from '../vbm-dashboard/load'
import { versionSchema } from '../vbm-dashboard/model'
import { backupJobSchema as jobSchema } from '../vbm-jobs/model'
import { repositorySchema } from '../vbm-repositories/model'
import { validId } from '../investigation/model'
import { proxySchema,type Snapshot } from './model'

export async function loadProxies(raw:Reader,sourceName:string,proxyId?:string,now=new Date()):Promise<Snapshot> {
  if(proxyId && !validId(proxyId))throw new VbmRequestError('Invalid proxy ID.',400)
  proxyId=proxyId?.toLowerCase()
  let active=0;const queue:(()=>void)[]=[]
  const read:Reader=async path=>{if(active>=4)await new Promise<void>(resolve=>queue.push(resolve));active++;try{return await raw(path)}finally{active--;queue.shift()?.()}}
  const warnings:string[]=[]
  const collect=async<T>(label:string,path:string,schema:z.ZodType<T>,key:(row:T)=>string)=>{const result=await collection(read,path,schema,key);if(!result.complete)warnings.push(`${label}: ${result.error || 'Only loaded records are counted.'}`);return result}
  let proxies:Snapshot['proxies']
  if(proxyId){const proxy=proxySchema.parse(await read(`/v8/Proxies/${encodeURIComponent(proxyId)}`));if(proxy.id!==proxyId)throw new VbmRequestError('The source returned a different proxy. Refresh to retry.',502);proxies={data:[proxy],available:true,complete:true}}
  else proxies=await collect('Proxies','/v8/Proxies',proxySchema,row=>row.id)
  if(!proxies.available)throw new VbmRequestError('Proxies could not be read. Check your Microsoft 365 connection and permissions.',502)
  const [repositories,jobs,serverVersion]=await Promise.all([
    collect('Repositories','/v8/BackupRepositories',repositorySchema,row=>row.id),collect('Dependent jobs','/v8/Jobs',jobSchema,row=>row.id),
    (async()=>{try{return versionSchema.parse(await read('/v8/ServiceInstance')).version || null}catch(error){if(error instanceof VbmRequestError && error.status===401)throw error;warnings.push('Server build unavailable. Component versions cannot be compared.');return null}})()
  ])
  if(repositories.data.some(repository=>!repository.proxyId && !repository.proxyPoolId)){repositories.complete=false;warnings.push('Some repositories have no proxy or pool ID. Their dependencies cannot be attributed.')}
  if(jobs.data.some(job=>!job.repositoryId)){jobs.complete=false;warnings.push('Some jobs have no repository ID. Their dependencies cannot be attributed.')}
  return {sourceName,fetchedAt:now.toISOString(),proxyId,warnings,proxies,repositories,jobs,serverVersion}
}
