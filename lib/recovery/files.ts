// Open Backup UI v1.0.2
import { z } from 'zod'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { RecoverySend } from '../server/vbr-recovery'
import { VbrRecoveryError, checkSource } from './error'
import { inventorySchema, resolveInventory } from './inventory'
import { collect } from './options'

const guestPath = z.string().max(32767).refine(value => !value.includes(String.fromCharCode(0)), 'Invalid guest path.')
export const filesSchema = z.object({
  action: z.enum(['browse', 'restore', 'validateRestore', 'unmount', 'credentials', 'task', 'search', 'searchStatus', 'searchResults', 'stopSearch',
    'prepareDownload', 'downloadStatus', 'stopDownload', 'streamDownload']), sessionId: z.string().uuid(),
  sourceKey: z.string().regex(/^[a-f0-9]{64}$/), path: guestPath.optional(), skip: z.number().int().nonnegative().default(0),
  sourcePaths: z.array(guestPath.min(1)).min(1).optional(), restoreType: z.enum(['Keep', 'Overwrite', 'PermissionOnly']).optional(),
  credentialsId: z.string().uuid().optional(), targetPath: guestPath.min(1).optional(), targetHost: inventorySchema.optional(),
  taskId: z.string().uuid().optional(), searchKey: z.string().max(100).optional(), downloadKey: z.string().max(100).optional(), restoreKey: z.string().max(100).optional(),
  query: z.string().trim().min(1).max(1024).optional(), recursive: z.boolean().default(true), foldersOnly: z.boolean().optional(),
})
const taskSchema = z.object({ id: z.string().uuid(), type: z.literal('FlrRestore'), name: z.string(), state: z.string(), progressPercent: z.number(), result: z.string() })
const searchTaskSchema = taskSchema.extend({ type: z.literal('FlrSearch') })
const downloadTaskSchema = taskSchema.extend({ type: z.literal('FlrDownload') })
const mountSchema = z.object({ sessionId: z.string().uuid(), type: z.enum(['Windows', 'Linux']), restorePointId: z.string().uuid().nullish(), properties: z.object({ pathSeparator: z.string() }).nullish() })
const credential = z.object({id:z.string().uuid(),type:z.string(),username:z.string().nullish(),name:z.string().nullish()})
const credentialCheck = z.object({isSuccessful:z.boolean(),message:z.string().nullish()})
const pathCheck = z.object({isTargetPathNeeded:z.boolean(),targetPath:guestPath.nullish()})
const unavailableCredentials = 'VBR could not validate the target guest credentials.'
const restoreLog = z.object({status:z.string().optional(),title:z.string().nullish(),description:z.string().nullish()})

function restoreTask(raw:unknown,expectedId?:string) {
  const parsed=taskSchema.safeParse(raw)
  if(!parsed.success || expectedId&&parsed.data.id!==expectedId)return
  const details=z.object({additionalInfo:z.object({message:z.string().nullish()}).nullish(),logs:z.object({
    records:z.array(restoreLog).nullish(),data:z.array(restoreLog).nullish(),
  }).nullish()}).safeParse(raw)
  const info=details.success?details.data:undefined
  const records=info?.logs?.records||info?.logs?.data||[]
  const failure=records.find(row=>row.status==='Failed')||records.find(row=>row.status==='Warning')
  const message=(info?.additionalInfo?.message?.trim()||failure?.description?.trim()||failure?.title?.trim())?.slice(0,2000)
  return {...parsed.data,...(message&&{message})}
}

// VBR chooses SSH, Windows credentials (including gMSA), or standard accounts
// using BOTH the guest OS from the actual restore point and the FLR mount OS.
async function guestCredentialTypes(send:RecoverySend,mount:z.infer<typeof mountSchema>){
  let guestOs:string=mount.type
  if(mount.restorePointId){
    const point=z.object({id:z.literal(mount.restorePointId),guestOsFamily:z.string().nullish()}).safeParse(await send('/api/v1/restorePoints/'+mount.restorePointId))
    if(!point.success)throw new VbrRecoveryError('VBR could not verify this recovery request.',409)
    if(point.data.guestOsFamily==='Linux'||point.data.guestOsFamily==='Windows')guestOs=point.data.guestOsFamily
  }
  return guestOs==='Linux'?['Linux']:mount.type==='Windows'?['Standard','ManagedService']:['Standard']
}
const directorySchema = z.object({ path: z.string().nullish(), items: z.array(z.object({
  name: z.string(), displayName: z.string(), type: z.string(), location: z.string().nullish(), size: z.number(), modifiedDate: z.string().nullish(), itemState: z.string().optional(),
})), pagination: z.object({ total: z.number(), count: z.number(), skip: z.number(), limit: z.number() }).nullish() })

