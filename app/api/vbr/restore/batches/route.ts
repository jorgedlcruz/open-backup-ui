// Open Backup UI v1.0.2
import {after,NextRequest} from 'next/server'
import {withVbrRecovery} from '@/lib/server/vbr-recovery'
import {restoreBatches} from '@/lib/server/restore-batches'
import {vmBatchSchema,checkBatchInput} from '@/lib/recovery/vm-batch'
import {runVmBatch} from '@/lib/recovery/run-vm-batch'
import {VbrRecoveryError} from '@/lib/recovery/error'

export const dynamic='force-dynamic'
export async function POST(request:NextRequest){
  return withVbrRecovery(request,async({send,sourceKey,cacheKey})=>{
    const parsed=vmBatchSchema.safeParse(await request.json().catch(()=>null))
    if(!parsed.success)throw new VbrRecoveryError('Review the selected VMs and restore settings.')
    const input=parsed.data,scope={sourceKey,cacheKey}
    checkBatchInput(input,sourceKey)
    await send('/api/v1/serverInfo')
    const {receipt,runner}=await restoreBatches.create(scope,input)
    if(runner)after(()=>runVmBatch(restoreBatches,scope,input.batchId,runner,send))
    return receipt
  },{backgroundRestore:true})
}
