import { z } from 'zod'
import { validId } from '../investigation/model'
import { jobSchema, sessionSchema, repositorySchema, organizationSchema, usageSchema, protectedSchema, licensedSchema, licenseSchema, healthSchema, versionSchema, kinds, type Evidence, type Snapshot, type Kind } from './model'
export type Reader = (path: string) => Promise<unknown>
export class VbmRequestError extends Error { constructor(message: string, public status: number) { super(message) } }

export async function collection<T>(read: Reader, path: string, schema: z.ZodType<T>, key: (row:T)=>string, max=5000): Promise<Evidence<T>> {
  const rows = new Map<string,T>(); let offset=0, available=false
  try {
    while(offset<max) {
      const url = new URL(path,'https://source.invalid'); const limit=Math.min(500,max-offset)
      url.searchParams.set('offset',String(offset)); url.searchParams.set('limit',String(limit))
      const raw = z.object({ results:z.array(z.unknown()),offset:z.coerce.number().optional(),limit:z.coerce.number().optional(),totalCount:z.coerce.number().optional(),
        _links:z.object({next:z.object({href:z.string()}).nullish()}).optional() }).parse(await read(url.pathname+url.search))
      available=true
      if(raw.offset!==undefined && raw.offset!==offset) return {data:[...rows.values()],available,complete:false,error:'The server returned a different page offset.'}
      const parsed=raw.results.slice(0,limit).map(row=>schema.parse(row)); let added=0
      for(const row of parsed) if(!rows.has(key(row))) {rows.set(key(row),row);added++}
      if(raw.results.length>limit) return {data:[...rows.values()],available,complete:false,error:'The server exceeded the requested page size.'}
      if(parsed.length && !added) return {data:[...rows.values()],available,complete:false,error:'A repeated page was returned.'}
      offset+=parsed.length
      if(raw.totalCount!==undefined && offset>=raw.totalCount) return {data:[...rows.values()],available,complete:true}
      if(!parsed.length || (!raw._links?.next && parsed.length<(raw.limit || limit))) return {data:[...rows.values()],available,complete:!raw._links?.next && (raw.totalCount===undefined || offset>=raw.totalCount)}
    }
    return {data:[...rows.values()],available,complete:false,error:`Collection limited to ${max} records.`}
  } catch(error) {
    if(error instanceof VbmRequestError && error.status===401) throw error
    return {data:[...rows.values()],available,complete:false,error:error instanceof VbmRequestError && error.status===403 ? 'Read access denied.' : error instanceof z.ZodError ? 'Unexpected response fields.' : 'These records could not be read.'}
  }
}
export async function loadDashboard(raw: Reader, sourceName: string, days:7|30, now=new Date()):Promise<Snapshot> {
  // Bound all reads, including independent collections and organization fan-out, to four at a time.
  let active=0; const queue:(()=>void)[]=[]
  const read:Reader=async path=>{if(active>=4) await new Promise<void>(resolve=>queue.push(resolve));active++;try{return await raw(path)}finally{active--;queue.shift()?.()}}
  const warnings:string[]=[]
  const collect=async<T>(label:string,path:string,schema:z.ZodType<T>,key:(row:T)=>string,max=5000)=>{
    const result=await collection(read,path,schema,key,max)
    if(!result.complete) warnings.push(`${label}: ${result.available ? 'partial collection' : 'unavailable'}. ${result.error || 'Only loaded records are counted.'}`)
    return result
  }
  const single=async<T>(label:string,path:string,schema:z.ZodType<T>)=>{try{return schema.parse(await read(path))}catch(error){if(error instanceof VbmRequestError && error.status===401)throw error;warnings.push(`${label} unavailable.`);return null}}
  const since=new Date(now.getTime()-days*86400000).toISOString()
  const [jobs,sessions,repositories,organizations,licensed,license,health,version,protectedResults]=await Promise.all([
    collect('Jobs','/v8/Jobs',jobSchema,row=>row.id),
    collect('Session history',`/v8/JobSessions?endTimeLowerBound=${encodeURIComponent(since)}`,sessionSchema,row=>row.id,10000),
    collect('Repositories','/v8/BackupRepositories',repositorySchema,row=>row.id),
    collect('Organizations','/v8/Organizations',organizationSchema,row=>row.id),
    collect('Licensed users','/v8/LicensedUsers',licensedSchema,row=>`${row.organizationId || ''}:${row.backedUpOrganizationId || ''}:${row.id}`),
    single('License','/v8/License',licenseSchema),single('Component health','/v8/Health',healthSchema),single('Build version','/v8/ServiceInstance',versionSchema),
    Promise.all(kinds.map(kind=>collect(`Protected ${kind.toLowerCase()}`,`/v8/Protected${kind}`,protectedSchema,row=>`${row.organizationId || ''}:${row.backedUpOrganizationId || ''}:${row.id}`))),
  ])
  if(!jobs.available && !sessions.available && !repositories.available)throw new VbmRequestError('Microsoft 365 jobs, sessions, and repositories are unavailable. Check your connection and permissions.',502)
  const usage=await Promise.all(organizations.data.slice(0,50).map(async org=>({organizationId:org.id,evidence:validId(org.id) ? await collect(`Storage usage for ${org.name || org.id}`,`/v8/Organizations/${encodeURIComponent(org.id)}/usedRepositories`,usageSchema,row=>row.repositoryId) : {data:[],available:false,complete:false,error:'Organization ID was not valid.'} as Evidence<z.infer<typeof usageSchema>>})))
  if(usage.some(org=>!validId(org.organizationId)))warnings.push('Storage usage could not be scoped to an invalid organization ID.')
  if(organizations.data.length>50)warnings.push('Organization storage reads are limited to 50 organizations. Usage is a subtotal.')
  return {sourceName,fetchedAt:now.toISOString(),days,warnings,jobs,sessions,repositories,organizations,usage,licensed,license,health,version,
    protected:Object.fromEntries(kinds.map((kind,i)=>[kind,protectedResults[i]])) as Record<Kind,Evidence<z.infer<typeof protectedSchema>>>}
}
