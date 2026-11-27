// Open Backup UI v1.3.0
import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { withVbrRead } from '@/lib/server/vbr-read'
import { isSameApplicationOrigin } from '@/lib/server/request-origin'
import { supportedJob } from '@/lib/job-builder/native-job-types'
import { requireRev3,jobInput,readNativeJob,checkNativeRequest } from '@/lib/job-builder/rev3-requests'
import { TopologyRequestError } from '@/lib/topology/load'
import { sendRev3Job } from '@/lib/server/vbr-rev3-jobs'
export const dynamic='force-dynamic'

export async function GET(request:NextRequest){
  const params=request.nextUrl.searchParams
  return withVbrRead(request,async(read,sourceName,_browse,context)=>{
    const revision=await context.getRevision()
    if(params.get('capabilities')==='true')return {sourceKey:context.sourceKey,revision}
    requireRev3(revision,context.sourceKey)
    const type=params.get('type'), id=params.get('id')
    if(!supportedJob(type)||id!==null&&!z.string().uuid().safeParse(id).success)throw new TopologyRequestError('Invalid job selection.',400)
    return {sourceName,revision,sourceKey:context.sourceKey,...(id?await readNativeJob(read,type,id):{})}
  })
}
export async function POST(request:NextRequest){
  if(!isSameApplicationOrigin(request))return NextResponse.json({error:'Job changes must come from this application.'},{status:403})
  const text=await request.text()
  if(text.length>1024*1024)return NextResponse.json({error:'Job settings exceed the size limit.'},{status:413})
  let parsed:unknown
  try{parsed=JSON.parse(text)}catch{return NextResponse.json({error:'Invalid job JSON.'},{status:400})}
  const input=jobInput.safeParse(parsed)
  if(!input.success)return NextResponse.json({error:'Invalid job request.'},{status:400})
  const {data}=input
  const check=await withVbrRead(request,async(read,_name,_browse,context)=>{
    requireRev3(await context.getRevision(),context.sourceKey,data.sourceKey)
    await checkNativeRequest(data,read)
    return {valid:true}
  })
  if(!check.ok||data.action==='validate')return check
  return sendRev3Job(request,data.sourceKey,data.id?'edit':'create',data.job,data.id)
}
