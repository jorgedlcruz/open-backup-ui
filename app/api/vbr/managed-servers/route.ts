import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadServerInventory } from '@/lib/managed-servers/load'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  return withVbrRead(request, (read, source) => loadServerInventory(read, source))
}
