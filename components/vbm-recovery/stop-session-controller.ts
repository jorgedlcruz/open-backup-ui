// Open Backup UI v1.3.0
export type StopPhase = 'idle' | 'submitting' | 'waiting' | 'unconfirmed' | 'failed' | 'stopped'
export type StopSnapshot = { phase: StopPhase; checking: boolean; requestedAt?: number; pollUntil?: number; error?: string }
type SessionState = { id: string; state: string }
type Dependencies = {
  post: (id: string) => Promise<unknown>
  read: (id: string, signal: AbortSignal) => Promise<{ session: SessionState }>
  now?: () => number
  readTimeoutMs?: number
}
const idle: StopSnapshot = { phase: 'idle', checking: false }
const message = (error: unknown) => error instanceof Error ? error.message : 'Recovery information could not be loaded.'
const knownRejection = (error: unknown) => !!error && typeof error === 'object' && 'outcomeUnknown' in error && error.outcomeUnknown === false

/** A stop acknowledgment is not a stopped session. Reconcile with reads, never replay an ambiguous POST. */
export function createStopSessionController({ post, read, now = Date.now, readTimeoutMs = 15000 }: Dependencies) {
  const states = new Map<string, StopSnapshot>()
  const listeners = new Map<string, Set<() => void>>()
  const checks = new Map<string, Promise<void>>()
  const snapshot = (id: string) => states.get(id) || idle
  const publish = (id: string, value: StopSnapshot) => {
    states.set(id, value)
    listeners.get(id)?.forEach(listener => listener())
  }
  const observe = (session: SessionState) => {
    if (session.state === 'Stopped' && snapshot(session.id).phase !== 'stopped') publish(session.id, { ...snapshot(session.id), phase: 'stopped', checking: false, error: undefined })
  }
  const request = async (id: string) => {
    if (!['idle', 'failed'].includes(snapshot(id).phase)) return
    publish(id, { phase: 'submitting', checking: false, requestedAt: now() })
    try {
      const raw = await post(id)
      if (snapshot(id).phase === 'stopped') return
      const response = raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined
      if (response?.accepted !== true || response.sessionId !== id) {
        publish(id, { ...snapshot(id), phase: 'unconfirmed', pollUntil: now() + 120000, error: 'The stop request could not be confirmed. Check its status before trying again.' })
      } else publish(id, { ...snapshot(id), phase: response.state === 'Stopped' ? 'stopped' : 'waiting', pollUntil: now() + 120000, error: undefined })
    } catch (error) {
      if (snapshot(id).phase !== 'stopped') publish(id, { ...snapshot(id), phase: knownRejection(error) ? 'failed' : 'unconfirmed', pollUntil: now() + 120000, error: message(error) })
    }
  }
  const check = (id: string): Promise<void> => {
    const pending = checks.get(id)
    if (pending) return pending
    if (['idle', 'failed', 'stopped'].includes(snapshot(id).phase)) return Promise.resolve()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), readTimeoutMs)
    publish(id, { ...snapshot(id), checking: true })
    const operation = Promise.resolve().then(() => read(id, controller.signal)).then(value => {
      if (value.session.id !== id) throw new Error('The returned session does not match this request.')
      if (value.session.state === 'Stopped') observe(value.session)
      else if (snapshot(id).phase !== 'stopped') publish(id, { ...snapshot(id), error: undefined })
    }).catch(error => {
      if (snapshot(id).phase !== 'stopped') publish(id, { ...snapshot(id), error: message(error) })
    }).finally(() => {
      clearTimeout(timer)
      checks.delete(id)
      publish(id, { ...snapshot(id), checking: false })
    })
    checks.set(id, operation)
    return operation
  }
  return {
    snapshot, observe, request, check,
    subscribe(id: string, listener: () => void) {
      const group = listeners.get(id) || new Set<() => void>()
      group.add(listener); listeners.set(id, group)
      return () => { group.delete(listener); if (!group.size) listeners.delete(id) }
    },
  }
}
