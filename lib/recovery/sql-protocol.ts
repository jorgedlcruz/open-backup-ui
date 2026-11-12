// Open Backup UI v1.2.0
import {createHmac,timingSafeEqual} from 'node:crypto'
import {z} from 'zod'
import {validId} from '../investigation/model'
import {VbrRecoveryError} from './error'

export const sqlGuid=z.string().refine(validId).transform(v=>v.toLowerCase())
export const sqlScope=z.string().regex(/^[a-f0-9]{64}$/)
export const sqlTicket=z.string().min(1).max(120000)
export type SqlContext={sourceKey:string;principalKey:string;secret:string;stagingGateway?:string}
const lifetime=4*3600000
function sign(ctx:SqlContext,kind:string,value:string) {
  return createHmac('sha256',ctx.secret).update(JSON.stringify(['vesql',ctx.sourceKey,ctx.principalKey,kind,value])).digest('base64url')
}
export function sqlSeal(ctx:SqlContext,kind:string,data:object) {
  const value=Buffer.from(JSON.stringify({data,until:Date.now()+lifetime})).toString('base64url')
  return value+'.'+sign(ctx,kind,value)
}
export function sqlOpen<T>(ctx:SqlContext,kind:string,token:string,schema:z.ZodType<T>):T {
  const [value,mac,...rest]=token.split('.'), expected=Buffer.from(sign(ctx,kind,value)), received=Buffer.from(mac||'')
  if(rest.length || expected.length!==received.length || !timingSafeEqual(expected,received)) throw new VbrRecoveryError('This Explorer request expired or belongs to another source.',409)
  const decoded=JSON.parse(Buffer.from(value,'base64url').toString('utf8'))
  if(!(decoded.until>Date.now()))throw new VbrRecoveryError('This Explorer request expired or belongs to another source.',409)
  return schema.parse(decoded.data)
}

const text=z.string().max(4096), identifier=z.union([text,z.number().int().safe()]).transform(String)
const range=z.object({from:text.nullish(),to:text.nullish()})
// VESQL serializes an LSN as {value:"VLF offset slot"}. Keep its native
// precision and whitespace. Older responses can supply a scalar directly.
const lsn=z.union([text,z.number().int().safe().transform(String),z.object({value:text}).transform(lsn=>lsn.value)])
const address=z.object({machineName:text.nullish(),instanceName:text.nullish()})
export const sqlNode=z.object({
  type:z.enum(['SQLServer','SQLInstance','SQLDatabase','SQLDatabaseFile']),id:identifier.nullish(),name:text.nullish(),
  vmName:text.nullish(),serverName:text.nullish(),allNames:z.array(text).nullish(),instanceId:identifier.nullish(),databaseId:identifier.nullish(),sqlServerName:address.nullish(),
  timeRange:range.nullish(),lsnRange:z.object({from:lsn.nullish(),to:lsn.nullish()}).nullish().catch(undefined),
  fullVersion:text.nullish(),version:z.union([text,z.number()]).nullish(),backupCreated:text.nullish(),guestBackupStartTime:text.nullish(),
  guestBackupEndTime:text.nullish(),previousBackupCreated:text.nullish(),nextBackupCreated:text.nullish(),
  recoveryModel:text.nullish(),isSystem:z.boolean().nullish(),isReadOnly:z.boolean().nullish(),isBackedUp:z.boolean().nullish(),
  isAlwaysOn:z.boolean().nullish(),availabilityGroupName:text.nullish(),isClustered:z.boolean().nullish(),isPrimary:z.boolean().nullish(),
  primaryFile:text.nullish(),secondaryFiles:z.array(text).nullish(),blobFolders:z.array(text).nullish(),
  allowedOperations:z.array(text).nullish(),
})
export type SqlItem=z.infer<typeof sqlNode> & {key?:string}
const grant=z.object({sessionId:sqlGuid,type:sqlNode.shape.type,id:identifier.nullish(),name:text.nullish(),sourceServer:text.optional(),
  instanceName:text.optional(),serverNames:z.array(text).optional(),sole:z.boolean().optional(),timeRange:range.nullish()})
