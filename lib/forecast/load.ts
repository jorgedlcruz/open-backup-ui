import { z } from 'zod'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import { revisionForBuild } from '../investigation/model'
import { stateSchema, configSchema, scaleOutSchema, backupSchema, fileSchema } from '../repositories/model'
import { policySchema, objectSchema, uniqueFiles, type ForecastSnapshot, type BackupPlan, type ForecastFile } from './model'
import type { Collection } from '../operations/model'
import type { VbrReader } from '../server/vbr-read'

const forecastFileSchema = fileSchema.extend({name: z.string().nullish(), gfsPeriods: z.array(z.string()).nullish()})
export async function loadLatestPoint(read:(path:string)=>Promise<unknown>,id:string):Promise<NonNullable<BackupPlan['latestPoint']>> {
  try {
    const query=new URLSearchParams({backupIdFilter:id,orderColumn:'CreationTime',orderAsc:'false',skip:'0',limit:'1'})
    const result=z.object({data:z.array(z.object({backupId:z.string(),creationTime:z.string().nullish()})),pagination:z.object({total:z.number().optional()}).optional()}).parse(await read(`/api/v1/restorePoints?${query}`))
    if(result.data.length>1||result.data.some(p=>p.backupId.toLowerCase()!==id.toLowerCase()))return {state:'unavailable',at:null,reason:'Restore-point response did not honor the requested backup scope or limit.'}
    const point=result.data[0]
    if(!point)return result.pagination?.total?{state:'unavailable',at:null,reason:'Restore-point pagination was inconsistent.'}:{state:'empty',at:null}
    const stamp=Date.parse(point.creationTime||'')
    return !Number.isFinite(stamp)||stamp>Date.now()?{state:'unavailable',at:null,reason:'Latest restore-point time was missing, invalid or in the future.'}:{state:'verified',at:point.creationTime!}
  }catch(error){if(error instanceof TopologyRequestError&&error.status===401)throw error;return {state:'unavailable',at:null,reason:'Latest restore-point evidence could not be read.'}}
}
export async function loadForecast(raw: VbrReader, sourceName: string): Promise<ForecastSnapshot> {
  const warnings: string[] = []
  let revision: '1.3-rev1' | '1.3-rev2' = '1.3-rev1'
  try { revision = revisionForBuild(z.object({buildVersion: z.string()}).parse(await raw('/api/v1/serverInfo')).buildVersion) }
  catch (error) { if (error instanceof TopologyRequestError && error.status === 401) throw error; warnings.push('Version discovery unavailable; newer policy fields may be missing.') }
  const read = (path: string) => raw(path,revision)
  async function section<T>(label: string, promise: Promise<Collection<T>>): Promise<Collection<T>> {
    try { const result = await promise; if (!result.complete) warnings.push(`${label}: partial collection.`); return result }
    catch(error) { if(error instanceof TopologyRequestError && error.status === 401) throw error; warnings.push(`${label} unavailable; missing evidence is not zero.`); return {data:[],available:false,complete:false} }
  }
  const [repositories, configs, scaleOut, policies, objects, backups] = await Promise.all([
    section('Repository states',readOperationsCollection(read,'/api/v1/backupInfrastructure/repositories/states',stateSchema)),
    section('Repository settings',readOperationsCollection(read,'/api/v1/backupInfrastructure/repositories',configSchema)),
    section('Scale-out membership',readOperationsCollection(read,'/api/v1/backupInfrastructure/scaleOutRepositories',scaleOutSchema)),
    section('Job policies',readOperationsCollection(read,'/api/v1/jobs',policySchema)),
    section('Workload inventory',readOperationsCollection(read,'/api/v1/backupObjects',objectSchema,10000,item=>`${item.backupId}:${item.id}`)),
    section('Backup inventory',readOperationsCollection(read,'/api/v1/backups',backupSchema)),
  ])
  if(!repositories.available && !scaleOut.available) throw new TopologyRequestError('Repository inventory is unavailable. Check the VBR connection and permissions.',502)
  const plans: BackupPlan[] = backups.data.map(b=>({...b,files:[],complete:false,issue:'File collection was outside this refresh limit'}))
  let cursor = 0
  // Bound source load; every backup remains visible even when enrichment is partial.
  await Promise.all(Array.from({length:Math.min(4,plans.length)},async()=>{
    while(cursor < Math.min(plans.length,60)) {
      const plan = plans[cursor++], observed: ForecastFile[] = []
      const [files,members,latestPoint] = await Promise.all([section(`Files for ${plan.name || plan.id}`,readOperationsCollection(async path=>{
        const result = await read(path)
        observed.push(...z.object({data:z.array(forecastFileSchema)}).parse(result).data)
        return result
      },`/api/v1/backups/${encodeURIComponent(plan.id)}/backupFiles?orderColumn=CreationTime&orderAsc=false`,forecastFileSchema,3000)),
      section(`Workloads for ${plan.name || plan.id}`,readOperationsCollection(read,`/api/v1/backups/${encodeURIComponent(plan.id)}/objects`,objectSchema,5000,item=>`${item.backupId}:${item.id}`)),loadLatestPoint(read,plan.id)])
      plan.workloads=members.data
      plan.latestPoint=latestPoint
      const ids = new Set(files.data.map(f=>f.id))
      plan.files = observed.filter(f=>ids.has(f.id) && f.backupId === plan.id)
      plan.complete = files.complete && plan.files.length > 0 && observed.every(f=>f.backupId===plan.id)
      plan.issue = !files.available ? 'File inventory unavailable' : !plan.files.length ? 'No file inventory reported for this backup type' : !plan.complete ? 'File inventory is partial' : undefined
    }
  }))
  if(plans.length > 60) warnings.push('File enrichment is limited to 60 backups per refresh. Other backups remain visible as unmodeled.')
  const conflicts = new Set(uniqueFiles(plans.flatMap(p=>p.files)).conflictingIds)
  if(conflicts.size) {
    warnings.push(`${conflicts.size} conflicting file identities were excluded. Affected backup chains cannot be modeled.`)
    for(const plan of plans) if(plan.files.some(f=>conflicts.has(f.id))) { plan.files=plan.files.filter(f=>!conflicts.has(f.id));plan.complete=false;plan.issue='Conflicting file identities excluded' }
  }
  return {sourceName,fetchedAt:new Date().toISOString(),warnings,repositories,configs,scaleOut,policies,objects,
    backups:{...backups,data:plans},observations:[],historyAvailable:false}
}
