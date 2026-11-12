// Open Backup UI v1.2.0
import { z } from 'zod'
import { checkSource, VbrRecoveryError } from '../recovery/error'
import type { RecoverySend } from '../server/vbr-recovery'
import { inventorySchema, type InventoryRef } from '../recovery/inventory'
import type { MigrationDestination } from '../server/migration-links'
import { investigationSessionSchema, validId } from '../investigation/model'
import { mountBelongsToSession, mountPaths, parseMount } from './model'

const ref = inventorySchema.extend({ platform: z.literal('VSphere') })
export const mountAction = z.object({
  kind: z.enum(['vSphere', 'hyperV', 'fcd', 'publish']), action: z.enum(['migrate', 'unmount']),
  sourceKey: z.string().min(1), sessionId: z.string().refine(validId),
  host: ref.optional(), resourcePool: ref.optional(), folder: ref.optional(), datastore: ref.optional(),
  useOriginalPlacement: z.boolean().optional(), quickMigration: z.boolean().optional(),
}).strict()
type Action = z.infer<typeof mountAction>
type Resolve = (selection: z.infer<typeof ref>, kind: 'Host'|'Cluster'|'ResourcePool'|'Folder'|'Datastore') => Promise<InventoryRef>

export async function runMountAction(send: RecoverySend, resolve: Resolve, sourceKey: string, mountId: string, action: Action) {
  if (!validId(mountId) || !validId(action.sessionId)) throw new VbrRecoveryError('Select a valid mount point.', 400)
  checkSource(action.sourceKey, sourceKey)
  const path = `${mountPaths[action.kind]}/${mountId}`
  const mount = parseMount(action.kind, await send(path))
  let linked = mount.sessionId === action.sessionId
  if (!linked && mount.kind === 'publish') {
    const session = investigationSessionSchema.safeParse(await send(`/api/v1/sessions/${action.sessionId}`))
    linked = session.success && session.data.id === action.sessionId && mountBelongsToSession(mount, session.data)
  }
  if (mount.id !== mountId || !linked || !(mount.state === 'Mounted' || (action.action === 'unmount' && ['Failed', 'MountFailed', 'UnmountFailed'].includes(mount.state)))) {
    throw new VbrRecoveryError('The mount state changed. Refresh Activity.', 409)
  }

  if (action.kind === 'publish' && action.action === 'migrate') throw new VbrRecoveryError('Invalid recovery action.', 400)

  let body: unknown
  let destination: MigrationDestination | undefined
  // Hyper-V migrates the specified publication in place; its native mount reports the destination host.
  if (action.action === 'migrate' && action.kind === 'hyperV' && mount.host) destination = {host:mount.host}
  if (action.action === 'migrate' && action.kind !== 'hyperV') {
    if (!action.datastore || action.datastore.type !== 'Datastore') throw new VbrRecoveryError('Select a destination datastore.', 400)
    if (action.kind === 'fcd') {
      if (!mount.disks?.length) throw new VbrRecoveryError('No mounted disks were reported.', 409)
      body = { mountedDiskNames: mount.disks, targetDatastore: await resolve(action.datastore, 'Datastore') }
    } else {
      if (action.useOriginalPlacement && (!mount.originalLocation || action.host || action.resourcePool || action.folder)) {
        throw new VbrRecoveryError('Original placement is unavailable for this mount.', 400)
      }
      if (!action.useOriginalPlacement && (!action.host || !['Host', 'Cluster'].includes(action.host.type))) {
        throw new VbrRecoveryError('Select a destination host or cluster.', 400)
      }
      const server = action.datastore.hostName.toLowerCase()
      if ([action.host, action.resourcePool, action.folder].some(item => item && item.hostName.toLowerCase() !== server)) {
        throw new VbrRecoveryError('Select destination objects on the same inventory server.', 400)
      }
      const [destinationHost, resourcePool, folder, defaultDatastore] = await Promise.all([
        action.host && resolve(action.host, action.host.type === 'Cluster' ? 'Cluster' : 'Host'),
        action.resourcePool && resolve(action.resourcePool, 'ResourcePool'),
        action.folder && resolve(action.folder, 'Folder'),
        resolve(action.datastore, 'Datastore'),
      ])
      body = { ...(destinationHost ? {destinationHost} : {}), ...(resourcePool ? {resourcePool} : {}), ...(folder ? {folder} : {}),
        datastore: {defaultDatastore}, VeeamQMEnabled: !!action.quickMigration, DeleteSourceVmsFiles: false }
      // Keep display names from the same VBR inventory objects used in the accepted payload.
      const host = destinationHost?.name || (action.useOriginalPlacement ? mount.host : undefined)
      destination = {...(host && {host}), datastore:defaultDatastore.name}
    }
  }
  const operation = action.kind === 'publish' ? 'unpublish' : action.action === 'unmount' && action.kind === 'fcd' ? 'dismount' : action.action
  const result = await send(`${path}/${operation}`, {method: 'POST', ...(body ? {body} : {}), mutation: true})
  const accepted = z.object({id: z.string().refine(validId)}).safeParse(result)
  // A successful response may arrive after VBR has removed the mount; never replay it to obtain a session ID.
  return {accepted: true, sessionId: accepted.success ? accepted.data.id : null, ...(destination && {destination})}
}
