// Open Backup UI v1.3.0
import { NextRequest } from 'next/server'
import { withVbmRead } from '@/lib/server/vbm-read'
import { recoveryCandidates } from '@/lib/vbm-recovery/candidates'

export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  return withVbmRead(request,(read,source,context)=>recoveryCandidates(read,source,context.cacheKey,request.nextUrl.searchParams.get('refresh')==='1'))
}
