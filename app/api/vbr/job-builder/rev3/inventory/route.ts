// Open Backup UI v1.3.0
import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { withVbrRead } from '@/lib/server/vbr-read'
import { requireRev3 } from '@/lib/job-builder/rev3-requests'
import { pluginObjects,pluginOptions,pluginPlatforms } from '@/lib/job-builder/platform-job-options'
export const dynamic='force-dynamic'
export function GET(request:NextRequest){
  const params=request.nextUrl.searchParams
  const platform=z.enum(pluginPlatforms).safeParse(params.get('platform')),skip=z.coerce.number().int().min(0).max(1_000_000).safeParse(params.get('skip')||0)
  if(!platform.success || !skip.success)return NextResponse.json({error:'Invalid inventory selection.'},{status:400})
  return withVbrRead(request,async(read,_name,browse,context)=>{
    requireRev3(await context.getRevision(),context.sourceKey,params.get('sourceKey'))
    const host=params.get('host')
    return host?pluginObjects(browse,platform.data,host,skip.data):pluginOptions(read,browse,platform.data)
  })
}
