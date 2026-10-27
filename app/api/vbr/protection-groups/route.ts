import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadProtectionInventory } from '@/lib/protection-groups/load'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  return withVbrRead(request, (read, source) => loadProtectionInventory(read, source))
}
