// Open Backup UI v1.2.0
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { validId } from '../investigation/model'
import type { RecoverySend } from '../server/vbr-recovery'
import {adSubmissions,type AdSubmissions} from '../server/ad-submissions'
import {snapshotDirectoryObject,readProductionDirectory,compareDirectoryValues} from '../server/ad-production'
import { checkSource, VbrRecoveryError } from './error'

const guid = z.string().refine(validId).transform(value=>value.toLowerCase())
const source = z.string().regex(/^[a-f0-9]{64}$/)
const text = z.string().trim().min(1).max(4096)
const server = z.string().trim().min(1).max(255).regex(/^[\p{L}\p{N}_.:[\]-]+$/u)
const password = z.string().min(1).max(4096)
const ticket = z.string().min(1).max(16384)
const dnt = z.number().int().positive().max(2147483647)
const parent = z.object({dnt,containerType:z.enum(['ConfigurationPartition','UsersAndComputers','GroupPolicyObjects','IntegratedDNS','DfsConfiguration']).optional(),
  dnsZoneCategory:z.enum(['CachedLookup','ForwardLookupZone','ReverseLookupZone','ConditionalForwarder','StubZone','Other']).optional()})
const workflow = z.object({id:guid,intent:z.enum(['restore','export']),key:ticket})
const context = {sourceKey:source}
const session = {...context,sessionId:guid}
const work = {...session,workflow}
const steps = ['targets','catalogs','certificate','catalogCertificate','credentials','passwordAccess','items','attributes','containers','exportServer','exportPath'] as const
const stepSchema=z.enum(steps)
export const adExplorerSchema=z.discriminatedUnion('action',[
  z.object({...context, action:z.literal('start'),restorePointId:guid,backupId:guid,backupObjectId:guid,reviewedMalwareStatus:z.string().max(64).nullish()}),
  z.object({...context, action:z.literal('poll'),pending:ticket}),
  z.object({...session, action:z.literal('browse'),view:z.enum(['domains','containers','items','attributes']),parent:parent.optional(),
    query:z.string().trim().max(2048).optional(),ldap:z.boolean().optional(),recurse:z.boolean().optional(),
    skip:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(200).default(100)}),
  z.object({...session,action:z.literal('keepAlive')}),z.object({...session,action:z.literal('finish')}),
  z.object({...session,action:z.literal('prepare'),intent:z.enum(['restore','export']),dntIds:z.array(dnt).min(1).max(256)}),
  z.object({...session,action:z.literal('comparisonSource'),dnt}).strict(),
  z.object({...session,action:z.literal('compareProduction'),dnt,reference:ticket,username:text,password}).strict(),
  z.object({...work,action:z.literal('cancelWorkflow')}),
  z.object({...work,action:z.literal('check'),step:stepSchema,server:server.optional(),gcServer:server.optional(),useSsl:z.boolean().optional(),
    username:text.optional(),password:password.optional(),rootDn:text.optional(),path:text.optional(),filename:text.optional(),overwrite:z.boolean().optional()}),
  z.object({...work,action:z.literal('trust'),thumbprint:text,serviceUri:text,certificateKey:ticket,remember:z.boolean().default(false)}),
  z.object({...work,action:z.literal('restore'),proofs:z.array(ticket).max(16),targetContainer:text.optional(),fullRestore:z.boolean(),
    skipAttributes:z.array(text).max(4096).default([]),mergeMultivalues:z.boolean().default(false),restoreChangedObjects:z.boolean(),restoreDeletedObjects:z.boolean(),
    restoreLinkExpirationTime:z.boolean().default(true),accountState:z.enum(['KeepStateFromBackup','Enable','Disable']),
    passwordAction:z.enum(['RestorePassword','SetPasswordTo','DoNotRestorePassword']),newPassword:password.optional(),changePasswordAtLogon:z.boolean().default(false)}),
  z.object({...work,action:z.literal('export'),proofs:z.array(ticket).max(16),filter:text.optional(),ldap:z.boolean().optional()}),
])
export type AdExplorerInput=z.infer<typeof adExplorerSchema>
type Check=Extract<AdExplorerInput,{action:'check'}>
type Context={sourceKey:string;principalKey:string;secret:string}
type Claims={purpose:'pending'|'workflow'|'proof'|'certificate'|'comparison';sessionId?:string;workflowId?:string;intent?:'restore'|'export';
  operation?:'start'|'browse'|'trust'|'comparisonSource'|Check['step'];taskId?:string;view?:string;dnt?:number;thumbprint?:string;serviceUri?:string;submittedAt?:number;
  restorePointId?:string;backupId?:string;backupObjectId?:string;hasAccountObjects?:boolean;canRestoreDeletedObjects?:boolean;mergeModeAllowed?:boolean}
