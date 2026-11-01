/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createRequire } = require('node:module')

require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file)

const { ForecastCache, FORECAST_CACHE_INTERVAL } = require('../lib/forecast/cache.ts')
const { readCacheScope } = require('../lib/server/read-cache-scope.ts')
const { TopologyRequestError } = require('../lib/topology/load.ts')
const base = Date.parse('2026-10-27T12:00:00Z')
const source = (id = 'vbr') => ({ id, platform: 'vbr', protocol: 'https', host: `${id}.test`, port: 9419, username: 'operator', password: 'fixture-password' })
const reply = (status = 200, data = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => data })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const collection = data => ({ data, available: true, complete: true })
function scopeFor(item) {
  const destination = new URL(`${item.protocol}://${item.host}:${item.port}`)
  return { destination, scope: readCacheScope(destination.href, '', item) }
}
async function until(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(setImmediate)
  assert.ok(predicate(), 'asynchronous operation settled')
}

function harness(options = {}) {
  let now = base, interval
  const records = new Map((options.sources || [source()]).map(item => [item.id, item]))
  const calls = [], measurements = [], authentications = [], renewals = [], loads = [], collectorReads = []
  const cache = new ForecastCache(() => now)
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  const file = require.resolve('../lib/server/forecast-cache.ts'), realRequire = createRequire(file), exports = {}
  const snapshot = name => ({
    sourceName: name, fetchedAt: new Date(now).toISOString(), warnings: [],
    repositories: collection([{ id: 'repository', name: 'Repository', type: 'LinuxLocal', capacityGB: 100, freeGB: 25 }]),
    configs: collection([]), scaleOut: collection([]), policies: collection([]), objects: collection([]), backups: collection([]),
    observations: [], historyAvailable: false,
  })
  const dependencies = {
    './config-store': { configStore: {
      getAll: () => [...records.values()].filter(item => !item.id.startsWith('env-')),
      getById: id => records.get(id),
    } },
    './token-manager': { tokenManager: {
      getToken: async id => { authentications.push(id); await options.onAuth?.(records, id); return options.noToken ? null : 'fixture-access-token' },
      refreshToken: async id => { renewals.push(id); return options.noRenewal ? null : 'fixture-renewed-token' },
    } },
    './capacity-collector': {
      configuredScope: scopeFor,
      getCollectorStatus: async (scope, supported) => { collectorReads.push({ scope, supported }); return { state: 'healthy', intervalMinutes: 15 } },
    },
    './capacity-history': { recordCapacity: async (scope, data) => {
      if (options.historyFailure) throw Error('private filesystem details')
      measurements.push({ scope, data, at: now })
      return [{ id: 'repository', at: new Date(now).toISOString(), capacityGB: 100, freeGB: 25 }]
    } },
    '../forecast/cache': { forecastCache: cache },
    '../forecast/load': { loadForecast: async (read, name) => {
      loads.push({ name, at: now })
      if (options.actualLoader) return realRequire('../forecast/load.ts').loadForecast(read, name)
      if (options.load) return options.load(read, name, { records, snapshot, now })
      await read('/api/v1/jobs')
      return snapshot(name)
    } },
  }
  const context = {
    exports, require: key => dependencies[key] || realRequire(key),
    process: { cwd: () => path.join(process.cwd(), 'tmp', 'forecast-refresh-fixture'), env: options.env || {} },
    Date: Clock, URL, AbortController, DOMException, setTimeout, clearTimeout,
    setInterval: fn => { interval = fn; return { unref() {} } },
    fetch: async (url, init) => { calls.push({ url: String(url), init }); return options.fetch ? options.fetch(url, init, records) : reply() },
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, context)
  const request = (id = 'vbr', force = false, signal = new AbortController().signal) => exports.readForecastSnapshot(
    async () => { throw Error('Configured refresh must not reuse the request transport') }, 'Selected source',
    { cacheKey: scopeFor(records.get(id)).scope, serverCredentials: true, sourceId: id }, { force, signal },
  )
  return {
    exports, cache, context, records, calls, measurements, authentications, renewals, loads, collectorReads, request, snapshot,
    advance: duration => { now += duration }, tick: () => interval?.(),
    settled: () => until(() => context.forecastRefreshRuntime?.busy === false),
  }
}

