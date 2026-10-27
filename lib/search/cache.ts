import type { SearchIndex, PreviewResponse } from './model'

type Entry<T> = { value?: T; expires: number; pending?: Promise<T> }
export class SearchCache<T extends { complete: boolean } = SearchIndex> {
  private entries = new Map<string, Entry<T>>()
  constructor(private clock = Date.now, private limit = 8, private ttl = 5 * 60 * 1000) {}

  async read(key: string, load: () => Promise<T>, signal: AbortSignal, refresh = false): Promise<T> {
    if (signal.aborted) throw new DOMException('Search cancelled', 'AbortError')
    const previous = this.entries.get(key)
    if (!refresh && previous?.value && previous.expires > this.clock()) return previous.value
    if (previous?.pending) {
      try { return await previous.pending }
      catch (error) {
        // A newer query may share an inventory build with a cancelled request.
        // Its own request can retry; other failures remain visible to the UI.
        if (signal.aborted || !(error instanceof Error) || error.name !== 'AbortError') throw error
        return this.read(key, load, signal)
      }
    }
    const entry: Entry<T> = { expires: 0 }
    this.entries.set(key, entry)
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
    entry.pending = load().then(value => {
      if (signal.aborted) throw new DOMException('Search cancelled', 'AbortError')
      entry.value = value
      entry.expires = this.clock() + (value.complete ? this.ttl : 15000)
      return value
    }).catch(error => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      if (signal.aborted) throw new DOMException('Search cancelled', 'AbortError')
      throw error
    }).finally(() => { entry.pending = undefined })
    return entry.pending
  }
}
// Authenticated source/principal hashes only; never cache results across sources.
const processCache = globalThis as typeof globalThis & { spotlightIndexV3?: SearchCache; spotlightPreview?: SearchCache<PreviewResponse> }
export const searchCache = processCache.spotlightIndexV3 ??= new SearchCache()
export const previewCache = processCache.spotlightPreview ??= new SearchCache<PreviewResponse>(Date.now, 64, 60000)
