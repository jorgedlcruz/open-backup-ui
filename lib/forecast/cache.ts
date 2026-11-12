// Open Backup UI v1.2.0
import type { ForecastSnapshot } from './model'

export const FORECAST_CACHE_INTERVAL = 30 * 60 * 1000

type CacheOptions = { force?: boolean; background?: boolean; signal?: AbortSignal }
type Entry = {
  value?: ForecastSnapshot
  freshUntil: number
  nextRefresh: number
  refreshFailed: boolean
  lastError?: unknown
  pending?: Promise<ForecastSnapshot>
  invalidated?: boolean
}

const cancelled = () => new DOMException('Capacity planning request cancelled', 'AbortError')
const invalidated = () => Object.assign(new Error('Capacity planning source changed during refresh.'), { status: 409 })
const denied = (error: unknown) => typeof error === 'object' && error !== null && 'status' in error && [401, 403, 409].includes(Number(error.status))
const isCancelled = (error: unknown) => typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'

function waitFor<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  if (signal.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(cancelled()) }
    signal.addEventListener('abort', abort, { once: true })
    work.then(value => {
      signal.removeEventListener('abort', abort)
      resolve(value)
    }, error => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
  })
}

/** Server memory only. Keys must identify both the source and authenticated principal. */
export class ForecastCache {
  private entries = new Map<string, Entry>()

  constructor(private clock = Date.now, private limit = 20) {}

  has(key: string) { return this.entries.has(key) }

  /** Read an existing authenticated scope without starting or awaiting collection. */
  peek(key: string, background = false): ForecastSnapshot | null {
    const entry = this.entries.get(key)
    return entry?.value && !entry.invalidated ? this.snapshot(entry, background) : null
  }

  due(key: string) {
    const entry = this.entries.get(key)
    return !entry || !entry.pending && entry.nextRefresh <= this.clock()
  }

  delete(key: string) {
    const entry = this.entries.get(key)
    if (entry) entry.invalidated = true
    this.entries.delete(key)
  }

  /** Keep matching scopes, invalidating old configured credentials and removed sources. */
  prune(keep: (key: string) => boolean) {
    for (const key of this.entries.keys()) if (!keep(key)) this.delete(key)
  }

  private entry(key: string): Entry {
    const existing = this.entries.get(key)
    if (existing) return existing
    const entry: Entry = { freshUntil: 0, nextRefresh: 0, refreshFailed: false }
    // Never interrupt a shared refresh to make room. An overflow request can still
    // load uncached when every slot is busy, without growing the retained map.
    if (this.entries.size >= this.limit) {
      const removable = [...this.entries].find(([, value]) => !value.pending)
      if (removable) this.entries.delete(removable[0])
    }
    if (this.entries.size < this.limit) this.entries.set(key, entry)
    return entry
  }

  private snapshot(entry: Entry, background: boolean): ForecastSnapshot {
    const value = entry.value!
    return {
      ...value,
      warnings: [...value.warnings],
      observations: [...value.observations],
      cache: {
        intervalMinutes: 30,
        updatedAt: value.fetchedAt,
        nextRefreshAt: entry.nextRefresh ? new Date(entry.nextRefresh).toISOString() : null,
        refreshing: !!entry.pending,
        stale: entry.refreshFailed || entry.freshUntil <= this.clock(),
        refreshFailed: entry.refreshFailed,
        background,
      },
    }
  }

  private start(key: string, entry: Entry, load: () => Promise<ForecastSnapshot>, options: CacheOptions) {
    const work = Promise.resolve().then(load).then(value => {
      // A browser-owned reader may turn aborts into partial results. Such results
      // must never become a new cached snapshot. Server-owned loads keep running.
      if (!options.background && options.signal?.aborted) throw cancelled()
      if (entry.invalidated) throw invalidated()
      entry.value = value
      entry.freshUntil = this.clock() + FORECAST_CACHE_INTERVAL
      entry.nextRefresh = entry.freshUntil
      entry.refreshFailed = false
      entry.lastError = undefined
      return value
    }).catch(error => {
      if (!options.background && options.signal?.aborted) error = cancelled()
      if (denied(error) || entry.invalidated) {
        entry.value = undefined
        entry.freshUntil = 0
        entry.refreshFailed = true
        entry.lastError = error
        entry.nextRefresh = this.clock() + FORECAST_CACHE_INTERVAL
        if (entry.invalidated && this.entries.get(key) === entry) this.entries.delete(key)
      } else if (isCancelled(error)) {
        if (!entry.value && this.entries.get(key) === entry) this.entries.delete(key)
      } else {
        // Failed refreshes retain evidence with its original collection time and
        // avoid hammering an unavailable source on every page or scheduler tick.
        entry.refreshFailed = true
        entry.lastError = error
        entry.nextRefresh = this.clock() + FORECAST_CACHE_INTERVAL
      }
      throw error
    }).finally(() => {
      if (entry.pending === work) entry.pending = undefined
    })
    entry.pending = work
    // Background callers can return the previous snapshot without awaiting work.
    // Also handle rejection if the only waiting browser disconnects.
    void work.catch(() => undefined)
    return work
  }

  async read(key: string, load: () => Promise<ForecastSnapshot>, options: CacheOptions = {}): Promise<ForecastSnapshot> {
    if (options.signal?.aborted) throw cancelled()
    const entry = this.entry(key)
    const background = !!options.background

    if (!options.force && entry.value) {
      if (entry.nextRefresh > this.clock()) return this.snapshot(entry, background)
      if (background) {
        if (!entry.pending) this.start(key, entry, load, options)
        return this.snapshot(entry, background)
      }
    }
    if (!options.force && !entry.value && !entry.pending && entry.lastError && entry.nextRefresh > this.clock()) throw entry.lastError

    const joined = !!entry.pending
    try {
      await waitFor(entry.pending || this.start(key, entry, load, options), options.signal)
      if (entry.invalidated) throw invalidated()
      return this.snapshot(entry, background)
    } catch (error) {
      if (options.signal?.aborted) throw cancelled()
      // Another browser may have owned and cancelled the shared reader. Retry
      // with this caller's own reader rather than keeping the cancelled result.
      if (joined && isCancelled(error) && !background) return this.read(key, load, options)
      if (entry.value && !denied(error) && !isCancelled(error) && !entry.invalidated) return this.snapshot(entry, background)
      throw error
    }
  }
}

const processCache = globalThis as typeof globalThis & { forecastCache?: ForecastCache }
export const forecastCache = processCache.forecastCache ??= new ForecastCache()
