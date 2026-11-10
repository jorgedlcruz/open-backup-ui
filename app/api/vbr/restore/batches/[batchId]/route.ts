// Open Backup UI v1.2.0
import {NextRequest} from 'next/server'
import {z} from 'zod'
import {withVbrRecovery} from '@/lib/server/vbr-recovery'
import {restoreBatches} from '@/lib/server/restore-batches'
import {checkSource,VbrRecoveryError} from '@/lib/recovery/error'

export const dynamic='force-dynamic'
export async function GET(request:NextRequest,{params}:{params:Promise<{batchId:string}>}){
  return withVbrRecovery(request,async({send,sourceKey,cacheKey})=>{
    checkSource(request.nextUrl.searchParams.get('sourceKey')||'',sourceKey)
    const id=z.string().uuid().safeParse((await params).batchId)
    if(!id.success)throw new VbrRecoveryError('Invalid recovery batch.')
    await send('/api/v1/serverInfo')
    return restoreBatches.get({sourceKey,cacheKey},id.data)
  })
}
