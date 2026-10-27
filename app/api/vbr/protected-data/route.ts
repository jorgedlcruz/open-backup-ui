import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadProtectedData, loadProtectedRecoveryTimes } from '@/lib/protected-data/load'
import { protectedDataCache } from '@/lib/protected-data/cache'

export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  const operations=request.nextUrl.searchParams.get('operations')==='true'
  return withVbrRead(request,(read,source,_inventory,context)=>operations
    ? protectedDataCache.read(context.cacheKey,()=>loadProtectedData(read,source),base=>loadProtectedRecoveryTimes(read,base),{
      recovery:request.nextUrl.searchParams.get('recoveryTimes')==='true',force:request.nextUrl.searchParams.get('refresh')==='true',
    })
    : loadProtectedData(read,source,false,new Date(),false))
}
