// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript'), vm = require('node:vm'), assert = require('node:assert/strict'), { test } = require('node:test')
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
require.extensions['.ts'] = (mod, file) => mod._compile(compile(file), file)
const model = require('../lib/labs/model.ts'), presentation = require('../lib/labs/presentation.ts'), catalog = require('../lib/labs/catalog.ts'), { chartModel } = require('../lib/labs/chart.ts')
const fixture = (source = 'history', view = 'bar') => model.createWidget(source, view, { x: 20, y: 20, w: 600, h: 400 }, 'widget')
const dataset = (source, rows) => ({ rows, fields: catalog.fieldsFor(source), available: true, complete: true, warnings: ['Private host diagnostic'], sourceName: 'PRIVATE-HOST', fetchedAt: '2026-10-30T00:00:00Z' })
const load = (file, mocks = {}, globals = {}) => {
  const exports = {}, real = require('node:module').createRequire(path.resolve(file))
  vm.runInNewContext(compile(file), { exports, require: key => key in mocks ? mocks[key] : real(key), process, Buffer, URL, Headers, AbortController, setTimeout, clearTimeout, ...globals }, { filename: file })
  return exports
}
const plain = value => JSON.parse(JSON.stringify(value))

test('object cards fold repeated events by identity, expose mixed state, and can show individual records', () => {
  const data = dataset('malware', [{ id: 'event-a', objectId: 'object-a', name: 'Workload', status: 'Active', severity: 'Critical', time: '2026-10-29' }, { id: 'event-b', objectId: 'object-a', name: 'Workload', status: 'Resolved', severity: 'Warning', time: '2026-10-30' }, { id: 'event-c', objectId: 'object-b', name: 'Workload', status: 'Active', severity: 'Critical' }])
  const widget = fixture('malware', 'grid'), nodes = presentation.prepareWidget(data, widget).nodes
  assert.equal(nodes.length, 2); assert.equal(nodes[0].count, 2); assert.equal(nodes[0].detail, 'Mixed'); assert.equal(nodes[0].time, '2026-10-30'); assert.equal(nodes[0].values.count, 2)
  assert.equal(presentation.prepareWidget(data, { ...widget, gridMode: 'records' }).nodes.length, 3)
  assert.equal(presentation.prepareWidget(data, { ...widget, query: 'Resolved' }).nodes.length, 1)
})

test('public tables and grids contain only displayed data, never private records or diagnostics', () => {
  const data = dataset('malware', [{ id: 'secret-event', objectId: 'secret-object', name: 'Visible workload', details: 'SECRET EVIDENCE', severity: 'Critical', status: 'Active' }, { id: 'filtered-event', name: 'HIDDEN WORKLOAD', status: 'Resolved' }])
  const base = { ...fixture('malware', 'table'), columns: ['name', 'status'], query: 'Active', searchField: 'status' }
  const table = presentation.prepareWidget(data, base, true)
  assert.deepEqual(table.rows, [{ name: 'Visible workload', status: 'Active' }]); assert.deepEqual(table.warnings, [])
  const grid = presentation.prepareWidget(data, { ...base, view: 'grid' }, true)
  assert.equal(grid.nodes[0].count, 1); assert.equal(grid.nodes[0].records, undefined)
  for (const result of [table, grid]) for (const secret of ['secret-event', 'secret-object', 'SECRET EVIDENCE', 'HIDDEN WORKLOAD', 'Private host diagnostic', 'PRIVATE-HOST']) assert.ok(!JSON.stringify(result).includes(secret), secret)
  const safe = presentation.publicWidget({ ...base, filters: [{ field: 'name', op: 'not', value: 'SECRET-FILTER' }], hiddenSeries: ['SECRET-SERIES'], seriesNames: { 'secret-id': 'secret-alias' } })
  assert.deepEqual(safe.filters, []); assert.equal(safe.query, ''); assert.deepEqual(safe.seriesNames, {})
})

test('public split charts omit hidden series values, IDs, aggregate totals and source rows', () => {
  const data = dataset('history', [{ jobId: 'private-id', jobName: 'VISIBLE', time: '2026-10-30', duration: 10 }, { jobId: 'hidden-id', jobName: 'SECRET-JOB', time: '2026-10-30', duration: 9999 }])
  const widget = { ...fixture('history', 'line'), metrics: ['duration'] }, hidden = chartModel(data.rows, data, widget).series.find(s => s.name === 'SECRET-JOB')
  const result = presentation.prepareWidget(data, { ...widget, hiddenSeries: [hidden.id] }, true)
  assert.equal(result.chart.series.length, 1); assert.equal(result.chart.series[0].value, 10)
  for (const secret of ['private-id', 'hidden-id', 'SECRET-JOB', '9999', '10009']) assert.ok(!JSON.stringify(result).includes(secret), secret)
  assert.deepEqual(result.rows, []); assert.deepEqual(result.cards, []); assert.equal(result.chart.points[0].duration, undefined)
})