const base='/private-api/v1'
const browseBase=base+'/backupBrowser/applicationItems/vead'
const validBase=base+'/validations/applicationItems/vead'
const restoreBase=base+'/restore/applicationItems/vead'
const exportBase=base+'/export/applicationItems/vead'
const failure=(message:string,status=400)=>new VbrRecoveryError(message,status)
function signature(payload:string,ctx:Context) {
  return createHmac('sha256',ctx.secret).update(JSON.stringify(['vead',ctx.sourceKey,ctx.principalKey,payload])).digest('base64url')
}
function seal(data:Claims,ctx:Context) {
  const payload=Buffer.from(JSON.stringify({...data,submittedAt:Date.now()})).toString('base64url')
  return payload+'.'+signature(payload,ctx)
}
function open(value:string,ctx:Context,purpose:Claims['purpose']) {
  const parts=value.split('.'), expected=Buffer.from(signature(parts[0],ctx)), received=Buffer.from(parts[1]||'')
  if(parts.length!==2 || expected.length!==received.length || !timingSafeEqual(expected,received))throw failure('This Explorer request belongs to another session or source.',409)
  const claims=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8')) as Claims
  if(claims.purpose!==purpose || !claims.submittedAt || Date.now()-claims.submittedAt>4*3600000)throw failure('The Explorer request expired. Reopen the operation.',409)
  return claims
}
function verifyWorkflow(input:Extract<AdExplorerInput,{workflow:unknown}>,ctx:Context) {
  const claims=open(input.workflow.key,ctx,'workflow')
  if(claims.sessionId!==input.sessionId || claims.workflowId!==input.workflow.id || claims.intent!==input.workflow.intent)throw failure('This action belongs to another Explorer workflow.',409)
}
function resultId(value:unknown) {
  const parsed=z.object({id:guid}).safeParse(value)
  if(!parsed.success)throw new VbrRecoveryError('VBR did not return the Explorer task or session ID. Check Sessions before trying again.',502,true)
  return parsed.data.id
}
const mutation=(send:RecoverySend,path:string,body?:unknown)=>send(path,{method:'POST',mutation:true,...(body!==undefined&&{body})})
function pending(ctx:Context,task:unknown,claims:Omit<Claims,'purpose'|'taskId'>) {
  return {pending:seal({...claims,purpose:'pending',taskId:resultId(task)},ctx)}
}
const names={domains:'ADDomain',containers:'ADContainer',items:'ADItem',attributes:'ADItemAttribute'} as const
function browsePayload(input:Extract<AdExplorerInput,{action:'browse'}>) {
  if(['items','attributes'].includes(input.view) && !input.parent)throw failure('Select an Active Directory container or item.')
  const p=input.parent
  return {searchObjectType:names[input.view],
    ...(p && ['containers','items'].includes(input.view) && {searchObjectParentFilter:{parentContainerId:p.dnt,parentContainerType:p.containerType||'UsersAndComputers',
      parentDnsZoneCategory:p.dnsZoneCategory||(input.view==='items'?'StubZone':'Other'),children:[]}}),
    ...(input.view==='items' && {itemSearchFilter:{recurse:!!input.recurse,...(input.query && (input.ldap?{ldapQuery:input.query}:{name:input.query})),sortBy:'Name',sortDirection:'Ascending'}}),
    ...(input.view==='attributes' && p && {itemAttributesFilter:{itemId:p.dnt}})}
}
const row=z.object({type:z.enum(['ADDomain','ADContainer','ADItem','ADItemAttribute']),id:z.union([z.string(),z.number()]),name:z.string(),
  dnt:z.number().int().nullish(),containerType:z.string().nullish(),dnsZoneCategory:z.string().nullish(),itemType:z.string().nullish(),
  description:z.string().nullish(),parentName:z.string().nullish(),values:z.array(z.string()).nullish()})
