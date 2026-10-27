import { NextRequest } from 'next/server'
import { withVbmRead } from '@/lib/server/vbm-read'
import { loadDashboard } from '@/lib/vbm-dashboard/load'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  const days=request.nextUrl.searchParams.get('days')==='30' ? 30 : 7
  return withVbmRead(request,(read,source)=>loadDashboard(read,source,days))
}
