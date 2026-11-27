// Open Backup UI v1.3.0
import { z } from 'zod'
import { objectSchema, pointSchema, opaqueId } from '../vbm-protected/model'
import { type Execute, RestoreStatisticsPendingError } from './transport'
import { openWithRepositoryProxy } from './repository-proxy'
import { browseProxyWaitMs } from './proxy-wait-policy'
import { recoveryActivity } from './activity'
import { browseCollectionNotFound } from './read-retry'
import { auditSaveFailed, auditSelection, auditSettings, earlierGroupStopped, restoreAudit } from './restore-audit'
import { readBrowseActivity,recordBrowseActivity,rememberBrowseLocations } from './browse-activity'
import { loadRestoreAuthentication,restoreCodeVerificationCapability,normalizeRestoreDeviceCode } from './restore-auth'
import { browsePath, searchPath, entityPath, restoreGroups } from './paths'
import { beginOnce, once, rememberSession, sessionContext, requestReceipt, sessionBrowseCache, observeBrowseSession, forgetBrowseSession } from './store'
import { RecoveryError, record, part, sessionBase, ownerBase, normalizeSession, normalizeItems, assertWorkload, startSchema, restoreSchema, browseSchema, sessionIdSchema, requestIdSchema, regionSchema, explorerTypes, type RecoveryContext, type RecoverySession, type RecoveryItem, type BrowseInput, type OperationReceipt, type JsonRecord } from './model'

