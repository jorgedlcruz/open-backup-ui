// Open Backup UI v1.3.0
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { TopologyRequestError } from '../topology/load'
import { isRecord } from './rev3-form'
import { supportedJob, type NativeJobType } from './native-job-types'
import type { VbrReader } from '../server/vbr-read'
import { validateNativeJob } from './rev3-validation'

export const sourceKeySchema=z.string().regex(/^[a-f0-9]{64}$/)
export const jobInput=z.object({action:z.enum(['validate','save']),sourceKey:sourceKeySchema,type:z.string().refine(supportedJob),
  id:z.string().uuid().optional(),version:sourceKeySchema.optional(),job:z.record(z.string(),z.unknown())}).strict()
export function requireRev3(revision:string,selectedSource:string,expectedSource?:string|null){
  if(revision!=='1.3-rev3')throw new TopologyRequestError('This feature requires VBR REST API 1.3-rev3.',409)
  if(expectedSource!==undefined && selectedSource!==expectedSource)throw new TopologyRequestError('The VBR source changed. Reload and validate again.',409)
}
function jobVersion(value:unknown):string{
  function canonical(v:unknown):unknown{
    if(Array.isArray(v))return v.map(canonical)
    return isRecord(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
export async function readNativeJob(read:VbrReader,type:NativeJobType,id:string){
  const job=await read('/api/v1/jobs/'+z.string().uuid().parse(id),'1.3-rev3')
  if(!isRecord(job)||job.type!==type||job.id!==id)throw new TopologyRequestError('The selected job does not match the request.',409)
  if(validateNativeJob(type,true,job))throw new TopologyRequestError('This job contains settings the editor cannot preserve.',409)
  return {job,version:jobVersion(job)}
}
export async function checkNativeRequest(input:z.infer<typeof jobInput>,read:VbrReader){
  if(!supportedJob(input.type))throw new TopologyRequestError('Unsupported job type.',400)
  const problem=validateNativeJob(input.type,!!input.id,input.job)
  if(problem)throw new TopologyRequestError(problem,400)
  if(input.id){
    if(input.job.id!==input.id||!input.version)throw new TopologyRequestError('Reload the job before editing it.',409)
    const current=await readNativeJob(read,input.type,input.id)
    if(current.version!==input.version)throw new TopologyRequestError('The job changed. Reopen it to review the latest settings.',409)
  }else if(input.version || input.job.id!==undefined)throw new TopologyRequestError('A new job cannot include a job ID.',400)
}