test('version two layouts inherit Branding, grouped cards and validated refresh preferences', () => {
  const widget = { ...fixture('malware', 'grid'), palette: 'atelier' }; delete widget.gridMode
  const board = model.parseBoard(JSON.stringify({ version: 2, name: 'Saved kiosk', widgets: [widget] }))
  assert.equal(board.version, 3); assert.equal(board.widgets[0].palette, 'brand'); assert.equal(board.widgets[0].gridMode, 'groups'); assert.deepEqual(board.refresh, { enabled: false, seconds: 60 })
  assert.equal(model.boardSchema.safeParse({ ...board, refresh: { enabled: true, seconds: 1 } }).success, false)
})

test('single-measure public charts do not export unused measures or all-hidden values', () => {
  const data = dataset('repositories', [{ id: 'repo-id', name: 'Visible repo', used: 10, capacity: 987654321 }])
  const widget = { ...fixture('repositories', 'donut'), metrics: ['used', 'capacity'] }
  const result = presentation.prepareWidget(data, widget, true)
  assert.equal(result.chart.series.length, 1); assert.equal(result.chart.points[0].used, 10)
  assert.ok(!JSON.stringify(result).includes('987654321'))
  const hidden = chartModel(data.rows, data, widget).series.map(s => s.id)
  const empty = presentation.prepareWidget(data, { ...widget, hiddenSeries: hidden }, true)
  assert.equal(empty.chart.series.length, 0); assert.equal(empty.chart.points.length, 0); assert.equal(empty.chart.visible.length, 0)
})

test('unavailable sources and incompatible-unit charts do not export unrendered readings', () => {
  const data = dataset('repositories', [{ id: 'repo-id', name: 'Visible repo', used: 10, utilization: 987654321 }])
  const widget = { ...fixture('repositories', 'bar'), metrics: ['used', 'utilization'] }
  const result = presentation.prepareWidget(data, widget, true)
  assert.equal(result.chart.units.length, 2); assert.deepEqual(result.chart.points, []); assert.deepEqual(result.chart.series, [])
  assert.ok(!JSON.stringify(result).includes('987654321'))
  const unavailable = presentation.prepareWidget({ ...data, available: false }, { ...widget, view: 'grid' }, true)
  assert.equal(unavailable.available, false); assert.deepEqual(unavailable.nodes, []); assert.equal(unavailable.matching, 0)
})

test('share ownership, password rotation, brute-force limits, persistence and revocation', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-sharing-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const store = load('lib/server/kiosk-shares.ts', {}, { process: { ...process, cwd: () => root } })
  const owner = store.opaqueToken(), source = { id: 'saved-source', binding: 'source-binding' }, input = { board: { ...model.emptyBoard(), widgets: [fixture()] }, theme: {}, mode: 'dark', access: 'password', password: 'synthetic-password' }
  const record = await store.publishShare(owner, source, input)
  assert.equal(store.validToken(record.id), true); assert.notEqual(record.owner, owner); assert.equal(record.password.hash.length, 128)
  assert.ok(!JSON.stringify(record).includes('synthetic-password')); assert.ok(!JSON.stringify(record).includes(owner))
  assert.equal((await store.listShares(owner, source.id)).length, 1); assert.equal((await store.listShares(store.opaqueToken(), source.id)).length, 0)
  await assert.rejects(() => store.publishShare(store.opaqueToken(), source, input, record.id), { status: 404 })
  await assert.rejects(() => store.revokeShare(record.id, owner, 'other-source'), { status: 404 })
  assert.equal(store.canView(record), false)
  await assert.rejects(() => store.unlockShare(record.id, 'wrong'), { status: 401 })
  const unlocked = await store.unlockShare(record.id, input.password)
  assert.equal(store.canView(record, unlocked.ticket), true); assert.equal(store.canView(record, unlocked.ticket + 'a'), false)
  assert.equal(store.canView(record, store.accessTicket(record, Date.now() - 100)), false)
  const republished = await store.publishShare(owner, source, { ...input, password: undefined }, record.id)
  assert.equal(store.canView(republished, unlocked.ticket), true)
  const rotated = await store.publishShare(owner, source, { ...input, password: 'replacement-password' }, record.id)
  assert.equal(store.canView(rotated, unlocked.ticket), false)
  for (let i = 0; i < 10; i++) await assert.rejects(() => store.unlockShare(record.id, 'wrong'), { status: 401 })
  await assert.rejects(() => store.unlockShare(record.id, 'replacement-password'), { status: 429 })
  const publicRecord = await store.publishShare(owner, source, { ...input, access: 'public', password: undefined }, record.id)
  assert.equal(store.canView(publicRecord), true); assert.equal(publicRecord.password, null)
  const persisted = load('lib/server/kiosk-shares.ts', {}, { process: { ...process, cwd: () => root } })
  assert.equal((await persisted.readShare(record.id)).revision, publicRecord.revision)
  await store.revokeShare(record.id, owner, source.id); assert.equal(await store.readShare(record.id), null)
  await assert.rejects(() => store.readShare('../../sources'), { status: 404 })
})

