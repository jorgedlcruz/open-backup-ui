// Open Backup UI v1.0.2
import {createHmac,randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {RecoverySend} from '../server/vbr-recovery'
import {sqlStagingReceipts,type SqlStagingReceipt} from '../server/sql-staging-receipts'
import {applicationAccess} from './application-eligibility'
import {VbrRecoveryError} from './error'
import {sqlGuid,sqlOpen,sqlScope,sqlSeal,sqlTicket,type SqlContext} from './sql-protocol'

const root='/private-api/v1/settings/applicationItems/vesql/stagingServer'
const validation='/private-api/v1/validations/applicationItems'
const session={sourceKey:sqlScope,sessionId:sqlGuid}
const label=z.string().trim().max(512).refine(v=>!/[\x00-\x1f\x7f]/.test(v))
const auth=z.enum(['machine','windows','sql'])
const password=z.string().min(1).max(4096)
const draft=z.object({enabled:z.boolean(),serverName:label,windowsUsername:label,windowsPassword:password.optional(),
  sqlAuth:auth,sqlUsername:label,sqlPassword:password.optional()}).strict()
export const stagingInput=z.discriminatedUnion('action',[
  z.object({...session,action:z.literal('stagingRead')}).strict(),
  z.object({...session,action:z.literal('stagingChoose')}).strict(),
  z.object({...session,action:z.literal('stagingSave'),revision:sqlTicket,settings:draft}).strict(),
  z.object({...session,action:z.literal('stagingPoll'),pending:sqlTicket}).strict(),
])
type Input=z.infer<typeof stagingInput>
export type SqlStagingDraft=z.infer<typeof draft>
export type SqlStagingSettings=Omit<SqlStagingDraft,'windowsPassword'|'sqlPassword'>&{hasWindowsPassword:boolean;hasSqlPassword:boolean}
type Draft=SqlStagingDraft
const user=z.object({username:label.nullish(),password:z.string().nullish()})
const win=z.object({credentials:user}).nullish()
const native=z.object({enabled:z.boolean(),machineConnectionConfig:z.object({machineName:label,windowsCredentials:win}),
  sqlConnectionConfig:z.object({sqlServer:z.object({machineName:label,instanceName:label.nullish()}).nullish(),
    windowsCredentials:win,sqlAuthCredentials:user.nullish()})}).nullable()
const rev=z.object({sessionId:sqlGuid,id:sqlGuid,stamp:z.string(),generation:z.string()})
const grant=z.object({sessionId:sqlGuid,kind:z.enum(['choose','save']),id:sqlGuid,taskId:sqlGuid})
const changed='SQL staging settings changed. Reload them before applying your changes.'
const invalid='VBR could not read the SQL staging server settings.'
const rejected='VBR could not validate the SQL staging server. Check the server and credentials.'
const uncertain='VBR could not confirm the SQL staging change. Reload the settings before trying again.'
const fail=(msg:string,status=409)=>new VbrRecoveryError(msg,status)
const unknown=()=>new VbrRecoveryError(uncertain,502,true)
const idReply=z.object({id:sqlGuid})

// Settings responses can contain actual passwords. Take a keyed digest for
// optimistic concurrency and explicitly project the fields allowed in the UI.
function digest(ctx:SqlContext,value:unknown){
  return createHmac('sha256',ctx.secret).update(JSON.stringify(['sql-staging',ctx.sourceKey,ctx.principalKey,value])).digest('hex')
}
async function readSettings(send:RecoverySend,ctx:SqlContext){
  const parsed=native.safeParse(await send(root))
  if(!parsed.success)throw fail(invalid,502)
  const raw=parsed.data,server=raw?.sqlConnectionConfig.sqlServer
  if(server?.machineName&&raw?.machineConnectionConfig.machineName&&server.machineName.toLowerCase()!==raw.machineConnectionConfig.machineName.toLowerCase())throw fail(invalid,502)
  const machine=raw?.machineConnectionConfig.windowsCredentials?.credentials
  const sql=raw?.sqlConnectionConfig.sqlAuthCredentials,separate=raw?.sqlConnectionConfig.windowsCredentials?.credentials
  const sqlAuth:Draft['sqlAuth']=sql?'sql':separate?.username&&separate.username!==machine?.username?'windows':'machine'
  const host=raw?.machineConnectionConfig.machineName||server?.machineName||''
  const result:SqlStagingSettings={enabled:raw?.enabled??false,serverName:host+(server?.instanceName?'\\'+server.instanceName:''),
    windowsUsername:machine?.username||'',hasWindowsPassword:!!machine?.username,sqlAuth,
    sqlUsername:sqlAuth==='machine'?'':sql?.username||separate?.username||'',hasSqlPassword:sqlAuth!=='machine'&&!!(sql?.username||separate?.username)}
  return {settings:result,stamp:digest(ctx,raw)}
}
function fingerprint(s:Draft){
  const mode=s.sqlAuth==='windows'&&s.sqlUsername===s.windowsUsername?'machine':s.sqlAuth
  return [s.serverName.toLowerCase(),s.windowsUsername,mode,mode==='machine'?'':s.sqlUsername]
}
function configuration(old:Awaited<ReturnType<typeof readSettings>>['settings'],s:Draft){
  const [machineName,instanceName='',...extra]=s.serverName.split('\\')
  if(!machineName||extra.length||s.serverName.endsWith('\\')||!s.windowsUsername||s.sqlAuth!=='machine'&&!s.sqlUsername)
    throw fail('Enter the staging server and the required account names.',400)
  const windowsChanged=s.windowsUsername!==old.windowsUsername
  const sqlChanged=s.sqlAuth!==old.sqlAuth||s.sqlAuth!=='machine'&&s.sqlUsername!==old.sqlUsername
  const useMachineInstead=s.sqlAuth==='machine'&&old.sqlAuth!=='machine'
  if((windowsChanged||!old.hasWindowsPassword||useMachineInstead)&&!s.windowsPassword||
    s.sqlAuth!=='machine'&&(sqlChanged||!old.hasSqlPassword)&&!s.sqlPassword)
    throw fail('Enter a password for each new or changed staging account.',400)
  if(s.sqlAuth==='machine'&&s.sqlPassword)throw fail('Review the SQL staging authentication mode.',400)
  const windows=(username:string,password:string)=>({credentials:{username,password,type:'Standard'},credentialsKind:'UserAccount'})
  const machine=s.windowsPassword?windows(s.windowsUsername,s.windowsPassword):undefined
  const sqlServer={machineName,instanceName},sqlConnectionConfig:Record<string,unknown>={sqlServer,encryptionType:'Optional'}
  if(s.sqlAuth==='sql'&&s.sqlPassword)sqlConnectionConfig.sqlAuthCredentials={username:s.sqlUsername,password:s.sqlPassword,type:'Standard'}
  if(s.sqlAuth==='windows'&&s.sqlPassword)sqlConnectionConfig.windowsCredentials=windows(s.sqlUsername,s.sqlPassword)
  if(s.sqlAuth==='machine'&&machine)sqlConnectionConfig.windowsCredentials=machine
  return {machineConnectionConfig:{machineName,...(machine&&{windowsCredentials:machine})},sqlConnectionConfig}
}
function ticket(ctx:SqlContext,r:SqlStagingReceipt){
  return sqlSeal(ctx,'staging-task',{kind:'save',id:r.id,sessionId:r.sessionId,taskId:r.taskId})
}
function pending(ctx:SqlContext,r:SqlStagingReceipt){return {status:'pending' as const,pending:ticket(ctx,r)}}
const saved=()=>({status:'saved' as const})
async function state(send:RecoverySend,taskId:string){
  const parsed=z.object({id:sqlGuid,type:z.literal('Common'),state:z.enum(['Starting','Working','Stopping','Stopped']),result:z.string().nullish()})
    .safeParse(await send(validation+'/tasks/'+taskId))
  if(!parsed.success||parsed.data.id!==taskId)throw fail('VBR returned a different Explorer task.',502)
  return parsed.data
}
const scopedServers=z.object({instances:z.array(z.object({serverName:label.min(1),instanceName:label.nullish()}))})
const settingsResult=z.object({error:z.string().nullish()})

export async function runSqlStaging(upstream:RecoverySend,input:Input,ctx:SqlContext,store=sqlStagingReceipts){
  if(input.sourceKey!==ctx.sourceKey)throw fail('The connected VBR source changed. Reopen this workflow.')
  // Native errors can echo connection strings or validation input. Never pass
  // upstream payloads or arbitrary provider text from this credential editor.
  const send:RecoverySend=async(path,options)=>{
    try{return await upstream(path,options)}catch(e){
      const status=e instanceof VbrRecoveryError?e.status:502,ambiguous=!!options?.mutation&&(e instanceof VbrRecoveryError?e.uncertain:status>=500)
      throw new VbrRecoveryError(ambiguous?uncertain:status===403?'Your VBR account cannot change these SQL staging settings.':
        input.action==='stagingRead'?invalid:rejected,status,ambiguous)
    }
  }
  const {sessionId}=input
  const writeNative=async(path:string,receipt:SqlStagingReceipt,body?:unknown)=>{
    try{return await send(path,{method:'POST',mutation:true,...(body!==undefined&&{body})})}
    catch(e){
      if(e instanceof VbrRecoveryError&&!e.uncertain&&e.status<500)
        await store.write(ctx,{...receipt,phase:'failed'})
      throw e
    }
  }
  const rights=await applicationAccess(send)
  if(!['ViewBackupObjects','ViewRestorePoints','ViewTasks','StartExplorerForMsSql'].every(right=>rights.has(right)))
    throw fail('Your VBR account cannot change these SQL staging settings.',403)
  // The route checks the original operator's open-session marker. This
  // provider-specific check also rejects a mount closed or expired in VBR.
  await send('/private-api/v1/restore/applicationItems/vesql/'+sessionId+'/keepAlive',{method:'POST'})
  if(input.action==='stagingRead'){
    const [current,last]=await Promise.all([readSettings(send,ctx),store.read(ctx)])
    return {settings:current.settings,revision:sqlSeal(ctx,'staging-revision',{id:randomUUID(),sessionId,stamp:current.stamp,generation:digest(ctx,last?.id??null)}),
      ...(last?.sourceKey===ctx.sourceKey&&last.principalKey===ctx.principalKey&&last.sessionId===sessionId&&last.phase==='validating'&&{pending:ticket(ctx,last)})}
  }
  if(input.action==='stagingChoose'){
    const reply=idReply.safeParse(await send(validation+'/vesql/'+sessionId+'/targetInstances',{method:'POST'}))
    if(!reply.success)throw fail('VBR could not list SQL staging server instances.',502)
    return {status:'pending' as const,pending:sqlSeal(ctx,'staging-task',{id:randomUUID(),sessionId,kind:'choose',taskId:reply.data.id})}
  }
  if(input.action==='stagingPoll'){
    const ref=sqlOpen(ctx,'staging-task',input.pending,grant)
    if(sessionId!==ref.sessionId)throw fail('Select the current SQL workflow.')
    const activeReceipt=async()=>{
      const last=await store.read(ctx)
      if(!last||last.sourceKey!==ctx.sourceKey||last.principalKey!==ctx.principalKey||last.id!==ref.id||last.taskId!==ref.taskId||last.sessionId!==sessionId)throw fail(changed)
      if(last.phase==='failed')throw fail(rejected)
      if(last.phase!=='validating'&&last.phase!=='saved')throw unknown()
      return last
    }
    if(ref.kind==='save'&&(await activeReceipt()).phase==='saved')return saved()
    const task=await state(send,ref.taskId)
    if(task.state!=='Stopped')return {status:'pending' as const,pending:input.pending}
    if(ref.kind==='choose'){
      if(!['Success','Warning'].includes(task.result||''))throw fail('VBR could not list SQL staging server instances.')
      const res=scopedServers.safeParse(await send(validation+'/vesql/'+sessionId+'/targetInstances/'+ref.taskId+'/result'))
      if(!res.success)throw fail('VBR could not list SQL staging server instances.',502)
      return {status:'choices' as const,servers:[...new Set(res.data.instances.map(s=>s.serverName+(s.instanceName?'\\'+s.instanceName:'')))]}
    }
    return store.exclusive(ctx,async()=>{
      const last=await activeReceipt()
      if(last.phase==='saved')return saved()
      if(!['Success','Warning'].includes(task.result||'')){await store.write(ctx,{...last,phase:'failed'});throw fail(rejected)}
      const res=settingsResult.safeParse(await send(root+'/'+ref.taskId+'/result'))
      if(!res.success||res.data.error){await store.write(ctx,{...last,phase:'failed'});throw fail(rejected)}
      const current=await readSettings(send,ctx)
      if(digest(ctx,fingerprint(current.settings))!==last.target||!last.enable&&!current.settings.enabled)throw fail(changed)
      if(last.enable&&!current.settings.enabled){
        const toggling={...last,phase:'toggling' as const,updated:Date.now()}
        await store.write(ctx,toggling)
        await writeNative(root+'/enable',toggling)
      }
      await store.write(ctx,{...last,phase:'saved'}).catch(()=>{throw unknown()})
      return saved()
    })
  }
  const ref=sqlOpen(ctx,'staging-revision',input.revision,rev)
  if(ref.sessionId!==sessionId)throw fail(changed)
  return store.exclusive(ctx,async()=>{
    const last=await store.read(ctx),s=input.settings,plan=digest(ctx,s)
    if(last?.id===ref.id){
      if(last.sourceKey!==ctx.sourceKey||last.principalKey!==ctx.principalKey||last.sessionId!==sessionId||last.plan!==plan)throw fail(changed)
      if(last.phase==='saved')return saved()
      if(last.phase==='validating')return pending(ctx,last)
      if(last.phase==='failed')throw fail(rejected)
      throw unknown()
    }
    if(digest(ctx,last?.id??null)!==ref.generation)throw fail(changed)
    if(last&&(last.phase==='sending'||last.phase==='toggling')&&Date.now()-last.updated<300_000)throw unknown()
    if(last?.phase==='validating'&&(await state(send,last.taskId!)).state!=='Stopped')
      throw fail('SQL staging settings are being updated. Reload their status.')
    const current=await readSettings(send,ctx)
    if(current.stamp!==ref.stamp)throw fail(changed)
    const edits=digest(ctx,fingerprint(s))!==digest(ctx,fingerprint(current.settings))||!!s.windowsPassword||!!s.sqlPassword
    const body=s.enabled&&edits?configuration(current.settings,s):undefined
    if(!body&&s.enabled===current.settings.enabled)return saved()
    if(s.enabled&&(!s.serverName||!s.windowsUsername))throw fail('Enter the staging server and the required account names.',400)
    const next:SqlStagingReceipt={id:ref.id,sessionId,sourceKey:ctx.sourceKey,principalKey:ctx.principalKey,updated:Date.now(),phase:'sending',plan,target:digest(ctx,fingerprint(s)),enable:s.enabled&&!current.settings.enabled}
    await store.write(ctx,next)
    if(body){
      const response=idReply.safeParse(await writeNative(root+'?sessionId='+sessionId,next,body))
      if(!response.success)throw unknown()
      const accepted={...next,phase:'validating' as const,taskId:response.data.id}
      await store.write(ctx,accepted).catch(()=>{throw unknown()})
      return pending(ctx,accepted)
    }
    await writeNative(root+(s.enabled?'/enable':'/disable'),next)
    await store.write(ctx,{...next,phase:'saved'}).catch(()=>{throw unknown()})
    return saved()
  })
}