function browsePage(value:unknown,view:string|undefined) {
  const page=z.object({data:z.array(row),pagination:z.object({total:z.number().int().nonnegative()})}).parse(value)
  const types={ADDomain:'domain',ADContainer:'container',ADItem:'item',ADItemAttribute:'attribute'} as const
  const expected=names[view as keyof typeof names]
  return {items:page.data.filter(item=>item.type===expected).map(item=>({...item,id:String(item.id),type:types[item.type]})),total:page.pagination.total}
}
const endpoints:Record<Check['step'],string>={targets:'possibleRestoreTargets',catalogs:'possibleGlobalCatalogs',certificate:'certificate',
  catalogCertificate:'global-catalog-certificate',credentials:'credentials',passwordAccess:'adminShareAndSam',items:'restoreItems',
  attributes:'attributesForRestore',containers:'serverContainers',exportServer:'targetWindowsServer',exportPath:'targetPath'}
function checkPayload(input:Check) {
  const {step,username,password,server,gcServer,useSsl}=input
  if((step==='exportServer'||step==='exportPath') !== (input.workflow.intent==='export'))throw failure('Select the matching Explorer workflow.')
  if(step==='credentials'||step==='exportServer'||step==='catalogCertificate') {
    if(!server || !username || !password)throw failure('Enter the destination server and credentials.')
    const credentials={username,password,type:'Standard'}
    if(step==='exportServer')return {server,credentials:{credentials,credentialsKind:'UserAccount'}}
    return {server,credentials:step==='catalogCertificate'?{username,password}:credentials,useSsl:!!useSsl,...(gcServer&&{gcServer})}
  }
  if(step==='certificate') {if(!server)throw failure('Enter the destination server.');return {server}}
  if(step==='containers')return input.rootDn?{rootDn:input.rootDn}:{}
  if(step==='exportPath') {if(!input.path)throw failure('Enter a destination path.');return {path:input.path,filename:input.filename,canOverwrite:!!input.overwrite}}
  return undefined
}
const validation=z.object({
  result:z.string().nullish(),error:z.string().nullish(),message:z.string().nullish(),question:z.string().nullish(),
  interaction:z.array(z.object({question:z.string().nullish()})).nullish(),
  hasAccountObjects:z.boolean().nullish(),canRestoreDeletedObjects:z.boolean().nullish(),mergeModeAllowed:z.boolean().nullish(),
  server:z.array(z.object({name:z.string()})).nullish(),attributes:z.array(z.object({name:z.string(),isMandatory:z.boolean().nullish(),isChangeable:z.boolean().nullish()})).nullish(),
  containers:z.array(z.object({name:z.string().nullish(),distinguishedName:z.string()})).nullish(),
  certificate:z.object({thumbprint:z.string(),subject:z.string().nullish(),issuer:z.string().nullish()}).nullish(),serviceUri:z.string().nullish(),
})
function checkResult(value:unknown,claims:Claims,ctx:Context,taskError?:string) {
  const v=validation.parse(value),step=claims.operation
  const message=v.error || v.message || taskError
  const question=v.question || v.interaction?.find(i=>i.question)?.question || undefined
  if((step==='certificate'||step==='catalogCertificate') && v.certificate) {
    const serviceUri=v.serviceUri || claims.serviceUri
    if(!serviceUri)throw failure('VBR did not identify the certificate endpoint.',502)
    const {thumbprint}=v.certificate
    return {ok:false,message,certificate:{...v.certificate,serviceUri},certificateKey:seal({...claims,purpose:'certificate',thumbprint,serviceUri},ctx)}
  }
  if(v.error || taskError)return {ok:false,message,question}
  if(step==='targets'||step==='catalogs')return {servers:(v.server||[]).map(item=>item.name)}
  if(step==='attributes')return {attributes:(v.attributes||[]).map(item=>item.name),attributeOptions:v.attributes||[],
    ...(v.attributes?.length&&{proof:seal({...claims,purpose:'proof'},ctx)})}
  if(step==='containers')return {containers:(v.containers||[]).map(item=>({name:item.name||item.distinguishedName,distinguishedName:item.distinguishedName}))}
  // The native items and Windows-target validators signal success by the absence
  // of error/question. Every other permission check has an explicit result.
  const resultKeys=step==='certificate'||step==='catalogCertificate'?['error','errorType','sslPolicyError','certificate','serviceUri','result','message']:
    step==='items'?['error','question','result','message','hasAccountObjects','canRestoreDeletedObjects','mergeModeAllowed']:['error','result','message']
  const knownEnvelope=Object.keys(value as object).every(key=>resultKeys.includes(key))
  const emptySuccess=!v.result && !message && knownEnvelope
  const reportedSuccess=['Success','Warning'].includes(v.result||'')
  if(step==='certificate'||step==='catalogCertificate')return {ok:emptySuccess||reportedSuccess,message}
  const ok=step==='items'||step==='exportServer' ? emptySuccess||reportedSuccess :
    step==='passwordAccess' ? v.result==='Success' : reportedSuccess
  const capabilities=step==='items'?{hasAccountObjects:v.hasAccountObjects??undefined,canRestoreDeletedObjects:!!v.canRestoreDeletedObjects,mergeModeAllowed:!!v.mergeModeAllowed}:{}
  return {ok,question,message,...capabilities,...(ok&&{proof:seal({...claims,purpose:'proof',...capabilities},ctx)})}
}
function checkProofs(input:Extract<AdExplorerInput,{proofs:unknown}>,ctx:Context,required:Check['step'][]) {
  const verified=input.proofs.map(proof=>open(proof,ctx,'proof')).filter(claims=>claims.sessionId===input.sessionId &&
    claims.workflowId===input.workflow.id && claims.intent===input.workflow.intent)
  if(required.some(step=>!verified.some(claims=>claims.operation===step)))throw failure('Complete VBR validation for this operation.',409)
  return verified
}
async function poll(send:RecoverySend,ctx:Context,handle:string) {
  const claims=open(handle,ctx,'pending'),{operation,taskId,sessionId,workflowId}=claims
  const checking=operation!=='start' && operation!=='browse' && operation!=='comparisonSource'
  const raw=await send((checking?base+'/validations/applicationItems/tasks/':base+'/tasks/')+taskId)
  const task=z.object({id:guid,state:z.string(),type:z.literal('Common'),result:z.string().nullish(),
    additionalInfo:z.object({message:z.string().nullish()}).nullish()}).parse(raw)
  if(task.id!==taskId)throw failure('VBR returned a different Explorer task.',502)
  if(task.state!=='Stopped')return {pending:handle}
  const taskError=['Success','Warning'].includes(task.result||'')?undefined:task.additionalInfo?.message||'The VBR Explorer task did not complete successfully.'
  if(taskError && (!checking||operation==='trust'||task.result!=='Failed'))throw failure(taskError,409)
  if(operation==='trust')return {ok:true}
  if(operation==='start')return {sourceKey:ctx.sourceKey,sessionId:resultId(await send(browseBase+'/'+taskId+'/result')),application:'ActiveDirectory',
    restorePointId:claims.restorePointId,backupId:claims.backupId,backupObjectId:claims.backupObjectId}
  if(operation==='browse')return browsePage(await send(browseBase+'/'+sessionId+'/'+taskId+'/result'),claims.view)
  if(operation==='comparisonSource'){
    const snapshot=await comparisonSnapshot(send,claims)
    return snapshot?{available:true,domain:snapshot.domain,dn:snapshot.dn,reference:seal({...claims,purpose:'comparison'},ctx)}:{available:false}
  }
  if(!operation||!workflowId||!sessionId)throw failure('Invalid Explorer validation handle.')
  const path=operation==='catalogCertificate'?'certificate':endpoints[operation]
  return checkResult(await send(validBase+'/'+workflowId+'/'+path+'/'+taskId+'/result'),claims,ctx,taskError)
}

