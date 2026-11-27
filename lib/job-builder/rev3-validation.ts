// Open Backup UI v1.3.0
import { z } from 'zod'
import contract from './rev3-contract.json'
import { supportedJob,type NativeJobType } from './native-job-types'
import { isRecord } from './rev3-form'

const validators=new Map<string,z.ZodType>()
export function validateNativeJob(type:NativeJobType,edit:boolean,payload:unknown) {
  if(!supportedJob(type) || !isRecord(payload) || payload.type!==type) return 'Choose a supported VBR job type.'
  const definition=contract.jobs[type][edit?'edit':'create']
  let validator=validators.get(definition)
  if(!validator){
    validator=z.fromJSONSchema({$schema:'https://json-schema.org/draft/2020-12/schema',
      $ref:'#/$defs/'+definition,$defs:contract.definitions} as Parameters<typeof z.fromJSONSchema>[0])
    validators.set(definition,validator)
  }
  const parsed=validator.safeParse(payload)
  if(!parsed.success){
    const issue=parsed.error.issues[0]
    return (issue.path.join('.') || 'Job')+' — '+issue.message
  }
  if(typeof payload.name!=='string' || !payload.name.trim() || payload.name.length>125)return 'Enter a job name (1–125 characters).'
  if(type==='RedHatOpenStackBackupJob' || type==='VirtuozzoBackupJob'){
    const platform=type==='RedHatOpenStackBackupJob'?'RedHatOpenStack':'Virtuozzo'
    const objects=isRecord(payload.objects)?payload.objects:{}
    const includes=Array.isArray(objects.includes)?objects.includes:[]
    if(!includes.length)return 'Choose at least one inventory object.'
    if([...includes,...(Array.isArray(objects.excludes)?objects.excludes:[])].some(v=>!isRecord(v)||v.platform!==platform))
      return 'Select objects from the same platform as the job.'
  }
  return null
}
export const estimateTaskSchema=z.object({id:z.string().uuid(),type:z.literal('JobSourcesSizeCalculation'),
  state:z.enum(['Starting','Working','Stopping','Stopped']),result:z.enum(['None','Success','Warning','Failed','Cancelled']),
  progressPercent:z.number().finite().min(0).max(100),totalSize:z.number().int().nonnegative(),
  items:z.array(z.object({state:z.enum(['Pending','Calculating','Calculated','Failed'])}))})
export function normalizedEstimate(value:unknown){
  const {id,state,result,progressPercent,totalSize,items}=estimateTaskSchema.parse(value)
  return {id,state,result,progressPercent,totalSize,calculated:items.filter(i=>i.state==='Calculated').length,total:items.length}
}
export type SourceEstimate=ReturnType<typeof normalizedEstimate>
