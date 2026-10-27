import { NextRequest, NextResponse } from 'next/server'
import { withVbmRead } from '@/lib/server/vbm-read'
import { VbmRequestError } from '@/lib/vbm-dashboard/load'
import { loadVbmSearch } from '@/lib/search/load'
import { loadPreview } from '@/lib/search/preview'
import { searchCache, previewCache } from '@/lib/search/cache'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key') || ''
  if (!key.startsWith('vb365:') || key.length > 8192) return NextResponse.json({ error: 'Invalid search selection.' }, { status: 400 })
  return withVbmRead(request, async (read, _source, context) => {
    const scope = `vb365:spotlight:${context.cacheKey}`
    const index = await searchCache.read(scope, () => loadVbmSearch(read), request.signal)
    const item = index.items.find(item => item.key === key)
    if (!item) throw new VbmRequestError('This result is no longer available in the selected data source. Search again.', 404)
    return previewCache.read(`${scope}:${index.fetchedAt}:${key}`, () => loadPreview(read, item, index.fetchedAt), request.signal)
  })
}
