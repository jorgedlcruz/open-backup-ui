// Open Backup UI v1.0.2
import { isIP } from 'node:net'
import { z } from 'zod'
import type { RecoverySend } from '../server/vbr-recovery'
import type { saveEntireRestore } from '../server/entire-restore-records'
import { VbrRecoveryError, checkSource } from './error'
import {validId} from '../investigation/model'
import { inventorySchema, resolveInventory, type InventoryRef } from './inventory'
import { findPoint, pointDisks, type SourcePoint } from './options'
import { compileNetworks, networkMode, networkMapping } from './networks'
import { linuxMountSettings, type PrivateFlrConnection } from './linux-flr'

const endpoints = {
  StartViVMInstantRecovery: '/api/v1/restore/instantRecovery/vSphere/vm',
  StartEntireVmRestore: '/api/v1/restore/vmRestore/vSphere',
  StartHvVMInstantRecovery: '/api/v1/restore/instantRecovery/hyperV/vm',
  StartEntireVmRestoreHyperV: '/api/v1/restore/vmRestore/hyperV',
  StartEntireVmRestoreCloudDirector: '/api/v1/restore/vmRestore/cloudDirector',
  StartFCDInstantRecovery: '/api/v1/restore/instantRecovery/vSphere/fcd',
  StartFlrRestore: '/api/v1/restore/flr',
  StartDiskPublish: '/api/v1/dataIntegration/publish',
} as const
const name = z.string().trim().min(1).max(255)
const targetSchema = z.object({
  host: inventorySchema.optional(), cluster: inventorySchema.optional(), folder: inventorySchema.optional(),
  resourcePool: inventorySchema.optional(), datastore: inventorySchema.optional(), vmName: name.optional(),
  storagePath: z.string().trim().min(1).max(2048).optional(),
})
export const draftSchema = z.object({
  sourceKey: z.string().regex(/^[a-f0-9]{64}$/), restorePointId: z.string().uuid(), backupId: z.string().uuid(),
  operation: z.enum(Object.keys(endpoints) as [keyof typeof endpoints, ...(keyof typeof endpoints)[]]),
  mode: z.enum(['OriginalLocation', 'Customized']).default('OriginalLocation'),
  reason: z.string().trim().max(2048).default(''), powerUp: z.boolean().default(false), nicsEnabled: z.boolean().default(false),
  overwrite: z.boolean().default(false), restoreTags: z.boolean().default(true), quickRollback: z.boolean().default(false),
  antivirusScan: z.boolean().default(false), target: targetSchema.default({}),
  reviewedMalwareStatus: z.string().max(64).nullish(),
  networkMode: networkMode.default('Original'), networkMappings: z.array(networkMapping).max(128).default([]),
  disks: z.array(z.object({ uid: z.string().min(1).max(2048), mountedName: name.optional(), registeredName: name.optional() })).max(256).optional(),
  mountServerId: z.string().uuid().optional(), credentialsId: z.string().uuid().optional(), guestOs: z.enum(['Windows', 'Linux']).optional(),
  linuxMountType:z.enum(['OriginalHost','HelperHost','MountServer']).optional(), helperHostId:z.string().uuid().optional(),
  allowedIps: z.array(z.string().refine(value => isIP(value) !== 0, 'Enter valid iSCSI client IP addresses.')).max(128).optional(),
})
type Draft = z.infer<typeof draftSchema>

async function location(send: RecoverySend, draft: Draft, platform: 'VSphere' | 'HyperV') {
  const { host, folder, resourcePool, datastore, vmName, storagePath } = draft.target
  if (!host || !vmName) throw new VbrRecoveryError('Select a destination host and enter a VM name.')
  if ([folder, resourcePool, datastore].some(item => item && item.hostName.toLowerCase() !== host.hostName.toLowerCase())) {
    throw new VbrRecoveryError('Select all destination objects from the same inventory server.')
  }
  const [destinationHost, targetFolder, pool, targetDatastore] = await Promise.all([
    resolveInventory(send, host, platform, 'Host'), folder && resolveInventory(send, folder, platform, 'Folder'),
    resourcePool && resolveInventory(send, resourcePool, platform, 'ResourcePool'), datastore && resolveInventory(send, datastore, platform, 'Datastore'),
  ])
  return { destinationHost, folder: targetFolder, resourcePool: pool, datastore: targetDatastore, vmName, storagePath }
}

