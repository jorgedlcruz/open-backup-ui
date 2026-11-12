// Open Backup UI v1.2.0
import {z} from 'zod'
import {requiredSqlChecks} from './sql-checks'
export {requiredSqlChecks} from './sql-checks'
import {validId} from '../investigation/model'
import type {RecoverySend} from '../server/vbr-recovery'
import {VbrRecoveryError} from './error'
import {normalizeSqlValidation, type SqlCheckResult} from './sql-validation-result'

export type {SqlCheckResult} from './sql-validation-result'
const guid=z.string().refine(validId).transform(value=>value.toLowerCase())
const text=z.string().trim().min(1).max(4096)
const name=z.string().min(1).max(512)
const instance=z.string().max(512)
const date=z.string().datetime({offset:true})
export const sqlDatabaseSchema=z.object({sourceServer:name,instanceName:instance,sourceDatabase:name})
const reportedDatabase=sqlDatabaseSchema.extend({instanceName:instance.nullish().transform(value=>value??'')})
export type SqlDatabase=z.infer<typeof sqlDatabaseSchema>
export const sqlIntentSchema=z.enum(['restore','publish','instant','export','exportFiles','exportPublished'])
export type SqlIntent=z.infer<typeof sqlIntentSchema>
type Intent=SqlIntent
const filePaths=z.object({primaryFile:text,secondaryFiles:z.array(text).max(1024),blobFolders:z.array(text).max(1024)})
const schedule=z.enum(['Auto','Manual','ScheduledAt'])
export const sqlFinalSettingsSchema=z.object({
  overwrite:z.boolean().optional(),compression:z.enum(['Default','WithCompression','NoCompression']).optional(),
  schedule:schedule.optional(),scheduledAt:date.optional(),pointInTime:z.boolean().optional(),
}).strict()
export const sqlMountedSettingsSchema=sqlFinalSettingsSchema.pick({schedule:true,scheduledAt:true}).strict()
export const sqlMountedActionSchema=z.enum(['stop','edit','switchover'])
export const sqlStepSchema=z.enum(['targetInstances','guestCredentials','sqlCredentials','adminShareAccess','alwaysOnAndUpdatePrimaryNode',
  'targetInstance','mountAccess','sqlDatabasesDoNotExist','files','filesOnReplicas','freeSpace','standByRestoreMode','windowsLogBackups',
  'fineTuning','transactions','availabilityGroups','replicaNodes','fileSystem','exportTargetWindowsServer','exportTargetPath',
  'stagingServerFreeSpaceForExport','exportDefaultCompressionSetting','exportPointInTime','stagingServerSqlCredentials','stagingServerGuestCredentials'])
