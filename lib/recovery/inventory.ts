// Open Backup UI v1.2.0
import { z } from 'zod'
import type { RecoverySend } from '../server/vbr-recovery'
import { VbrRecoveryError } from './error'

export const platformSchema = z.enum(['VSphere', 'HyperV'])
export const kindSchema = z.enum(['Server', 'Host', 'ResourcePool', 'Folder', 'Datastore', 'Cluster', 'VirtualMachine', 'Network'])
export const inventorySchema = z.object({
  platform: platformSchema, type: z.string().min(1), hostName: z.string().min(1).max(500),
  name: z.string().min(1), objectId: z.string().nullish(), urn: z.string().nullish(),
  aclInfo: z.object({ isAllowed: z.boolean() }).nullish(),
})
export type InventoryRef = z.infer<typeof inventorySchema>
type Platform = z.infer<typeof platformSchema>
type Kind = z.infer<typeof kindSchema>
const pageSchema = z.object({
  data: z.array(z.unknown()), pagination: z.object({ total: z.number().int().nonnegative(), count: z.number().int().nonnegative(), skip: z.number().int().nonnegative(), limit: z.number().int().positive() }),
})
const limit = 200

function matchesKind(item: InventoryRef, kind: Kind) {
  return kind === 'Server' || item.type === kind || (kind === 'Network' && item.type === 'DVSNetwork')
}

export async function browseInventory(send: RecoverySend, platform: Platform, kind: Kind, server?: string, skip = 0, reference?: InventoryRef): Promise<{
  data: InventoryRef[]; pagination: { total: number; count: number; skip: number; limit: number }
}> {
  if (kind !== 'Server' && (!server || /[\\/?#\x00-\x1f]/.test(server) || ['.', '..'].includes(server))) {
    throw new VbrRecoveryError('Select an inventory server.')
  }
  const hierarchyType = kind === 'Network' ? 'Network' : platform === 'HyperV' ? 'HostsAndVMs'
    : kind === 'Datastore' ? 'HostsAndDatastores' : kind === 'Folder' ? 'VmsAndTemplates' : 'HostsAndClusters'
  const items: { type: string; operation: string; property: string; value: string }[] = [
    { type: 'PredicateExpression', operation: 'In', property: 'platform', value: platform },
  ]
  if (kind !== 'Server' && kind !== 'Network') items.push({ type: 'PredicateExpression', operation: 'In', property: 'type', value: kind })
  if (kind === 'Server' && server) items.push({ type: 'PredicateExpression', operation: 'Equals', property: 'hostName', value: server })
  if (reference) items.push({ type: 'PredicateExpression', operation: 'Equals', property: reference.urn ? 'urn' : 'objectId', value: reference.urn || reference.objectId! })
  const criteria = kind === 'Network' ? [...items, { type: 'GroupExpression', operation: 'Or',
    items: (platform === 'VSphere' ? ['Network', 'DVSNetwork'] : ['Network']).map(value => ({ type: 'PredicateExpression', operation: 'In', property: 'type', value })) }] : items
  const result = await send(`/api/v1/inventory${kind === 'Server' ? '' : '/' + encodeURIComponent(server!)}`, { method: 'POST', body: {
    permissionScope: 'Restore', hierarchyType, pagination: { skip, limit }, sorting: { property: 'name', direction: 'Ascending' },
    filter: { type: 'GroupExpression', operation: 'And', items: criteria },
  } })
  const parsed = pageSchema.safeParse(result)
  if (!parsed.success) throw new VbrRecoveryError('Invalid VBR inventory response.', 502)
  const data: InventoryRef[] = []
  for (const row of parsed.data.data) {
    const native = inventorySchema.passthrough().safeParse(row)
    if (native.success && native.data.platform === platform && matchesKind(native.data, kind)
        && native.data.aclInfo?.isAllowed !== false) data.push(native.data)
  }
  // A standalone ESXi host has one fixed VM folder. VBR omits this folder from
  // its public inventory tree, but uses the native hostd reference when restoring.
  if (!data.length && parsed.data.pagination.total === 0 && skip === 0 && platform === 'VSphere' && kind === 'Folder'
      && (!reference || reference.objectId === 'ha-folder-vm')) {
    const roots = await browseInventory(send, platform, 'Server', server)
    const standalone = roots.data.find(item => item.type === 'Host' && item.urn?.startsWith('esx:') && item.hostName === server)
    if (standalone) {
      data.push({ platform, type: 'Folder', name: 'vm', objectId: 'ha-folder-vm', hostName: standalone.hostName })
      return { data, pagination: { total: 1, count: 1, skip: 0, limit } }
    }
  }
  return { data, pagination: parsed.data.pagination }
}

export async function resolveInventory(send: RecoverySend, ref: InventoryRef, platform: Platform, kind: Kind): Promise<InventoryRef> {
  if (ref.platform !== platform || !matchesKind(ref, kind) || (!ref.objectId && !ref.urn)) throw new VbrRecoveryError(`Select a valid ${kind.toLowerCase()}.`)
  const result = await browseInventory(send, platform, kind, ref.hostName, 0, ref)
  const matches = result.data.filter(item => item.hostName.toLowerCase() === ref.hostName.toLowerCase()
    && (!ref.urn || item.urn === ref.urn) && (!ref.objectId || item.objectId === ref.objectId))
  if (matches.length !== 1 || result.pagination.total > result.pagination.count) throw new VbrRecoveryError(`The selected ${kind.toLowerCase()} changed or is inaccessible. Select it again.`, 409)
  return matches[0]
}
