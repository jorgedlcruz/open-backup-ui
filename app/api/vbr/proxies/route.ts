import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadProxyInventory } from '@/lib/proxies/load'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  return withVbrRead(request, (read, source) => loadProxyInventory(read, source))
}
