// Open Backup UI v1.3.0
import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadOptions } from '@/lib/job-builder/load'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  return withVbrRead(request,async(read,name,browse,context)=>{
    const revision=await context.getRevision().catch(()=>undefined)
    const options=await loadOptions(read,browse,name,context.sourceKey,revision)
    return {...options,hasSourceSizeEstimate:revision==='1.3-rev3'}
  })
}
