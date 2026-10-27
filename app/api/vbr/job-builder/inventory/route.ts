import { NextRequest,NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadInventory } from '@/lib/job-builder/load'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  const host=request.nextUrl.searchParams.get('host')||'',platform=request.nextUrl.searchParams.get('platform')
  if(!host||host.length>500||!['VSphere','HyperV'].includes(platform||''))return NextResponse.json({error:'Select a supported platform and inventory server.'},{status:400})
  return withVbrRead(request,async(read,_name,browse,context)=>({...await loadInventory(read,browse,host,platform as 'VSphere'|'HyperV'),sourceKey:context.sourceKey}))
}
