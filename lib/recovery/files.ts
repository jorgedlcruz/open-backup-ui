import { z } from 'zod'
import type { RecoverySend } from '../server/vbr-recovery'
import { VbrRecoveryError, checkSource } from './error'
import { inventorySchema, resolveInventory } from './inventory'
import { listGuestCredentials } from './options'

const guestPath = z.string().max(32767).refine(value => !value.includes(String.fromCharCode(0)), 'Invalid guest path.')
export const filesSchema = z.object({
  action: z.enum(['browse', 'restore', 'unmount', 'credentials', 'task']), sessionId: z.string().uuid(),
  sourceKey: z.string().regex(/^[a-f0-9]{64}$/), path: guestPath.optional(), skip: z.number().int().nonnegative().default(0),
  sourcePaths: z.array(guestPath.min(1)).min(1).max(100).optional(), restoreType: z.enum(['Keep', 'Overwrite', 'PermissionOnly']).optional(),
  credentialsId: z.string().uuid().optional(), targetPath: guestPath.min(1).optional(), targetHost: inventorySchema.optional(),
  taskId: z.string().uuid().optional(),
})
const taskSchema = z.object({ id: z.string().uuid(), type: z.literal('FlrRestore'), name: z.string(), state: z.string(), progressPercent: z.number(), result: z.string() })
const mountSchema = z.object({ sessionId: z.string().uuid(), type: z.enum(['Windows', 'Linux']), properties: z.object({ pathSeparator: z.string() }).nullish() })

export async function guestFiles(send: RecoverySend, currentSource: string, input: z.infer<typeof filesSchema>) {
  checkSource(input.sourceKey, currentSource)
  const base = `/api/v1/backupBrowser/flr/${input.sessionId}`
  if (input.action === 'task') {
    if (!input.taskId) throw new VbrRecoveryError('Select a guest restore task.')
    const task = taskSchema.safeParse(await send(`/api/v1/tasks/${input.taskId}`))
    if (!task.success || task.data.id !== input.taskId) throw new VbrRecoveryError('The guest restore task is unavailable.', 404)
    return task.data
  }
  const mount = mountSchema.safeParse(await send(base))
  if (!mount.success || mount.data.sessionId !== input.sessionId) throw new VbrRecoveryError('This guest file mount is unavailable.', 409)
  if (input.action === 'credentials') return { credentials: await listGuestCredentials(send) }
  if (input.action === 'browse') {
    const path = input.path ?? (mount.data.type === 'Linux' ? '/' : '')
    const folder = z.object({ path: z.string(), items: z.array(z.object({ name: z.string(), displayName: z.string(), type: z.string(), location: z.string().nullish(),
      size: z.number(), modifiedDate: z.string().nullish(), itemState: z.string().optional() })),
      pagination: z.object({ total: z.number(), count: z.number(), skip: z.number(), limit: z.number() }).nullish() }).safeParse(await send(`${base}/browse`, {
      method: 'POST', body: { path, order: { orderColumn: 'Name', orderAsc: true }, pagination: { skip: input.skip, limit: 200 } },
    }))
    if (!folder.success) throw new VbrRecoveryError('VBR could not return the contents of this folder.', 502)
    return { ...folder.data, pagination: folder.data.pagination || { total: folder.data.items.length, count: folder.data.items.length, skip: input.skip, limit: 200 },
      pathSeparator: mount.data.properties?.pathSeparator || (mount.data.type === 'Linux' ? '/' : '\\'), guestOs: mount.data.type }
  }
  if (input.action === 'unmount') {
    await send(`/api/v1/restore/flr/${input.sessionId}/unmount`, { method: 'POST', mutation: true })
    return { success: true }
  }
  if (!input.sourcePaths?.length || !input.restoreType) throw new VbrRecoveryError('Select guest files and a restore policy.')
  if (input.targetHost && !input.targetPath) throw new VbrRecoveryError('Enter the target directory on the destination VM.')
  const vmObject = input.targetHost && await resolveInventory(send, input.targetHost, input.targetHost.platform, 'VirtualMachine')
  const targetHost = vmObject && { type: vmObject.platform === 'VSphere' ? 'VMware' : 'HyperV', vmObject }
  const validation = z.object({ isSuccessful: z.boolean(), message: z.string().nullish(), credentialsId: z.string().uuid().nullish() }).safeParse(
    await send(`/api/v1/restore/flr/${input.sessionId}/validateCredentials`, { method: 'POST', body: {
      restoreMode: targetHost ? 'Customized' : 'OriginalLocation', credentialsId: input.credentialsId, targetHost,
    } }))
  if (!validation.success || !validation.data.isSuccessful) {
    throw new VbrRecoveryError(validation.success && validation.data.message || 'VBR could not validate the target guest credentials.', 422)
  }
  const result = await send(`${base}/${targetHost ? 'restoreTo' : 'restore'}`, { method: 'POST', mutation: true, body: {
    sourcePath: input.sourcePaths, restoreType: input.restoreType, credentialsId: validation.data.credentialsId || input.credentialsId,
    targetPath: input.targetPath, targetHost,
  } })
  const task = taskSchema.safeParse(result)
  if (!task.success) throw new VbrRecoveryError('VBR accepted the file restore but its task ID is unavailable. Check Activity before trying again.', 502, true)
  return task.data
}
