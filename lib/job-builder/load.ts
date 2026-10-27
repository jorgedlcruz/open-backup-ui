import { z } from 'zod'
import { readOperationsCollection } from '../operations/load'
import { inventorySchema, itemKey } from '../virtual-infrastructure/model'
import { stateSchema as repositorySchema } from '../repositories/model'
import { proxyStateSchema,proxyConfigSchema } from '../proxies/model'
import { revisionForBuild } from '../investigation/model'
import { TopologyRequestError } from '../topology/load'
import type { VbrReader,VbrInventoryReader,VbrRevision } from '../server/vbr-read'
import { allowedTypes, objectSchema, objectKey, type JobObject, type Draft } from './model'

const credentialSchema=z.object({id:z.string().uuid(),username:z.string(),description:z.string().nullish(),type:z.string()})
const jobSchema=z.object({id:z.string(),name:z.string()})
export type Host={name:string;platform:'VSphere'|'HyperV'}
export async function revision(read:VbrReader):Promise<VbrRevision> {
  const value=z.object({buildVersion:z.string()}).parse(await read('/api/v1/serverInfo'))
  return revisionForBuild(value.buildVersion)
}
export async function browseObjects(browse:VbrInventoryReader,apiRevision:VbrRevision,host:string|null,platform?:Draft['platform']) {
  const objects=new Map<string,z.infer<typeof inventorySchema>>();let skip=0
  for(let page=0;page<50;page++) {
    const value=z.object({data:z.array(inventorySchema),pagination:z.object({total:z.number().optional()}).nullish()})
      .parse(await browse(host,skip,200,apiRevision,platform==='HyperV'?'HostsAndVms':'HostsAndClusters'))
    const previous=objects.size
    for(const item of value.data)objects.set(itemKey(item),item)
    skip+=value.data.length
    const total=value.pagination?.total
    if(total!==undefined && skip>=total)return {data:[...objects.values()],complete:true}
    if(!value.data.length)return {data:[...objects.values()],complete:total===undefined}
    if(objects.size===previous)return {data:[...objects.values()],complete:false}
    if(total===undefined && value.data.length<200)return {data:[...objects.values()],complete:true}
  }
  return {data:[...objects.values()],complete:false}
}
export function inventoryHosts(data:z.infer<typeof inventorySchema>[]):Host[] {
  return [...new Map(data.filter(i=>['VSphere','HyperV'].includes(i.platform||'') && (i.hostName||i.name))
    .map(i=>{const host={name:(i.hostName||i.name)!,platform:i.platform as Host['platform']};return [`${host.platform}|${host.name.toLowerCase()}`,host] as const})).values()]
}
export async function loadOptions(raw:VbrReader,browse:VbrInventoryReader,sourceName:string,sourceKey:string) {
  const apiRevision=await revision(raw),read=(path:string)=>raw(path,apiRevision),warnings:string[]=[]
  async function optional<T>(label:string,work:Promise<{data:T[];complete:boolean}>) {
    try {const value=await work;if(!value.complete)warnings.push(`${label}: only part of the inventory was returned.`);return value.data}
    catch(e){if(e instanceof TopologyRequestError && e.status===401)throw e;warnings.push(`${label} could not be loaded. Refresh the source or check permissions.`);return [] as T[]}
  }
  const [repositories,proxyStates,proxyConfigs,credentials,jobs,roots]=await Promise.all([
    optional('Repositories',readOperationsCollection(read,'/api/v1/backupInfrastructure/repositories/states',repositorySchema)),
    optional('Proxy availability',readOperationsCollection(read,'/api/v1/backupInfrastructure/proxies/states',proxyStateSchema)),
    optional('Proxies',readOperationsCollection(read,'/api/v1/backupInfrastructure/proxies',proxyConfigSchema)),
    optional('Guest credentials',readOperationsCollection(read,'/api/v1/credentials',credentialSchema)),
    optional('Job names',readOperationsCollection(read,'/api/v1/jobs',jobSchema)),
    optional('Inventory servers',browseObjects(browse,apiRevision,null)),
  ])
  // Return only fields needed for selection; credentials are references, never passwords.
  const proxies=proxyConfigs.map(p=>{const state=proxyStates.find(s=>s.id===p.id);return {id:p.id,name:p.name||p.server?.hostName||p.id,type:p.type||state?.type,isOnline:state?.isOnline,isDisabled:state?.isDisabled}})
  return {sourceName,sourceKey,apiRevision,fetchedAt:new Date().toISOString(),warnings,hosts:inventoryHosts(roots),
    repositories:repositories.filter(r=>!r.scaleOutRepositoryDetails?.scaleOutRepositoryId).map(r=>({id:r.id,name:r.name,type:r.type,isOnline:r.isOnline,capacityGB:r.capacityGB,freeGB:r.freeGB})),
    proxies,credentials:credentials.filter(c=>['Standard','Linux','ManagedService'].includes(c.type)),jobs}
}
export type BuilderOptions=Awaited<ReturnType<typeof loadOptions>>
export async function loadInventory(raw:VbrReader,browse:VbrInventoryReader,host:string,platform:Draft['platform']) {
  const apiRevision=await revision(raw),roots=await browseObjects(browse,apiRevision,null)
  if(!inventoryHosts(roots.data).some(h=>h.name.toLowerCase()===host.toLowerCase()&&h.platform===platform))throw new TopologyRequestError('Select an inventory server from this VBR source.',400)
  const result=await browseObjects(browse,apiRevision,host,platform)
  const objects:JobObject[]=[]
  for(const item of result.data) {
    if(item.platform!==platform||!allowedTypes[platform].includes(item.type||''))continue
    const value=objectSchema.safeParse({platform:item.platform,type:item.type,hostName:item.hostName||host,name:item.name,objectId:item.objectId,
      ...(item.urn?{urn:item.urn}:{}),...(item.parentObjectId?{parentObjectId:item.parentObjectId}:{}),...(item.size?{size:item.size}:{})})
    if(value.success)objects.push(value.data)
  }
  return {data:objects,complete:result.complete,fetchedAt:new Date().toISOString()}
}
export async function validateEnvironment(draft:Draft,raw:VbrReader,browse:VbrInventoryReader,options:BuilderOptions) {
  const errors:string[]=[]
  if(draft.sourceKey!==options.sourceKey)return ['The selected VBR source changed. Reload the job builder.']
  if(options.jobs.some(j=>j.name.toLowerCase()===draft.name.toLowerCase()))errors.push('A job with this name already exists. Choose a unique name.')
  const repo=options.repositories.find(r=>r.id===draft.repositoryId)
  if(!repo)errors.push('The selected repository is no longer available in this source.')
  else if(repo.isOnline===false)errors.push('The selected repository is offline.')
  if(draft.proxyMode==='selected')for(const id of draft.proxyIds) {
    const proxy=options.proxies.find(p=>p.id===id && p.type===(draft.platform==='VSphere'?'ViProxy':'HvProxy'))
    if(!proxy||proxy.isDisabled===true||proxy.isOnline===false)errors.push('A selected proxy is unavailable or does not support this platform.')
  }
  if((draft.guest.applicationAware||draft.guest.indexing)&&!options.credentials.some(c=>c.id===draft.guest.credentialId&&c.type===draft.guest.credentialType))errors.push('The guest credential is no longer available in this source.')
  const hosts=[...new Set([...draft.includes,...draft.excludes].map(i=>i.hostName))]
  if(hosts.length>20)return [...errors,'Limit this job to 20 inventory servers.']
  for(const host of hosts) {
    try {
      const inventory=await loadInventory(raw,browse,host,draft.platform),keys=new Set(inventory.data.map(objectKey))
      if([...draft.includes,...draft.excludes].filter(i=>i.hostName===host).some(i=>!keys.has(objectKey(i))))errors.push(`Some selected objects on ${host} could not be verified. Re-select them from inventory.`)
    } catch(e){if(e instanceof TopologyRequestError&&e.status===401)throw e;errors.push(`Inventory on ${host} could not be verified. Refresh and try again.`)}
  }
  return errors
}
