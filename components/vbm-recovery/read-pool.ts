// Open Backup UI v1.3.0

type Consumer = {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  cleanup: () => void
}

type PendingRead = {
  key: string
  controller: AbortController
  consumers: Set<Consumer>
  settled: boolean
}

const canceled = () => new DOMException('The read was canceled.', 'AbortError')

/** A pending read can outlive a folder visit, but never its owning browser. */
export function createReadPool({finishOnNavigate=false}={}) {
  const pending = new Map<string, PendingRead>()

  function settle(entry: PendingRead, result: { value: unknown } | { error: unknown }) {
    if (entry.settled) return
    entry.settled = true
    if (pending.get(entry.key) === entry) pending.delete(entry.key)
    const consumers = [...entry.consumers]
    entry.consumers.clear()
    for (const consumer of consumers) {
      consumer.cleanup()
      if ('error' in result) consumer.reject(result.error)
      else consumer.resolve(result.value)
    }
  }

  function cancel(entry: PendingRead) {
    settle(entry, { error: canceled() })
    entry.controller.abort()
  }

  function run<T>(key: string, load: (signal: AbortSignal) => Promise<T>, callerSignal?: AbortSignal): Promise<T> {
    if (callerSignal?.aborted) return Promise.reject(canceled())
    let entry = pending.get(key)
    if (!entry) {
      entry = { key, controller: new AbortController(), consumers: new Set(), settled: false }
      pending.set(key, entry)
      const started = entry
      // Schedule after subscription, and catch synchronous loader failures as well as rejected reads.
      void Promise.resolve().then(() => {
        if (started.controller.signal.aborted) throw canceled()
        return load(started.controller.signal)
      }).then(value => settle(started, { value }), error => settle(started, { error }))
    }
    const shared = entry
    return new Promise<T>((resolve, reject) => {
      const consumer: Consumer = {
        resolve: value => resolve(value as T),
        reject,
        cleanup: () => callerSignal?.removeEventListener('abort', abort),
      }
      const abort = () => {
        if (!shared.consumers.delete(consumer)) return
        consumer.cleanup()
        reject(canceled())
        if (shared.consumers.size === 0 && !finishOnNavigate) cancel(shared)
      }
      shared.consumers.add(consumer)
      callerSignal?.addEventListener('abort', abort, { once: true })
    })
  }

  /** Abort current reads; reusable after cleanup, including React StrictMode effect setup. */
  function dispose() {
    for (const entry of [...pending.values()]) cancel(entry)
  }

  return { run, dispose }
}
