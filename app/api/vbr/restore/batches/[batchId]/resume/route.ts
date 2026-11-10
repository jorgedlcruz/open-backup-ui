// Open Backup UI v1.0.2
import {after,NextRequest} from 'next/server'
import {z} from 'zod'
import {withVbrRecovery} from '@/lib/server/vbr-recovery'
import {restoreBatches} from '@/lib/server/restore-batches'
import {runVmBatch} from '@/lib/recovery/run-vm-batch'
import {checkSource,VbrRecoveryError} from '@/lib/recovery/error'

export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{batchId:string}>}){
  return withVbrRecovery(request,async({send,sourceKey,cacheKey})=>{
    const bound=z.object({sourceKey:z.string()}).safeParse(await request.json().catch(()=>null))
    const id=z.string().uuid().safeParse((await params).batchId)
    if(!bound.success||!id.success)throw new VbrRecoveryError('Invalid recovery batch.')
    checkSource(bound.data.sourceKey,sourceKey)
    await send('/api/v1/serverInfo')
    const scope={sourceKey,cacheKey},{receipt,runner}=await restoreBatches.resume(scope,id.data)
    if(runner)after(()=>runVmBatch(restoreBatches,scope,id.data,runner,send))
    return receipt
  },{backgroundRestore:true})
}