test('server startup warms planning without a browser and refreshes at the 30-minute boundary', async () => {
  const h = harness()
  h.exports.startForecastRefresh()
  await h.settled()
  assert.equal(h.loads.length, 1)
  h.exports.startForecastRefresh()
  h.advance(FORECAST_CACHE_INTERVAL - 1); h.tick(); await h.settled()
  assert.equal(h.loads.length, 1)
  h.advance(1); h.tick(); await h.settled()
  assert.equal(h.loads.length, 2)
  assert.equal(h.measurements.length, 2)
  assert.equal(h.measurements[1].at - h.measurements[0].at, 1800000)
})

test('cached page reads preserve snapshot time and do not record old capacity as a new sample', async () => {
  const h = harness()
  const first = await h.request()
  h.advance(300000)
  const second = await h.request()
  assert.equal(second.fetchedAt, first.fetchedAt)
  assert.equal(h.loads.length, 1)
  assert.equal(h.measurements.length, 1)
  assert.equal(h.collectorReads.length, 2)
  assert.equal(second.collector.intervalMinutes, 15)
  assert.equal(second.cache.intervalMinutes, 30)
})

test('mini preview reads only its current scope and rejects reconfigured credentials', async () => {
  const h = harness(), item = h.records.get('vbr')
  const context = { cacheKey: scopeFor(item).scope, serverCredentials: true, sourceId: item.id }
  assert.equal(h.exports.readForecastPreview(context).preview, null)
  assert.equal(h.loads.length, 0)
  await h.request()
  assert.equal(h.exports.readForecastPreview(context).preview.name, 'Repository')
  assert.equal(h.loads.length, 1); assert.equal(h.measurements.length, 1)
  assert.equal(h.exports.readForecastPreview({ cacheKey: 'other-principal', serverCredentials: false }).preview, null)
  h.records.set(item.id, { ...item, password: 'changed-fixture-password' })
  assert.throws(() => h.exports.readForecastPreview(context), error => error.status === 409)
})

test('manual Refresh bypasses the interval while ordinary reads share the refreshed result', async () => {
  const h = harness()
  const first = await h.request()
  h.advance(60000)
  const fresh = await h.request('vbr', true)
  assert.notEqual(fresh.fetchedAt, first.fetchedAt)
  assert.equal(h.loads.length, 2)
  assert.equal((await h.request()).fetchedAt, fresh.fetchedAt)
  assert.equal(h.loads.length, 2)
})

test('manual and scheduled refreshes coalesce onto the same source collection', async () => {
  const gate = deferred(), h = harness({ fetch: async () => { await gate.promise; return reply() } })
  h.exports.startForecastRefresh()
  await until(() => h.calls.length === 1)
  const manual = h.request('vbr', true)
  await new Promise(setImmediate)
  assert.equal(h.loads.length, 1)
  gate.resolve()
  await manual; await h.settled()
  assert.equal(h.measurements.length, 1)
})

test('scheduler bounds simultaneous source collections to two', async () => {
  const gate = deferred(); let active = 0, maximum = 0
  const h = harness({ sources: Array.from({ length: 5 }, (_, i) => source(`vbr${i}`)), fetch: async () => {
    active++; maximum = Math.max(maximum, active)
    await gate.promise
    active--
    return reply()
  } })
  h.exports.startForecastRefresh()
  await until(() => h.calls.length === 2)
  assert.equal(maximum, 2)
  gate.resolve(); await h.settled()
  assert.equal(h.loads.length, 5)
  assert.equal(maximum, 2)
})

test('environment VBR credentials participate even when not in the saved-source list', async () => {
  const h = harness({ sources: [source('env-vbr')] })
  h.exports.startForecastRefresh(); await h.settled()
  assert.deepEqual(h.authentications, ['env-vbr'])
  assert.equal(h.loads.length, 1)
})

