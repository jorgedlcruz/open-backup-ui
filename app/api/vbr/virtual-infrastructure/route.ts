// Open Backup UI v1.3.0
import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadVirtualInventory, searchVirtualInventory } from '@/lib/virtual-infrastructure/load'

export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  return withVbrRead(request,async(read,source,browse,context)=>{
    if(request.nextUrl.searchParams.has('platform'))
      return searchVirtualInventory(browse,await context.getRevision(),request.nextUrl.searchParams)
    const revision=await context.getRevision().catch(()=>'1.3-rev0' as const)
    return loadVirtualInventory(read,browse,source,revision)
  })
}
