// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { test } = require('node:test')

require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file)
const { ForecastCache, FORECAST_CACHE_INTERVAL } = require('../lib/forecast/cache.ts')
const base = Date.parse('2026-10-27T12:00:00Z')
const collection = () => ({ data: [], available: true, complete: true })
const snapshot = (at = base, sourceName = 'VBR') => ({
  sourceName, fetchedAt: new Date(at).toISOString(), warnings: [],
  repositories: collection(), configs: collection(), scaleOut: collection(), policies: collection(), objects: collection(), backups: collection(),
  observations: [{ at: new Date(at).toISOString(), id: 'repository', capacityGB: 100, freeGB: 50 }], historyAvailable: true,
})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise(setImmediate)

test('fresh planning evidence is reused for exactly thirty minutes without new loads', async () => {
  let now = base, calls = 0
  const cache = new ForecastCache(() => now)
  const load = async () => { calls++; return snapshot(now) }
  const first = await cache.read('source-a', load, { background: true })
  assert.equal(FORECAST_CACHE_INTERVAL, 1800000)
  assert.equal(first.cache.updatedAt, new Date(base).toISOString())
  assert.equal(first.cache.nextRefreshAt, new Date(base + FORECAST_CACHE_INTERVAL).toISOString())
  now += FORECAST_CACHE_INTERVAL - 1
  const cached = await cache.read('source-a', load, { background: true })
  assert.equal(calls, 1)
  assert.equal(cached.fetchedAt, first.fetchedAt)
  assert.equal(cached.cache.stale, false)
  assert.equal(cache.due('source-a'), false)
  now++
  assert.equal(cache.due('source-a'), true)
  const refreshed = await cache.read('source-a', load, { force: true, background: true })
  assert.equal(calls, 2)
  assert.equal(refreshed.fetchedAt, new Date(now).toISOString())
  assert.equal(refreshed.cache.refreshing, false)
})

test('a warm expired source returns immediately while one shared refresh runs', async () => {
  let now = base, calls = 0
  const cache = new ForecastCache(() => now), next = deferred()
  await cache.read('source', async () => snapshot())
  now += FORECAST_CACHE_INTERVAL
  const load = () => { calls++; return next.promise }
  const stale = await cache.read('source', load, { background: true })
  const second = await cache.read('source', load, { background: true })
  assert.equal(stale.fetchedAt, new Date(base).toISOString())
  assert.equal(stale.cache.stale, true)
  assert.equal(stale.cache.refreshing, true)
  assert.equal(second.cache.refreshing, true)
  assert.equal(calls, 1)
  assert.equal(cache.due('source'), false)
  const manual = cache.read('source', load, { force: true, background: true })
  next.resolve(snapshot(now))
  const result = await manual
  assert.equal(calls, 1)
  assert.equal(result.cache.stale, false)
  assert.equal(result.cache.refreshing, false)
})

test('simultaneous cold page and scheduler loads share work and freshness starts at completion', async () => {
  let now = base, calls = 0
  const cache = new ForecastCache(() => now), next = deferred()
  const load = () => { calls++; return next.promise }
  const first = cache.read('source', load, { background: true })
  const second = cache.read('source', load, { force: true, background: true })
  await flush()
  assert.equal(calls, 1)
  now += 60000
  next.resolve(snapshot(now))
  const [a, b] = await Promise.all([first, second])
  assert.equal(a.fetchedAt, b.fetchedAt)
  assert.equal(a.cache.nextRefreshAt, new Date(now + FORECAST_CACHE_INTERVAL).toISOString())
})

test('transient refresh failure preserves old evidence and backs off until thirty minutes', async () => {
  let now = base, calls = 0
  const cache = new ForecastCache(() => now)
  await cache.read('source', async () => snapshot())
  now += FORECAST_CACHE_INTERVAL
  const unavailable = async () => { calls++; throw new Error('Source unavailable') }
  const first = await cache.read('source', unavailable, { force: true, background: true })
  assert.equal(first.cache.refreshFailed, true)
  assert.equal(first.cache.stale, true)
  assert.equal(first.fetchedAt, new Date(base).toISOString())
  assert.equal(first.observations[0].at, new Date(base).toISOString())
  assert.equal(cache.due('source'), false)
  now += FORECAST_CACHE_INTERVAL - 1
  await cache.read('source', unavailable, { background: true })
  assert.equal(calls, 1)
  now++
  assert.equal(cache.due('source'), true)
  await cache.read('source', unavailable, { force: true, background: true })
  assert.equal(calls, 2)
})

test('background refresh errors are handled and visible on the next cached response', async () => {
  let now = base
  const cache = new ForecastCache(() => now)
  await cache.read('source', async () => snapshot())
  now += FORECAST_CACHE_INTERVAL
  await cache.read('source', async () => { throw new Error('Offline') }, { background: true })
  await flush()
  const result = await cache.read('source', async () => { assert.fail('backoff must avoid another request') }, { background: true })
  assert.equal(result.cache.refreshing, false)
  assert.equal(result.cache.refreshFailed, true)
})

test('manual refresh bypasses a transient failure backoff and clears the error after success', async () => {
  const cache = new ForecastCache(() => base)
  await cache.read('source', async () => snapshot())
  await cache.read('source', async () => { throw new Error('Offline') }, { force: true })
  const recovered = await cache.read('source', async () => snapshot(base + 10), { force: true })
  assert.equal(recovered.cache.refreshFailed, false)
  assert.equal(recovered.cache.stale, false)
  assert.equal(recovered.fetchedAt, new Date(base + 10).toISOString())
})

