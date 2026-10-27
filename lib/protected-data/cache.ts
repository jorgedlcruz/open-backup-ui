import type { Snapshot } from './model'

export const PROTECTED_DATA_TTL = 15 * 60 * 1000
type Entry = { value?: Snapshot; expires: number; base?: Promise<Snapshot>; recovery?: Promise<Snapshot> }

// Server memory only. Keys include the authenticated source and principal; no browser/shared HTTP caching.
export class ProtectedDataCache {
  private entries = new Map<string, Entry>()
  constructor(private clock = Date.now, private limit = 20) {}

  async read(key: string, load: () => Promise<Snapshot>, enrich: (base: Snapshot) => Promise<Snapshot>, options: { recovery: boolean; force?: boolean }) {
    let entry = this.entries.get(key)
    if (entry && !entry.base && (entry.expires <= this.clock() || options.force)) {
      this.entries.delete(key)
      entry = undefined
    }
    if (!entry) {
      entry = { expires: 0 }
      this.entries.set(key, entry)
      while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
    }
    const current = entry
    if (!current.value) {
      current.base ??= load().then(value => {
        current.expires = this.clock() + PROTECTED_DATA_TTL
        current.value = { ...value, cacheExpiresAt: new Date(current.expires).toISOString() }
        return current.value
      }).catch(error => {
        if (this.entries.get(key) === current) this.entries.delete(key)
        throw error
      }).finally(() => { current.base = undefined })
      await current.base
    }
    if (options.recovery && !current.value!.recoveryTimesRequested) {
      current.recovery ??= enrich(current.value!).then(value => {
        current.value = { ...value, cacheExpiresAt: new Date(current.expires).toISOString() }
        return current.value
      }).finally(() => { current.recovery = undefined })
      await current.recovery
    }
    return current.value!
  }
}

const processCache = globalThis as typeof globalThis & { protectedDataCache?: ProtectedDataCache }
export const protectedDataCache = processCache.protectedDataCache ??= new ProtectedDataCache()
