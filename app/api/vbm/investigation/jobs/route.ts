import { NextRequest } from 'next/server'
import { withVbmRead } from '@/lib/server/vbm-read'
import { loadJobs } from '@/lib/vbm-jobs/load'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  const days=request.nextUrl.searchParams.get('days')
  return withVbmRead(request,(read,source)=>loadJobs(read,source,days==='30' ? '30':days==='all' ? 'all':'7'))
}