test('public hostname only permits viewer, data GET, unlock POST and static assets', () => {
  const { publicPathAllowed, configuredPublicOrigin } = require('../lib/labs/sharing.ts'), id = 'a'.repeat(43)
  for (const route of [`/share/kiosk/${id}`, `/api/public/kiosks/${id}`, '/_next/static/chunks/app.js', '/favicon.ico']) assert.equal(publicPathAllowed(route, 'GET'), true)
  assert.equal(publicPathAllowed(`/api/public/kiosks/${id}/unlock`, 'POST'), true)
  for (const route of ['/labs', '/connect', '/api/labs/shares', '/api/config', '/api/vbr/operations', '/api/proxy', '/api/public/kiosks/../config']) assert.equal(publicPathAllowed(route, 'GET'), false)
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal(publicPathAllowed(`/api/public/kiosks/${id}`, method), false)
  assert.equal(configuredPublicOrigin('https://kiosk.example'), 'https://kiosk.example')
  for (const url of ['file:///tmp', 'https://u:p@kiosk.example', 'https://kiosk.example/path', 'https://kiosk.example/?x']) assert.throws(() => configuredPublicOrigin(url))
})

test('public route enforces passwords before reading, ignores query overrides, and rechecks revocation', async () => {
  const store = require('../lib/server/kiosk-shares.ts'), id = 'a'.repeat(43), record = { id, revision: 'v1', password: { hash: 'x' }, accessSecret: 'secret' }
  let reads = 0, removed = false
  const h = load('app/api/public/kiosks/[id]/route.ts', {
    '@/lib/server/kiosk-shares': { ...store, readShare: async () => removed ? null : record },
    '@/lib/server/kiosk-http': { ACCESS_COOKIE: 'access', json: (body, status = 200) => ({ body, status }), failure: error => ({ status: error.status }) },
    '@/lib/server/kiosk-reader': { shareSource: () => {}, readPublicKiosk: async actual => { assert.equal(actual, record); reads++; removed = true; return { widgets: [] } } },
  })
  const request = ticket => ({ cookies: { get: () => ({ value: ticket }) }, nextUrl: new URL('https://kiosk.example/api/public/kiosks/' + id + '?source=evil&range=30d') }), context = { params: Promise.resolve({ id }) }
  assert.equal((await h.GET(request(), context)).status, 401); assert.equal(reads, 0)
  assert.equal((await h.GET(request(store.accessTicket(record)), context)).status, 404); assert.equal(reads, 1)
})

test('public reader uses only bound saved credentials and GET; caches without accepting source changes', async () => {
  const store = require('../lib/server/kiosk-shares.ts'), original = { id: 'synthetic-source', protocol: 'https', host: 'synthetic.invalid', port: 9419, username: 'reader', password: 'never-export' }
  let source = { ...original, platform: 'vbr' }, calls = 0, requested
  const h = load('lib/server/kiosk-reader.ts', {
    './config-store': { configStore: { getById: id => { assert.equal(id, original.id); return source } } },
    './token-manager': { tokenManager: { getToken: async id => { assert.equal(id, original.id); return 'private-token' } } },
    '../operations/load': { loadOperations: async read => { await read('/api/v1/jobs'); return { sourceName: '', fetchedAt: '', warnings: [], jobs: { data: [{ id: 'id', name: 'Visible job', status: 'Working' }], available: true, complete: true } } } },
  }, { fetch: async (url, options) => { calls++; requested = { url: url.href, options }; return { ok: true, json: async () => ({}) } } })
  const record = { id: 'a'.repeat(43), sourceId: original.id, sourceBinding: store.sourceBinding(original), revision: 'v1', updatedAt: '', theme: {}, mode: 'dark', board: { ...model.emptyBoard(), widgets: [fixture('jobs', 'grid')] } }
  const result = await h.readPublicKiosk(record)
  assert.equal(calls, 1); assert.equal(requested.options.method, 'GET'); assert.equal(requested.options.redirect, 'error'); assert.equal(requested.url, 'https://synthetic.invalid:9419/api/v1/jobs')
  assert.ok(!JSON.stringify(result).includes('private-token')); assert.ok(!JSON.stringify(result).includes('never-export')); assert.ok(!JSON.stringify(result).includes('synthetic.invalid'))
  await h.readPublicKiosk(record); assert.equal(calls, 1)
  source = { ...source, host: 'changed.invalid' }
  assert.throws(() => h.readPublicKiosk(record), { status: 503 })
})

