// Open Backup UI v1.3.0
import { z } from 'zod'
import type { browseCollectionNotFound } from './read-retry'
import { opaqueId, objectType, type ProtectedObject, type Point } from '../vbm-protected/model'

export const workloads = ['Exchange', 'OneDrive', 'SharePoint', 'Teams'] as const
export const workloadSchema = z.enum(workloads)
export type Workload = z.infer<typeof workloadSchema>
export const explorerTypes: Record<Workload, string> = { Exchange: 'Vex', OneDrive: 'Veod', SharePoint: 'Vesp', Teams: 'Vet' }
export const sessionIdSchema = z.string().uuid()
export const requestIdSchema = z.string().uuid()
export type JsonRecord = Record<string, unknown>
export const itemKinds = ['owner', 'folder', 'item', 'document', 'library', 'list', 'channel', 'file', 'post', 'tab'] as const
export type ItemKind = typeof itemKinds[number]
export type RecoveryItem = {
  id: string; name: string; kind: ItemKind; isFolder: boolean; ownerId?: string; parentId?: string; channelId?: string;
  workload: Workload; email?: string; url?: string; modified?: string; sizeBytes?: number; from?: string;
  itemClass?: string; selectable: boolean; raw: JsonRecord;
}
export type RecoveryContext = { workload: Workload; object: ProtectedObject; point: Point; sourceName: string; showDeleted?: boolean; showAllVersions?: boolean }
export type RecoverySession = { id: string; name: string; workload: Workload; type: string; state: string; result?: string; creationTime?: string; endTime?: string | null; details?: string; organization?: string; initiatedBy?: string; context?: RecoveryContext; parentSessionId?: string }
export type RecoveryPage = { items: RecoveryItem[]; offset: number; nextOffset: number; hasMore: boolean; setId?: string; suggestedOwnerId?:string }
export const browseSchema = z.object({
  sessionId: sessionIdSchema, workload: workloadSchema,
  kind: z.enum(['owners', 'folders', 'items', 'documents', 'libraries', 'lists', 'channels', 'files', 'posts', 'tabs', 'versions']),
  ownerId: opaqueId.optional(), parentId: opaqueId.optional(), channelId: opaqueId.optional(), itemId: opaqueId.optional(),
  scopeKind:z.enum(['owner','folder','library','list','channel']).optional(),
  itemKind: z.enum(['folder','document','item','file']).optional(),
  offset: z.coerce.number().int().min(0).max(10000000).default(0), limit: z.coerce.number().int().min(1).max(200).default(100),
})
export type BrowseInput = z.infer<typeof browseSchema>
export const startSchema = z.object({ action: z.literal('start'), requestId: requestIdSchema, workload: workloadSchema, objectType, objectId: opaqueId, restorePointId: opaqueId, showDeleted: z.boolean().default(false), showAllVersions: z.boolean().default(false) }).strict()
export const regionSchema = z.enum(['Worldwide','Germany','China','USDefence','USGovernment'])
export const authSchema = z.discriminatedUnion('mode', [
  z.object({mode:z.literal('deviceCode'),userCode:z.string().trim().min(1).max(128),applicationId:z.string().uuid().optional()}).strict(),
  z.object({mode:z.literal('credentials'),userName:z.string().trim().min(1).max(512),userPassword:z.string().min(1).max(4096)}).strict(),
  z.object({mode:z.literal('certificate'),applicationId:z.string().uuid(),applicationCertificate:z.string().min(1).max(131072),applicationCertificatePassword:z.string().max(4096),impersonationAccountName:z.string().trim().max(512).optional()}).strict(),
])
export type RestoreAuth = z.infer<typeof authSchema>
export const cartItemSchema = z.object({id:opaqueId,ownerId:opaqueId,kind:z.enum(['folder','item','document','file','tab']),channelId:opaqueId.optional(),parentId:opaqueId.optional(),name:z.string().max(2048).optional()})
export type CartItem = z.infer<typeof cartItemSchema>
export const restoreOptionsSchema = z.object({
  originalMailboxFolder:z.boolean().optional(),
  destination:z.enum(['original','alternate']).default('original'), mailbox:z.string().trim().max(512).optional(), folder:z.string().max(2048).optional(),
  targetOneDriveId:opaqueId.optional(), siteURL:z.string().url().max(2048).optional(), list:z.string().max(2048).optional(),
  documentAction:z.enum(['Keep','Overwrite']).default('Keep'), documentVersion:z.enum(['Last','All']).default('Last'), documentLastVersionAction:z.enum(['Merge','Overwrite']).default('Merge'),
  restorePermissions:z.boolean().default(false), sendSharedLinksNotification:z.boolean().default(false),
  restoreChangedItems:z.boolean().default(false), restoreMissingItems:z.boolean().default(true),
  changedItems:z.boolean().optional(),deletedItems:z.boolean().optional(),markRestoredAsUnread:z.boolean().optional(),
  excludeDrafts:z.boolean().optional(),excludeDeletedItems:z.boolean().optional(),excludeInPlaceHoldItems:z.boolean().optional(),excludeLitigationHoldItems:z.boolean().optional(),
  officeRegion:regionSchema.optional(),organizationName:z.string().trim().max(512).optional(),casServer:z.string().max(512).optional(),
}).strict()
export type RestoreOptions = z.infer<typeof restoreOptionsSchema>
export const restoreSchema = z.object({action:z.literal('restore'),requestId:requestIdSchema,sessionId:sessionIdSchema,workload:workloadSchema,items:z.array(cartItemSchema).min(1).max(100),auth:authSchema,options:restoreOptionsSchema}).strict()
export type RestoreInput = z.infer<typeof restoreSchema>
export type OperationReceipt = {group:string;itemIds:string[];itemKeys?:string[];itemCount:number;sessionId?:string;status:'accepted'|'failed'|'unknown'|'notSubmitted';error?:string}
export type RequestReceipt = {status:'pending'|'completed'|'failed'|'unknown';phase?:'waitingForProxy';result?:unknown;error?:string;createdAt:string}
// Pending recovery requests can outlive the module instance that created them in development.
const recoveryErrorBrand = Symbol.for('open-backup-ui.vbm-recovery.RecoveryError')
export class RecoveryError extends Error {
  readonly [recoveryErrorBrand] = true
  constructor(message:string,public status=400,public outcomeUnknown=false,public code?:'ProxyOffline'|'ResourceNotFound'|typeof browseCollectionNotFound){super(message)}
}