test('scheduler skips browser-only and non-VBR sources', async () => {
  const h = harness({ sources: [{ ...source('browser'), password: undefined }, { ...source('m365'), platform: 'vb365' }] })
  h.exports.startForecastRefresh(); await h.settled()
  assert.equal(h.authentications.length, 0)
  assert.equal(h.calls.length, 0)
})

test('one malformed source does not prevent a valid source from refreshing', async () => {
  const h = harness({ sources: [{ ...source('broken'), host: '[' }, source('valid')] })
  h.exports.startForecastRefresh(); await h.settled()
  assert.deepEqual(h.authentications, ['valid'])
  assert.equal(h.loads.length, 1)
})

test('disabled and production-build startup do not authenticate or contact VBR', () => {
  for (const env of [{ CAPACITY_COLLECTOR_ENABLED: 'false' }, { NEXT_PHASE: 'phase-production-build' }]) {
    const h = harness({ env })
    h.exports.startForecastRefresh()
    assert.equal(h.context.forecastRefreshRuntime, undefined)
    assert.equal(h.authentications.length, 0)
    assert.equal(h.calls.length, 0)
  }
})

test('source and credential scopes isolate snapshots and stale credentials cannot retrieve a cached result', async () => {
  const h = harness({ sources: [source('one'), source('two')] })
  const one = await h.request('one'), two = await h.request('two')
  assert.notEqual(one.sourceName, two.sourceName)
  assert.equal(h.loads.length, 2)
  const oldScope = scopeFor(h.records.get('one')).scope
  h.records.set('one', { ...h.records.get('one'), password: 'changed-fixture-password' })
  await assert.rejects(() => h.exports.readForecastSnapshot(async () => ({}), 'Old source', {
    cacheKey: oldScope, serverCredentials: true, sourceId: 'one',
  }, { force: false, signal: new AbortController().signal }), error => error.status === 409)
  await h.request('one')
  assert.equal(h.loads.length, 3)
})

test('credentials changed during authentication prevent the first request', async () => {
  const h = harness({ onAuth: records => records.set('vbr', { ...source(), host: 'changed.test' }) })
  await assert.rejects(() => h.exports.loadConfiguredForecast('vbr', scopeFor(source()).scope), error => error.status === 409)
  assert.equal(h.calls.length, 0)
  assert.equal(h.measurements.length, 0)
})

test('source removal while collecting discards evidence before writing history or publishing a snapshot', async () => {
  const h = harness({ fetch: async (_url, _init, records) => { records.delete('vbr'); return reply() } })
  await assert.rejects(() => h.request(), error => error.status === 409)
  assert.equal(h.measurements.length, 0)
  await assert.rejects(() => h.cache.read(scopeFor(source()).scope, async () => assert.fail('Do not retry an invalid source immediately')),
    error => error.status === 409)
  assert.equal(h.cache.due(scopeFor(source()).scope), false)
})

test('scheduler invalidates removed sources and rotated credentials', async () => {
  const h = harness({ sources: [source('one'), source('two')] })
  h.exports.startForecastRefresh(); await h.settled()
  const firstScope = scopeFor(h.records.get('one')).scope, secondScope = scopeFor(h.records.get('two')).scope
  h.records.delete('one')
  h.records.set('two', { ...source('two'), username: 'other-operator' })
  h.tick(); await h.settled()
  assert.equal(h.cache.has(firstScope), false)
  assert.equal(h.cache.has(secondScope), false)
  assert.equal(h.cache.has(scopeFor(h.records.get('two')).scope), true)
})

