// Open Backup UI v1.0.2
import type {RestoreOperation} from './workflow'
import type {RestorePoint} from './model'

export const recoveryKinds=['instant-vm','entire-vm','guest-files','sql','active-directory','instant-disk','publish-disks',
  'nas-files','nas-entire','nas-rollback','nas-instant','object-files','object-entire','object-rollback','agent-volumes'] as const
export type RecoveryKind=typeof recoveryKinds[number]
export const recoveryGoals=['machines','files','apps','disks'] as const
export type RecoveryGoal=typeof recoveryGoals[number]
export const pickerScopes=[...recoveryKinds,...recoveryGoals] as const
export type PickerScope=typeof pickerScopes[number]
export const goalLabel:Record<RecoveryGoal,string>={
  machines:'Entire workload', files:'Files, folders and objects', apps:'Application items', disks:'Disks and volumes',
}
const goalKinds:Record<RecoveryGoal,RecoveryKind[]>={
  machines:['instant-vm','entire-vm','nas-entire','nas-instant','nas-rollback','object-entire','object-rollback','agent-volumes'],
  files:['guest-files','nas-files','object-files'], apps:['sql','active-directory'], disks:['instant-disk','publish-disks','agent-volumes'],
}
export type GoalAvailability={goal:RecoveryGoal;kinds:RecoveryKind[];count:number;workloadTypes:WorkloadType[]}
export function scopeKinds(scope:PickerScope):RecoveryKind[]{
  return isRecoveryKind(scope)?[scope]:goalKinds[scope]
}
export const recoveryKindLabel:Record<RecoveryKind,string>={
  'instant-vm':'Instant VM Recovery','entire-vm':'Entire VM restore','guest-files':'Guest file restore',
  sql:'Microsoft SQL Server','active-directory':'Microsoft Active Directory','instant-disk':'First Class Disk recovery','publish-disks':'Publish disks',
  'nas-files':'Restore files and folders','nas-entire':'Restore entire file share','nas-rollback':'Roll back file share','nas-instant':'Instant file share recovery',
  'object-files':'Restore objects','object-entire':'Restore entire object storage','object-rollback':'Roll back object storage','agent-volumes':'Volume recovery and recovery tools',
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
export type WorkloadType='vm'|'physical'|'nas'|'object'
export type RecoveryObject={objectId:string;name:string;platform:string;workloadType?:WorkloadType;displayPath?:string;distinguishingLocation?:string;copies:{
  backupId:string;name:string;kinds:RecoveryKind[];agentPointIds?:string[]
}[]}
export const isUnstructuredKind=(kind:RecoveryKind):kind is Extract<RecoveryKind,`nas-${string}`|`object-${string}`>=>kind.startsWith('nas-')||kind.startsWith('object-')
export function eligibleMethods(object:RecoveryObject,point:RestorePoint,scope:PickerScope){
  const copy=object.copies.find(candidate=>candidate.backupId===point.backupId)
  if(!copy)return []
  return scopeKinds(scope).filter(kind=>copy.kinds.includes(kind)&&(
    kind==='active-directory'||kind==='sql'?point.applications?.some(a=>a.objectId===object.objectId&&a.kind===(kind==='sql'?'sql':'activeDirectory')):
      point.recoveryKinds?.includes(kind)||pointOperations(point,kind).length>0))
}
export type RecoverySeed={objectId:string;backupId?:string;restorePointId?:string}
export type CalendarDay={day:string;count:number}
export type PickerPage<T>={sourceKey:string;data:T[];total:number;complete:boolean;notices:string[];snapshotId?:string;calendarDays?:CalendarDay[];calendarDay?:string}
export type PickedVm={object:RecoveryObject;point:RestorePoint;operation?:RestoreOperation}