export type SqlStep=z.infer<typeof sqlStepSchema>
export const sqlStepDataSchema=z.object({
  machineName:name.optional(),instanceName:instance.optional(),username:name.optional(),password:z.string().min(1).max(4096).optional(),
  auth:z.enum(['windows','sql']).optional(),targetNames:z.array(name).max(128).optional(),targetFiles:z.array(filePaths.nullable()).max(128).optional(),
  recoveryState:z.enum(['Recovery','NoRecovery','StandBy']).optional(),standbyFilePath:text.optional(),availabilityGroupName:name.optional(),
  restoreToDate:date.optional(),restoreBeforeLsn:z.string().min(1).max(128).regex(/^[0-9a-fA-F]+(?:[ :][0-9a-fA-F]+)*$/).optional(),
  dateTime:date.optional(),direction:z.enum(['Before','After']).optional(),skip:z.number().int().min(0).max(1000000).optional(),
  limit:z.number().int().min(1).max(200).optional(),fileType:z.enum(['SqlFiles','AllFiles']).optional(),parentPath:text.optional(),targetPath:text.optional(),
}).strict()
type Data=z.infer<typeof sqlStepDataSchema>
type Settings=z.infer<typeof sqlFinalSettingsSchema>
const base='/private-api/v1'
const validation=base+'/validations/applicationItems/vesql/'
const taskRoot=base+'/validations/applicationItems/tasks/'
const intentPath:Record<Intent,string>={restore:'restore',instant:'instantRecovery',publish:'publish',export:'export',exportFiles:'export',exportPublished:'exportPublishedDatabase'}
const actionPath=(intent:Intent,id:string)=>base+'/'+intentPath[intent]+'/applicationItems/vesql/'+guid.parse(id)
const bad=(message:string,status=400)=>new VbrRecoveryError(message,status)
function post(send:RecoverySend,path:string,body?:unknown) {
  return send(path,{method:'POST',mutation:true,...(body!==undefined&&{body})})
}
function accepted(raw:unknown) {
  const result=z.object({id:guid}).safeParse(raw)
  if(!result.success)throw new VbrRecoveryError('VBR did not report the SQL operation ID. Check Sessions before trying again.',502,true)
  return result.data.id
}
const dbKey=(db:SqlDatabase)=>JSON.stringify([db.sourceServer,db.instanceName,db.sourceDatabase])
function selected(databases:SqlDatabase[]) {
  const list=z.array(sqlDatabaseSchema).min(1).max(128).parse(databases)
  if(new Set(list.map(dbKey)).size!==list.length)throw bad('Select each database once.')
  return list
}
function publishedJobs(jobIds?:string[]) {
  const ids=z.array(guid).min(1).max(128).parse(jobIds)
  if(new Set(ids).size!==ids.length)throw bad('Select each published database once.')
  return ids
}
export async function initSqlAction(send:RecoverySend,sessionId:string,intent:Intent,databases:SqlDatabase[],publishJobIds?:string[]) {
  if(intent==='exportPublished')return accepted(await post(send,actionPath('publish',sessionId)+'/initPublishedDatabaseExport',{
    databasesToExport:publishedJobs(publishJobIds).map(publishJobId=>({publishJobId})),
  }))
  const dbs=selected(databases)
  const payload=intent==='export'||intent==='exportFiles'?{databasesToExport:dbs.map(database=>({database,toBakFile:intent==='export'}))}:
    intent==='restore'?{databasesToRestore:dbs}:{databases:dbs}
  return accepted(await post(send,actionPath(intent,sessionId)+'/init',payload))
}

