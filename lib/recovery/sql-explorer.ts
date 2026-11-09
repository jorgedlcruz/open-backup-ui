// Open Backup UI v1.0.2
import {z} from 'zod'
import {randomUUID} from 'node:crypto'
import type {RecoverySend} from '../server/vbr-recovery'
import {sqlWorkflows} from '../server/sql-workflows'
import {sqlBrowseCursor} from '../server/sql-browse-cursor'
import {checkSource,VbrRecoveryError} from './error'
import {pageRequest,parentGrant,sqlGuid,sqlOpen,sqlScope,sqlSeal,sqlTicket,type SqlContext} from './sql-protocol'
import {sqlWorkflowInput,runSqlWorkflow,pollSqlValidation} from './sql-workflow'

const scope={sourceKey:sqlScope}, session={...scope,sessionId:sqlGuid}
const base='/private-api/v1/backupBrowser/applicationItems/vesql'
const idResponse=z.object({id:sqlGuid})
const pendingSchema=z.discriminatedUnion('operation',[
  z.object({operation:z.literal('start'),taskId:sqlGuid,restorePointId:sqlGuid}),
  pageRequest.extend({operation:z.literal('browse'),requestId:sqlGuid.optional(),taskId:sqlGuid.optional(),queuedAt:z.number().optional()}),
  z.object({operation:z.literal('check'),taskId:sqlGuid,sessionId:sqlGuid,workflowId:sqlGuid,step:z.string(),nonce:sqlGuid}),
])
export const sqlExplorerSchema=z.union([z.discriminatedUnion('action',[
  z.object({...scope,action:z.literal('start'),backupId:sqlGuid,objectId:sqlGuid,restorePointId:sqlGuid,reviewedMalwareStatus:z.string().max(64).optional()}).strict(),
  z.object({...scope,action:z.literal('poll'),pending:sqlTicket}).strict(),
  z.object({...session,action:z.literal('browse'),view:pageRequest.shape.view,parent:sqlTicket.optional(),skip:pageRequest.shape.skip.default(0),limit:pageRequest.shape.limit.default(100)}).strict(),
  z.object({...session,action:z.literal('keepAlive')}).strict(),
  z.object({...session,action:z.literal('finish')}).strict(),
]),sqlWorkflowInput])
export type SqlInput=z.infer<typeof sqlExplorerSchema>

export function sqlRequestSession(input:SqlInput,ctx:SqlContext) {
  if('sessionId' in input)return input.sessionId
  if(input.action==='poll') {
    const receipt=sqlOpen(ctx,'pending',input.pending,pendingSchema)
    if('sessionId' in receipt)return receipt.sessionId
  }
}
function taskId(raw:unknown) {
  const accepted=idResponse.safeParse(raw)
  if(!accepted.success)throw new VbrRecoveryError('Check Sessions before submitting another request.',502,true)
  return accepted.data.id
}
/** Published jobs and their export workflows can outlive the SQL browse mount. */
export async function sqlAfterClose(input:SqlInput,ctx:SqlContext,store=sqlWorkflows) {
  if(input.action==='operations'||input.action==='mounted')return true
  if(input.action==='prepare')return input.intent==='exportPublished'
  if('workflow' in input)return input.workflow.intent==='exportPublished'
  if(input.action==='poll') {
    const claim=sqlOpen(ctx,'pending',input.pending,pendingSchema)
    return claim.operation==='check' && (await store.read(ctx,claim.sessionId,claim.workflowId)).intent==='exportPublished'
  }
  return false
}
export async function runSqlExplorer(send:RecoverySend,input:SqlInput,ctx:SqlContext,store=sqlWorkflows,cursor=sqlBrowseCursor) {
  checkSource(input.sourceKey,ctx.sourceKey)
  if(!ctx.secret || !ctx.principalKey)throw new VbrRecoveryError('Reconnect the VBR source before opening Explorer.',401)
  if(input.action==='start') {
    const id=taskId(await send(base,{method:'POST',mutation:true,body:{restorePointId:input.restorePointId}}))
    return {pending:sqlSeal(ctx,'pending',{operation:'start',taskId:id,restorePointId:input.restorePointId})}
  }
  if(input.action==='browse') {
    const {sessionId,view,skip,limit}=input
    const parent=parentGrant(ctx,view,sessionId,input.parent)
    return {pending:sqlSeal(ctx,'pending',{operation:'browse',requestId:randomUUID(),queuedAt:Date.now(),sessionId,view,skip,limit,parent})}
  }
  if(input.action==='poll') {
    const receipt=sqlOpen(ctx,'pending',input.pending,pendingSchema)
    if(receipt.operation==='check')return pollSqlValidation(send,ctx,receipt,input.pending,store)
    if(receipt.operation==='browse'){
      if(!receipt.requestId || !receipt.queuedAt)throw new VbrRecoveryError('Reopen the SQL browse page.',409)
      return await cursor.read(send,ctx,receipt,receipt.requestId,receipt.queuedAt)??{pending:input.pending}
    }
    const task=z.object({id:sqlGuid,type:z.literal('Common'),state:z.string(),result:z.string().nullish(),
      additionalInfo:z.object({message:z.string().nullish()}).nullish()}).parse(await send('/private-api/v1/tasks/'+receipt.taskId))
    if(task.id!==receipt.taskId)throw new VbrRecoveryError('VBR returned a different Explorer task.',502)
    if(task.state!=='Stopped')return {pending:input.pending}
    if(!['Success','Warning'].includes(task.result||''))throw new VbrRecoveryError(task.additionalInfo?.message || 'The VBR Explorer task did not complete successfully.',409)
    return {application:'SQL' as const,sourceKey:ctx.sourceKey,restorePointId:receipt.restorePointId,
      sessionId:idResponse.parse(await send(base+'/'+receipt.taskId+'/result')).id}
  }
  if(input.action==='keepAlive' || input.action==='finish') {
    // Confirm VESQL ownership before the generic application-session close call.
    await send('/private-api/v1/restore/applicationItems/vesql/'+input.sessionId+'/keepAlive',{method:'POST',mutation:true})
    if(input.action==='finish')await send('/private-api/v1/applicationItems/sessions/'+input.sessionId+'/close',{method:'POST',mutation:true})
    return {ok:true}
  }
  return runSqlWorkflow(send,ctx,input,store)
}
