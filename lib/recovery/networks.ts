// Open Backup UI v1.0.2
import { z } from 'zod'
import type { RecoverySend } from '../server/vbr-recovery'
import { VbrRecoveryError } from './error'
import { browseInventory, inventorySchema, resolveInventory, type InventoryRef } from './inventory'
import { collect, pointNetworks, type SourcePoint } from './options'

export const networkMode = z.enum(['Original', 'Disconnected', 'Mapped'])
export const networkMapping = z.object({ sourceId: z.string().min(1).max(2048), target: inventorySchema.optional() })
type Mode = z.infer<typeof networkMode>
type Mapping = z.infer<typeof networkMapping>

async function backedUpVmNetworks(send: RecoverySend, point: SourcePoint) {
  const rows = await collect(send, `/api/v1/backups/${point.backupId}/objects`, z.object({
    name: z.string().nullish(), platformName: z.string(), path: z.string().nullish(),
  }))
  const servers = new Set(rows.filter(item => item.name === point.name && item.platformName === 'VMware')
    .map(item => item.path?.split('\\')[0]).filter((item): item is string => !!item))
  if (servers.size !== 1) throw new VbrRecoveryError('VBR could not uniquely identify the source vSphere server. Keep the original networks or disconnect the VM.', 409)
  const [server] = servers
  const inventory: InventoryRef[] = []
  let skip = 0
  while (skip < 20000) {
    const page = await browseInventory(send, 'VSphere', 'Network', server, skip)
    inventory.push(...page.data)
    skip += page.pagination.count
    if (skip >= page.pagination.total) return inventory
    if (!page.pagination.count) break
  }
  throw new VbrRecoveryError('Source network inventory is incomplete.', 502)
}

function originalPortGroup(source: { id: string; name: string }, inventory: InventoryRef[]) {
  const exact = inventory.filter(row => row.objectId === source.id)
  const candidates = exact.length ? exact : inventory.filter(row => row.name === source.name || (row.type === 'DVSNetwork' && row.name.startsWith(source.name + '(')))
  const unique = new Map(candidates.filter(row => row.objectId).map(row => [row.objectId, row]))
  if (unique.size !== 1) throw new VbrRecoveryError(`VBR could not uniquely resolve the original port group "${source.name}". Keep the original networks or disconnect the VM.`, 409)
  const [portGroup] = unique.values()
  return { type: 'Network', platform: 'VSphere', hostName: portGroup.hostName, objectId: portGroup.objectId, name: portGroup.name }
}

export async function compileNetworks(send: RecoverySend, point: SourcePoint, host: InventoryRef, operation: string, mode: Mode, mappings: Mapping[]): Promise<{
  network?: object; networkMapping?: { sourceNetwork: { id: string; name: string }; targetNetwork?: InventoryRef }[]; nicsEnabled?: boolean
}> {
  if (mode === 'Original') return {}
  const hyperV = host.platform === 'HyperV'
  const isInstantVi = operation === 'StartViVMInstantRecovery'
  if (isInstantVi && point.platformName === 'VMware') throw new VbrRecoveryError('Use the network connection option for native vSphere Instant Recovery.')
  if (mode === 'Disconnected' && !hyperV) return isInstantVi ? { nicsEnabled: false } : { network: { networks: [], disconnected: true } }
  const sources = await pointNetworks(send, point.id)
  if (!sources.length) throw new VbrRecoveryError('The selected restore point has no network interfaces to configure.', 409)
  const bySource = new Map(mappings.map(mapping => [mapping.sourceId, mapping]))
  if (mode === 'Mapped' && (bySource.size !== sources.length || mappings.length !== sources.length || sources.some(item => !bySource.has(item.id)))) {
    throw new VbrRecoveryError('Choose a network mapping for every source interface.', 409)
  }
  const originalNetworks = !hyperV && !isInstantVi ? await backedUpVmNetworks(send, point) : []
  const targets = await Promise.all(sources.map(async source => {
    const chosen = mode === 'Mapped' ? bySource.get(source.id)?.target : undefined
    if (!chosen && !hyperV) throw new VbrRecoveryError('Choose a destination network for every source interface.')
    if (chosen && chosen.hostName.toLowerCase() !== host.hostName.toLowerCase()) throw new VbrRecoveryError('Choose a network on the selected destination server.')
    const target = chosen && await resolveInventory(send, chosen, host.platform, 'Network')
    return { source, target }
  }))
  if (hyperV) return { network: { mappings: targets.map(({ source, target }) => ({ sourceNetwork: { network: source, disconnect: !target }, targetNetwork: target })) } }
  if (isInstantVi) return { nicsEnabled: true, networkMapping: targets.map(({ source, target }) => ({ sourceNetwork: source, targetNetwork: target })) }
  return { network: { disconnected: false, networks: targets.map(({ source, target }) => ({
    sourceNetwork: originalPortGroup(source, originalNetworks), targetNetwork: target,
  })) } }
}
