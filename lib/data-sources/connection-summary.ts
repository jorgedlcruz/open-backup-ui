// Open Backup UI v1.2.0
import type { Health } from './model'

const refreshAfter = 120_000
const expiresAfter = 300_000
const maxConcurrent = 4
type Result = 'verified' | 'failed' | 'unverified'
type Sample = {result: Result; at: number}
export type ConnectionSummary = {
  status: 'ok' | 'warning' | 'error' | 'empty' | 'unverified'
  verified: number; total: number; pending: number; validForMs: number
}

function result(health: Health): Result {
  if (health.connection === 'unreachable' || (health.httpStatus ?? 0) >= 500 ||
    health.authentication === 'rejected' || health.authentication === 'forbidden') return 'failed'
  return health.connection === 'reachable' && health.authentication === 'verified' && health.api === 'verified' ? 'verified' : 'unverified'
}

// Keys are server-side connection fingerprints. Samples retain only the verdict and its time.
export class ConnectionChecks {
  private samples = new Map<string, Sample>()
  private running = new Map<string, Promise<void>>()
  constructor(private now = Date.now) {}

  remember(key: string, health: Health) {
    const at = Date.parse(health.checkedAt || '')
    if (Number.isFinite(at)) this.record(key, {result:result(health), at})
  }

  private record(key: string, sample: Sample) {
    if ((this.samples.get(key)?.at ?? 0) > sample.at) return
    this.samples.delete(key)
    this.samples.set(key, sample)
    if (this.samples.size > 4096) this.samples.delete(this.samples.keys().next().value!)
  }

  async summary(entries: {key: string; check: () => Promise<Health>}[]): Promise<ConnectionSummary> {
    const now = this.now()
    const due = entries.filter(({key}) => now - (this.samples.get(key)?.at ?? -Infinity) >= refreshAfter)
      .sort((a,b) => (this.samples.get(a.key)?.at ?? 0) - (this.samples.get(b.key)?.at ?? 0))
    const reads: Promise<void>[] = []
    for (const {key, check} of due) {
      const running = this.running.get(key)
      if (running) reads.push(running)
      else if (this.running.size < maxConcurrent) {
        const read = Promise.resolve().then(check).then(health => {
          if (health.checkedAt) this.remember(key, health)
          else this.record(key, {result:'unverified', at:this.now()})
        }, () => this.record(key, {result:'unverified', at:this.now()})).finally(() => this.running.delete(key))
        this.running.set(key, read)
        reads.push(read)
      }
    }
    await Promise.all(reads)
    const sampled = this.now()
    let verified = 0, failed = 0, pending = 0, validForMs = refreshAfter
    for (const {key} of entries) {
      const sample = this.samples.get(key)
      const age = sample ? sampled - sample.at : Infinity
      if (age >= refreshAfter) pending++
      if (!sample || age < 0 || age >= expiresAfter) continue
      validForMs = Math.min(validForMs, expiresAfter - age)
      if (sample.result === 'verified') verified++
      if (sample.result === 'failed') failed++
    }
    const total = entries.length
    const status = !total ? 'empty' : verified === total ? 'ok' : failed === total ? 'error' :
      !verified && !failed ? 'unverified' : 'warning'
    return {status, verified, total, pending, validForMs}
  }
}
