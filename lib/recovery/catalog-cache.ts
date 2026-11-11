// Open Backup UI v1.2.0
export const recoveryCatalogCacheMs = 30 * 60_000
export const isAuthorizationError = (error: unknown) => error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403)
export const isAbortedRead = (error: unknown) => error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')

/** In-flight requests are awaited by their owner; this cache never starts detached refreshes. */
export function scopedRecoveryCache<T extends { complete: boolean }>(limit: number, fallback?: (value: T) => T) {
  const entries = new Map<string, { expires: number; pending?: Promise<T>; value?: T }>()
  const get = (key: string, load: () => Promise<T>, refresh = false): Promise<T> => {
    const old = entries.get(key)
    if (old?.pending) return old.pending.catch(error => {
      // The owner's HTTP request may have closed while this caller is still live.
      // Retry with this caller's authenticated reader, never with the expired one.
      if (isAbortedRead(error)) return get(key, load, true)
      throw error
    })
    if (old?.value && !refresh && old.expires > Date.now()) return Promise.resolve(old.value)
    const entry = old || { expires: 0 }
    const promise = load().then(value => {
      // A verified partial inventory keeps its visible notice but must not fan
      // out to VBR again on every calendar click. Manual refresh can retry it.
      entry.value = value; entry.expires = Date.now() + recoveryCatalogCacheMs
      return value
    }, error => {
      if (isAbortedRead(error)) throw error
      if (!isAuthorizationError(error) && fallback && old?.value) {
        const stale = fallback(old.value)
        entry.value = stale; entry.expires = Date.now() + 25_000
        return stale
      }
      if (entries.get(key) === entry) entries.delete(key)
      throw error
    }).finally(() => {
      if (entry.pending === promise) entry.pending = undefined
      for (const [id, cached] of entries) {
        if (entries.size <= limit) break
        if (!cached.pending) entries.delete(id)
      }
    })
    entry.pending = promise; entries.set(key, entry)
    return promise
  }
  return Object.assign(get, { forget: (key: string) => entries.delete(key),
    forgetPrefix: (prefix: string) => { for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key) } })
}
