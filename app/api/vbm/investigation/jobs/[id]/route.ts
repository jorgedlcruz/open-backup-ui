import { NextRequest } from 'next/server'
import { withVbmRead } from '@/lib/server/vbm-read'
import { loadJobs } from '@/lib/vbm-jobs/load'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params,days=request.nextUrl.searchParams.get('days')
  return withVbmRead(request,(read,source)=>loadJobs(read,source,days==='7' ? '7':days==='30' ? '30':'all',id))
}
