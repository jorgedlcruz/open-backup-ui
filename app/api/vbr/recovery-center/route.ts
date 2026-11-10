// Open Backup UI v1.0.2
import {NextRequest,NextResponse} from 'next/server'
import {loadRecoverySnapshot,recoveryPageQuery} from '@/lib/recovery-center/load'
import {withVbrRead} from '@/lib/server/vbr-read'
import {restoreBatches} from '@/lib/server/restore-batches'
import {TopologyRequestError} from '@/lib/topology/load'

export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  const parsed=recoveryPageQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if(!parsed.success)return NextResponse.json({error:'Invalid activity filter.'},{status:400})
  return withVbrRead(request,async(read,sourceName,_inventory,{sourceKey,cacheKey,publishedRecoveries})=>{
    const query=parsed.data
    if(query.sourceKey&&query.sourceKey!==sourceKey)throw new TopologyRequestError('The connected VBR source changed. Reopen this workflow.',409)
    const page=await loadRecoverySnapshot(read,publishedRecoveries,query)
    // Only merge the account's local queue after a live, authenticated VBR read.
    const batches=query.skip?[]:await restoreBatches.list({sourceKey,cacheKey}).catch(()=>{
      page.warnings.push('Mass recovery');return []
    })
    return {...page,sourceKey,sourceName,batches:batches.map(({id,sourceKey,createdAt,items})=>({id,sourceKey,createdAt,
      items:items.map(({objectId,name,targetName,operation,status,sessionId,sessionType})=>({objectId,name,targetName,operation,status,sessionId,sessionType}))}))}
  })
}