function stepAllowed(intent:Intent,step:SqlStep) {
  if(requiredSqlChecks(intent,{pointInTime:true}).includes(step))return true
  if(intent==='exportPublished')return step==='fileSystem'||step==='exportDefaultCompressionSetting'
  if(step==='transactions'||step==='fineTuning'||step==='fileSystem')return true
  if(intent==='export'||intent==='exportFiles')return intent==='export'&&step==='exportDefaultCompressionSetting'
  return step==='targetInstances'||step==='availabilityGroups'||step==='replicaNodes'
}
const segments:Partial<Record<SqlStep,string>>={fineTuning:'fineTuning/validation',transactions:'fineTuning/transactions'}
const resultSegments:Partial<Record<SqlStep,string>>={stagingServerSqlCredentials:'sqlCredentials',stagingServerGuestCredentials:'guestCredentials'}
function checkBody(step:SqlStep,data:Data,dbs:SqlDatabase[]) {
  const machineName=data.machineName||dbs[0]?.sourceServer
  const {username,password}=data
  if(Boolean(username)!==Boolean(password))throw bad('Enter both a username and password.')
  const credentials=username&&password?{username,password,type:'Standard'}:undefined
  const windowsCredentials=credentials?{credentials,credentialsKind:'UserAccount'}:undefined
  switch(step) {
    case 'guestCredentials':
      if(!machineName)throw bad('Select a SQL Server host.')
      return {machineName,...(credentials&&{windowsCredentials:{credentials:{...credentials,uniqueId:''},credentialsKind:'UserAccount'}})}
    case 'sqlCredentials':
      if(data.auth==='sql'&&!credentials)throw bad('Enter SQL Server credentials.')
      // Original-location validation lets the initialized provider workflow choose
      // its source instance. Only a custom target supplies a SQL server address.
      return {encryptionType:'Optional',...(data.machineName&&{sqlServer:{machineName:data.machineName,instanceName:data.instanceName??''}}),
        ...(data.auth==='sql'?{sqlAuthCredentials:credentials}:windowsCredentials&&{windowsCredentials})}
    case 'exportTargetWindowsServer':
      if(!data.machineName||!windowsCredentials)throw bad('Enter the export server and its Windows credentials.')
      return {server:data.machineName,credentials:windowsCredentials}
    case 'exportTargetPath':
      if(!data.targetPath)throw bad('Enter the export destination path.')
      return {targetPath:data.targetPath}
    case 'targetInstance':
      if(data.targetNames&&data.targetNames.length!==dbs.length)throw bad('Match each target name to a selected database.')
      return {targetDatabases:dbs.map((db,i)=>({sourceDatabaseIdentifier:db,targetDatabaseName:data.targetNames?.[i]??db.sourceDatabase}))}
    case 'files':
      if(data.targetFiles&&data.targetFiles.length!==dbs.length)throw bad('Match each file mapping to a selected database.')
      return {targetDatabaseFiles:dbs.map((db,i)=>({sourceDatabaseIdentifier:db,targetFiles:data.targetFiles?.[i]??null}))}
    case 'standByRestoreMode':
      if(data.recoveryState==='StandBy'&&!data.standbyFilePath)throw bad('Enter the standby file path.')
      return {validationConfigs:dbs.map(db=>({sourceDatabase:db,recoveryState:data.recoveryState||'Recovery',
        ...(data.recoveryState==='StandBy'&&{standbyFilePath:data.standbyFilePath})}))}
    case 'windowsLogBackups':return {restoreToDate:data.restoreToDate??'',...(data.restoreBeforeLsn&&{restoreBeforeLsn:data.restoreBeforeLsn})}
    case 'exportPointInTime':return {...(data.restoreToDate&&{restoreToDate:data.restoreToDate}),...(data.restoreBeforeLsn&&{restoreBeforeLsn:data.restoreBeforeLsn})}
    case 'alwaysOnAndUpdatePrimaryNode':return {availabilityGroupName:data.availabilityGroupName??null}
    case 'transactions':
      if(!data.dateTime||!data.direction)throw bad('Select a transaction time and direction.')
      return {dateTime:data.dateTime,direction:data.direction}
    case 'fileSystem':return {parentPath:data.parentPath??null,...(data.fileType&&{fileTypeFilter:data.fileType})}
    default:return undefined
  }
}
type Started={taskId:string}|{result:SqlCheckResult}
export async function beginSqlCheck(send:RecoverySend,workflowId:string,intent:Intent,step:SqlStep,input:Data,databases:SqlDatabase[]):Promise<Started> {
  if(!stepAllowed(intent,step))throw bad('This validation does not apply to the SQL operation.')
  const data=sqlStepDataSchema.parse(input),id=guid.parse(workflowId),body=checkBody(step,data,databases.map(db=>sqlDatabaseSchema.parse(db)))
  if(step==='exportPointInTime') {
    await post(send,actionPath('export',id)+'/pointInTime',body)
    return {result:{ok:true,errors:[],warnings:[],data:{}}}
  }
  if(step==='replicaNodes') {
    if(!data.availabilityGroupName || ['.','..'].includes(data.availabilityGroupName))throw bad('Select a SQL availability group.')
    return {result:normalizeSqlValidation(step,await send(validation+id+'/availabilityGroups/'+encodeURIComponent(data.availabilityGroupName)+'/nodes'))}
  }
  const page=step==='transactions'?'?skip='+(data.skip??0)+'&limit='+(data.limit??50):''
  return {taskId:accepted(await post(send,validation+id+'/'+(segments[step]??step)+page,body))}
}
export async function pollSqlCheck(send:RecoverySend,workflowId:string,step:SqlStep,taskId:string):Promise<{pending:true}|{result:SqlCheckResult}> {
  const id=guid.parse(taskId),workflow=guid.parse(workflowId)
  const task=z.object({id:guid,type:z.literal('Common'),state:z.string(),result:z.string().nullish(),additionalInfo:z.object({message:z.string().nullish()}).nullish()}).parse(await send(taskRoot+id))
  if(id!==task.id)throw bad('VBR returned a different SQL validation task.',502)
  if(task.state!=='Stopped')return {pending:true}
  if(!['Success','Warning','Failed'].includes(task.result??''))throw bad(task.additionalInfo?.message||'VBR could not complete SQL validation.',409)
  const raw=await send(validation+workflow+'/'+(resultSegments[step]??segments[step]??step)+'/'+id+'/result')
  return {result:normalizeSqlValidation(step,raw,task.result==='Failed'?task.additionalInfo?.message||'VBR could not complete SQL validation.':undefined)}
}
function scheduleSpec(settings:Settings) {
  const scheduleType=settings.schedule??'Manual'
  if(scheduleType==='ScheduledAt'&&!settings.scheduledAt)throw bad('Enter the scheduled switchover time.')
  return {scheduleType,...(scheduleType==='ScheduledAt'&&{switchDateTime:settings.scheduledAt})}
}
export async function submitSqlAction(send:RecoverySend,workflowId:string,intent:Intent,databases:SqlDatabase[],input:Settings,publishJobIds?:string[]) {
  const settings=sqlFinalSettingsSchema.parse(input),dbs=intent==='exportPublished'?databases.map(db=>sqlDatabaseSchema.parse(db)):selected(databases)
  const restoreSettings=dbs.map(database=>({database,allowTargetDatabaseOverwrite:settings.overwrite===true}))
  if(intent==='exportFiles' && settings.compression && settings.compression!=='Default')throw bad('Compression applies only to a SQL backup file.')
  const bakCompression=settings.compression??'Default'
  const body=intent==='restore'?{restoreSettings}:intent==='publish'?{publishSettings:restoreSettings}:
    intent==='instant'?{settings:restoreSettings.map(item=>({...item,scheduleSpec:scheduleSpec(settings)}))}:
    intent==='export'||intent==='exportFiles'?{exportSettings:dbs.map(database=>({database,bakCompression}))}:
    {exportSettings:publishedJobs(publishJobIds).map(publishJobId=>({publishJobId,bakCompression}))}
  const raw=await post(send,actionPath(intent,workflowId)+'/start',body)
  const ack=z.object({sourceDatabaseToJobs:z.array(z.object({database:reportedDatabase,jobId:guid})).min(1).max(128)}).safeParse(raw)
  if(!ack.success)throw new VbrRecoveryError('VBR did not report the SQL job IDs. Check Sessions before trying again.',502,true)
  const jobs=ack.data.sourceDatabaseToJobs
  if(new Set(jobs.map(job=>job.jobId)).size!==jobs.length || new Set(jobs.map(job=>dbKey(job.database))).size!==jobs.length ||
    (dbs.length>0 && (jobs.length!==dbs.length || jobs.some(job=>!dbs.some(db=>dbKey(db)===dbKey(job.database)))))){
    throw new VbrRecoveryError('VBR returned different SQL jobs than requested. Check Sessions before trying again.',502,true)
  }
  return {jobs}
}
export async function cancelSqlAction(send:RecoverySend,workflowId:string) {
  await post(send,base+'/validations/applicationItems/'+guid.parse(workflowId)+'/revoke')
  return {ok:true}
}
export async function mountedSqlAction(send:RecoverySend,permanentSessionId:string,jobId:string,action:z.infer<typeof sqlMountedActionSchema>,input:z.infer<typeof sqlMountedSettingsSchema>={}) {
  const id=guid.parse(permanentSessionId),job=guid.parse(jobId),settings=sqlMountedSettingsSchema.parse(input)
  if(action==='stop')await post(send,base+'/applicationItems/operations/stop',{sessions:[{permanentSessionId:id,jobIds:[job]}]})
  else if(action==='edit'||action==='switchover')await post(send,actionPath('instant',id)+'/'+action,{
    settings:[{jobId:job,...(action==='edit'&&{scheduleSpec:scheduleSpec(settings)})}],
  })
  else throw bad('Unknown SQL mounted operation.')
  return {ok:true}
}
