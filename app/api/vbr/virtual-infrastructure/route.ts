import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadVirtualInventory } from '@/lib/virtual-infrastructure/load'

export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  return withVbrRead(request,(read,source,browse)=>loadVirtualInventory(read,browse,source))
}
