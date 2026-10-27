import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { TopologyRequestError } from '@/lib/topology/load'
import { loadVbrSearch } from '@/lib/search/load'
import { loadPreview } from '@/lib/search/preview'
import { searchCache, previewCache } from '@/lib/search/cache'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key') || ''
  if (!key.startsWith('vbr:') || key.length > 8192) return NextResponse.json({ error: 'Invalid search selection.' }, { status: 400 })
  return withVbrRead(request, async (read, _source, _inventory, context) => {
    const scope = `vbr:spotlight:${context.cacheKey}`
    const index = await searchCache.read(scope, () => loadVbrSearch(read), request.signal)
    const item = index.items.find(item => item.key === key)
    if (!item) throw new TopologyRequestError('This result is no longer available in the selected data source. Search again.', 404)
    return previewCache.read(`${scope}:${index.fetchedAt}:${key}`, () => loadPreview(read, item, index.fetchedAt), request.signal)
  })
}
