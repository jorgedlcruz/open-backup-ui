// Open Backup UI v1.2.0
import {z} from 'zod'
import {vmBatchKind,vmBatchOperations} from '../restore-points/batch'
import {sameRecoveryDestination,type RecoveryDestination} from '../restore-points/destination-collision'
import {VbrRecoveryError,checkSource} from './error'
import type {RecoverySend} from '../server/vbr-recovery'
import {draftSchema,prepareRestore} from './start'

const guid=z.string().uuid().transform(id=>id.toLowerCase())
const pointRef=z.object({id:guid,backupId:guid})
const vmDraft=draftSchema.pick({sourceKey:true,restorePointId:true,backupId:true,mode:true,reason:true,powerUp:true,nicsEnabled:true,overwrite:true,
  restoreTags:true,quickRollback:true,antivirusScan:true,target:true,reviewedMalwareStatus:true,networkMode:true,networkMappings:true})
  .extend({operation:z.enum(vmBatchOperations),backupId:guid,restorePointId:guid})
export const vmBatchSchema=z.object({sourceKey:draftSchema.shape.sourceKey,batchId:guid,
  items:z.array(z.object({objectId:guid,name:z.string().trim().min(1).max(512).optional(),draft:vmDraft})).min(1).max(32)})
export type VmBatch=z.infer<typeof vmBatchSchema>
export type VmBatchRow=VmBatch['items'][number]
export function checkBatchInput(batch:VmBatch,sourceKey:string) {
  checkSource(batch.sourceKey,sourceKey)
  const objects=new Set<string>(),points=new Set<string>(),kind=vmBatchKind(batch.items[0].draft.operation)
  for(const {draft,objectId} of batch.items){
    checkSource(draft.sourceKey,sourceKey)
    if(vmBatchKind(draft.operation)!==kind)throw new VbrRecoveryError('Choose one recovery method for the batch.')
    if(objects.has(objectId)||points.has(draft.restorePointId))throw new VbrRecoveryError('Choose one restore point per virtual machine.')
    objects.add(objectId);points.add(draft.restorePointId)
    if(draft.mode==='OriginalLocation' && !draft.overwrite && ['StartHvVMInstantRecovery','StartEntireVmRestoreHyperV','StartEntireVmRestoreCloudDirector'].includes(draft.operation))
      throw new VbrRecoveryError('Confirm the original VM location before starting this recovery.')
  }
}
const object=z.object({id:guid,name:z.string().min(1),type:z.string(),platformName:z.string(),platformId:z.string().nullish(),
  objectId:z.string().nullish(),path:z.string().nullish()})
const members=z.object({data:z.array(pointRef),pagination:z.object({skip:z.number().int(),total:z.number().int().nonnegative()})})
async function verifyMember(send:RecoverySend,row:VmBatchRow){
  let skip=0
  while(skip<20000){
    const page=members.parse(await send('/api/v1/backupObjects/'+row.objectId+'/restorePoints?backupIdFilter='+row.draft.backupId+'&skip='+skip+'&limit=200'))
    if(page.pagination.skip!==skip)throw new VbrRecoveryError('VBR returned a different restore-point page.',502)
    if(page.data.some(p=>p.id===row.draft.restorePointId&&p.backupId===row.draft.backupId))return
    skip+=page.data.length
    if(!page.data.length||skip>=page.pagination.total)break
  }
  throw new VbrRecoveryError('The restore point no longer belongs to this virtual machine and backup.',409)
}
const norm=(s:string|undefined|null)=>s?.trim().toLowerCase()||''
const named=z.object({name:z.string(),hostName:z.string(),objectId:z.string().nullish(),urn:z.string().nullish()}).nullish()
const placement=z.object({destinationHost:named,destination:z.object({destinationHost:named,folder:named}).optional(),
  folder:z.object({folder:named}).optional(),datastore:z.object({defaultDatastore:named,cacheDatastore:named,configurationFilesPath:z.string().optional()}).optional()})
export type Destination=RecoveryDestination
export type BatchIdentity={sourceVm:string;destination:Destination}
export function collide(a:BatchIdentity,b:BatchIdentity) {
  if(a.sourceVm===b.sourceVm)return 'Choose one restore point per virtual machine.'
  if(sameRecoveryDestination(a.destination,b.destination))
    return 'Two selected VMs would use the same destination name. Rename one of them or change its destination.'
}
export async function prepareBatchRow(send:RecoverySend,sourceKey:string,row:VmBatchRow){
  const {draft}=row
  const [vm,prepared]=await Promise.all([send('/api/v1/backupObjects/'+row.objectId).then(raw=>object.parse(raw)),
    prepareRestore(send,sourceKey,draft),verifyMember(send,row)])
  if(vm.id!==row.objectId||!['vm','virtualmachine'].includes(norm(vm.type))||vm.platformName!==prepared.point.platformName)throw new VbrRecoveryError('Select a current virtual machine on the same VBR platform.',409)
  const op=draft.operation
  if(op==='StartEntireVmRestore'&&vm.platformName!=='VMware' || op==='StartEntireVmRestoreHyperV'&&vm.platformName!=='HyperV')throw new VbrRecoveryError('The selected recovery is unavailable for this VM platform.',409)
  const sourceManager=norm(vm.path?.split(/[\\/]/).find(Boolean)),custom=draft.mode==='Customized'
  const name=prepared.point.name,targetName=custom?draft.target.vmName!:name
  const destination=placement.parse(prepared.payload)
  const host=destination.destinationHost??destination.destination?.destinationHost
  const folder=destination.folder?.folder??destination.destination?.folder
  const identity:BatchIdentity={
    sourceVm:vm.objectId?JSON.stringify([norm(vm.platformName),norm(vm.platformId),sourceManager,norm(vm.objectId)]):row.objectId,
    destination:{platform:op==='StartViVMInstantRecovery'?'vmware':op==='StartHvVMInstantRecovery'?'hyperv':norm(vm.platformName),
      manager:custom?norm(host?.hostName):sourceManager,
      folder:custom?norm(folder?.objectId||folder?.urn):'',name:norm(targetName)},
  }
  return {prepared,name,targetName,identity,placement:{pointTime:prepared.point.creationTime,
    targetHost:host?.name,targetFolder:folder?.name,
    targetDatastore:destination.datastore?.defaultDatastore?.name,writeCacheDatastore:destination.datastore?.cacheDatastore?.name,
    storagePath:destination.datastore?.configurationFilesPath}}
}