async function comparisonSnapshot(send:RecoverySend,claims:Claims){
  const page=browsePage(await send(browseBase+'/'+claims.sessionId+'/'+claims.taskId+'/result'),'attributes')
  return page.total===page.items.length?snapshotDirectoryObject(page.items):undefined
}

export async function runAdExplorer(send:RecoverySend,input:AdExplorerInput,ctx:Context,submissions:AdSubmissions=adSubmissions,
  production=readProductionDirectory) {
  checkSource(input.sourceKey,ctx.sourceKey)
  if(!ctx.principalKey || !ctx.secret)throw failure('Reconnect the VBR source before opening Explorer.',401)
  if(input.action==='start')return pending(ctx,await mutation(send,browseBase,{restorePointId:input.restorePointId}),{
    operation:'start',restorePointId:input.restorePointId,backupId:input.backupId,backupObjectId:input.backupObjectId})
  if(input.action==='poll')return poll(send,ctx,input.pending)
  const sessionId=input.sessionId
  if(input.action==='keepAlive'||input.action==='finish') {
    // Verify the selected session really is a VEAD publication before the generic close action.
    await mutation(send,browseBase+'/'+sessionId+'/keepAlive')
    if(input.action==='finish')await mutation(send,base+'/applicationItems/sessions/'+sessionId+'/close')
    return {ok:true}
  }
  if(input.action==='browse')return pending(ctx,await mutation(send,browseBase+'/'+sessionId+'?skip='+input.skip+'&limit='+input.limit,browsePayload(input)),
    {operation:'browse',sessionId,view:input.view})
  if(input.action==='comparisonSource'){
    if(process.platform!=='win32'&&production===readProductionDirectory)return {available:false}
    const task=await mutation(send,browseBase+'/'+sessionId+'?skip=0&limit=200',{searchObjectType:'ADItemAttribute',itemAttributesFilter:{itemId:input.dnt}})
    return pending(ctx,task,{operation:'comparisonSource',sessionId,dnt:input.dnt})
  }
  if(input.action==='compareProduction'){
    const reference=open(input.reference,ctx,'comparison')
    if(reference.sessionId!==sessionId||reference.dnt!==input.dnt||reference.operation!=='comparisonSource')throw failure('Select the original directory object again.',409)
    const snapshot=await comparisonSnapshot(send,reference)
    if(!snapshot)throw failure('VBR could not verify the directory object identity.',409)
    return compareDirectoryValues(snapshot,await production(snapshot,input.username,input.password))
  }
  if(input.action==='prepare') {
    if(new Set(input.dntIds).size!==input.dntIds.length)throw failure('Select each Active Directory object once.')
    const path=input.intent==='restore'?restoreBase:exportBase
    const id=resultId(await mutation(send,path+'/'+sessionId+'/init',{dntIds:input.dntIds}))
    return {workflow:{id,intent:input.intent,key:seal({purpose:'workflow',sessionId,workflowId:id,intent:input.intent},ctx)}}
  }
  verifyWorkflow(input,ctx)
  const {id:workflowId,intent}=input.workflow
  if(input.action==='check')return pending(ctx,await mutation(send,validBase+'/'+workflowId+'/'+endpoints[input.step],checkPayload(input)),
    {operation:input.step,sessionId,workflowId,intent,...((input.step==='certificate'||input.step==='catalogCertificate')&&{serviceUri:input.server})})
  if(input.action==='cancelWorkflow') {
    await submissions.submit(ctx,sessionId,workflowId,'cancel',{},async()=>{
      await mutation(send,base+'/validations/applicationItems/'+workflowId+'/revoke')
      return {sessionId}
    })
    return {ok:true}
  }
  if(input.action==='trust') {
    const grant=open(input.certificateKey,ctx,'certificate')
    if(grant.workflowId!==workflowId || grant.sessionId!==sessionId || grant.thumbprint!==input.thumbprint || grant.serviceUri!==input.serviceUri)throw failure('The certificate changed. Verify it again.',409)
    return pending(ctx,await mutation(send,validBase+'/'+workflowId+'/trustCertificate',{
      certificateThumbprint:input.thumbprint,serviceUri:input.serviceUri,shouldRememberForAccount:input.remember}),{operation:'trust',sessionId,workflowId,intent})
  }
  if(input.action==='export') {
    if(intent!=='export')throw failure('Select an export workflow.')
    checkProofs(input,ctx,['exportServer','exportPath'])
    const body={useFilter:!!input.filter,filter:input.filter,useLdapFilter:!!input.filter&&!!input.ldap}
    return submissions.submit(ctx,sessionId,workflowId,intent,[body,input.proofs],async()=>{
      const result=z.object({jobId:guid,name:z.string().nullish()}).safeParse(await mutation(send,exportBase+'/'+workflowId+'/start',body))
      if(!result.success)throw new VbrRecoveryError('VBR did not return the export job ID. Check Sessions before trying again.',502,true)
      return {sessionId:result.data.jobId,name:result.data.name||undefined}
    })
  }
  if(intent!=='restore')throw failure('Select a restore workflow.')
  if(!input.restoreChangedObjects && !input.restoreDeletedObjects)throw failure('Select changed or deleted objects to restore.')
  if(input.passwordAction==='SetPasswordTo' && !input.newPassword)throw failure('Enter a new account password.')
  const grants=checkProofs(input,ctx,input.fullRestore?['credentials','items']:['credentials','items','attributes'])
  const items=grants.find(claim=>claim.operation==='items')!
  if(items.hasAccountObjects!==false && !grants.some(claim=>claim.operation==='passwordAccess'))throw failure('Complete VBR validation for the selected account options.',409)
  if(items.hasAccountObjects===false && (input.passwordAction==='SetPasswordTo'||input.changePasswordAtLogon))throw failure('This selection contains no accounts.')
  if(input.restoreDeletedObjects&&!items.canRestoreDeletedObjects)throw failure('VBR cannot restore deleted objects for this selection.')
  if(input.mergeMultivalues&&!items.mergeModeAllowed)throw failure('VBR cannot merge multivalued attributes for this selection.')
  if(!input.fullRestore) {
    const attributes=grants.find(claim=>claim.operation==='attributes')!
    const result=validation.parse(await send(validBase+'/'+workflowId+'/attributesForRestore/'+attributes.taskId+'/result'))
    const options=result.attributes,skipped=new Set(input.skipAttributes)
    if(result.error || !options?.length || skipped.size!==input.skipAttributes.length || skipped.size>=options.length ||
      input.skipAttributes.some(name=>!options.some(attr=>attr.name===name)) ||
      options.some(attr=>attr.isMandatory&&skipped.has(attr.name) || attr.isChangeable===false&&!attr.isMandatory&&!skipped.has(attr.name))) {
      throw failure('Review the available and required Active Directory attributes.',409)
    }
  }
  const body={
    targetContainer:input.targetContainer,skipAttributes:input.fullRestore?[]:input.skipAttributes,mergeMultivalues:input.mergeMultivalues,
    fullRestore:input.fullRestore,setChangePasswordAtNextLogon:input.changePasswordAtLogon,restoreChangedObjects:input.restoreChangedObjects,
    restoreDeletedObjects:input.restoreDeletedObjects,restoreLinkExpirationTime:input.restoreLinkExpirationTime,
    specifiedPassword:input.passwordAction==='SetPasswordTo'?input.newPassword:undefined,restoreAccountToState:input.accountState,passwordRestoreType:input.passwordAction}
  return submissions.submit(ctx,sessionId,workflowId,intent,[body,input.proofs],async()=>{
    const result=z.object({id:guid,status:z.string().nullish()}).safeParse(await mutation(send,restoreBase+'/'+workflowId+'/start?force=false',body))
    if(!result.success)throw new VbrRecoveryError('VBR did not return the restore operation ID. Check Sessions before trying again.',502,true)
    return {sessionId:result.data.id,status:result.data.status||undefined}
  })
}
