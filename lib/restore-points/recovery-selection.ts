// Open Backup UI v1.2.0
import type {RecoveryKind} from './recovery-picker'
import { validId } from '../investigation/model'
import { recoveryCenterPath } from '../navigation/recovery'
import type { PointEvidence } from './model'
import { vmBatchOperations, vmBatchKind } from './batch'

export type MultiVmKind = 'instant-vm' | 'entire-vm'
export type PointSelection = { objectId:string; backupId:string; restorePointId:string }

export function multiVmKind(operation: string): MultiVmKind | undefined {
  const supported = vmBatchOperations.find(item => item === operation)
  if (supported) return vmBatchKind(supported) === 'instant' ? 'instant-vm' : 'entire-vm'
}

export function pointSelection(row: PointEvidence, scopedObjectId?: string): PointSelection | undefined {
  const {point} = row
  if (/Physical|UnstructuredData/i.test(point.platformName||''))return
  if (!validId(point.id) || !validId(point.backupId) || !point.allowedOperations?.some(multiVmKind)) return
  const candidates = new Set<string>()
  if (point.verifiedObjectId === null) return
  if (point.verifiedObjectId) candidates.add(point.verifiedObjectId.toLowerCase())
  if (validId(scopedObjectId)) candidates.add(scopedObjectId.toLowerCase())
  for (const application of point.applications ?? []) candidates.add(application.objectId.toLowerCase())
  if (row.mapping === 'confirmed' && row.file?.objectIds?.length === 1 && validId(row.file.objectIds[0])) {
    candidates.add(row.file.objectIds[0].toLowerCase())
  }
  if (candidates.size !== 1) return
  const [objectId] = candidates
  if (validId(objectId)) return {objectId, backupId:point.backupId, restorePointId:point.id}
}

export function recoveryPickerHref(kind: RecoveryKind, sourceKey: string, items: PointSelection[]) {
  const query = new URLSearchParams({recover:kind, sourceKey})
  if (items.length === 1) {
    for (const [name,value] of Object.entries(items[0])) query.set(name,value)
  } else {
    for (const item of items) query.append('point',[item.objectId,item.backupId,item.restorePointId].join('.'))
  }
  return recoveryCenterPath + '?' + query
}
