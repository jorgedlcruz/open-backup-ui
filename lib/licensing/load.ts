import { z } from 'zod'
import { collection,type Reader,VbmRequestError } from '../vbm-dashboard/load'
import { vbrSchema,vbmSchema,userSchema,type Snapshot } from './model'
export async function loadVbr(read:Reader,sourceName:string,now=new Date()):Promise<Snapshot> {
  const vbr=vbrSchema.parse(await read('/api/v1/license')),warnings:string[]=[]
  for(const [label,value] of [['Instance',vbr.instanceLicenseSummary],['Socket',vbr.socketLicenseSummary],['Capacity',vbr.capacityLicenseSummary]] as const)if(value && !value.workload)warnings.push(`${label} consumption details were not returned. Summary totals remain available.`)
  return {platform:'vbr',sourceName,fetchedAt:now.toISOString(),warnings,vbr,vbm:null,users:{data:[],available:false,complete:false},autoUpdate:vbr.autoUpdateEnabled ?? null}
}
export async function loadVbm(read:Reader,sourceName:string,now=new Date()):Promise<Snapshot> {
  const warnings:string[]=[]
  const optional=async<T>(label:string,path:string,schema:z.ZodType<T>)=>{try{return schema.parse(await read(path))}catch(error){if(error instanceof VbmRequestError && error.status===401)throw error;warnings.push(`${label} unavailable. Check source permissions and refresh.`);return null}}
  const [vbm,users,auto]=await Promise.all([optional('License summary','/v8/License',vbmSchema),collection(read,'/v8/LicensedUsers',userSchema,user=>`${user.organizationId || ''}:${user.backedUpOrganizationId || ''}:${user.id}`,50000),optional('Automatic license update status','/v8/License/AutoUpdate',z.object({isEnabled:z.boolean().nullish()}))])
  if(!users.complete)warnings.push(`Licensed users: ${users.error || 'Partial collection. Only loaded records are shown.'}`)
  if(!vbm && !users.available)throw new VbmRequestError('Microsoft 365 licensing data is unavailable. Check the connection and permissions.',502)
  return {platform:'vbm',sourceName,fetchedAt:now.toISOString(),warnings,vbr:null,vbm,users,autoUpdate:auto?.isEnabled ?? null}
}
