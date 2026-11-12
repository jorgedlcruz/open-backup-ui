// Open Backup UI v1.2.0
import {z} from 'zod'
import type {SqlStep} from './sql-actions'

export type SqlCheckResult={ok:boolean;errors:string[];warnings:string[];data:Record<string,unknown>}
const str=z.string().nullish()
const messages=z.array(z.string()).nullish()
const issue=z.object({error:str})
const diagnostics=z.object({
  error:str,errorMessage:str,unexpectedError:str,errorMessages:messages,warningMessages:messages,
  targetPathIssues:z.array(issue).nullish(),
})
const reply=diagnostics.extend({validationResults:z.array(diagnostics).nullish(),results:z.array(diagnostics.extend({
  exists:z.boolean().nullish(),targetDatabase:str,
})).nullish()})
const instances=z.object({instances:z.array(z.object({serverName:z.string(),instanceName:str})).nullish()})
const groups=z.object({availabilityGroups:z.array(z.string()).nullish()})
const replicas=z.object({nodes:z.array(z.object({sqlServer:z.object({machineName:z.string(),instanceName:str}),
  isPrimary:z.boolean().nullish(),isInstanceAvailable:z.boolean().nullish(),instanceDetectionError:str})).nullish()})
const entries=z.object({items:z.array(z.object({name:z.string(),type:z.enum(['Disk','Folder','File'])}))})
const transactions=z.object({transactions:z.array(z.object({lsn:str,time:str,operation:str,object:str,type:str})),
  paginationResult:z.object({count:z.number().int().nonnegative()})})
const compression=z.object({defaultCompression:str})

export function normalizeSqlValidation(step:SqlStep,raw:unknown,taskError?:string):SqlCheckResult {
  const value=reply.parse(raw)
  const errors:string[]=[],warnings:string[]=[],data:Record<string,unknown>={}
  for(const row of [value,...value.validationResults??[],...value.results??[]]){
    for(const error of [row.error,row.unexpectedError,row.errorMessage,...row.errorMessages??[],...(row.targetPathIssues??[]).map(issue=>issue.error)]) {
      if(error&&!errors.includes(error))errors.push(error)
    }
    for(const warning of row.warningMessages??[])if(warning&&!warnings.includes(warning))warnings.push(warning)
  }
  if(taskError&&!errors.length)errors.push(taskError)
  if(!errors.length)switch(step){
    case 'targetInstances':data.instances=(instances.parse(raw).instances??[]).map(({serverName,instanceName})=>({machineName:serverName,instanceName:instanceName??''}));break
    case 'availabilityGroups':data.groups=groups.parse(raw).availabilityGroups??[];break
    case 'replicaNodes':data.nodes=(replicas.parse(raw).nodes??[]).map(({sqlServer,...node})=>({...sqlServer,...node}));break
    case 'fileSystem':data.entries=entries.parse(raw).items;break
    case 'transactions':{
      const page=transactions.parse(raw)
      data.transactions=page.transactions;data.count=page.paginationResult.count
      break
    }
    case 'exportDefaultCompressionSetting':data.defaultCompression=compression.parse(raw).defaultCompression??'NotSupported';break
    case 'sqlDatabasesDoNotExist':
      if(!value.results||value.results.some(row=>typeof row.exists!=='boolean'||(row.exists&&!row.targetDatabase)))errors.push('VBR did not report whether the destination database exists.')
      else data.existingDatabases=value.results.filter(row=>row.exists).map(row=>row.targetDatabase)
      break
    case 'fineTuning':
      if(!Object.hasOwn(raw as object,'sourceDatabaseIdentifier')&&!Object.hasOwn(raw as object,'validationResults'))errors.push('VBR did not report the transaction replay validation result.')
      break
    default:
      // Credential results use "results", file/disk/space results "validationResults".
      // Other response envelopes cannot authorize a recovery.
      if(!Array.isArray(value.results)&&!Array.isArray(value.validationResults))errors.push('VBR did not report the SQL validation result.')
  }
  return {ok:errors.length===0,errors,warnings,data}
}
