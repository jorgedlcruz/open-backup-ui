import { NextRequest } from 'next/server'
import { withVbmJobAction } from '@/lib/server/vbm-read'
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params
  return withVbmJobAction(request,id,'disable')
}
