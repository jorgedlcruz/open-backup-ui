import { isIP } from 'node:net'
import { z } from 'zod'
import { validId } from '../investigation/model'
import { browseInventory, inventorySchema, resolveInventory } from '../recovery/inventory'
import { VbrRecoveryError } from '../recovery/error'
import { collect } from '../recovery/options'
import type { RecoverySend } from '../server/vbr-recovery'
import { mountPaths } from './model'

export type VmwareDestination = {
  provider: 'esxi' | 'vcenter'
  server: string
  port: number
  vmId: string
  vmName: string
  canConsole: boolean
  powerState: 'PoweredOn' | 'PoweredOff' | 'Suspended' | 'Unknown'
  runtimeHost?: string
  url: string | null
}

const unavailable = () => new VbrRecoveryError('The published VMware VM could not be uniquely verified on the configured destination.', 409)
const id = z.string().uuid().transform(value => value.toLowerCase())
const mountModel = z.object({
  id, sessionId: id, state: z.literal('Mounted'), vmName: z.string().min(1), hostName: z.string().min(1),
  spec: z.object({
    type: z.enum(['OriginalLocation', 'Customized', 'OtherPlatform']), restorePointId: id,
    destination: z.object({ restoredVmName: z.string().min(1).nullish(), destinationHost: inventorySchema.nullish() }).nullish(),
  }),
})
const vmModel = inventorySchema.extend({
  powerState: z.enum(['PoweredOn', 'PoweredOff', 'Suspended']).nullish(),
})
const managerPage = z.object({
  data: z.array(z.object({ name: z.string(), type: z.string(), viHostType: z.string().nullish(), status: z.string(),
    port: z.number().int().min(1).max(65535), parentHostId: z.string().nullish() })),
  pagination: z.object({ total: z.number().int(), count: z.number().int(), skip: z.number().int() }),
})

function hostName(value: string) {
  const host = value.toLowerCase()
  if (isIP(host)) return host
  if (host.startsWith('[') && host.endsWith(']') && isIP(host.slice(1, -1)) === 6) return host.slice(1, -1)
  if (host.length > 253 || !host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) throw unavailable()
  // WHATWG URLs canonicalize legacy numeric IPv4 spellings such as 127.1 and hexadecimal labels.
  if (!URL.canParse('https://' + host) || new URL('https://' + host).hostname !== host) throw unavailable()
  return host
}

/** VMware identifies vCenter objects by (manager instance UUID, MoRef). VBR's managed-server UUID is unrelated. */
export function vmwareManagementUrl(target: Pick<VmwareDestination, 'provider' | 'server' | 'port' | 'vmId'>, instanceUuid?: string): string | null {
  const host = hostName(target.server)
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) throw unavailable()
  const origin = new URL('https://' + (isIP(host) === 6 ? '[' + host + ']' : host))
  origin.port = String(target.port)
  if (target.provider === 'esxi' && /^\d+$/.test(target.vmId)) return origin.origin + '/ui/#/host/vms/' + target.vmId
  if (target.provider === 'vcenter' && /^vm-\d+$/.test(target.vmId) && instanceUuid && validId(instanceUuid)) {
    return origin.origin + '/ui/app/vm;nav=h/urn:vmomi:VirtualMachine:' + target.vmId + ':' + instanceUuid.toLowerCase() + '/summary'
  }
  return null
}

type CheckedMount = z.infer<typeof mountModel>

function mounted(raw: unknown, sessionId: string, mountId: string) {
  const result = mountModel.safeParse(raw)
  if (!result.success) throw unavailable()
  const mount = result.data
  const requestedName = mount.spec.destination?.restoredVmName
  if (mount.id !== mountId || mount.sessionId !== sessionId || (requestedName && mount.vmName !== requestedName)) throw unavailable()
  return mount
}

function fingerprint(mount: CheckedMount) {
  const host = mount.spec.destination?.destinationHost
  return [mount.spec.type, mount.spec.restorePointId, mount.vmName, mount.hostName, host?.type, host?.hostName, host?.objectId, host?.urn]
}

async function inventoryRoot(send: RecoverySend, server: string) {
  // VBR reports the *unfiltered* root count even for an exact hostName predicate. Scan the small
  // server collection so a multi-page or duplicate registration cannot select the wrong provider.
  const matches = []
  let skip = 0
  for (;;) {
    const page = await browseInventory(send, 'VSphere', 'Server', undefined, skip)
    if (page.pagination.skip !== skip) throw unavailable()
    matches.push(...page.data.filter(row => row.hostName.toLowerCase() === server))
    if (matches.length > 1) throw unavailable()
    skip += page.pagination.count
    if (skip >= page.pagination.total) break
    if (!page.pagination.count) throw unavailable()
  }
  if (matches.length !== 1 || matches[0].aclInfo?.isAllowed !== true) throw unavailable()
  return matches[0]
}