function secureSettings(draft: Draft) {
  return { antivirusScanEnabled: draft.antivirusScan, yaraScanEnabled: false,
    ...(draft.antivirusScan ? { virusDetectionAction: 'AbortRecovery', entireVolumeScanEnabled: true } : {}) }
}

async function vmPayload(send: RecoverySend, point: SourcePoint, draft: Draft) {
  const { operation, mode, powerUp, overwrite, restoreTags, nicsEnabled } = draft
  const base = { restorePointId: point.id, type: mode, powerUp, reason: draft.reason, secureRestore: secureSettings(draft) }
  const isInstantVi = operation === 'StartViVMInstantRecovery'
  const isInstantHv = operation === 'StartHvVMInstantRecovery'
  const hyperV = isInstantHv || operation === 'StartEntireVmRestoreHyperV'
  const crossPlatform = (isInstantVi && point.platformName !== 'VMware') || (isInstantHv && point.platformName !== 'HyperV')
  if (mode === 'OriginalLocation') {
    if (draft.networkMode !== 'Original') throw new VbrRecoveryError('Select a customized location to change network mappings.')
    if (crossPlatform) throw new VbrRecoveryError('Select a destination on the target hypervisor.')
    if (isInstantVi) return { ...base, vmTagsRestoreEnabled: restoreTags, nicsEnabled, overwrite }
    if (isInstantHv) return base
    return { ...base, quickRollback: draft.quickRollback, ...(!hyperV ? { restoreProxies: { autoSelectEnabled: true } } : {}),
      ...(operation === 'StartEntireVmRestore' ? { overwrite } : {}) }
  }
  if (operation === 'StartEntireVmRestoreCloudDirector') throw new VbrRecoveryError('Choose the original Cloud Director location.')
  const target = await location(send, draft, hyperV ? 'HyperV' : 'VSphere')
  const { destinationHost, resourcePool, folder, datastore, vmName, storagePath } = target
  const networks = await compileNetworks(send, point, destinationHost, operation, draft.networkMode, draft.networkMappings)
  if (hyperV) {
    return { ...base, type: crossPlatform ? 'OtherPlatform' : mode, destinationHost,
      target: { vmName, preserveUUID: false, registerAsClusterResource: false, overwriteExistingVm: overwrite, overwriteExistingDisks: overwrite },
      ...(storagePath ? { datastore: { configurationFilesPath: storagePath } } : {}), network: networks.network }
  }
  if (isInstantVi) return { ...base, type: crossPlatform ? 'OtherPlatform' : mode, nicsEnabled: networks.nicsEnabled ?? nicsEnabled, overwrite,
    ...(!crossPlatform ? { vmTagsRestoreEnabled: restoreTags } : {}),
    destination: { restoredVmName: vmName, destinationHost, resourcePool, folder, biosUuidPolicy: 'GenerateNew', enableClusterWideMount: false, networkMapping: networks.networkMapping },
    datastore: { redirectEnabled: !!datastore, cacheDatastore: datastore } }
  if (!folder) throw new VbrRecoveryError('Select a destination VM folder for the restored VM name.')
  return { ...base, destinationHost, resourcePool, folder: { vmName, folder, restoreVmTags: restoreTags }, network: networks.network,
    ...(datastore ? { datastore: { defaultDatastore: datastore } } : {}), restoreProxies: { autoSelectEnabled: true }, overwrite }
}

async function flrPayload(send: RecoverySend, point: SourcePoint, draft: Draft,open?:PrivateFlrConnection) {
  const knownOS = point.guestOsFamily === 'Windows' || point.guestOsFamily === 'Linux' ? point.guestOsFamily : null
  if (draft.guestOs && knownOS && draft.guestOs !== knownOS) throw new VbrRecoveryError('The guest operating system changed.')
  const type = knownOS || draft.guestOs
  if (!type) throw new VbrRecoveryError('Select the guest operating system.')
  const base = { restorePointId: point.id, reason: draft.reason, type, autoUnmount: { isEnabled: true, noActivityPeriodInMinutes: 30 } }
  if (type === 'Windows') {
    if(draft.linuxMountType||draft.helperHostId)throw new VbrRecoveryError('The guest operating system changed.',409)
    return { ...base, mountMode: 'Automatic', credentialsId: draft.credentialsId }
  }
  return { ...base, mountMode: 'Manual', mountServer:await linuxMountSettings(send,open,point.id,draft) }
}

