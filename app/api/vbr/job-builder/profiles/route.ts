import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { withVbrRead } from '@/lib/server/vbr-read'
import { jobProfiles } from '@/lib/server/job-profiles'
import { profileInput } from '@/lib/job-builder/model'
import { isSameApplicationOrigin } from '@/lib/server/request-origin'
import { TopologyRequestError } from '@/lib/topology/load'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {return withVbrRead(request,async(_read,name,_browse,context)=>({sourceName:name,sourceKey:context.sourceKey,profiles:await jobProfiles.list(context.sourceKey)}))}
const input=z.object({sourceKey:z.string(),profile:profileInput,id:z.string().uuid().optional(),revision:z.number().int().positive().optional()}).strict()
export async function POST(request:NextRequest) {
  if(!isSameApplicationOrigin(request))return NextResponse.json({error:'Profile changes must come from this application.'},{status:403})
  const parsed=input.safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues.map(e=>e.message).join(' ')},{status:400})
  return withVbrRead(request,async(_read,_name,_browse,context)=>{
    if(parsed.data.sourceKey!==context.sourceKey)throw new TopologyRequestError('The selected VBR source changed. Reload the library.',409)
    const {profile,id,revision}=parsed.data
    return {profile:await jobProfiles.save(context.sourceKey,profile,id,revision)}
  })
}
