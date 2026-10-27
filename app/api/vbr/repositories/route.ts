import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadRepositoryInventory } from '@/lib/repositories/load-inventory'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  return withVbrRead(request, (read, source) => loadRepositoryInventory(read, source))
}