async function diskPayload(send: RecoverySend, point: SourcePoint, draft: Draft) {
  const selected = draft.disks || []
  if (new Set(selected.map(disk => disk.uid)).size !== selected.length) throw new VbrRecoveryError('Select each disk once.')
  const disks = selected.length ? await pointDisks(send, point.id) : []
  const mappings = selected.map(choice => {
    const disk = disks.find(item => item.uid === choice.uid)
    if (!disk) throw new VbrRecoveryError('A selected disk is unavailable in this restore point.', 409)
    return { nameInBackup: disk.name, mountedDiskName: choice.mountedName, registeredFcdName: choice.registeredName }
  })
  const base = { restorePointId: point.id, reason: draft.reason }
  if (draft.operation === 'StartDiskPublish') {
    if (!draft.allowedIps?.length) throw new VbrRecoveryError('Enter at least one allowed iSCSI client IP address.')
    return { ...base, type: 'ISCSITarget', allowedIps: draft.allowedIps, ...(mappings.length ? { diskNames: mappings.map(item => item.nameInBackup) } : {}) }
  }
  if (!draft.target.cluster || !mappings.length || mappings.some(m => !m.registeredFcdName || !m.mountedDiskName)) {
    throw new VbrRecoveryError('Select a cluster and name each disk to recover.')
  }
  const destinationCluster: InventoryRef = await resolveInventory(send, draft.target.cluster, 'VSphere', 'Cluster')
  const cache = draft.target.datastore
  if (cache && cache.hostName.toLowerCase() !== destinationCluster.hostName.toLowerCase()) throw new VbrRecoveryError('Select a write cache on the destination cluster inventory server.')
  const cacheDatastore = cache && await resolveInventory(send, cache, 'VSphere', 'Datastore')
  return { ...base, destinationCluster, disksMapping: mappings,
    ...(cacheDatastore ? { writeCache: { redirectIsEnabled: true, cacheDatastore } } : {}) }
}

export function checkPointOperation(point: SourcePoint,draft: Draft) {
  if ((point.malwareStatus === 'Infected' || point.malwareStatus === 'Suspicious') && point.malwareStatus !== draft.reviewedMalwareStatus) {
    throw new VbrRecoveryError('VBR flagged this restore point for malware. Reopen the workflow and review its current status.', 409)
  }
  if (!point.allowedOperations.includes(draft.operation)) throw new VbrRecoveryError('VBR no longer allows this operation for the selected point.', 409)
}
export async function prepareRestore(send: RecoverySend, sourceKey: string, draft: Draft,open?:PrivateFlrConnection) {
  checkSource(draft.sourceKey, sourceKey)
  const point = await findPoint(send, draft.restorePointId, draft.backupId)
  checkPointOperation(point,draft)
  const isFiles = draft.operation === 'StartFlrRestore'
  const payload = isFiles ? await flrPayload(send, point, draft,open)
    : draft.operation === 'StartFCDInstantRecovery' || draft.operation === 'StartDiskPublish' ? await diskPayload(send, point, draft)
    : await vmPayload(send, point, draft)
  return {operation:draft.operation,point,payload}
}
export async function submitPreparedRestore(send: RecoverySend, sourceKey: string, prepared:Awaited<ReturnType<typeof prepareRestore>>, saveReceipt?: typeof saveEntireRestore) {
  const {operation,point,payload}=prepared
  const isFiles=operation==='StartFlrRestore'
  const result = await send(endpoints[operation], { method: 'POST', body: payload, mutation: true })
  const session = z.object({ id: z.string().uuid().optional(), sessionId: z.string().uuid().optional(),
    state: z.string().optional(), sessionType: z.string().optional(), mountErrors: z.array(z.object({ type: z.string(), message: z.string() })).optional() }).safeParse(result)
  const id = session.success ? (isFiles ? session.data.sessionId : session.data.id) : null
  if (!session.success || !id || !validId(id)) throw new VbrRecoveryError('VBR accepted the operation but returned no session ID. Check Sessions before trying again.', 502, true)
  if (saveReceipt && ['StartEntireVmRestore','StartEntireVmRestoreHyperV','StartEntireVmRestoreCloudDirector'].includes(operation)) {
    await saveReceipt(sourceKey, id, point, payload).catch(() => {})
  }
  return { id, sourceKey, sessionType: session.data.sessionType, state: session.data.state, mountErrors: session.data.mountErrors }
}
export async function startRestore(send:RecoverySend,sourceKey:string,draft:Draft,saveReceipt?:typeof saveEntireRestore,open?:PrivateFlrConnection) {
  return submitPreparedRestore(send,sourceKey,await prepareRestore(send,sourceKey,draft,open),saveReceipt)
}
