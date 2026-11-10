// Open Backup UI v1.2.0
import { z } from 'zod'
import type { RecoverySend } from '../server/vbr-recovery'
import type { LinuxMountOptions, LinuxMountType } from '../restore-points/workflow'
import { validId } from '../investigation/model'
import { VbrRecoveryError } from './error'

export type PrivateFlrConnection = () => RecoverySend
const selector = '/private-api/v1/flr/validation/mountServer/'
const host = z.object({ type:z.string(), mountServerType:z.string(), name:z.string().trim().min(1), mountServerId:z.string().uuid().nullish() })
type Host = z.infer<typeof host>
export const linuxCredential = z.object({id:z.string().uuid(),type:z.string(),username:z.string().nullish(),isDefaultAppliance:z.boolean().nullish()})
export const usableLinuxCredential = (value:z.infer<typeof linuxCredential>) => value.type==='Linux' && !value.isDefaultAppliance && validId(value.id)
const changed = 'The selected Linux mount host is no longer available for this restore point.'
const invalid = 'VBR could not verify the original Linux host.'
const chooseCredential = 'Choose saved Linux SSH credentials for the original host and try again.'

function connection(open?:PrivateFlrConnection) {
  if(!open)throw new VbrRecoveryError('VBR could not list mount hosts for this restore point.',403)
  return open()
}
async function selectedHosts(send:RecoverySend,id:string) {
  const raw=await send(selector+'select',{method:'POST',body:{restorePointId:id}})
  const parsed=z.object({options:z.array(host)}).safeParse(raw)
  if(!parsed.success)throw new VbrRecoveryError('VBR could not list mount hosts for this restore point.',502)
  const unique=new Map<string,Host|null>()
  for(const row of parsed.data.options){
    if(row.type!=='Linux')continue
    const original=row.mountServerType==='OriginalHost'
    if(original ? validId(row.mountServerId)&&row.mountServerId.toLowerCase()!==id.toLowerCase() : !validId(row.mountServerId))continue
    const key=original?'original':row.mountServerType+'/'+row.mountServerId
    unique.set(key,unique.has(key)?null:row)
  }
  return [...unique.values()].filter((row):row is Host=>row!==null)
}
function selectedHost(hosts:Host[],type:LinuxMountType,id?:string|null) {
  return hosts.find(h=>h.mountServerType===type&&(type==='OriginalHost'||h.mountServerId===id))
}
export async function linuxHostOptions(open:PrivateFlrConnection|undefined,id:string) {
  const send=connection(open)
  const [hosts,auto]=await Promise.all([
    selectedHosts(send,id),
    send(selector+'autoselect',{method:'POST',body:{restorePointId:id}}).then(raw=>
      z.object({enabled:z.boolean(),selectedMountServer:host.nullish()}).safeParse(raw)).catch(()=>undefined),
  ])
  const original=selectedHost(hosts,'OriginalHost')
  const selected=auto?.success&&auto.data.enabled?auto.data.selectedMountServer:null
  const type=selected?.mountServerType
  const preferred=selected?.type==='Linux' && (type==='OriginalHost'||type==='HelperHost'||type==='MountServer')
    && selectedHost(hosts,type,selected.mountServerId)
  const recommended:LinuxMountOptions['recommended']=preferred && preferred.mountServerId===selected?.mountServerId ?
    {type:type as LinuxMountType,id:preferred.mountServerId||id}:undefined
  const choices=(type:'HelperHost'|'MountServer')=>hosts.filter(h=>h.mountServerType===type).map(h=>({id:h.mountServerId!,name:h.name}))
  return {originalHost:original?{available:true,name:original.name}:{available:false},helperHosts:choices('HelperHost'),
    mountServers:choices('MountServer').map(h=>({...h,type:'Linux'})),recommended}
}
const validation=z.object({result:z.enum(['Success','Warning','Failed','InteractionRequired']),message:z.string().nullish(),
  interaction:z.array(z.object({id:z.string().min(1),type:z.string(),question:z.string().nullish()})).nullish(),
  prepareSpec:z.object({restorePointId:z.string().uuid().optional(),credentialsId:z.string().uuid().nullish()}).nullish()})