export type BrowseTiming={sessionCheckMs?:number;sourceReadMs?:number}
type Context={browseTiming?:BrowseTiming;execute:Execute;scope:string;sourceName:string;sourceOrigin?:string;signal?:AbortSignal}
const paging=z.object({offset:z.coerce.number().int().min(0).max(10000000).default(0),limit:z.coerce.number().int().min(1).max(200).default(100)})
const collection=(value:unknown)=>Array.isArray(value) ? value:Array.isArray(record(value).results) ? record(value).results as unknown[]:[]
const cleanRecord=(value:unknown)=>{const result={...record(value)};delete result._links;delete result._actions;return result}
export async function getSession(context:Context,id:string) {
  let raw:unknown
  try {raw=await context.execute(sessionBase(id))}
  catch(error) {
    if(error instanceof RecoveryError && [401,403,404,410].includes(error.status))forgetBrowseSession(context.scope,id)
    throw error
  }
  const session=normalizeSession(raw)
  if(session.id!==id)throw new RecoveryError('The returned session does not match this request.',502)
  observeBrowseSession(context.scope,id,session.state,context.sourceOrigin)
  return {...session,...sessionContext(context.scope,id)}
}
export function suggestedOwner(context:RecoveryContext|undefined,items:RecoveryItem[]) {
  if(!context)return undefined
  const object=context.object,components=context.workload==='Exchange' ? object.mailboxes:context.workload==='OneDrive' ? object.oneDrives:context.workload==='SharePoint' ? object.sites:[]
  const ids=new Set([object.id,object.msid,...(components||[]).map(item=>item.id)].filter(Boolean).map(value=>value!.toLowerCase()))
  const addresses=new Set([object.url,...(components||[]).flatMap(item=>[item.email,item.url])].filter(Boolean).map(value=>value!.toLowerCase().replace(/\/$/,'')))
  const matching=items.filter(item=>ids.has(item.id.toLowerCase()) || [item.email,item.url].some(value=>value && addresses.has(value.toLowerCase().replace(/\/$/,''))))
  return matching.length===1 ? matching[0].id:undefined
}
export function beginBrowseSession(context:Context,input:unknown) {
  const data=startSchema.parse(input)
  const result=beginOnce(context.scope,data.requestId,data,async(waitingForProxy)=>{
    const deadline=Date.now()+browseProxyWaitMs
    const [objectRead,pointRead]=await Promise.allSettled([
      context.execute(`/v8/Protected${data.objectType}s/${part(data.objectId)}`),
      context.execute(`/v8/RestorePoints/${part(data.restorePointId)}`),
    ])
    if(objectRead.status==='rejected')throw objectRead.reason
    const object={...objectSchema.parse(objectRead.value),type:data.objectType}
    if(object.id!==data.objectId)throw new RecoveryError('The selected protected object no longer matches the source.',409)
    if(pointRead.status==='rejected')throw pointRead.reason
    const point=pointSchema.parse(pointRead.value)
    if(point.id!==data.restorePointId || point.isDeleted===true || !point.backupTime || !Number.isFinite(Date.parse(point.backupTime)) || Date.parse(point.backupTime)>Date.now()+60000 || point[`is${data.workload}`]!==true)throw new RecoveryError('This restore point is not available for the selected recovery type.',409)
    const organizationId=object.organizationId || object.backedUpOrganizationId?.split(':')[0] || point.organizationId
    const organization=z.string().uuid().safeParse(organizationId)
    if(!organization.success || point.organizationId && point.organizationId.toLowerCase()!==organization.data.toLowerCase())throw new RecoveryError('The restore point does not belong to this organization.',409)
    // Confirm object membership server-side, including point timestamp and repository. IDs from the browser are not sufficient.
    const date=Date.parse(point.backupTime),query=new URLSearchParams({[`${data.objectType.toLowerCase()}Id`]:object.id,organizationId:organization.data,from:new Date(date-1000).toISOString(),to:new Date(date+1000).toISOString(),offset:'0',limit:'200'})
    if(point.repositoryId)query.set('repositoryId',point.repositoryId)
    const candidates=collection(await context.execute(`/v8/RestorePoints?${query}`))
    if(!candidates.some(row=>record(row).id===point.id))throw new RecoveryError('The restore point could not be verified for the selected object. Refresh its restore points.',409)
    const options={dateTime:point.backupTime,type:explorerTypes[data.workload],showDeleted:data.showDeleted,showAllVersions:data.showAllVersions}
    let path:string,body:unknown=options
    if(point.isLongTermCopy===true && point.isRetrieved!==true)throw new RecoveryError('Retrieve this archived restore point in Veeam before browsing it.',409)
    if(point.isRetrieved===true) {
      if(!point.retrievalId)throw new RecoveryError('The retrieved restore point has no retrieval session.',409)
      path=`/v8/DataRetrievals/${part(point.retrievalId)}/explore`;body=undefined
    }else if(point.isCopy===true) {
      if(!point.repositoryId)throw new RecoveryError('This backup copy has no repository.',409)
      path=`/v8/BackupRepositories/${part(point.repositoryId)}/explore?${new URLSearchParams({organizationId:organization.data})}`
    }else {
      path=`/v8/Organizations/${organization.data}/explore`;body={...options,...(point.repositoryId ? {repositoryId:point.repositoryId}:{})}
    }
    const raw=await openWithRepositoryProxy(context.execute,point.isRetrieved ? undefined : point.repositoryId ?? undefined,
      deadline,waitingForProxy,()=>context.execute(path,'POST',body,deadline))
    let session:RecoverySession
    try {session=normalizeSession(raw)}catch {throw new RecoveryError('Veeam accepted the browse request but returned no usable session. Check restore sessions before retrying.',502,true)}
    const recoveryContext:RecoveryContext={workload:session.workload,object,point,sourceName:context.sourceName,showDeleted:data.showDeleted,showAllVersions:data.showAllVersions}
    rememberSession(context.scope,session.id,{context:recoveryContext})
    return {session:{...session,context:recoveryContext},context:recoveryContext,...(session.workload!==data.workload ? {notice:'Veeam opened a different Explorer type for this retrieval. The session is available in Recovery Center.'}:{})}
  })
  return {requestId:data.requestId,result}
}
async function browse(context:Context,input:BrowseInput,search?:{query:string;setId?:string}) {
  const cache=sessionBrowseCache(context.scope,input.sessionId,context.sourceOrigin)
  const started=performance.now()
  const timing=context.browseTiming??{}
  const session=await getSession(context,input.sessionId).finally(()=>{timing.sessionCheckMs=Math.round(performance.now()-started)})
  assertWorkload(session,input.workload)
  const ensureOpen=()=>{
    if(context.signal?.aborted)throw new RecoveryError('The recovery request was cancelled.',499)
    if(cache.closed)throw new RecoveryError('This browse session has ended. Start a new recovery to browse or restore items.',409)
  }
  ensureOpen()
  const path=search ? searchPath(input,search.setId) : browsePath(input)
  const pageKey=JSON.stringify([input.workload,input.kind,input.scopeKind,input.itemKind,input.ownerId,input.parentId,input.channelId,input.itemId,path,search?.query,search?.setId])
  let page=cache.pages.get(pageKey)
  const cached=!!page
  try {
    if(page)timing.sourceReadMs=0
    if(!page) {
      const readStarted=performance.now()
      let raw:unknown
      try {raw=search ? await context.execute(path,'POST',{query:search.query}) : await context.execute(path)}
      finally {timing.sourceReadMs=Math.round(performance.now()-readStarted)}
      ensureOpen()
      if(!Array.isArray(raw)&&!Array.isArray(record(raw).results))throw new RecoveryError('Microsoft 365 recovery data could not be loaded.',502)
      page=normalizeItems(raw,input,!!search)
      cache.pages.set(pageKey,page)
    }
  }catch(error) {
    if(error instanceof RecoveryError && error.status===404) {
      const missingRoot=!search && input.kind==='owners' && !input.parentId && input.offset===0 && error.code==='ResourceNotFound'
      throw new RecoveryError('Veeam lists this session, but its backup explorer or selected location is unavailable. Check the session log or end browsing and open the backup again.',404,false,missingRoot?browseCollectionNotFound:undefined)
    }
    if(error instanceof RecoveryError && error.status===504) {
      if(search)throw new RecoveryError('Loading took too long. Retry to continue.',504)
      if(input.workload==='Exchange') {
        if(input.kind==='owners')throw new RecoveryError('Veeam took too long to list the mailboxes. Retry browsing this session.',504)
        if(input.kind==='folders'||input.kind==='items')throw new RecoveryError('Loading took too long. Retry to continue.',504)
      }
      throw new RecoveryError('The Microsoft 365 source did not finish reading this backup within 60 seconds. Your selection is kept; retry when the source is ready.',504)
    }
    throw error
  }
  rememberBrowseLocations(context.scope,input.sessionId,page.items)
  const activityAvailability=await recordBrowseActivity(context.scope,context.sourceName,input,page.items.length,performance.now()-started,!!search,cached,timing)
  ensureOpen()
  return {...page,browseCacheId:cache.id,activityAvailability,...(input.kind==='owners' ? {suggestedOwnerId:suggestedOwner(session.context,page.items)}:{})}
}
async function restore(context:Context,input:unknown) {
  const data=restoreSchema.parse(input)
  return once(context.scope,data.requestId,data,async()=>{
    const session=await getSession(context,data.sessionId);assertWorkload(session,data.workload)
    // Preflight ALL entities before the first write. Only server-read metadata enters payloads.
    if(data.options.originalMailboxFolder) {
      const owner=data.items[0].ownerId
      if(data.workload!=='Exchange'||data.options.destination!=='alternate'||data.items.some(item=>item.ownerId!==owner))
        throw new RecoveryError('Choose a folder in one original Exchange mailbox.',409)
      const mailbox=record(await context.execute(ownerBase(session.id,'Exchange',owner)))
      if(mailbox.id!==owner||typeof mailbox.email!=='string'||!mailbox.email.trim()||
        mailbox.email.trim().toLowerCase()!==data.options.mailbox?.trim().toLowerCase())
        throw new RecoveryError('The destination address does not match the original mailbox. Review the mailbox before restoring.',409)
    }
    const entities:JsonRecord[]=[]
    for(const item of data.items)entities.push(cleanRecord(await context.execute(entityPath(data.sessionId,data.workload,item))))
    const target=data.options.destination==='alternate' && data.workload==='OneDrive' && data.options.targetOneDriveId ? cleanRecord(await context.execute(ownerBase(data.sessionId,data.workload,data.options.targetOneDriveId))):undefined
    const groups=restoreGroups(data,entities,target),operations:OperationReceipt[]=[]
    const reservedAt=await restoreAudit.reserve(context.scope,data.requestId,session.id)
    let halted=false,auditUnavailable=false
    for(const group of groups) {
      const base={group:group.key,itemIds:group.items.map(item=>item.id),itemKeys:group.items.map(item=>JSON.stringify([item.ownerId,item.channelId,item.kind,item.id])),itemCount:group.items.length}
      let audit:Awaited<ReturnType<typeof restoreAudit.begin>>
      try {
        audit=await restoreAudit.begin(context.scope,{
          requestId:data.requestId,browseSessionId:session.id,source:context.sourceName,workload:data.workload,
          authMode:data.auth.mode,settings:{...auditSettings(data.options.destination,group.body,'applicationId' in data.auth?data.auth.applicationId:undefined),
            ...(data.options.originalMailboxFolder?{originalMailboxFolder:true}:{})},
          selection:auditSelection(group.entities),
        },group.key,reservedAt,halted?'notSubmitted':'requested')
      }catch(error) {
        // Earlier groups may already have written to Microsoft 365. Always return their receipts.
        const reason=error instanceof RecoveryError?error.message:auditSaveFailed
        auditUnavailable=true;halted=true;operations.push({...base,status:'notSubmitted',error:reason});continue
      }
      if(halted){operations.push({...base,status:'notSubmitted',error:earlierGroupStopped});continue}
      try {
        const receipt=record(await context.execute(group.path,'POST',group.body)),id=sessionIdSchema.safeParse(receipt.sessionId)
        if(!id.success||id.data===session.id||operations.some(operation=>operation.sessionId===id.data))throw new RecoveryError('Veeam accepted the request without a distinct restore session ID. Check restore sessions before retrying.',502,true)
        rememberSession(context.scope,id.data,{context:session.context,parentSessionId:session.id})
        operations.push({...base,status:'accepted',sessionId:id.data})
      }catch(error) {
        const known=error instanceof RecoveryError
        operations.push({...base,status:known && !error.outcomeUnknown ? 'failed':'unknown',error:known ? error.message:'The restore outcome is unconfirmed. Check restore sessions before retrying.'});halted=true
      }
      const operation=operations[operations.length-1]
      if(await restoreAudit.finish(context.scope,audit,operation)==='unavailable'){auditUnavailable=true;halted=true}
      else if(operation.sessionId && restoreAudit.watch(context.scope,operation.sessionId,context.execute)===false)auditUnavailable=true
    }
    const checkVeeamLog=auditUnavailable && operations.some(operation=>operation.status!=='notSubmitted')
    return {operations,sessionId:session.id,...(checkVeeamLog?{notice:'The application could not save the complete restore audit. Check the Veeam session log.'}:{})}
  })
}