test('planning transport permits only known GET resources on the configured destination', async () => {
  const h = harness({ load: async (read, name, { snapshot }) => {
    await read('/api/v1/backups/backup-id/backupFiles?skip=0&limit=500', '1.3-rev2')
    return snapshot(name)
  } })
  await h.request()
  const call = h.calls[0]
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.redirect, 'error')
  assert.equal(call.init.cache, 'no-store')
  assert.equal(call.init.headers['x-api-version'], '1.3-rev2')
  const destination = new URL('https://vbr.test:9419')
  for (const target of ['/api/v1/jobs/id/start', '/api/v1/backupInfrastructure/repositories/id/rescan', '/api/v1/inventory', 'https://outside.test/api/v1/jobs', 'https://user:secret@vbr.test:9419/api/v1/jobs']) {
    assert.equal(h.exports.planningEndpointAllowed(new URL(target, destination), destination), false, target)
  }
})

test('an unexpected loader destination is rejected before a network call', async () => {
  const h = harness({ load: async read => read('https://outside.test/api/v1/jobs') })
  await assert.rejects(() => h.request(), error => error.status === 400)
  assert.equal(h.calls.length, 0)
})

test('parallel expired-token requests share one renewal and snapshots contain no credentials', async () => {
  const h = harness({
    fetch: async (_url, init) => reply(init.headers.Authorization === 'Bearer fixture-access-token' ? 401 : 200),
    load: async (read, name, { snapshot }) => { await Promise.all([read('/api/v1/jobs'), read('/api/v1/backups')]); return snapshot(name) },
  })
  const value = await h.request()
  assert.equal(h.renewals.length, 1)
  assert.equal(h.calls.length, 4)
  assert.doesNotMatch(JSON.stringify(value), /fixture-password|fixture-access-token|fixture-renewed-token/)
})

test('authorization denial invalidates the old cache rather than serving previously permitted data', async () => {
  let status = 200
  const h = harness({ fetch: async () => reply(status) })
  await h.request()
  status = 403
  await assert.rejects(() => h.request('vbr', true), error => error.status === 403)
  const requests = h.calls.length
  await assert.rejects(() => h.request(), error => error.status === 403)
  assert.equal(h.calls.length, requests)
  assert.equal(h.cache.due(scopeFor(source()).scope), false)
  assert.equal(h.measurements.length, 1)
})

test('real loader permission failures cannot downgrade authorization denial into stale cached evidence', async () => {
  let forbidden = false
  const h = harness({ actualLoader: true, fetch: async url => {
    if (forbidden) return reply(403)
    const endpoint = new URL(url).pathname
    if (endpoint === '/api/v1/serverInfo') return reply(200, { buildVersion: '13.0.0.1' })
    const rows = endpoint.endsWith('/repositories/states')
      ? [{ id: '00000000-0000-4000-8000-000000000001', name: 'Real loader repository', type: 'LinuxLocal', capacityGB: 100, freeGB: 25 }]
      : []
    return reply(200, { data: rows, pagination: { total: rows.length } })
  } })
  const original = await h.request()
  assert.equal(original.repositories.data.length, 1)
  assert.equal(h.measurements.length, 1)
  forbidden = true
  await assert.rejects(() => h.request('vbr', true), error => error.status === 403)
  await assert.rejects(() => h.request(), error => error.status === 403)
  assert.equal(h.measurements.length, 1)
})

test('temporary source failures preserve cached evidence and do not stamp history again', async () => {
  let status = 200
  const h = harness({ fetch: async () => reply(status) })
  const first = await h.request()
  status = 502
  const failed = await h.request('vbr', true)
  assert.equal(failed.fetchedAt, first.fetchedAt)
  assert.equal(failed.cache.refreshFailed, true)
  assert.equal(h.measurements.length, 1)
})

test('legacy browser sessions use their supplied reader and do not gain unattended refresh', async () => {
  const h = harness(), signal = new AbortController().signal
  let reads = 0
  const context = { cacheKey: readCacheScope('https://legacy.test/', 'fixture-browser-token'), serverCredentials: false }
  const value = await h.exports.readForecastSnapshot(async () => { reads++; return {} }, 'Legacy source', context, { force: false, signal })
  await h.exports.readForecastSnapshot(async () => { reads++; return {} }, 'Legacy source', context, { force: false, signal })
  assert.equal(reads, 1)
  assert.equal(h.authentications.length, 0)
  assert.equal(value.cache.background, false)
  assert.equal(h.measurements.length, 1)
})