// The VBR stop operation is global. Bind the returned search task to the
// source and mount that started it before allowing the client to cancel it.
function taskKey(secret: string, kind: 'search' | 'download' | 'restore', sourceKey: string, sessionId: string, taskId: string) {
  return createHmac('sha256', secret).update(JSON.stringify(['flr-' + kind, sourceKey, sessionId, taskId])).digest('base64url')
}

function checkTaskKey(expected: string | undefined, received: string | undefined) {
  if (!expected || !received || Buffer.byteLength(expected) !== Buffer.byteLength(received)
      || !timingSafeEqual(Buffer.from(expected), Buffer.from(received))) {
    throw new VbrRecoveryError('This task does not belong to the selected guest file mount.', 409)
  }
}

export async function guestFiles(send: RecoverySend, currentSource: string, input: z.infer<typeof filesSchema>, secret?: string, principalScope=currentSource) {
  checkSource(input.sourceKey, currentSource)
  const base = `/api/v1/backupBrowser/flr/${input.sessionId}`
  if (input.action === 'task') {
    if (!input.taskId) throw new VbrRecoveryError('Select a guest restore task.')
    if(input.restoreKey)checkTaskKey(secret&&taskKey(secret,'restore',principalScope,input.sessionId,input.taskId),input.restoreKey)
    const task = restoreTask(await send(`/api/v1/tasks/${input.taskId}`),input.taskId)
    if (!task) throw new VbrRecoveryError('The guest restore task is unavailable.', 404)
    // Older workspaces only stored a task ID. Preserve their basic progress.
    return input.restoreKey?{...task,restoreKey:input.restoreKey}:taskSchema.parse(task)
  }
  const mount = mountSchema.safeParse(await send(base))
  if (!mount.success || mount.data.sessionId !== input.sessionId) throw new VbrRecoveryError('This guest file mount is unavailable.', 409)
  if (input.action === 'credentials') {
    const [types,records]=await Promise.all([guestCredentialTypes(send,mount.data),collect(send,'/api/v1/credentials',credential)])
    return {credentials:records.filter(row=>types.includes(row.type)).map(row=>({id:row.id,name:row.name||row.username||row.id}))}
  }
  if (input.action === 'prepareDownload') {
    if (!secret || !input.sourcePaths?.length) throw new VbrRecoveryError('Select files or folders to download.')
    const task = downloadTaskSchema.safeParse(await send(`${base}/prepareDownload`, { method: 'POST', mutation: true, body: { sourcePath: input.sourcePaths } }))
    if (!task.success) throw new VbrRecoveryError('VBR accepted the download preparation but returned no task ID.', 502, true)
    return { ...task.data, downloadKey: taskKey(secret, 'download', currentSource, input.sessionId, task.data.id) }
  }
  if (input.action === 'downloadStatus' || input.action === 'stopDownload' || input.action === 'streamDownload') {
    checkTaskKey(secret && input.taskId && taskKey(secret, 'download', currentSource, input.sessionId, input.taskId), input.downloadKey)
    const task = downloadTaskSchema.safeParse(await send(`/api/v1/tasks/${input.taskId}`))
    if (!task.success || task.data.id !== input.taskId) throw new VbrRecoveryError('The guest file download task is unavailable.', 404)
    if (input.action === 'streamDownload') {
      if (task.data.state !== 'Stopped' || task.data.result !== 'Success') throw new VbrRecoveryError('The ZIP archive is not ready for download.', 409)
      return send(`${base}/prepareDownload/${task.data.id}/download`, { method: 'POST', archive: true })
    }
    if (input.action === 'stopDownload' && ['Starting','Working'].includes(task.data.state)) {
      await send(`/api/v1/tasks/${task.data.id}/stop`, { method: 'POST', mutation: true })
      return { ...task.data, state: 'Stopping' }
    }
    return task.data
  }
  const path = input.path ?? (mount.data.type === 'Linux' ? '/' : '')
  if (input.action === 'search') {
    if (!input.query || !secret) throw new VbrRecoveryError('Enter a file name or search pattern.')
    const pattern = /[*?+]/.test(input.query) ? input.query : `*${input.query}*`
    const task = searchTaskSchema.safeParse(await send(`${base}/search`, { method: 'POST', mutation: true,
      body: { path, searchString: pattern, disableRecursiveSearch: !input.recursive } }))
    if (!task.success) throw new VbrRecoveryError('VBR accepted the search but did not return a search task.', 502, true)
    return { ...task.data, searchKey: taskKey(secret, 'search', currentSource, input.sessionId, task.data.id) }
  }
  if (['searchStatus', 'searchResults', 'stopSearch'].includes(input.action)) {
    checkTaskKey(secret && input.taskId && taskKey(secret, 'search', currentSource, input.sessionId, input.taskId), input.searchKey)
    if (input.action !== 'searchResults') {
      const task = searchTaskSchema.safeParse(await send(`/api/v1/tasks/${input.taskId}`))
      if (!task.success || task.data.id !== input.taskId) throw new VbrRecoveryError('The guest file search is unavailable.', 404)
      if (input.action === 'stopSearch' && ['Starting','Working'].includes(task.data.state)) {
        await send(`/api/v1/tasks/${task.data.id}/stop`, { method: 'POST', mutation: true })
        return { ...task.data, state: 'Stopping' }
      }
      return task.data
    }
  }
  if (input.action === 'browse' || input.action === 'searchResults') {
    const search = input.action === 'searchResults'
    const folder = directorySchema.safeParse(await send(search ? `${base}/search/${input.taskId}/browse` : `${base}/browse`, {
      method: 'POST', body: { ...(!search && { path }), ...(!search && input.foldersOnly && { filter: { itemTypes: ['Drive', 'Folder'] } }),
        order: { orderColumn: 'Name', orderAsc: true }, pagination: { skip: input.skip, limit: 200 } },
    }))
    if (!folder.success) throw new VbrRecoveryError('VBR could not return the contents of this folder.', 502)
    return { ...folder.data, path: folder.data.path ?? path, pagination: folder.data.pagination || { total: input.skip + folder.data.items.length, count: folder.data.items.length, skip: input.skip, limit: 200 },
      pathSeparator: mount.data.properties?.pathSeparator || (mount.data.type === 'Linux' ? '/' : '\\'), guestOs: mount.data.type }
  }
  if (input.action === 'unmount') {
    await send(`/api/v1/restore/flr/${input.sessionId}/unmount`, { method: 'POST', mutation: true })
    return { success: true }
  }
  if (!input.sourcePaths?.length || !input.restoreType) throw new VbrRecoveryError('Select guest files and a restore policy.')
  const vmObject = input.targetHost && await resolveInventory(send, input.targetHost, input.targetHost.platform, 'VirtualMachine')
  const targetHost = vmObject && { type: vmObject.platform === 'VSphere' ? 'VMware' : 'HyperV', vmObject }
  const native='/api/v1/restore/flr/'+input.sessionId
  const credentialField=input.credentialsId?{credentialsId:input.credentialsId}:{}
  if (input.credentialsId) {
    const [types,record]=await Promise.all([guestCredentialTypes(send,mount.data),send('/api/v1/credentials/'+input.credentialsId)])
    const saved=credential.safeParse(record)
    if(!saved.success||saved.data.id!==input.credentialsId||!types.includes(saved.data.type))
      return {status:'credentialsRequired' as const,message:'Choose a saved credential compatible with this guest.'}
  }
  const validatePath=async()=>{
    const value=pathCheck.safeParse(await send(native+'/validateRestoreItemTargetPath',{method:'POST',body:{
      itemPath:input.sourcePaths![0],isRestoreToOriginal:!targetHost,
    }}))
    if(!value.success)throw new VbrRecoveryError('VBR could not verify the guest restore destination.',502)
    return value.data
  }
  // Original-location restore checks credentials first. Restore To asks for its
  // destination first. Both preflight and final submit validate the submitted plan.
  const customPath=targetHost&&await validatePath()
  if(customPath?.isTargetPathNeeded&&!input.targetPath)return {status:'targetPathRequired' as const,targetPath:customPath.targetPath||''}
  const validation=credentialCheck.safeParse(await send(native+'/validateCredentials',{method:'POST',body:{
    restoreMode:targetHost?'Customized':'OriginalLocation',...credentialField,...(targetHost&&{targetHost}),
  }}))
  if(!validation.success)throw new VbrRecoveryError(unavailableCredentials,502)
  if(!validation.data.isSuccessful)return {status:'credentialsRequired' as const,...(validation.data.message&&{message:validation.data.message.slice(0,2000)})}
  let targetPath: string|undefined
  if(targetHost)targetPath=input.targetPath??''
  else{
    const destination=await validatePath()
    if(destination.isTargetPathNeeded){
      if(!input.targetPath)return {status:'targetPathRequired' as const,targetPath:destination.targetPath||''}
      targetPath=input.targetPath
    }else if(input.targetPath)throw new VbrRecoveryError('The target path requirement changed. Review the restore destination again.',409)
  }
  if(input.action==='validateRestore')return {status:'ready' as const}
  const result = await send(`${base}/${targetHost ? 'restoreTo' : 'restore'}`, { method: 'POST', mutation: true, body: {
    sourcePath: input.sourcePaths, restoreType: input.restoreType, ...credentialField,
    ...(targetPath!==undefined&&{targetPath}), ...(targetHost&&{targetHost}),
  } })
  const task=restoreTask(result)
  if(!task)throw new VbrRecoveryError('VBR accepted the file restore but its task ID is unavailable. Check Sessions before trying again.',502,true)
  return {...task,...(secret&&{restoreKey:taskKey(secret,'restore',principalScope,input.sessionId,task.id)})}
}