async function originalCredentials(publicSend:RecoverySend,send:RecoverySend,id:string,selected:Host,credentialsId?:string) {
  if(credentialsId) {
    const saved=linuxCredential.safeParse(await publicSend('/api/v1/credentials/'+credentialsId))
    if(!saved.success||saved.data.id!==credentialsId||!usableLinuxCredential(saved.data))throw new VbrRecoveryError(chooseCredential,409)
  }
  const prepareSpec={restorePointId:id,selectedMountServer:selected,credentialsId}
  const verify=async(interaction:{id:string;answer:'Yes';type:'FlrOriginalHost';credentialsId:string}[])=>{
    const response=validation.safeParse(await send('/private-api/v1/flr/validation/originalMountServer',{method:'POST',body:{prepareSpec,interaction}}))
    if(!response.success||response.data.prepareSpec?.restorePointId&&response.data.prepareSpec.restorePointId!==id)throw new VbrRecoveryError(invalid,502)
    return response.data
  }
  let result=await verify([])
  if(result.result==='InteractionRequired'){
    const question=result.interaction?.at(-1)
    if(question?.type==='FlrOriginalHost'&&credentialsId)result=await verify([{id:question.id,answer:'Yes',type:'FlrOriginalHost',credentialsId}])
    else throw new VbrRecoveryError(question?.type==='FlrOriginalHost'?chooseCredential:question?.question||invalid,422)
  }
  if(result.result!=='Success')throw new VbrRecoveryError(result.message||invalid,422)
  if(!result.prepareSpec)throw new VbrRecoveryError(invalid,502)
  const resolved=result.prepareSpec?.credentialsId
  if(credentialsId && validId(resolved) && resolved!==credentialsId)throw new VbrRecoveryError(invalid,409)
  return credentialsId || (validId(resolved)?resolved:undefined)
}
type MountDraft={linuxMountType?:LinuxMountType;mountServerId?:string;helperHostId?:string;credentialsId?:string}
export async function linuxMountSettings(send:RecoverySend,open:PrivateFlrConnection|undefined,id:string,draft:MountDraft) {
  const {mountServerId,helperHostId,credentialsId}=draft
  const type=draft.linuxMountType || (mountServerId?'MountServer':undefined)
  if(!type)throw new VbrRecoveryError('Select a Linux mount host.')
  if(type!=='OriginalHost'&&credentialsId || type!=='HelperHost'&&helperHostId || type!=='MountServer'&&mountServerId)
    throw new VbrRecoveryError('Review the selected Linux mount host and credentials.',409)
  if(type==='MountServer'){
    // Older clients selected an explicitly assigned repository mount-server role.
    if(!validId(mountServerId))throw new VbrRecoveryError('Select a Linux mount server.')
    const role=z.object({id:z.string().uuid(),type:z.literal('Linux')}).safeParse(await send('/api/v1/backupInfrastructure/mountServers/'+mountServerId))
    if(!role.success||role.data.id!==mountServerId)throw new VbrRecoveryError('Select an available Linux mount server.',409)
    return {mountServerType:type,mountServerId}
  }
  const privateSend=connection(open)
  const hosts=await selectedHosts(privateSend,id)
  const selected=selectedHost(hosts,type,helperHostId)
  if(!selected)throw new VbrRecoveryError(changed,409)
  if(type==='HelperHost')return {mountServerType:type,helperHost:{hostId:selected.mountServerId!}}
  const resolved=await originalCredentials(send,privateSend,id,selected,credentialsId)
  return {mountServerType:type,originalHost:resolved?{credentialsId:resolved}:{}}
}
