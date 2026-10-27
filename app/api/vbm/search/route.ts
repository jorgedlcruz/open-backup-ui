import { NextRequest, NextResponse } from 'next/server'
import { withVbmRead } from '@/lib/server/vbm-read'
import { loadVbmSearch } from '@/lib/search/load'
import { searchCache } from '@/lib/search/cache'
import { searchIndex, searchScopes, type SearchScope } from '@/lib/search/model'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get('q') || '').trim()
  const scope = request.nextUrl.searchParams.get('scope') || 'all'
  if (!searchScopes.includes(scope as SearchScope)) return NextResponse.json({ error: 'Invalid search type.' }, { status: 400 })
  if (query.length < 2 || query.length > 200) return NextResponse.json({ error: 'Enter between 2 and 200 characters.' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })
  return withVbmRead(request, async (read, _source, context) => searchIndex(
    await searchCache.read(`vb365:spotlight:${context.cacheKey}`, () => loadVbmSearch(read), request.signal, request.nextUrl.searchParams.get('refresh') === '1'), query, 20, scope as SearchScope,
  ))
}