test('a failed cold load is throttled until scheduled retry or manual refresh', async () => {
  let now = base, calls = 0
  const cache = new ForecastCache(() => now)
  const load = async () => { calls++; throw new Error('Offline') }
  await assert.rejects(cache.read('source', load), /Offline/)
  await assert.rejects(cache.read('source', load), /Offline/)
  assert.equal(calls, 1)
  assert.equal(cache.due('source'), false)
  now += FORECAST_CACHE_INTERVAL
  await assert.rejects(cache.read('source', load), /Offline/)
  assert.equal(calls, 2)
})

test('authorization or source changes discard prior evidence but retain failure backoff', async () => {
  for (const status of [401, 403, 409]) {
    const cache = new ForecastCache(() => base)
    await cache.read('source', async () => snapshot())
    await assert.rejects(cache.read('source', async () => { throw Object.assign(new Error('Denied'), { status }) }, { force: true }), error => error.status === status)
    assert.equal(cache.due('source'), false)
    await assert.rejects(cache.read('source', async () => { assert.fail('must not silently return old evidence or retry') }), error => error.status === status)
    const recovered = await cache.read('source', async () => snapshot(base, 'Fresh authorization'), { force: true })
    assert.equal(recovered.sourceName, 'Fresh authorization')
  }
})

test('cache entries isolate authenticated scopes and response decoration does not mutate evidence', async () => {
  const cache = new ForecastCache(() => base)
  const first = await cache.read('principal-a', async () => snapshot(base, 'A'))
  await cache.read('principal-b', async () => snapshot(base, 'B'))
  first.warnings.push('Caller-specific warning')
  first.observations.push({ at: 'other', id: 'another', capacityGB: 10, freeGB: 1 })
  const next = await cache.read('principal-a', async () => { assert.fail('cached scope should be reused') }, { background: true })
  assert.equal(next.sourceName, 'A')
  assert.deepEqual(next.warnings, [])
  assert.equal(next.observations.length, 1)
  assert.equal(next.cache.background, true)
  const other = await cache.read('principal-b', async () => { assert.fail('cached scope should be reused') })
  assert.equal(other.sourceName, 'B')
  assert.equal(other.cache.background, false)
})

test('partial evidence remains partial and preserves collection notices', async () => {
  const cache = new ForecastCache(() => base), value = snapshot()
  value.backups.complete = false
  value.warnings.push('File inventory is partial')
  const loaded = await cache.read('source', async () => value)
  assert.equal(loaded.backups.complete, false)
  assert.deepEqual(loaded.warnings, ['File inventory is partial'])
})

test('cancelling one waiter leaves a server-owned refresh available to other callers', async () => {
  const cache = new ForecastCache(() => base), next = deferred(), controller = new AbortController()
  const cancelledRequest = cache.read('source', () => next.promise, { background: true, signal: controller.signal })
  const rejection = assert.rejects(cancelledRequest, error => error.name === 'AbortError')
  const remaining = cache.read('source', async () => { assert.fail('shared server load should continue') }, { background: true })
  controller.abort()
  await rejection
  next.resolve(snapshot())
  assert.equal((await remaining).fetchedAt, new Date(base).toISOString())
  assert.equal(cache.due('source'), false)
})

test('browser-owned cancellation cannot publish a partial success and another waiter retries', async () => {
  const cache = new ForecastCache(() => base), next = deferred(), controller = new AbortController()
  const owner = cache.read('source', () => next.promise, { signal: controller.signal })
  const rejection = assert.rejects(owner, error => error.name === 'AbortError')
  let retries = 0
  const remaining = cache.read('source', async () => { retries++; return snapshot(base + 1) })
  controller.abort()
  await rejection
  next.resolve({ ...snapshot(), warnings: ['Aborted incomplete collection'] })
  const result = await remaining
  assert.equal(retries, 1)
  assert.deepEqual(result.warnings, [])
  assert.equal(result.fetchedAt, new Date(base + 1).toISOString())
})

test('aborted requests and non-shared AbortErrors do not retry indefinitely', async () => {
  const cache = new ForecastCache(() => base), controller = new AbortController()
  controller.abort()
  await assert.rejects(cache.read('source', async () => { assert.fail('aborted request must not load') }, { signal: controller.signal }), error => error.name === 'AbortError')
  let calls = 0
  await assert.rejects(cache.read('source', async () => { calls++; throw new DOMException('Cancelled', 'AbortError') }), error => error.name === 'AbortError')
  assert.equal(calls, 1)
  assert.equal(cache.has('source'), false)
})

test('pruning an in-flight old scope prevents late publication', async () => {
  const cache = new ForecastCache(() => base), next = deferred()
  await cache.read('keep', async () => snapshot())
  const old = cache.read('old', () => next.promise, { background: true })
  const rejection = assert.rejects(old, error => error.status === 409)
  cache.prune(key => key === 'keep')
  next.resolve(snapshot())
  await rejection
  assert.equal(cache.has('keep'), true)
  assert.equal(cache.has('old'), false)
  assert.equal(cache.due('old'), true)
})

test('bounded cache preserves busy entries and serves overflow without retaining it', async () => {
  const cache = new ForecastCache(() => base, 1), next = deferred()
  const first = cache.read('busy', () => next.promise, { background: true })
  assert.equal((await cache.read('overflow', async () => snapshot(base, 'Overflow'))).sourceName, 'Overflow')
  assert.equal(cache.has('busy'), true)
  assert.equal(cache.has('overflow'), false)
  next.resolve(snapshot())
  await first
  await cache.read('replacement', async () => snapshot())
  assert.equal(cache.has('busy'), false)
  assert.equal(cache.has('replacement'), true)
})
