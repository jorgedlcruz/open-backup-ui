// Open Backup UI v1.0.2
import type {RestoreOperation} from './workflow'
import type {RestorePoint} from './model'

export const recoveryKinds=['instant-vm','entire-vm','guest-files','sql','active-directory','instant-disk','publish-disks'] as const
export type RecoveryKind=typeof recoveryKinds[number]
export const recoveryKindLabel:Record<RecoveryKind,string>={
  'instant-vm':'Instant VM Recovery','entire-vm':'Entire VM restore','guest-files':'Guest file restore',
  sql:'Microsoft SQL Server','active-directory':'Microsoft Active Directory','instant-disk':'First Class Disk recovery','publish-disks':'Publish disks',
}
const operationKind:Record<RestoreOperation,RecoveryKind>={
  StartViVMInstantRecovery:'instant-vm',StartHvVMInstantRecovery:'instant-vm',
  StartEntireVmRestore:'entire-vm',StartEntireVmRestoreHyperV:'entire-vm',StartEntireVmRestoreCloudDirector:'entire-vm',
  StartFlrRestore:'guest-files',StartFCDInstantRecovery:'instant-disk',StartDiskPublish:'publish-disks',
}
export const bulkKind=(kind:RecoveryKind)=>kind==='instant-vm'||kind==='entire-vm'
export const isRecoveryKind=(kind:unknown):kind is RecoveryKind=>recoveryKinds.some(k=>k===kind)
export function pointOperations(point:RestorePoint,kind:RecoveryKind) {
  return (point.allowedOperations||[]).filter((op):op is RestoreOperation=>operationKind[op as RestoreOperation]===kind)
}
export type RecoveryObject={objectId:string;name:string;platform:string;distinguishingLocation?:string;copies:{backupId:string;name:string;kinds:RecoveryKind[]}[]}
export type RecoverySeed={objectId:string;backupId?:string;restorePointId?:string}
export type PickerPage<T>={sourceKey:string;data:T[];total:number;complete:boolean;notices:string[]}
export type PickedVm={object:RecoveryObject;point:RestorePoint;operation?:RestoreOperation}