export function isRecoveryError(value:unknown): value is RecoveryError {
  if (!(value instanceof Error)) return false
  const error = value as Partial<RecoveryError>
  return error[recoveryErrorBrand] === true && typeof error.message === 'string'
    && typeof error.status === 'number' && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
    && typeof error.outcomeUnknown === 'boolean'
}

export const record = (value:unknown):JsonRecord => value && typeof value==='object' && !Array.isArray(value) ? value as JsonRecord : {}
export const str = (value:unknown) => typeof value==='string' ? value : undefined
export const part = (value:string) => encodeURIComponent(opaqueId.parse(value))
export const sessionBase = (id:string) => `/v8/RestoreSessions/${sessionIdSchema.parse(id)}`
export function ownerBase(sessionId:string,workload:Workload,ownerId?:string) {
  const root=sessionBase(sessionId)+({Exchange:'/organization/mailboxes',OneDrive:'/Organization/OneDrives',SharePoint:'/Organization/Sites',Teams:'/organization/teams'}[workload])
  return ownerId===undefined ? root : `${root}/${part(ownerId)}`
}
export function normalizeSession(value:unknown):RecoverySession {
  const raw=record(value), id=sessionIdSchema.parse(raw.id), type=str(raw.type)||''
  const workload=workloads.find(w=>explorerTypes[w]===type)
  if(!workload)throw new RecoveryError('This session is not a supported Microsoft 365 explorer.',400)
  return {id,name:str(raw.name)||str(raw.scopeName)||`${workload} recovery`,workload,type,state:str(raw.state)||'Unknown',result:str(raw.result),creationTime:str(raw.creationTime),endTime:raw.endTime===null?null:str(raw.endTime),details:str(raw.details),organization:str(raw.organization),initiatedBy:str(raw.initiatedBy)}
}
export function assertWorkload(session:RecoverySession, workload:Workload) {
  if(session.workload!==workload)throw new RecoveryError('The requested workload does not match this recovery session.',409)
  if(session.state==='Stopped')throw new RecoveryError('This browse session has ended. Start a new recovery to browse or restore items.',409)
}
export function normalizeItems(rawPage:unknown,input:BrowseInput,search=false):RecoveryPage {
  const page=record(rawPage), source=Array.isArray(page.results)?page.results:Array.isArray(rawPage)?rawPage:[]
  const items:RecoveryItem[]=source.flatMap(value=>{
    const raw=record(value),id=str(raw.id) ?? (typeof raw.postId==='number'?String(raw.postId):undefined)
    if(!id)return []
    const isFolder=raw.isFolder===true||raw.fileType==='Folder'||input.kind==='folders'||input.workload==='SharePoint'&&['ListFolder','LibraryFolder'].includes(String(raw.type))
    let kind:ItemKind=input.kind==='owners'?'owner':input.kind==='libraries'?'library':input.kind==='lists'?'list':input.kind==='channels'?'channel':input.kind==='tabs'?'tab':input.kind==='posts'?'post':isFolder?'folder':input.workload==='Exchange'?'item':input.workload==='Teams'?'file':input.kind==='items'&&input.workload==='SharePoint'?'item':'document'
    if(input.kind==='versions')kind=input.itemKind||'document'
    let ambiguousSearch=false
    if(search && input.workload==='SharePoint') {
      // Site search mixes list items and documents. Read the returned resource type,
      // without following the hyperlink or trusting it as a request destination.
      const self=str(record(record(raw._links).self).href)
      let resource:string|undefined
      try {
        const path=new URL(self||'', 'https://metadata.invalid').pathname.split('/').map(decodeURIComponent)
        const position=path.findIndex(value=>value.toLowerCase()==='sites')
        if(position>=0 && path[position+1]===input.ownerId && path[position+3]===id)resource=path[position+2]?.toLowerCase()
      }catch { /* Missing or malformed metadata cannot broaden a restore. */ }
      if(isFolder)kind='folder'
      else if(resource==='items')kind='item'
      else if(resource==='documents')kind='document'
      else if(input.scopeKind && input.scopeKind!=='owner')kind=input.kind==='items'?'item':'document'
      else {kind='document';ambiguousSearch=true}
    }
    const name=str(raw.subject)||str(raw.fullName)||str(raw.name)||str(raw.displayName)||str(raw.title)||str(raw.email)||str(raw.url)||id
    const clean={...raw};delete clean._links;delete clean._actions
    return [{id,name,kind,isFolder,workload:input.workload,ownerId:input.ownerId,parentId:input.parentId,channelId:input.channelId||str(raw.channelId),email:str(raw.email),url:str(raw.url),modified:str(raw.modificationTime)||str(raw.modified)||str(raw.received)||str(raw.createdTime),sizeBytes:typeof raw.sizeBytes==='number'?raw.sizeBytes:undefined,from:str(raw.from)||str(raw.author),itemClass:str(raw.itemClass),selectable:!ambiguousSearch&&['folder','item','document','file','tab'].includes(kind)&&input.kind!=='versions',raw:clean}]
  })
  // _links is evidence of another page, never a URL that the server follows.
  const hasMore=!!record(page._links).next || source.length >= (typeof page.limit==='number'&&page.limit>0?page.limit:input.limit)
  return {items,offset:input.offset,nextOffset:input.offset+source.length,hasMore:source.length>0&&hasMore,setId:str(page.setId)}
}