export async function recoveryGet(context:Context,input:Record<string,unknown>) {
  if(input.action==='activity')return {...await recoveryActivity(context.execute,context.scope),sourceName:context.sourceName}
  if(input.action==='request')return requestReceipt(context.scope,requestIdSchema.parse(input.requestId))
  if(input.action==='sessionState')return {session:await getSession(context,sessionIdSchema.parse(input.sessionId))}
  if(input.action==='authSettings') {
    const session=await getSession(context,sessionIdSchema.parse(input.sessionId));assertWorkload(session,session.workload)
    return loadRestoreAuthentication(context.execute,session.id,session.workload,session.context?.point.organizationId,session.organization)
  }
  if(input.action==='sessions') {
    const page=paging.parse(input),result=await context.execute(`/v8/RestoreSessions?${new URLSearchParams({offset:String(page.offset),limit:String(page.limit)})}`),raw=record(result),rows=collection(result)
    const sessions=rows.map(row=>{const item=normalizeSession(row);observeBrowseSession(context.scope,item.id,item.state,context.sourceOrigin);return {...item,...sessionContext(context.scope,item.id)}})
    return {sessions,sourceName:context.sourceName,offset:page.offset,nextOffset:page.offset+rows.length,hasMore:rows.length>0 && (!!record(raw._links).next || rows.length>=page.limit)}
  }
  if(input.action==='session') {
    const id=sessionIdSchema.parse(input.sessionId),page=paging.parse(input),session=await getSession(context,id)
    const cache=session.state==='Stopped'?undefined:sessionBrowseCache(context.scope,id,context.sourceOrigin)
    const essentials=()=>({session,context:session.context,...(cache&&!cache.closed?{browseCacheId:cache.id}:{})})
    // Authenticated source state and its cache identity are enough to open a known browse workspace.
    if(input.view==='workspace')return essentials()
    const storedAudit=await restoreAudit.read(context.scope,id)
    if(!session.parentSessionId)session.parentSessionId=storedAudit.entries.find(entry=>entry.sessionId===id&&entry.browseSessionId!==id)?.browseSessionId
    if(input.view==='operations')return {...essentials(),restoreAudit:storedAudit.entries,restoreAuditAvailability:storedAudit.availability}
    // Item restore statistics do not describe Explorer readiness. Read them only for operations.
    const includeStatistics=!!session.parentSessionId || input.includeStatistics==='true'
    const [statistics,events]=await Promise.allSettled([includeStatistics?context.execute(`${sessionBase(id)}/Statistics`):Promise.resolve(null),context.execute(`${sessionBase(id)}/Events?${new URLSearchParams({offset:String(page.offset),limit:String(page.limit)})}`)])
    // Do not swallow authentication/authorization failures as empty statistics.
    for(const result of [statistics,events])if(result.status==='rejected' && result.reason instanceof RecoveryError && [401,403].includes(result.reason.status))throw result.reason
    const raw=events.status==='fulfilled' ? record(events.value):{},rows=collection(raw)
    let auditPage=storedAudit
    if(session.parentSessionId&&session.state==='Stopped') {
      const availability=await restoreAudit.observe(context.scope,session,statistics.status==='fulfilled'?statistics.value:null,rows.map(cleanRecord))
      auditPage=await restoreAudit.read(context.scope,id)
      if(availability==='unavailable')auditPage.availability='unavailable'
    }
    const applicationActivity=await readBrowseActivity(context.scope,id)
    const statisticsAvailability=!includeStatistics?'notRequested':statistics.status==='fulfilled'&&statistics.value!==null?'available':statistics.status==='rejected'&&statistics.reason instanceof RestoreStatisticsPendingError&&session.state==='Working'?'afterCompletion':'unavailable'
    return {session,...(cache&&!cache.closed?{browseCacheId:cache.id}:{}),context:session.context,applicationActivity:applicationActivity.events,activityAvailability:applicationActivity.availability,restoreAudit:auditPage.entries,restoreAuditAvailability:auditPage.availability,statisticsAvailability,statistics:statistics.status==='fulfilled' && statistics.value!==null ? cleanRecord(statistics.value):null,events:rows.map(cleanRecord),offset:page.offset,nextOffset:page.offset+rows.length,hasMore:rows.length>0 && (!!record(raw._links).next || rows.length>=page.limit),warnings:[...(statistics.status==='rejected' && statisticsAvailability!=='afterCompletion' ? ['Restore statistics could not be loaded.']:[]),...(events.status==='rejected' ? ['Session events could not be loaded.']:[])]}
  }
  if(input.action==='browse')return browse(context,browseSchema.parse(input))
  throw new RecoveryError('Unknown recovery read action.')
}