function checkSession(nativeSession: unknown, sessionId: string, mountId: string, path: string) {
  const session = z.object({id, sessionType: z.literal('InstantRecovery'), state: z.enum(['Working', 'Starting']), endTime: z.string().nullish(),
    resourceId: id.nullish(), resourceReference: z.string().nullish()}).safeParse(nativeSession)
  if (!session.success || session.data.id !== sessionId || session.data.endTime || (session.data.resourceId && session.data.resourceId !== mountId)
      || (session.data.resourceReference && session.data.resourceReference.toLowerCase() !== path.toLowerCase())) throw unavailable()
}

const pointModel = z.object({ id, name: z.string().min(1), platformName: z.string(), backupId: id,
  creationTime: z.string(), allowedOperations: z.array(z.string()).nullish() })

async function backedUpVm(send: RecoverySend, point: z.infer<typeof pointModel>) {
  if (point.platformName !== 'VMware') throw unavailable()
  const rows = await collect(send, '/api/v1/backups/' + point.backupId + '/objects', z.object({
    id, name: z.string(), platformName: z.string(), viType: z.string().nullish(), path: z.string().nullish(), objectId: z.string().nullish(),
  }))
  const date = Date.parse(point.creationTime)
  if (!Number.isFinite(date)) throw unavailable()
  const params = new URLSearchParams({ backupIdFilter: point.backupId, createdAfterFilter: new Date(date - 2000).toISOString(),
    createdBeforeFilter: new Date(date + 2000).toISOString() })
  let match: {server: string; vmId: string} | undefined
  for (const row of rows.filter(row => row.name === point.name && row.platformName === 'VMware' && row.viType === 'VirtualMachine')) {
    // A name can appear multiple times in the same backup. Bind this exact restore point to its backed-up VM.
    const points = await collect(send, '/api/v1/backupObjects/' + row.id + '/restorePoints?' + params, z.object({id, backupId: id}))
    if (!points.some(item => item.id === point.id && item.backupId === point.backupId)) continue
    const parts = row.path?.split('\\')
    if (match || !parts || parts.length < 2 || !row.objectId || !/^(?:vm-)?\d+$/.test(row.objectId)) throw unavailable()
    match = {server: hostName(parts[0]), vmId: row.objectId}
  }
  if (!match) throw unavailable()
  return match
}

async function originalPlacement(send: RecoverySend, server: string, reportedHost: string) {
  if (reportedHost.toLowerCase() === server) return undefined
  for (const kind of ['Host', 'Cluster'] as const) {
    const page = await browseInventory(send, 'VSphere', kind, server, 0, undefined, reportedHost)
    if (page.pagination.total === 0) continue
    if (page.pagination.total !== 1 || page.data.length !== 1 || page.data[0].name.toLowerCase() !== reportedHost.toLowerCase()) throw unavailable()
    return page.data[0]
  }
  throw unavailable()
}

