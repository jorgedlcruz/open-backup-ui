import { NextRequest,NextResponse } from 'next/server'
import { draftSchema,compileJob } from '@/lib/job-builder/model'
import { loadOptions,validateEnvironment } from '@/lib/job-builder/load'
import { withVbrRead } from '@/lib/server/vbr-read'
import { isSameApplicationOrigin } from '@/lib/server/request-origin'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest) {
  if(!isSameApplicationOrigin(request))return NextResponse.json({error:'Validation must come from this application.'},{status:403})
  const parsed=draftSchema.safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues.map(e=>`${e.path.join('.')}: ${e.message}`).join(' ')},{status:400})
  return withVbrRead(request,async(read,name,browse,context)=>{
    const options=await loadOptions(read,browse,name,context.sourceKey),errors=await validateEnvironment(parsed.data,read,browse,options)
    return {valid:!errors.length,errors,warnings:options.warnings,checkedAt:new Date().toISOString(),apiRevision:options.apiRevision,payload:compileJob(parsed.data)}
  })
}
