import { NextRequest,NextResponse } from 'next/server'
import { draftSchema } from '@/lib/job-builder/model'
import { loadOptions,validateEnvironment } from '@/lib/job-builder/load'
import { withVbrRead,type VbrRevision } from '@/lib/server/vbr-read'
import { createVbrJob } from '@/lib/server/vbr-job-create'
import { isSameApplicationOrigin } from '@/lib/server/request-origin'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest) {
  if(!isSameApplicationOrigin(request))return NextResponse.json({error:'Job creation must come from this application.'},{status:403})
  const parsed=draftSchema.safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues.map(e=>e.message).join(' ')},{status:400})
  let apiRevision:VbrRevision|undefined
  const check=await withVbrRead(request,async(read,name,browse,context)=>{
    const options=await loadOptions(read,browse,name,context.sourceKey),errors=await validateEnvironment(parsed.data,read,browse,options)
    if(!errors.length)apiRevision=options.apiRevision
    return {errors}
  })
  if(!check.ok)return check
  const result=await check.json()
  if(!apiRevision)return NextResponse.json({error:result.errors.join(' ')},{status:400})
  return createVbrJob(request,parsed.data,apiRevision)
}