export async function resolveVmwareDestination(send: RecoverySend, sessionId: string, mountId: string): Promise<VmwareDestination> {
  if (!validId(sessionId) || !validId(mountId)) throw unavailable()
  sessionId = sessionId.toLowerCase()
  mountId = mountId.toLowerCase()
  const path = mountPaths.vSphere + '/' + mountId
  const sessionPath = '/api/v1/sessions/' + sessionId
  const [raw, nativeSession] = await Promise.all([send(path), send(sessionPath)])
  const mount = mounted(raw, sessionId, mountId)
  checkSession(nativeSession, sessionId, mountId, path)
  const requested = mount.spec.destination?.destinationHost
  if (requested && (requested.platform !== 'VSphere' || !['Host', 'Cluster'].includes(requested.type) || requested.aclInfo?.isAllowed === false)) throw unavailable()
  const point = pointModel.safeParse(await send('/api/v1/restorePoints/' + mount.spec.restorePointId))
  if (!point.success || point.data.id !== mount.spec.restorePointId) throw unavailable()
  const sameName = point.data.name.toLowerCase() === mount.vmName.toLowerCase()
  if (mount.spec.type === 'OriginalLocation' && !sameName) throw unavailable()
  const sourceVm = !requested || sameName ? await backedUpVm(send, point.data) : undefined
  if (!requested && !sourceVm) throw unavailable()
  const server = hostName(requested?.hostName ?? sourceVm!.server)
  const params = new URLSearchParams({ typeFilter: 'ViHost', nameFilter: server, includeNestedHosts: 'false', skip: '0', limit: '200' })
  const [root, managed] = await Promise.all([
    inventoryRoot(send, server),
    send('/api/v1/backupInfrastructure/managedServers?' + params),
  ])
  if (hostName(root.hostName) !== server || hostName(root.name) !== server) throw unavailable()
  const provider = root.type === 'Host' ? 'esxi' : root.type === 'vCenterServer' ? 'vcenter' : null
  const rootUrn = (provider === 'esxi' ? 'esx:' : 'vc:') + server
  if (!provider || root.urn?.toLowerCase() !== rootUrn) throw unavailable()
  const managers = managerPage.safeParse(managed)
  if (!managers.success || managers.data.pagination.skip !== 0 || managers.data.pagination.total !== managers.data.data.length
      || managers.data.pagination.count !== managers.data.data.length) throw unavailable()
  const managersNamed = managers.data.data.filter(row => row.name.toLowerCase() === server)
  if (managersNamed.length !== 1) throw unavailable()
  const manager = managersNamed[0]
  if (manager.type !== 'ViHost' || manager.viHostType !== (provider === 'esxi' ? 'ESXi' : 'VC')
    || manager.status !== 'Available' || manager.parentHostId) throw unavailable()

  const [destination, matches] = await Promise.all([
    provider === 'esxi' ? root : requested ? resolveInventory(send, requested, 'VSphere', requested.type === 'Host' ? 'Host' : 'Cluster')
      : originalPlacement(send, server, mount.hostName),
    browseInventory(send, 'VSphere', 'VirtualMachine', server, 0, undefined, mount.vmName),
  ])
  if (destination && (!destination.urn || destination.aclInfo?.isAllowed !== true || hostName(destination.hostName) !== server)) throw unavailable()
  if (requested && (!destination || destination.type !== requested.type || destination.name !== requested.name
      || (requested.objectId && destination.objectId !== requested.objectId) || (requested.urn && destination.urn !== requested.urn))) throw unavailable()
  if (provider === 'vcenter' && destination?.type === 'Host' && ![server, destination.name.toLowerCase()].includes(mount.hostName.toLowerCase())) throw unavailable()
  if (provider === 'esxi' && hostName(mount.hostName) !== server) throw unavailable()
  if (matches.pagination.total !== 1 || matches.data.length !== 1) throw unavailable()
  const item = vmModel.safeParse(matches.data[0])
  if (!item.success) throw unavailable()
  const vm = item.data
  if (hostName(vm.hostName) !== server || vm.name !== mount.vmName || vm.aclInfo?.isAllowed !== true || !vm.objectId || !vm.urn) throw unavailable()
  const address = vm.urn.toLowerCase().split(';')
  if (address[0] !== rootUrn || address.at(-1) !== 'vm:' + vm.objectId.toLowerCase()) throw unavailable()
  if (!(provider === 'esxi' ? /^\d+$/ : /^vm-\d+$/).test(vm.objectId)) throw unavailable()
  if (sameName && sourceVm) {
    // ESXi host-local IDs and vCenter MoRefs may identify the same VM by different values. Only compare
    // like namespaces. With a different manager, establish the source VM still has its own inventory record.
    if ((provider === 'vcenter') !== sourceVm.vmId.startsWith('vm-') || sourceVm.vmId === vm.objectId) throw unavailable()
    if (sourceVm.server !== server) {
      const sourceRoot = await inventoryRoot(send, sourceVm.server)
      if (sourceRoot.type !== root.type) throw unavailable()
      const source = await resolveInventory(send, {name: point.data.name, type: 'VirtualMachine', platform: 'VSphere', hostName: sourceVm.server,
        objectId: sourceVm.vmId}, 'VSphere', 'VirtualMachine')
      if (source.name !== point.data.name || source.aclInfo?.isAllowed !== true || !sourceRoot.urn || !source.urn?.startsWith(sourceRoot.urn + ';')
        || !source.urn.endsWith(';vm:' + sourceVm.vmId)) throw unavailable()
    }
  }
  if (provider === 'vcenter' && destination?.urn) {
    const placement = destination.urn.toLowerCase().split(';')
    if (placement[0] !== rootUrn || !destination.objectId
      || placement.at(-1) !== (destination.type === 'Cluster' ? 'cluster:' : 'esx:') + destination.objectId.toLowerCase()) throw unavailable()
    // With DRS, the VM's inventory URN can stop at the cluster. Match this placement without assuming its runtime host.
    const scope = destination.type === 'Host' ? placement.slice(0, -1) : placement
    if (scope.some((part, index) => address[index] !== part)) throw unavailable()
    const locatedHost = address.find(segment => segment.startsWith('esx:'))
    if (destination.type === 'Host' && locatedHost && locatedHost !== placement.at(-1)) throw unavailable()
  }
  // Catch unpublish/migration while the provider and inventory reads were in flight.
  const [rawCurrent, currentSession] = await Promise.all([send(path), send(sessionPath)])
  const current = mounted(rawCurrent, sessionId, mountId)
  checkSession(currentSession, sessionId, mountId, path)
  if (JSON.stringify(fingerprint(current)) !== JSON.stringify(fingerprint(mount))) throw unavailable()
  const target = { provider, server, port: manager.port, vmId: vm.objectId, vmName: vm.name, powerState: vm.powerState || 'Unknown',
    canConsole: point.data.allowedOperations?.includes('StartViVMInstantRecovery') === true } as const
  return { ...target, ...(provider === 'esxi' && { runtimeHost: server }), url: vmwareManagementUrl(target) }
}
