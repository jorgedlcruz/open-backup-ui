// Open Backup UI v1.3.0
import { z } from 'zod'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import type { VbrReader,VbrInventoryReader } from '../server/vbr-read'

export const pluginPlatforms=['RedHatOpenStack','Virtuozzo'] as const
export type PluginPlatform=typeof pluginPlatforms[number]
const pageSchema=z.object({data:z.array(z.unknown()),pagination:z.object({total:z.number().int().nonnegative().optional()}).nullish()})
const managerSchema=z.object({platform:z.string(),hostName:z.string().nullish(),name:z.string().nullish()})
// Select only fields the job contract accepts. Rows may include display-only ACL and size information.
const objectSchema=z.object({platform:z.enum(pluginPlatforms),name:z.string().min(1),objectId:z.string().min(1),type:z.string().min(1),
  hostName:z.string().optional(),clusterId:z.string().optional(),domainId:z.string().optional(),projectId:z.string().optional(),
  regionId:z.string().optional(),availabilityZoneId:z.string().optional()})
const repoSchema=z.object({id:z.string().uuid(),name:z.string(),isOnline:z.boolean().nullish(),
  scaleOutRepositoryDetails:z.object({scaleOutRepositoryId:z.string().nullish()}).nullish()})
async function managers(browse:VbrInventoryReader,platform:PluginPlatform){
  const names=new Set<string>()
  let skip=0
  while(skip<10_000){
    const {data,pagination}=pageSchema.parse(await browse(null,skip,200,'1.3-rev3'))
    for(const entry of data){
      const row=managerSchema.safeParse(entry)
      const host=row.success && (row.data.hostName || row.data.name)
      if(row.success && row.data.platform===platform && host && !/[\\/?#\x00-\x1f]/.test(host) && host!=='.' && host!=='..')names.add(host)
    }
    skip+=data.length
    if(!data.length || (pagination?.total!==undefined ? skip>=pagination.total : data.length<200))break
  }
  return [...names].sort()
}
export async function pluginOptions(read:VbrReader,browse:VbrInventoryReader,platform:PluginPlatform){
  const [hosts,repositories]=await Promise.all([managers(browse,platform),readOperationsCollection(
    path=>read(path,'1.3-rev3'),'/api/v1/backupInfrastructure/repositories/states',repoSchema)])
  return {hosts,repositories:repositories.data.filter(r=>r.isOnline!==false&&!r.scaleOutRepositoryDetails?.scaleOutRepositoryId)
    .map(({id,name})=>({id,name}))}
}
export async function pluginObjects(browse:VbrInventoryReader,platform:PluginPlatform,host:string,skip:number){
  if(!(await managers(browse,platform)).includes(host))throw new TopologyRequestError('Choose an inventory server for this platform.',400)
  const page=pageSchema.parse(await browse(host,skip,100,'1.3-rev3'))
  const data=page.data.flatMap(row=>{
    const parsed=objectSchema.safeParse(row && typeof row==='object' ? Object.fromEntries(Object.entries(row).filter(([,v])=>v!=null)):row)
    return parsed.success&&parsed.data.platform===platform?[parsed.data]:[]
  })
  const offset=skip+page.data.length
  return {data,nextOffset:page.data.length>0&&(page.pagination?.total===undefined?page.data.length===100:offset<page.pagination.total)?offset:null}
}
