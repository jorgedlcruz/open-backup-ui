import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadRansomware } from '@/lib/ransomware/load'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  return withVbrRead(request, (read, sourceName) => loadRansomware(read, sourceName))
}
