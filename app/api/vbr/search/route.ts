import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadVbrSearch } from '@/lib/search/load'
import { searchCache } from '@/lib/search/cache'
import { searchIndex, searchScopes, type SearchScope } from '@/lib/search/model'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get('q') || '').trim()
  const scope = request.nextUrl.searchParams.get('scope') || 'all'
  if (!searchScopes.includes(scope as SearchScope)) return NextResponse.json({ error: 'Invalid search type.' }, { status: 400 })
  if (query.length < 2 || query.length > 200) return NextResponse.json({ error: 'Enter between 2 and 200 characters.' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })
  return withVbrRead(request, async (read, _source, _inventory, context) => searchIndex(
    await searchCache.read(`vbr:spotlight:${context.cacheKey}`, () => loadVbrSearch(read), request.signal, request.nextUrl.searchParams.get('refresh') === '1'), query, 20, scope as SearchScope,
  ))
}
