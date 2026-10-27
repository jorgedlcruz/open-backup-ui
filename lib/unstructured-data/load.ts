import { z } from 'zod'
import type { VbrReader } from '../server/vbr-read'
import { TopologyRequestError } from '../topology/load'
import { revisionForBuild, validId, type Evidence } from '../investigation/model'
import { readOperationsCollection } from '../operations/load'
import { serverSchema, backupSchema, backupKey, credentialRef, credentialSchema, repositorySchema, repositoryStateSchema, jobSchema, jobStateSchema, type Snapshot, type Job } from './model'

export async function loadUnstructured(read:VbrReader,sourceName:string,now=new Date()):Promise<Snapshot> {
  const warnings:string[]=[]
  let revision:'1.3-rev1'|'1.3-rev2'='1.3-rev1'
  try {revision=revisionForBuild(z.object({buildVersion:z.string()}).parse(await read('/api/v1/serverInfo')).buildVersion)}
  catch(error){if(error instanceof TopologyRequestError && error.status===401)throw error;warnings.push('Server version unavailable. Using API 1.3-rev1.')}
  const get=(path:string)=>read(path,revision)
  async function optional<T>(label:string,work:Promise<Evidence<T>>):Promise<Evidence<T>> {
    try {const result=await work;if(!result.complete)warnings.push(`${label}: partial collection. Counts cover loaded records only.`);return result}
    catch(error){
      if(error instanceof TopologyRequestError && error.status===401)throw error
      const reason=error instanceof TopologyRequestError && error.status===403 ? 'Your account cannot read these records.':'The source did not return the expected records.'
      warnings.push(`${label} unavailable. ${reason}`);return {data:[],available:false,complete:false,error:reason}
    }
  }
  const [servers,fileJobs,objectJobs,jobStates,backups,repositories,repositoryStates]=await Promise.all([
    readOperationsCollection(get,'/api/v1/inventory/unstructuredDataServers',serverSchema),
    optional('File backup jobs',readOperationsCollection(get,'/api/v1/jobs?typeFilter=FileBackup',jobSchema)),
    optional('Object storage backup jobs',readOperationsCollection(get,'/api/v1/jobs?typeFilter=ObjectStorageBackup',jobSchema)),
    optional('Job states',readOperationsCollection(get,'/api/v1/jobs/states',jobStateSchema)),
    optional('Unstructured backup objects',readOperationsCollection(get,'/api/v1/backupObjects?platformNameFilter=UnstructuredData',backupSchema,20000,backupKey)),
    optional('Cache repository configuration',readOperationsCollection(get,'/api/v1/backupInfrastructure/repositories',repositorySchema)),
    optional('Cache repository states',readOperationsCollection(get,'/api/v1/backupInfrastructure/repositories/states',repositoryStateSchema)),
  ])
  if(!servers.complete)warnings.push('Unstructured server inventory is partial. Counts cover loaded sources only.')
  const jobs:Evidence<Job>={data:[...new Map([...fileJobs.data,...objectJobs.data].filter(j=>['FileBackup','ObjectStorageBackup'].includes(j.type || '')).map(j=>[j.id,j])).values()],
    available:fileJobs.available || objectJobs.available,complete:fileJobs.complete && objectJobs.complete}
  if(jobs.data.some(j=>!Array.isArray(j.objects) || j.objects.some(o=>!validId(j.type==='FileBackup' ? o.fileServerId:o.objectStorageServerId)))){
    jobs.complete=false
    warnings.push('Some jobs have missing scope configuration or source references. Missing job matches remain unresolved.')
  }
  const refs=[...new Map(servers.data.map(credentialRef).filter(r=>validId(r.id)).map(r=>[`${r.kind}|${r.id}`,r])).values()]
  const credentials:Snapshot['credentials']={data:[],available:true,complete:refs.length<=100}
  if(refs.length>100)warnings.push('Credential metadata lookup is limited to 100 unique records. Additional references remain visible.')
  for(let offset=0;offset<Math.min(refs.length,100);offset+=4){
    const results=await Promise.all(refs.slice(offset,Math.min(offset+4,100)).map(async ref=>{
      const result=await optional('Credential metadata',get(`/api/v1/${ref.kind==='cloud' ? 'cloudCredentials':'credentials'}/${encodeURIComponent(ref.id!)}`).then(value=>{
        const credential=credentialSchema.parse(value)
        if(credential.id!==ref.id)throw new Error('Credential identity mismatch')
        return {data:[{...credential,kind:ref.kind}],available:true,complete:true}
      }))
      return result
    }))
    for(const result of results){credentials.data.push(...result.data);if(!result.complete)credentials.complete=false}
  }
  return {sourceName,fetchedAt:now.toISOString(),apiRevision:revision,warnings:[...new Set(warnings)],servers,jobs,jobStates,backups,repositories,repositoryStates,credentials}
}
