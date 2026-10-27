import { applicationRequest } from '../api/application-request'
import type { SearchPlatform, SearchResponse, SearchScope } from './model'

export type PlatformSearch = { status: 'loading' } | { status: 'ready'; data: SearchResponse } | { status: 'error'; message: string }
type Request = (path: string, init: RequestInit) => Promise<SearchResponse>

// Deliver each platform independently. Aborted searches never publish results,
// even when a transport completes after cancellation.
export async function searchPlatforms(query: string, platforms: SearchPlatform[], signal: AbortSignal,
  publish: (platform: SearchPlatform, result: PlatformSearch) => void,
  request: Request = applicationRequest<SearchResponse>, scope: SearchScope = 'all', refresh = false) {
  await Promise.all(platforms.map(async platform => {
    try {
      const data = await request(`/api/${platform === 'vbr' ? 'vbr' : 'vbm'}/search?${new URLSearchParams({ q: query, scope, ...(refresh ? { refresh: '1' } : {}) })}`, { signal })
      if (!signal.aborted) publish(platform, { status: 'ready', data })
    } catch (error) {
      if (!signal.aborted) publish(platform, { status: 'error', message: error instanceof Error ? error.message : 'Search is unavailable. Please retry.' })
    }
  }))
}
