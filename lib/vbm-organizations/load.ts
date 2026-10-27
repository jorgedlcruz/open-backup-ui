import { z } from 'zod'
import { collection,VbmRequestError,type Reader } from '../vbm-dashboard/load'
import { kinds,jobSchema,repositorySchema,usageSchema,type Evidence } from '../vbm-dashboard/model'
import { validId } from '../investigation/model'
import { organizationSchema,protectedSchema,userSchema,belongs,type Snapshot } from './model'
export async function loadOrganizations(raw:Reader,sourceName:string,organizationId?:string,now=new Date()):Promise<Snapshot> {
  if(organizationId && !validId(organizationId))throw new VbmRequestError('Invalid organization ID.',400)
  organizationId=organizationId?.toLowerCase()
  let active=0;const queue:(()=>void)[]=[]
  const read:Reader=async path=>{if(active>=4)await new Promise<void>(resolve=>queue.push(resolve));active++;try{return await raw(path)}finally{active--;queue.shift()?.()}}
  const warnings:string[]=[]
  const collect=async<T>(label:string,path:string,schema:z.ZodType<T>,key:(row:T)=>string,max=5000)=>{const result=await collection(read,path,schema,key,max);if(!result.complete)warnings.push(`${label}: ${result.error || 'Partial collection. Only loaded evidence is counted.'}`);return result}
  const organizations=await collect('Organizations','/v8/Organizations?extendedView=false',organizationSchema,row=>row.id)
  if(!organizations.available)throw new VbmRequestError('Organizations could not be read. Check the Microsoft 365 connection and permissions.',502)
  if(organizationId && !organizations.data.some(row=>row.id===organizationId))throw new VbmRequestError(organizations.complete ? 'Organization not found on this Microsoft 365 source.':'Organization was not found in the partial inventory. Refresh to retry.',organizations.complete ? 404:502)
  const query=organizationId ? `?${new URLSearchParams({organizationId})}`:''
  const key=(row:{id:string;organizationId?:string|null;backedUpOrganizationId?:string|null})=>JSON.stringify([row.organizationId,row.backedUpOrganizationId,row.id])
  const [jobs,repositories,licensed,protectedCollections]=await Promise.all([collect('Jobs',`/v8/Jobs${query}`,jobSchema,row=>row.id),collect('Repositories','/v8/BackupRepositories',repositorySchema,row=>row.id),collect('Licensed users',`/v8/LicensedUsers${query}`,userSchema,key),Promise.all(kinds.map(kind=>collect(`Protected ${kind.toLowerCase()}`,`/v8/Protected${kind}${query}`,protectedSchema,key)))])
  const scope=organizations.data.filter(org=>!organizationId || org.id===organizationId)
  // Usage is per organization; cap list fan-out but allow every organization to be investigated directly.
  const usage=await Promise.all(scope.slice(0,50).map(async org=>({organizationId:org.id,evidence:validId(org.id) ? await collect(`Storage for ${org.name || org.id}`,`/v8/Organizations/${encodeURIComponent(org.id)}/usedRepositories`,usageSchema,row=>row.repositoryId):{data:[],available:false,complete:false,error:'Invalid organization ID.'} as Evidence<z.infer<typeof usageSchema>>})))
  if(scope.length>50)warnings.push('Storage reads cover the first 50 organizations. Open another organization to load its usage.')
  // Never assign unknown records to a tenant by name or assume a failed source returned zero objects.
  for(const [label,evidence] of [['Jobs',jobs],['Licensed users',licensed],...kinds.map((kind,index)=>[`Protected ${kind.toLowerCase()}`,protectedCollections[index]] as const)] as const) {
    const unassigned=evidence.data.filter(row=>!scope.some(org=>belongs(row,org,organizations.data))).length
    if(unassigned)warnings.push(`${label}: ${unassigned} records could not be attributed to the selected organization scope and are excluded from its metrics.`)
    if(unassigned)evidence.complete=false
  }
  return {sourceName,fetchedAt:now.toISOString(),organizationId,warnings,organizations,jobs,repositories,licensed,protected:Object.fromEntries(kinds.map((kind,index)=>[kind,protectedCollections[index]])) as Snapshot['protected'],usage}
}
