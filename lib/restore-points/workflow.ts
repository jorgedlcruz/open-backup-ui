// Open Backup UI v1.0.2
import type { RestorePoint } from './model'

export const restoreOperations = [
  'StartViVMInstantRecovery', 'StartEntireVmRestore', 'StartHvVMInstantRecovery',
  'StartEntireVmRestoreHyperV', 'StartEntireVmRestoreCloudDirector', 'StartFCDInstantRecovery',
  'StartFlrRestore', 'StartDiskPublish',
] as const

export type RestoreOperation = typeof restoreOperations[number]
export function isRestoreOperation(value: string): value is RestoreOperation {
  return restoreOperations.some(operation => operation === value)
}
export type RestorePlatform = 'VSphere' | 'HyperV'
export type InventoryKind = 'Server' | 'Host' | 'ResourcePool' | 'Folder' | 'Datastore' | 'Cluster' | 'VirtualMachine' | 'Network'
export type RestoreInventoryItem = {
  type: string
  platform: string
  hostName: string
  name: string
  objectId?: string
  urn?: string
}
export type RestoreInventoryPage = {
  sourceKey: string
  data: RestoreInventoryItem[]
  pagination: { skip: number; count: number; total: number; limit: number }
}
export type RestoreOptions = {
  point: RestorePoint
  sourceKey: string
  disks: { uid: string; name: string }[]
  mountServers: { id: string; name: string; type: string }[]
  credentials?: {id: string; name: string}[]
  networks?: {id: string; name: string}[]
  warnings?: string[]
}
export type RestoreTarget = {
  host?: RestoreInventoryItem
  cluster?: RestoreInventoryItem
  resourcePool?: RestoreInventoryItem
  folder?: RestoreInventoryItem
  datastore?: RestoreInventoryItem
  vmName?: string
  storagePath?: string
}
export type RestoreDraft = {
  sourceKey: string
  restorePointId: string
  backupId: string
  operation: RestoreOperation
  mode: 'OriginalLocation' | 'Customized'
  reason?: string
  target?: RestoreTarget
  disks?: {uid: string; mountedName: string; registeredName: string}[]
  powerUp?: boolean
  nicsEnabled?: boolean
  networkMode?: 'Original' | 'Disconnected' | 'Mapped'
  networkMappings?: {sourceId: string; target?: RestoreInventoryItem}[]
  overwrite?: boolean
  restoreTags?: boolean
  quickRollback?: boolean
  antivirusScan?: boolean
  reviewedMalwareStatus?: string
  guestOs?: 'Windows' | 'Linux'
  mountServerId?: string
  credentialsId?: string
  allowedIps?: string[]
}
export type RestoreResult = { id: string; sourceKey: string; state?: string; sessionType?: string; mountErrors?: {type: string; message: string}[] }

export type GuestFile = { name: string; displayName?: string; location?: string; type: 'Drive' | 'Folder' | 'File' | 'Link'; size?: number }
export type GuestDirectory = {
  path: string; pathSeparator: string; items: GuestFile[]; guestOs: string
  pagination: { skip: number; count: number; total: number; limit: number }
  credentials?: {id: string; name: string}[]
}
export type GuestRestoreRequest = {
  action: 'restore' | 'unmount'; sessionId: string; sourceKey: string
  sourcePaths?: string[]; restoreType?: 'Keep' | 'Overwrite' | 'PermissionOnly'
  targetPath?: string; targetHost?: RestoreInventoryItem; credentialsId?: string
}
export type GuestTask = { id?: string; state?: string; result?: string; progressPercent?: number }
export type GuestSearch = GuestTask & { id: string; searchKey: string }
export type GuestDownload = GuestTask & { id: string; downloadKey: string; count?: number; bearerOnly?: boolean }

export const uncertainRestore = (error: unknown) => error instanceof TypeError ||
  (error instanceof Error && 'uncertain' in error && error.uncertain === true)

export function guestItemPath(item: GuestFile, directory: GuestDirectory) {
  const parent = item.location || directory.path
  const separator = directory.pathSeparator
  if (item.type === 'Drive' || !parent) {
    return item.type === 'Drive' && /^[a-z]:$/i.test(item.name) ? item.name + separator : item.name
  }
  return parent.endsWith(separator) ? parent + item.name : parent + separator + item.name
}

export function restoreActivityUrl(sessionId: string, sourceKey: string) {
  return '/vbr/activity/' + encodeURIComponent(sessionId) + '?' + new URLSearchParams({sourceKey})
}