test('real browser-session loader preserves 403 denial instead of returning old cached evidence', async () => {
  let forbidden = false, reads = 0
  const h = harness({ actualLoader: true }), signal = new AbortController().signal
  const context = { cacheKey: readCacheScope('https://legacy.test/', 'fixture-browser-token'), serverCredentials: false }
  const read = async endpoint => {
    reads++
    if (forbidden) throw new TopologyRequestError('Your VBR account cannot read the required backup records.', 403)
    const pathname = new URL(endpoint, 'https://legacy.test').pathname
    if (pathname === '/api/v1/serverInfo') return { buildVersion: '13.0.0.1' }
    const rows = pathname.endsWith('/repositories/states')
      ? [{ id: '00000000-0000-4000-8000-000000000001', name: 'Browser repository', type: 'LinuxLocal', capacityGB: 100, freeGB: 25 }]
      : []
    return { data: rows, pagination: { total: rows.length } }
  }
  const initial = await h.exports.readForecastSnapshot(read, 'Legacy source', context, { force: false, signal })
  assert.equal(initial.repositories.data.length, 1)
  forbidden = true
  await assert.rejects(() => h.exports.readForecastSnapshot(read, 'Legacy source', context, { force: true, signal }), error => error.status === 403)
  const failedReads = reads
  await assert.rejects(() => h.exports.readForecastSnapshot(read, 'Legacy source', context, { force: false, signal }), error => error.status === 403)
  assert.equal(reads, failedReads)
  assert.equal(h.cache.due(context.cacheKey), false)
  assert.equal(h.measurements.length, 1)
  assert.equal(h.authentications.length, 0)
})

test('a browser-session deadline cannot publish partial evidence after its reader abort is swallowed', async () => {
  const h = harness({ load: async (read, name, { snapshot }) => {
    try { await read('/api/v1/jobs') } catch { /* The planning loader can retain partial evidence. */ }
    return snapshot(name)
  } })
  const context = { cacheKey: readCacheScope('https://legacy.test/', 'fixture-browser-token'), serverCredentials: false }
  const initial = await h.exports.readForecastSnapshot(async () => ({}), 'Legacy source', context, {
    force: false, signal: new AbortController().signal,
  })
  h.advance(60000)
  const deadline = new AbortController()
  await assert.rejects(() => h.exports.readForecastSnapshot(async () => {
    deadline.abort()
    throw new DOMException('Server deadline elapsed', 'AbortError')
  }, 'Legacy source', context, { force: true, signal: deadline.signal }), error => error.name === 'AbortError')
  await new Promise(setImmediate)
  const retained = await h.exports.readForecastSnapshot(async () => assert.fail('The previous cached snapshot remains available'),
    'Legacy source', context, { force: false, signal: new AbortController().signal })
  assert.equal(retained.fetchedAt, initial.fetchedAt)
  assert.equal(retained.cache.updatedAt, initial.fetchedAt)
  assert.equal(h.measurements.length, 1)
  assert.equal(h.loads.length, 2)
})

test('history failure keeps fresh API evidence without leaking local filesystem details', async () => {
  const h = harness({ historyFailure: true })
  const value = await h.request()
  assert.equal(value.historyAvailable, false)
  assert.equal(value.warnings.length, 1)
  assert.doesNotMatch(JSON.stringify(value), /private filesystem details/)
})

test('a cancelled page waiter cannot abort the shared configured-source refresh', async () => {
  const gate = deferred(), waiter = new AbortController()
  const h = harness({ fetch: async () => { await gate.promise; return reply() } })
  const pending = h.request('vbr', false, waiter.signal)
  await until(() => h.calls.length === 1)
  waiter.abort()
  await assert.rejects(() => pending, error => error.name === 'AbortError')
  assert.equal(h.calls[0].init.signal.aborted, false)
  gate.resolve()
  await until(() => h.measurements.length === 1)
  const value = await h.request()
  assert.equal(value.sourceName, 'vbr.test')
  assert.equal(h.loads.length, 1)
})
