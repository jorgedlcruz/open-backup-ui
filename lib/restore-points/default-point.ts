// Open Backup UI v1.2.0
import {pointTime,type RestorePoint} from './model'
import {eligibleMethods,pointOperations,type PickedVm,type PickerScope,type RecoveryKind,type RecoveryObject,type RecoverySeed} from './recovery-picker'

export type RecoverySelection={object:RecoveryObject;point?:RestorePoint;operation?:PickedVm['operation'];seed?:RecoverySeed}

export function suggestedOperation(point:RestorePoint,kind:RecoveryKind){
  const offered=pointOperations(point,kind)
  const local=point.platformName?.toLowerCase().replace('-','')
  const preferred=local==='hyperv'?(kind==='instant-vm'?'StartHvVMInstantRecovery':'StartEntireVmRestoreHyperV')
    :local==='clouddirector'?'StartEntireVmRestoreCloudDirector':kind==='instant-vm'?'StartViVMInstantRecovery':'StartEntireVmRestore'
  return offered.find(op=>op===preferred)||offered[0]
}

/** Default only an untouched selection. A missing linked point must never silently become another point. */
export function latestDefaultPoint(selection:RecoverySelection,scope:PickerScope,points:RestorePoint[]):RestorePoint|undefined{
  if(selection.point||selection.seed?.restorePointId)return undefined
  return points.filter(point=>pointTime(point)!==null&&(!selection.seed?.backupId||point.backupId===selection.seed.backupId)&&
    eligibleMethods(selection.object,point,scope).length>0)
    .sort((a,b)=>pointTime(b)!-pointTime(a)!||a.id.localeCompare(b.id)||a.backupId.localeCompare(b.backupId))[0]
}

/** Ignore late responses after a manual choice, removal, or another selection of the same workload. */
export function applyDefaultPoint(current:RecoverySelection[],original:RecoverySelection,scope:PickerScope,points:RestorePoint[]):RecoverySelection[]{
  if(!current.includes(original))return current
  const point=latestDefaultPoint(original,scope,points)
  if(!point)return current
  return current.map(item=>item===original?{...item,point}:item)
}
