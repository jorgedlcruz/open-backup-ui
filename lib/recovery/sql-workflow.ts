// Open Backup UI v1.2.0
import {createHmac,randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {RecoverySend} from '../server/vbr-recovery'
import {sqlWorkflows,type SqlFlow,type SqlWorkflows} from '../server/sql-workflows'
import {VbrRecoveryError} from './error'
import {sqlGrant,sqlGuid,sqlOpen,sqlScope,sqlSeal,sqlTicket,type SqlContext} from './sql-protocol'
import {beginSqlCheck,cancelSqlAction,initSqlAction,mountedSqlAction,pollSqlCheck,requiredSqlChecks,sqlDatabaseSchema,
  sqlFinalSettingsSchema,sqlIntentSchema,sqlMountedActionSchema,sqlMountedSettingsSchema,sqlStepDataSchema,sqlStepSchema,
  submitSqlAction,type SqlCheckResult,type SqlStep} from './sql-actions'

const session={sourceKey:sqlScope,sessionId:sqlGuid}
const flowRef=z.object({id:sqlGuid,intent:sqlIntentSchema,key:sqlTicket}).strict()
const work={...session,workflow:flowRef}
export const sqlWorkflowInput=z.discriminatedUnion('action',[
  z.object({...session,action:z.literal('prepare'),intent:sqlIntentSchema,databases:z.array(sqlTicket).max(128).default([]),jobs:z.array(sqlTicket).max(128).optional()}).strict(),
  z.object({...work,action:z.literal('check'),step:sqlStepSchema,data:sqlStepDataSchema.default({}),resetValidation:z.boolean().optional()}).strict(),
  z.object({...work,action:z.literal('submit'),proofs:z.array(sqlTicket).max(50),settings:sqlFinalSettingsSchema}).strict(),
  z.object({...work,action:z.literal('cancelWorkflow')}).strict(),
  z.object({...session,action:z.literal('operations')}).strict(),
  z.object({...session,action:z.literal('mounted'),command:sqlMountedActionSchema,job:sqlTicket,settings:sqlMountedSettingsSchema.default({})}).strict(),
])
const flowClaim=z.object({sessionId:sqlGuid,id:sqlGuid,intent:sqlIntentSchema})
const jobClaim=z.object({sessionId:sqlGuid,workflowId:sqlGuid,jobId:sqlGuid})
const proofClaim=z.object({sessionId:sqlGuid,workflowId:sqlGuid,step:sqlStepSchema,nonce:sqlGuid})
const fail=(message:string,status=409)=>new VbrRecoveryError(message,status)
const fingerprint=(ctx:SqlContext,value:unknown)=>createHmac('sha256',ctx.secret).update(JSON.stringify(value)).digest('hex')
const readOnly=new Set<SqlStep>(['targetInstances','transactions','availabilityGroups','replicaNodes','fileSystem','exportDefaultCompressionSetting','fineTuning'])

async function operations(send:RecoverySend,ctx:SqlContext,sid:string,store:SqlWorkflows) {
  const known=await store.jobs(ctx,sid)
  if(!known.length)return []
  const states=['Starting','Running','Publishing','StartingPublished','Offline','StartingRestored','StoppingForSwitch','Switching','Unpublishing','Exporting',
    'Copying','WaitingForRetry','Canceling','Failed','Unavailable','Published']
  const result=z.object({data:z.array(z.object({id:sqlGuid.nullish(),permanentSessionId:sqlGuid.nullish(),explorerKind:z.string().nullish(),
    operationKind:z.string().nullish(),name:z.string().nullish(),status:z.string().nullish(),operationStatus:z.string().nullish(),
    targetHost:z.string().nullish(),targetName:z.string().nullish()}))}).parse(await send('/private-api/v1/applicationItems/operations',
    {method:'POST',body:{explorerKinds:['Sql'],operationStatuses:states}}))
  return known.map(({job,workflowId,intent})=>{
    const row=result.data.find(r=>r.explorerKind==='Sql' && r.id===job.jobId && r.permanentSessionId===workflowId)
    const allowedOperations:string[]=[]
    if(row?.operationStatus && states.includes(row.operationStatus)) {
      const instant=intent==='instant' && row.operationKind==='InstantRecovery'
      if(instant) {
        if(!['Canceled','Canceling','Success'].includes(row.operationStatus))allowedOperations.push('stop')
        if(['Starting','Publishing','Published','WaitingForRetry'].includes(row.operationStatus))allowedOperations.push('edit')
        if(row.operationStatus==='Published')allowedOperations.push('switchover')
      }
      if(intent==='publish' && row.operationKind==='Publish' && row.operationStatus==='Published')allowedOperations.push('stop','exportPublished')
      if(intent==='restore' && row.operationKind==='Restore' && !['Failed','Unavailable','Success'].includes(row.operationStatus))allowedOperations.push('stop')
    }
    return {...job,permanentSessionId:workflowId,key:sqlSeal(ctx,'job',{sessionId:sid,workflowId,jobId:job.jobId}),intent,name:row?.name||job.database.sourceDatabase,
      state:row?.status,operationStatus:row?.operationStatus,targetHost:row?.targetHost,targetName:row?.targetName,allowedOperations}
  })
}
async function authorizeJobs(send:RecoverySend,ctx:SqlContext,sid:string,keys:string[],command:string,store:SqlWorkflows) {
  const rows=await operations(send,ctx,sid,store)
  return keys.map(key=>{
    const grant=sqlOpen(ctx,'job',key,jobClaim),row=rows.find(r=>r.jobId===grant.jobId)
    if(grant.sessionId!==sid || !row?.allowedOperations.includes(command) ||
      sqlOpen(ctx,'job',row.key,jobClaim).workflowId!==grant.workflowId)throw fail('This SQL operation is unavailable for the selected job.')
    return {grant,row}
  })
}
function ensureOpen(flow:SqlFlow) {
  if(flow.state!=='open')throw fail('This SQL workflow is unavailable. Reopen the operation.')
  if(flow.pending)throw fail('A SQL operation is already in progress. Check Sessions before trying again.')
}
async function settleCheck(ctx:SqlContext,sid:string,fid:string,step:SqlStep,nonce:string,result:SqlCheckResult,store:SqlWorkflows) {
  const proof=await store.update(ctx,sid,fid,flow=>{
    const current=flow.pending
    if(flow.checks[step]?.nonce===nonce && result.ok)return sqlSeal(ctx,'proof',{sessionId:sid,workflowId:fid,step,nonce})
    if(!current || current.nonce!==nonce || current.step!==step || flow.state!=='open')throw fail('This SQL validation no longer belongs to the current workflow.')
    delete flow.pending
    if(!result.ok)return
    const existing=result.data.existingDatabases
    flow.checks[step]={nonce,digest:current.digest,existing:Array.isArray(existing)&&existing.length>0,
      pointInTime:current.pointInTime,recoveryPoint:current.recoveryPoint}
    return sqlSeal(ctx,'proof',{sessionId:sid,workflowId:fid,step,nonce})
  })
  return {...result,...(proof&&{proof})}
}
type CheckTicket={sessionId:string;workflowId:string;step:string;nonce:string;taskId:string}
export async function pollSqlValidation(send:RecoverySend,ctx:SqlContext,ticket:CheckTicket,token:string,store=sqlWorkflows) {
  const step=sqlStepSchema.parse(ticket.step),{sessionId,workflowId,nonce,taskId}=ticket
  const flow=await store.read(ctx,sessionId,workflowId)
  if(flow.state!=='open' || (flow.pending?.nonce!==nonce && flow.checks[step]?.nonce!==nonce))throw fail('This SQL validation no longer belongs to the current workflow.')
  const observed=await pollSqlCheck(send,step==='targetInstances'?sessionId:workflowId,step,taskId)
  return 'pending' in observed ? {pending:token} : settleCheck(ctx,sessionId,workflowId,step,nonce,observed.result,store)
}
export async function runSqlWorkflow(send:RecoverySend,ctx:SqlContext,input:z.infer<typeof sqlWorkflowInput>,store=sqlWorkflows) {
  const sid=input.sessionId
  if(input.action==='operations')return {jobs:await operations(send,ctx,sid,store)}
  if(input.action==='mounted') {
    const [{grant}]=await authorizeJobs(send,ctx,sid,[input.job],input.command,store)
    return mountedSqlAction(send,grant.workflowId,grant.jobId,input.command,input.settings)
  }
  if(input.action==='prepare') {
    const {intent}=input
    const pubs=intent==='exportPublished'?await authorizeJobs(send,ctx,sid,input.jobs||[],'exportPublished',store):[]
    if(intent==='exportPublished' && (!pubs.length || input.databases.length || pubs.some(p=>p.grant.workflowId!==pubs[0].grant.workflowId)))throw fail('Select published databases from the same SQL operation.')
    if(intent!=='exportPublished' && (!input.databases.length || input.jobs?.length))throw fail('Select databases from the current SQL browse session.')
    const grants=input.databases.map(key=>sqlGrant(ctx,key,sid,'SQLDatabase'))
    const databases=grants.length ? grants.map(g=>sqlDatabaseSchema.parse({sourceServer:g.sourceServer,instanceName:g.instanceName??'',sourceDatabase:g.name})) : pubs.map(p=>p.row.database)
    const published=pubs.map(p=>p.grant.jobId)
    const id=await initSqlAction(send,pubs[0]?.grant.workflowId||sid,intent,databases,published)
    await store.create(ctx,{id,sessionId:sid,intent,databases,ranges:grants.map(g=>g.timeRange||null),published,state:'open',created:Date.now(),checks:{}})
    return {workflow:{id,intent,key:sqlSeal(ctx,'workflow',{id,intent,sessionId:sid})}}
  }
  const ref=input.workflow,claim=sqlOpen(ctx,'workflow',ref.key,flowClaim),fid=ref.id
  if(claim.id!==fid || claim.intent!==ref.intent || claim.sessionId!==sid)throw fail('Select the current SQL workflow.')
  if(input.action==='check') {
    const {step,data}=input,nonce=randomUUID(),digest=fingerprint(ctx,[step,data])
    const flow=await store.update(ctx,sid,fid,f=>{
      ensureOpen(f)
      if(input.resetValidation) {
        f.checks={}
        f.inputs={}
      }
      if((data.restoreToDate || data.restoreBeforeLsn) && !readOnly.has(step)) {
        const when=data.restoreToDate ? Date.parse(data.restoreToDate) : undefined
        if(!f.ranges.length || f.ranges.some(r=>{
          const first=Date.parse(r?.from??''),last=Date.parse(r?.to??'')
          return !Number.isFinite(first)||!Number.isFinite(last)||last-first<=60000||
            (when!==undefined && (!Number.isFinite(when)||when<first||when>last))
        }))throw fail('Select a time inside the database recovery range.')
      }
      if(!readOnly.has(step)) {
        f.inputs??={}
        if(f.inputs[step] && f.inputs[step]!==digest)f.checks={}
        f.inputs[step]=digest
      }
      delete f.checks[step]
      const recoveryPoint=step==='windowsLogBackups'||step==='exportPointInTime'?
        fingerprint(ctx,[data.restoreToDate??null,data.restoreBeforeLsn??null]):undefined
      f.pending={nonce,step,digest,pointInTime:!!(data.restoreToDate||data.restoreBeforeLsn),recoveryPoint}
      return f
    })
    let started
    try{started=await beginSqlCheck(send,step==='targetInstances'?sid:fid,ref.intent,step,data,flow.databases)}
    catch(error){await store.update(ctx,sid,fid,f=>{if(f.pending?.nonce===nonce){delete f.pending;if(error instanceof VbrRecoveryError&&error.uncertain)f.state='uncertain'}});throw error}
    if('result' in started)return settleCheck(ctx,sid,fid,step,nonce,started.result,store)
    return {pending:sqlSeal(ctx,'pending',{operation:'check',taskId:started.taskId,sessionId:sid,workflowId:fid,step,nonce})}
  }
  if(input.action==='cancelWorkflow') {
    await store.update(ctx,sid,fid,f=>{if(f.state==='submitted' || f.pending?.step==='submit')throw fail('This SQL operation has already been submitted.');f.state='canceled'})
    return cancelSqlAction(send,fid)
  }
  const nonce=randomUUID(),digest=fingerprint(ctx,input.settings)
  const flow=await store.update(ctx,sid,fid,f=>{
    if(f.state==='submitted' && f.submission===digest && f.jobs)return f
    ensureOpen(f)
    const proofs=input.proofs.map(key=>sqlOpen(ctx,'proof',key,proofClaim))
    const valid=(step:SqlStep)=>!!f.checks[step] && proofs.some(p=>p.workflowId===fid && p.sessionId===sid && p.step===step && p.nonce===f.checks[step]?.nonce)
    if(requiredSqlChecks(ref.intent,input.settings).some(step=>!valid(step)))throw fail('Complete VBR validation for this operation.')
    if(f.checks.sqlDatabasesDoNotExist?.existing && !input.settings.overwrite)throw fail('Confirm the existing database can be overwritten.')
    const logs=f.checks.windowsLogBackups,pointInTime=!!input.settings.pointInTime
    if(ref.intent==='export'||ref.intent==='exportFiles') {
      // VBR keeps the configured export point on the workflow. The start payload
      // has no date/LSN, so log validation must attest exactly that native setting.
      const configured=f.checks.exportPointInTime
      if(!configured?.recoveryPoint||configured.pointInTime!==pointInTime||
        ((ref.intent==='export'||pointInTime||logs) && logs?.recoveryPoint!==configured.recoveryPoint)){
        throw fail('Confirm the validated SQL recovery time.')
      }
    } else if(!!logs?.pointInTime!==pointInTime)throw fail('Confirm the validated SQL recovery time.')
    f.pending={step:'submit',nonce,digest}
    return f
  })
  const keys=(jobs:NonNullable<SqlFlow['jobs']>)=>jobs.map(j=>({...j,key:sqlSeal(ctx,'job',{sessionId:sid,workflowId:fid,jobId:j.jobId})}))
  if(flow.state==='submitted' && flow.jobs)return {jobs:keys(flow.jobs)}
  let accepted:Awaited<ReturnType<typeof submitSqlAction>>
  try {accepted=await submitSqlAction(send,fid,ref.intent,flow.databases,input.settings,flow.published)}
  catch(error){await store.update(ctx,sid,fid,f=>{if(f.pending?.nonce===nonce){delete f.pending;if(!(error instanceof VbrRecoveryError)||error.uncertain)f.state='uncertain'}});throw error}
  await store.update(ctx,sid,fid,f=>{f.jobs=accepted.jobs;f.state='submitted';f.submission=digest;delete f.pending})
  return {jobs:keys(accepted.jobs)}
}
