import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadOperations } from '@/lib/operations/load'
import { recordCapacity } from '@/lib/server/capacity-history'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const range = request.nextUrl.searchParams.get('range') || '24h'
  if (range !== '24h' && range !== '7d' && range !== '30d') {
    return NextResponse.json({ error: 'Choose a 24h, 7d or 30d history window.' }, { status: 400 })
  }
  return withVbrRead(request, async (read, sourceName, _inventory, context) => {
    const snapshot = await loadOperations(read, sourceName, range)
    try { await recordCapacity(context.cacheKey, snapshot.repositories.data) }
    catch { snapshot.warnings.push('Capacity history recording is unavailable; current repository readings are unaffected.') }
    return snapshot
  })
}
