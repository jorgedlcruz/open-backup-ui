// Open Backup UI v1.2.0
import { after, NextRequest } from 'next/server'
import { z } from 'zod'
import { withVbrRecovery, VbrRecoveryError } from '@/lib/server/vbr-recovery'
import { draftSchema, prepareRestore, submitPreparedRestore, checkPointOperation } from '@/lib/recovery/start'
import { findPoint } from '@/lib/recovery/options'
import { checkSource } from '@/lib/recovery/error'
import { saveEntireRestore } from '@/lib/server/entire-restore-records'
import { restoreStarts } from '@/lib/server/restore-starts'

export const dynamic = 'force-dynamic'
const requestSchema=draftSchema.extend({requestId:z.string().uuid().transform(value=>value.toLowerCase())})
const address=z.object({sourceKey:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.string().uuid().transform(value=>value.toLowerCase())})

export function POST(request: NextRequest) {
  return withVbrRecovery(request, async ({ send, sourceKey, cacheKey, getExplorer }) => {
    const input = requestSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) throw new VbrRecoveryError(input.error.issues.map(issue => issue.message).join(' ').slice(0, 1000))
    const {requestId,...draft}=input.data
    checkSource(draft.sourceKey,sourceKey)
    await send('/api/v1/serverInfo')
    return restoreStarts.submit({sourceKey,cacheKey,requestId},draft.operation,draft,after,async()=>{
      const prepared=await prepareRestore(send,sourceKey,draft,()=>getExplorer().send)
      checkPointOperation(await findPoint(send,draft.restorePointId,draft.backupId),draft)
      return ()=>submitPreparedRestore(send,sourceKey,prepared,saveEntireRestore)
    })
  },{backgroundRestore:true})
}

export function GET(request:NextRequest){
  return withVbrRecovery(request,async({send,sourceKey,cacheKey})=>{
    const input=address.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if(!input.success)throw new VbrRecoveryError('Invalid recovery request.')
    checkSource(input.data.sourceKey,sourceKey)
    await send('/api/v1/serverInfo')
    return restoreStarts.observe({sourceKey,cacheKey,requestId:input.data.requestId})
  })
}
