import { NextRequest, NextResponse } from 'next/server'
import { mutateSource } from '@/lib/server/data-sources'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string;action:string}>}) {
  const {id,action}=await params
  if(action!=='connect' && action!=='disconnect')return NextResponse.json({error:'Unknown data-source action.'},{status:400})
  return mutateSource(request,action,id)
}
