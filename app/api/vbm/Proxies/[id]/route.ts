import { NextRequest,NextResponse } from 'next/server'
import { withVbmProxyAction } from '@/lib/server/vbm-read'
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params
  const body=await request.json().catch(()=>null)
  if(!body || typeof body!=='object')return NextResponse.json({error:'Invalid proxy action.'},{status:400})
  return withVbmProxyAction(request,id,body.action,body.credentials)
}