test('sharing HTTP rejects cross-origin writes and oversized streamed bodies', async () => {
  const h = load('lib/server/kiosk-http.ts', { './config-store': { configStore: {} } })
  const request = headers => ({ nextUrl: new URL('http://internal:3000'), headers: new Headers({ host: 'backup.example', 'x-forwarded-proto': 'https', origin: 'https://backup.example', ...headers }) })
  assert.doesNotThrow(() => h.sameOrigin(request({})))
  for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' }]) assert.throws(() => h.sameOrigin(request(headers)), { status: 403 })
  const large = new Request('https://backup.example', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'a'.repeat(2000) }) })
  await assert.rejects(() => h.readBody(large, 1024), { status: 413 })
  assert.equal(plain(h.cookieOptions(request({}))).httpOnly, true); assert.equal(plain(h.cookieOptions(request({}))).secure, true)
})

test('management API binds publication to the saved source and owner cookie, never public input', async () => {
  const store = require('../lib/server/kiosk-shares.ts'), { NextRequest } = require('next/server')
  const savedSource = { id: 'trusted-source', platform: 'vbr', password: 'private', host: 'private.invalid', protocol: 'https', port: 9419, username: 'reader' }
  const http = load('lib/server/kiosk-http.ts', { './config-store': { configStore: { getById: id => id === savedSource.id ? savedSource : null } } }, { process: { ...process, env: { ...process.env, KIOSK_PUBLIC_ORIGIN: 'https://kiosk.example' } } })
  const stored = [], removed = [], apiStore = { ...store,
    publishShare: async (owner, source, input, id) => { const prior = id && stored.find(r => r.id === id); if (id && prior?.owner !== store.digest(owner)) throw new store.ShareError('Not found', 404); const record = { id: id ?? store.opaqueToken(), owner: store.digest(owner), sourceId: source.id, sourceBinding: source.binding, board: input.board, password: input.access === 'password' ? { hash: 'secret-hash' } : null, updatedAt: 'now' }; stored.push(record); return record },
    listShares: async (owner, sourceId) => stored.filter(r => r.owner === store.digest(owner) && r.sourceId === sourceId),
    revokeShare: async (id, owner, sourceId) => { removed.push({ id, owner, sourceId }) },
  }
  const modules = { '@/lib/server/kiosk-shares': apiStore, '@/lib/server/kiosk-http': http }
  const collection = load('app/api/labs/shares/route.ts', modules), single = load('app/api/labs/shares/[id]/route.ts', modules)
  const input = { board: { ...model.emptyBoard(), widgets: [fixture()] }, theme: {}, mode: 'dark', access: 'password', password: 'synthetic-password', sourceId: 'attacker-source' }
  const request = (method, body, owner) => new NextRequest('https://console.example/api/labs/shares', { method, headers: { origin: 'https://console.example', host: 'console.example', 'content-type': 'application/json', cookie: `veeam_source_id=${savedSource.id}${owner ? `; kiosk-share-owner=${owner}` : ''}` }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const created = await collection.POST(request('POST', input)), payload = await created.json(), owner = created.cookies.get(http.OWNER_COOKIE).value
  assert.equal(created.status, 201); assert.equal(payload.share.protected, true); assert.equal(stored[0].sourceId, savedSource.id); assert.equal(stored[0].sourceBinding, store.sourceBinding(savedSource))
  for (const secret of ['secret-hash', 'synthetic-password', 'private.invalid', owner]) assert.ok(!JSON.stringify(payload).includes(secret))
  assert.equal((await (await collection.GET(request('GET', null, owner))).json()).shares.length, 1)
  assert.equal((await (await collection.GET(request('GET'))).json()).shares.length, 0)
  const context = { params: Promise.resolve({ id: payload.share.id }) }
  assert.equal((await single.PUT(request('PUT', input), context)).status, 404)
  assert.equal((await single.PUT(request('PUT', input, store.opaqueToken()), context)).status, 404)
  assert.equal((await single.PUT(request('PUT', input, owner), context)).status, 200)
  assert.equal((await single.DELETE(request('DELETE', null, owner), context)).status, 200)
  assert.equal(removed[0].sourceId, savedSource.id); assert.equal(removed[0].owner, owner)
})