export type SqlGrant=z.infer<typeof grant>
export function sqlGrant(ctx:SqlContext,key:string,sessionId:string,type?:SqlGrant['type']) {
  const value=sqlOpen(ctx,'item',key,grant)
  if(value.sessionId!==sessionId || type && value.type!==type)throw new VbrRecoveryError('Select an item from the current SQL browse session.',409)
  return value
}
export const views={servers:'SQLServer',instances:'SQLInstance',databases:'SQLDatabase',files:'SQLDatabaseFile'} as const
export type SqlView=keyof typeof views
const parentType={instances:'SQLServer',databases:'SQLInstance',files:'SQLDatabase'} as const
export function parentGrant(ctx:SqlContext,view:SqlView,sessionId:string,parent?:string) {
  if(view==='servers' && !parent)return undefined
  if(view==='servers' || !parent)throw new VbrRecoveryError('Select an item from the current SQL browse session.')
  return sqlGrant(ctx,parent,sessionId,parentType[view])
}
export function browsePayload(view:SqlView,parent?:SqlGrant) {
  if ((view==='databases'||view==='files') && !parent?.id)throw new VbrRecoveryError('VBR did not identify the selected SQL object.',409)
  return {searchObjectType:views[view],...(view==='databases'&&{databaseSearchFilter:{instanceId:parent?.id}}),
    ...(view==='files'&&{databaseFileSearchFilter:{databaseId:parent?.id}})}
}
export const pageRequest=z.object({sessionId:sqlGuid,view:z.enum(['servers','instances','databases','files']),parent:grant.optional(),
  skip:z.number().int().nonnegative(),limit:z.number().int().min(1).max(200)})
export function browsePage(ctx:SqlContext,request:z.infer<typeof pageRequest>,raw:unknown) {
  const {data,pagination}=z.object({data:z.array(z.unknown()),pagination:z.object({total:z.number().int().nonnegative().nullish(),skip:z.number().int().nullish()}).nullish()}).parse(raw)
  const {sessionId,view,parent,skip,limit}=request
  if(pagination?.skip!=null && pagination.skip!==skip)throw new VbrRecoveryError('VBR returned a different SQL browse page.',502)
  const items:SqlItem[]=[]
  for(const candidate of data) {
    if(candidate && typeof candidate==='object' && 'type' in candidate && candidate.type!==views[view])throw new VbrRecoveryError('VBR returned a different SQL browse view. Refresh the page.',409)
    const parsed=sqlNode.safeParse(candidate)
    if(!parsed.success)throw new VbrRecoveryError('VBR returned an unreadable SQL browse item.',502)
    const n=parsed.data
    if(view==='instances' && parent && (n.serverName
      ? !parent.serverNames?.some(host=>host.toLowerCase()===n.serverName?.toLowerCase())
      : !parent.sole))continue
    if(view==='databases') {
      const matches=n.instanceId ? n.instanceId===parent?.id : !!n.sqlServerName?.machineName && !!parent?.sourceServer &&
        (parent.serverNames??[parent.sourceServer]).some(alias=>alias.toLowerCase()===n.sqlServerName?.machineName?.toLowerCase()) &&
        (n.sqlServerName.instanceName??'').toLowerCase()===(parent.instanceName??'').toLowerCase()
      if(!matches)throw new VbrRecoveryError('VBR returned a database for a different SQL instance. Refresh the page.',409)
    }
    if(view==='files' && n.databaseId && n.databaseId!==parent?.id)throw new VbrRecoveryError('VBR returned files for a different database. Refresh the page.',409)
    const binding:SqlGrant={sessionId,type:n.type,id:n.id,name:n.name}
    if(view==='servers') {binding.serverNames=[...new Set([n.name,n.vmName,...n.allNames||[]].filter((v):v is string=>!!v))]
      binding.sole=skip===0 && pagination?.total===1 && data.length===1;binding.sourceServer=n.name||undefined}
    if(view==='instances') {binding.sourceServer=n.serverName || parent?.sourceServer;binding.serverNames=parent?.serverNames;binding.instanceName=n.name ?? ''}
    if(view==='databases') {binding.sourceServer=n.sqlServerName?.machineName || parent?.sourceServer
      binding.instanceName=n.sqlServerName?.instanceName ?? parent?.instanceName;binding.timeRange=n.timeRange}
    items.push({...n,...(view!=='files'&&{key:sqlSeal(ctx,'item',binding)})})
  }
  const total=pagination?.total??null,next=skip+data.length
  if(total!==null && next<total && !data.length)throw new VbrRecoveryError('VBR returned an incomplete SQL browse page. Refresh the page.',409)
  return {items,total,skip,limit,...(data.length && (total===null ? data.length>=limit : next<total) ? {nextSkip:next} : {})}
}
