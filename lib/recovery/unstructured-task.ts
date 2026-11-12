// Open Backup UI v1.2.0
import {z} from 'zod'

const guid=z.string().uuid().transform(value=>value.toLowerCase())
const meta=z.object({field:z.string(),data:z.string()})
const log=z.object({id:z.union([z.number(),z.string()]).optional(),status:z.string().nullish(),startTime:z.string().nullish(),
  updateTime:z.string().nullish(),title:z.string().nullish(),description:z.string().nullish(),additionalInfo:z.array(meta).nullish()})
// The current API returns logs.records; older documented task examples use data.
const logs=z.object({totalRecords:z.number().int().nonnegative().optional(),records:z.array(log).optional(),data:z.array(log).optional(),
  pagination:z.object({total:z.number().int().nonnegative().optional()}).nullish()}).nullish()
export const unstructuredTaskSchema=z.object({id:guid,type:z.string(),state:z.string(),result:z.string().nullish(),progressPercent:z.number().nullish(),
  name:z.string().nullish(),creationTime:z.string().nullish(),endTime:z.string().nullish(),logs,
  additionalInfo:z.object({message:z.string().nullish(),resourceId:guid.nullish(),resourceReference:z.string().nullish()}).nullish()})

export function readUnstructuredTask(value:unknown){
  const parsed=unstructuredTaskSchema.parse(value),records=parsed.logs?.records??parsed.logs?.data??[]
  const match=/^\/?api\/v1\/sessions\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\/?$/i.exec(parsed.additionalInfo?.resourceReference??'')
  const relatedSessionId=match?.[1].toLowerCase()
  return {...parsed,logs:{totalRecords:parsed.logs?.totalRecords??parsed.logs?.pagination?.total??records.length,records},
    ...(relatedSessionId?{relatedSessionId}:{})}
}
