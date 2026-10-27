import { NextRequest } from 'next/server'
import { withVbmRead } from '@/lib/server/vbm-read'
import { loadSession } from '@/lib/vbm-jobs/load'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params
  return withVbmRead(request,(read,source)=>loadSession(read,source,id,request.nextUrl.searchParams.get('jobId') || ''))
}
