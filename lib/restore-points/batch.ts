// Open Backup UI v1.2.0
import type {RestoreDraft} from './workflow'

export const vmBatchOperations=['StartViVMInstantRecovery','StartHvVMInstantRecovery','StartEntireVmRestore','StartEntireVmRestoreHyperV','StartEntireVmRestoreCloudDirector'] as const
export type VmBatchOperation=typeof vmBatchOperations[number]
export type BatchStatus='queued'|'submitting'|'accepted'|'failed'|'unknown'|'notStarted'
export type BatchItem={objectId:string;restorePointId:string;backupId:string;name:string;targetName:string;operation:VmBatchOperation;
  pointTime?:string;targetHost?:string;targetFolder?:string;targetDatastore?:string;writeCacheDatastore?:string;storagePath?:string;
  mode:'OriginalLocation'|'Customized';status:BatchStatus;sessionId?:string;sessionType?:string;message?:string}
export type BatchReceipt={id:string;sourceKey:string;createdAt:string;updatedAt:string;kind:'instant'|'entire';items:BatchItem[]}
export type BatchInput={sourceKey:string;batchId:string;items:{objectId:string;name?:string;draft:RestoreDraft}[]}
export const vmBatchKind=(operation:VmBatchOperation)=>operation==='StartViVMInstantRecovery'||operation==='StartHvVMInstantRecovery'?'instant':'entire'