export async function recoveryPost(context:Context,input:unknown) {
  const raw=record(input)
  if(raw.action==='start')return beginBrowseSession(context,input).result
  if(raw.action==='restore')return restore(context,input)
  if(raw.action==='search') {
    const data=browseSchema.extend({action:z.literal('search'),query:z.string().trim().min(1).max(2048),setId:opaqueId.optional()}).parse(input)
    return browse(context,data,{query:data.query,setId:data.setId})
  }
  if(raw.action==='stop') {
    const data=z.object({action:z.literal('stop'),sessionId:sessionIdSchema}).strict().parse(input),session=await getSession(context,data.sessionId)
    if(session.state==='Stopped')return {accepted:true,sessionId:session.id,state:'Stopped'}
    await context.execute(`${sessionBase(session.id)}/Stop`,'POST')
    sessionBrowseCache(context.scope,session.id,context.sourceOrigin)
    observeBrowseSession(context.scope,session.id,'Stopped',context.sourceOrigin)
    return {accepted:true,sessionId:session.id}
  }
  if(raw.action==='deviceCodeCheck') {
    const data=z.object({action:z.literal('deviceCodeCheck'),sessionId:sessionIdSchema,userCode:z.string().trim().min(1).max(128)}).strict().parse(input)
    const session=await getSession(context,data.sessionId);assertWorkload(session,session.workload)
    return restoreCodeVerificationCapability(data.userCode)
  }
  if(raw.action==='deviceCode') {
    const data=z.object({action:z.literal('deviceCode'),sessionId:sessionIdSchema,targetApplicationId:z.string().uuid(),targetRegion:regionSchema.optional(),targetOrganizationName:z.string().max(512).optional()}).strict().parse(input)
    const session=await getSession(context,data.sessionId);assertWorkload(session,session.workload)
    const body={targetApplicationId:data.targetApplicationId,targetRegion:data.targetRegion,targetOrganizationName:data.targetOrganizationName},receipt=record(await context.execute(`${sessionBase(data.sessionId)}/organization/restoreDeviceCode`,'POST',body))
    return normalizeRestoreDeviceCode(receipt)
  }
  throw new RecoveryError('Unknown recovery action.')
}
