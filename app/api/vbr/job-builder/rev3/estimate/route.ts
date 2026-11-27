// Open Backup UI v1.3.0
import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { withVbrRead } from '@/lib/server/vbr-read'
import { isSameApplicationOrigin } from '@/lib/server/request-origin'
import { draftSchema,compileJob } from '@/lib/job-builder/model'
import { requireRev3 } from '@/lib/job-builder/rev3-requests'
import { normalizedEstimate } from '@/lib/job-builder/rev3-validation'
import { sendRev3Job } from '@/lib/server/vbr-rev3-jobs'
export const dynamic='force-dynamic'

export function GET(request:NextRequest){
  const id=z.string().uuid().safeParse(request.nextUrl.searchParams.get('task'))
  if(!id.success)return NextResponse.json({error:'Invalid size calculation task.'},{status:400})
  return withVbrRead(request,async(read,_name,_browse,context)=>{
    requireRev3(await context.getRevision(),context.sourceKey,request.nextUrl.searchParams.get('sourceKey'))
    const result=normalizedEstimate(await read('/api/v1/tasks/'+id.data,'1.3-rev3'))
    if(result.id!==id.data)throw Error('The size calculation task changed.')
    return result
  })
}
export async function POST(request:NextRequest){
  if(!isSameApplicationOrigin(request))return NextResponse.json({error:'Size calculation must come from this application.'},{status:403})
  const draft=draftSchema.safeParse(await request.json().catch(()=>null))
  if(!draft.success)return NextResponse.json({error:'Review the job scope before calculating its size.'},{status:400})
  const scope=await withVbrRead(request,async(_read,_name,_browse,context)=>{
    requireRev3(await context.getRevision(),context.sourceKey,draft.data.sourceKey)
    return {valid:true}
  })
  if(!scope.ok)return scope
  const {type,virtualMachines}=compileJob(draft.data)
  return sendRev3Job(request,draft.data.sourceKey,'estimate',{type,virtualMachines})
}
