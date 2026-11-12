// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm'), assert = require('node:assert/strict'), { test } = require('node:test')
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
require.extensions['.ts'] = (mod, file) => mod._compile(compile(file), file)
const m = require('../lib/labs/model.ts'), d = require('../lib/labs/data.ts')
const widget = patch => ({ ...m.createWidget('history', 'bar', { x: 0, y: 0, w: 600, h: 400 }, 'w1'), groupBy: 'status', ...patch })
const dataset = rows => ({ rows, fields: [{ key: 'name', type: 'text' }, { key: 'status', type: 'text' }, { key: 'duration', type: 'number' }, { key: 'time', type: 'date' }], available: true, complete: true, warnings: [], sourceName: 'Test', fetchedAt: '2026-10-30T12:00:00Z' })
const collection = data => ({ data, available: true, complete: true })
const operations = patch => ({ sourceName: 'Test', fetchedAt: '2026-10-30T12:00:00Z', from: '2026-10-29T12:00:00Z', range: '24h', warnings: [], jobs: collection([]), sessions: collection([]), repositories: collection([]), security: collection([]), ...patch })
const layout = require('../lib/labs/layout.ts'), { chartModel } = require('../lib/labs/chart.ts')

test('repository and history defaults name the entities being measured', () => {
  const repo = m.createWidget('repositories', 'bar', { x: 20, y: 20, w: 600, h: 400 }, 'repo')
  assert.equal(repo.groupBy, 'name'); assert.deepEqual(repo.metrics, ['used']); assert.equal(repo.horizontal, true)
  const history = m.createWidget('history', 'line', repo, 'history')
  assert.equal(history.groupBy, 'time'); assert.equal(history.splitBy, 'jobName')
  const table = m.createWidget('history', 'table', repo, 'table')
  assert.ok(table.columns.includes('jobName')); assert.equal(table.labelField, 'jobName')
})

test('repository identity keeps same-named stores separate and values correctly attached', () => {
  const data = { ...dataset([{ id: 'repo-a', name: 'Store', used: 10 }, { id: 'repo-b', name: 'Store', used: 20 }]), fields: d.fieldsFor('repositories') }
  const w = m.createWidget('repositories', 'donut', { x: 20, y: 20, w: 600, h: 400 }, 'repo')
  const result = chartModel(data.rows, data, w)
  assert.equal(result.visible.length, 2); assert.deepEqual(result.visible.map(g => g.used), [20, 10])
  assert.ok(result.visible.every(g => g.name.startsWith('Store · repo-')))
})

test('job identity joins inventory names without guessing from session names', () => {
  const session = (id, jobId) => ({ id, name: 'Ambiguous session', jobId, sessionType: 'BackupJob', state: 'Stopped', creationTime: '2026-10-30T01:00:00Z', result: { result: 'Success' } })
  const data = d.toDataset('history', operations({ jobs: collection([{ id: 'JOB-A', name: 'Nightly SQL' }]), sessions: collection([session('s1', 'job-a'), session('s2', 'JOB-A'), session('s3', 'unknown')]) }))
  assert.equal(data.rows[0].jobName, 'Nightly SQL'); assert.equal(data.rows[0].name, 'Ambiguous session')
  assert.equal(data.rows[2].jobNameSource, 'Reported session name')
  const groups = m.groupRows(data.rows, data, widget({ groupBy: 'jobName' }))
  assert.equal(groups.all.find(g => g.name === 'Nightly SQL').count, 2)
})

test('time series pivot by job ID and leave missing samples unknown', () => {
  const data = { ...dataset([{ id: 's1', jobId: 'a', jobName: 'SQL', time: '2026-10-29T01:00:00Z', duration: 10 }, { id: 's2', jobId: 'a', jobName: 'SQL', time: '2026-10-30T01:00:00Z', duration: 30 }, { id: 's3', jobId: 'b', jobName: 'Files', time: '2026-10-30T01:00:00Z', duration: 0 }]), fields: d.fieldsFor('history') }
  const w = widget({ view: 'line', groupBy: 'time', splitBy: 'jobName', metrics: ['duration'], aggregate: 'avg' })
  const result = chartModel(data.rows, data, w)
  const sql = result.series.find(s => s.name === 'SQL'), files = result.series.find(s => s.name === 'Files')
  assert.equal(sql.value, 20); assert.equal(result.points[0][sql.key], 10); assert.equal(result.points[1][sql.key], 30)
  assert.equal(result.points[0][files.key], null); assert.equal(result.points[1][files.key], 0)
  const edited = chartModel(data.rows, data, { ...w, seriesNames: { [sql.id]: 'Database backups' }, hiddenSeries: [files.id] })
  assert.equal(edited.series.length, 1); assert.equal(edited.series[0].id, sql.id); assert.equal(edited.series[0].name, 'Database backups')
})

test('series limits apply after visibility and aliases cannot become object paths', () => {
  const data = { ...dataset([{ time: '2026-10-30', status: '__proto__' }, { time: '2026-10-30', status: 'x.y[0]' }]), fields: d.fieldsFor('history') }
  const w = widget({ view: 'line', groupBy: 'time', splitBy: 'status', seriesLimit: 1 })
  const initial = chartModel(data.rows, data, w)
  const next = chartModel(data.rows, data, { ...w, hiddenSeries: [initial.series[0].id] })
  assert.equal(next.series.length, 1); assert.notEqual(next.series[0].id, initial.series[0].id)
  assert.ok(next.series.every(s => /^v\d+$/.test(s.key))); assert.equal(next.points[0][next.series[0].key], 1)
})

test('per-measure calculations preserve weighted averages and expose incompatible units', () => {
  const data = { ...dataset([{ name: 'a', status: 'ok', progress: 20, duration: 10 }, { name: 'b', status: 'ok', progress: 40, duration: 50 }, { name: 'c', status: 'fail', progress: 90, duration: null }]), fields: d.fieldsFor('history') }
  const w = widget({ metrics: ['progress', 'duration'], metricNames: { progress: 'Completion' }, metricAggregates: { duration: 'max' } })
  const result = chartModel(data.rows, data, w)
  assert.equal(result.series[0].value, 50); assert.equal(result.series[0].name, 'Completion'); assert.equal(result.series[1].value, 50)
  assert.equal(result.units.size, 2)
})

test('version one migration retains configuration and identities while separating old overlaps', () => {
  const legacy = widget({ title: 'My saved outcomes', groupBy: 'status', metrics: ['duration'], query: 'SQL' })
  for (const key of ['splitBy', 'seriesLimit', 'hiddenSeries', 'seriesNames', 'metricNames', 'metricAggregates', 'legendValues', 'labelMode', 'labelField', 'detailField', 'kpiMode', 'horizontal']) delete legacy[key]
  const board = m.parseBoard(JSON.stringify({ version: 1, name: 'Personal board', widgets: [legacy, { ...legacy, id: 'two' }] }))
  assert.equal(board.version, 3); assert.equal(board.widgets[0].kpiMode, 'total'); assert.equal(board.widgets[0].title, legacy.title)
  assert.equal(board.widgets[0].query, 'SQL'); assert.equal(board.widgets[0].groupBy, 'status')
  assert.equal(layout.overlaps(...board.widgets, board.layout.gap), false)
  assert.deepEqual(m.parseBoard(JSON.stringify(board)), board)
})

test('layout bounds retain outer padding and nearest placement never overlaps neighbours', () => {
  const a = { x: 40, y: 40, w: 600, h: 400 }
  const b = layout.placeBox(a, [a], 40)
  assert.equal(layout.canPlace(b, [a], 40), true); assert.equal(b.y, 480); assert.equal(b.x, 40)
  const edge = layout.placeBox({ x: -100, y: -100, w: 1600, h: 400 }, [], 80)
  assert.deepEqual(edge, { x: 80, y: 80, w: 1280, h: 400 })
})

test('magnetic alignment yields guides and preserves the requested gutter', () => {
  const a = { x: 40, y: 40, w: 400, h: 300 }
  const result = layout.magnetBox({ x: 490, y: 50, w: 400, h: 300 }, [a], 40, 24)
  assert.equal(result.box.x, 480); assert.equal(result.box.y, 40); assert.ok(result.guides.some(g => g.axis === 'y' && g.position === 40))
  assert.ok(layout.canPlace(result.box, [a], 40))
})

test('resizing anchors top-left and repels neighbours while preserving the chosen size and gap', () => {
  const original = { id: 'a', x: 40, y: 40, w: 400, h: 300 }, right = { id: 'b', x: 600, y: 40, w: 400, h: 600 }, below = { id: 'c', x: 40, y: 600, w: 400, h: 400 }
  const result = layout.repelLayout([original, right, below], original.id, { ...original, w: 1000, h: 1000 }, 40, 'resize')
  assert.deepEqual(result[0], { ...original, w: 1000, h: 1000 })
  assert.equal(result[1].y, 1080); assert.equal(result[2].y, 1080)
  for (const item of result) assert.ok(layout.canPlace(item, result.filter(w => w.id !== item.id), 40))
  assert.equal(right.y, 40); assert.equal(below.y, 600)
})

test('repel cascades right then below at the canvas edge and restores the original gesture baseline', () => {
  const input = ['a', 'b', 'c'].map((id, i) => ({ id, x: 20 + i * 420, y: 20, w: 400, h: 300, title: id }))
  const moved = layout.repelLayout(input, 'a', { ...input[0], w: 600 }, 20, 'resize')
  assert.equal(moved[1].x, 640); assert.equal(moved[1].y, 20)
  assert.equal(moved[2].x, 860); assert.equal(moved[2].y, 340)
  assert.deepEqual(layout.repelLayout(input, 'a', input[0], 20, 'resize'), input)
  for (const item of moved) { assert.equal(item.title, item.id); assert.ok(layout.canPlace(item, moved.filter(w => w.id !== item.id), 20)) }
})

test('repel cascades down through multiple rows, and moving a widget can push to the left', () => {
  const column = ['a', 'b', 'c'].map((id, i) => ({ id, x: 20, y: 20 + i * 320, w: 400, h: 300 }))
  const moved = layout.repelLayout(column, 'a', { ...column[0], h: 500 }, 20, 'resize')
  assert.deepEqual(moved.map(w => w.y), [20, 540, 860])
  const row = [{ id: 'left', x: 300, y: 20, w: 240, h: 300 }, { id: 'active', x: 700, y: 20, w: 300, h: 300 }]
  const left = layout.repelLayout(row, 'active', { ...row[1], x: 500 }, 20)
  assert.equal(left[0].x, 240); assert.equal(left[1].x, 500)
})

test('repel stays deterministic, bounded and disjoint across dense boards and all gutters', () => {
  let seed = 1523
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n }
  for (const gap of [20, 40, 60, 80]) {
    const initial = layout.normalizeLayout(Array.from({ length: 24 }, (_, i) => ({ id: String(i), x: gap, y: gap, w: 240 + random(25) * 20, h: 200 + random(15) * 20 })), gap)
    for (let step = 0; step < 35; step++) {
      const active = initial[random(initial.length)], mode = step % 2 ? 'resize' : 'move'
      const requested = { ...active, x: random(75) * 20, y: random(150) * 20, w: 240 + random(50) * 20, h: 200 + random(35) * 20 }
      const result = layout.repelLayout(initial, active.id, requested, gap, mode)
      assert.deepEqual(layout.repelLayout(initial, active.id, requested, gap, mode), result)
      for (const item of result) assert.ok(layout.canPlace(item, result.filter(w => w.id !== item.id), gap), `gap=${gap}, step=${step}, id=${item.id}`)
      if (mode === 'resize') { const resized = result.find(w => w.id === active.id); assert.equal(resized.x, active.x); assert.equal(resized.y, active.y) }
    }
  }
})

test('forty large imported widgets grow the canvas without losing content or padding', () => {
  const input = Array.from({ length: 40 }, (_, i) => ({ x: 0, y: 0, w: 1440, h: 2400, id: String(i), title: 'Keep me' }))
  const result = layout.normalizeLayout(input, 80)
  assert.equal(result.length, 40); assert.equal(new Set(result.map(w => w.id)).size, 40)
  for (const w of result) assert.ok(layout.canPlace(w, result.filter(other => other !== w), 80))
  assert.ok(layout.canvasHeight(result, 80) > 2400); assert.ok(layout.canvasHeight(result, 80) <= layout.MAX_CANVAS_HEIGHT)
  assert.deepEqual(layout.normalizeLayout(result, 80), result)
})

test('tidying and changing spacing preserve widget configuration', () => {
  const input = [widget({ x: 100, y: 100 }), widget({ x: 740, y: 300, id: 'two', title: 'Named capacity' })]
  const result = layout.tidyLayout(layout.normalizeLayout(input, 60), 60)
  for (const w of result) { assert.ok(layout.canPlace(w, result.filter(other => other !== w), 60)); assert.equal(w.title, input.find(o => o.id === w.id).title) }
  assert.equal(result[0].x, 60); assert.equal(result[0].y, 60)
})
test('numeric aggregations distinguish unknown evidence, actual zero and empty counts', () => {
  assert.equal(m.aggregate([{ duration: null }], 'duration', 'sum'), null)
  assert.equal(m.aggregate([], 'duration', 'sum'), null)
  assert.equal(m.aggregate([], 'count', 'sum'), 0)
  assert.equal(m.aggregate([{ duration: 0 }, { duration: null }, { duration: 10 }], 'duration', 'avg'), 5)
  assert.equal(m.aggregate([{ duration: 0 }, { duration: null }], 'duration', 'min'), 0)
})

test('fast sources publish while a slow source is pending, and requests remain deduplicated', async () => {
  let resolveMalware
  const slow = new Promise(resolve => { resolveMalware = resolve })
  const exports = {}, calls = [], emitted = []
  vm.runInNewContext(compile('lib/labs/data.ts'), { exports, Error, Map, Set, require: name => {
    if (name === '../api/application-request') return { applicationRequest: async path => { calls.push(path); return path.includes('ransomware') ? slow : operations({ repositories: collection([{ id: 'r', name: 'Store', capacityGB: 100, freeGB: 40 }]) }) } }
    if (name === '../operations/model') return require('../lib/operations/model.ts')
    if (name === '../protected-data/model') return require('../lib/protected-data/model.ts')
    if (name === './catalog') return require('../lib/labs/catalog.ts')
    if (name === './model') return m
    if (name === './monitoring-data') return require('../lib/labs/monitoring-data.ts')
    throw new Error(name)
  } })
  const loading = exports.loadDatasets([{ source: 'repositories', range: '7d' }, { source: 'jobs', range: '7d' }, { source: 'malware', range: '7d' }], new AbortController().signal, (key, value) => emitted.push([key, value]))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(emitted.map(([key]) => key), ['repositories:7d', 'jobs:7d']); assert.equal(calls.length, 2)
  assert.equal(emitted[0][1].rows[0].used, 60)
  resolveMalware({ sourceName: 'Test', fetchedAt: '', warnings: [], events: collection([]) })
  const result = await loading
  assert.equal(Object.keys(result).length, 3); assert.equal(emitted.length, 3)
})
test('search and multiple predicates preserve field types, dates and unknowns', () => {
  const data = dataset([{ name: 'Database', status: 'Failed', duration: 0, time: '2026-10-30T03:00:00Z' }, { name: 'Database 2', status: 'Success', duration: null, time: null }])
  assert.equal(m.filterRows(data, widget({ query: ' database ', filters: [{ field: 'status', op: 'equals', value: 'failed' }, { field: 'time', op: 'gt', value: '2026-10-30' }] })).length, 1)
  assert.equal(m.filterRows(data, widget({ filters: [{ field: 'duration', op: 'lt', value: '1' }] })).length, 1)
  assert.equal(m.filterRows(data, widget({ filters: [{ field: 'duration', op: 'empty', value: '' }] })).length, 1)
  assert.equal(m.filterRows(data, widget({ searchField: 'status', query: 'database' })).length, 0)
  assert.equal(m.filterRows(data, widget({ filters: [{ field: 'duration', op: 'gt', value: '' }] })).length, 0)
})
test('grouping handles prototype-like source values safely and hides categories before limiting', () => {
  const data = dataset([{ status: '__proto__', duration: 9 }, { status: 'Failed', duration: null }, { status: 'Failed', duration: 3 }, { status: 'Success', duration: 7 }])
  const groups = m.groupRows(data.rows, data, widget({ metrics: ['count', 'duration'], hidden: ['Failed'], limit: 1 }))
  assert.equal(groups.all.length, 3); assert.equal(groups.visible.length, 1)
  assert.ok(groups.all.some(g => g.name === '__proto__' && g.duration === 9))
  assert.notEqual(groups.visible[0].name, 'Failed')
})
test('time buckets are ordered in UTC and do not invent empty historical readings', () => {
  const data = dataset([{ time: '2026-10-30T13:30:00+02:00' }, { time: '2026-10-28T00:10:00Z' }, { time: null }])
  const groups = m.groupRows(data.rows, data, widget({ groupBy: 'time', bucket: 'day' }))
  assert.deepEqual(groups.all.map(g => g.name), ['2026-10-28T00:00:00.000Z', '2026-10-30T00:00:00.000Z', 'Not reported'])
  const nodes = m.groupRows(data.rows, data, widget({ view: 'grid', groupBy: 'time', hidden: ['2026-10-30T13:30:00+02:00'] }))
  assert.equal(nodes.isDate, false); assert.equal(nodes.visible.length, 2)
})
test('sorting never places missing numeric evidence first and does not mutate rows', () => {
  const rows = [{ duration: null }, { duration: 12 }, { duration: 0 }]
  assert.deepEqual(m.sortRows(rows, widget({ sort: 'duration', direction: 'asc' })).map(r => r.duration), [0, 12, null])
  assert.equal(rows[0].duration, null)
})
test('layout files validate bounds, unique IDs, metric names, size and version', () => {
  const board = { ...m.emptyBoard(), widgets: [widget()] }
  assert.equal(m.parseBoard(JSON.stringify(board)).widgets.length, 1)
  for (const invalid of [{ ...board, version: 4 }, { ...board, widgets: [widget(), widget()] }, { ...board, widgets: [widget({ x: 1400 })] }, { ...board, widgets: [widget({ metrics: ['__proto__'] })] }, { ...board, widgets: [widget({ metrics: ['capacity'] })] }, { ...board, widgets: [widget({ metrics: ['count', 'count'] })] }, { ...board, widgets: [widget({ groupBy: 'missing' })] }, { ...board, widgets: Array.from({ length: 41 }, (_, i) => widget({ id: String(i) })) }]) assert.throws(() => m.parseBoard(JSON.stringify(invalid)))
  assert.throws(() => m.parseBoard('x'.repeat(500001)))
  assert.deepEqual(m.fitBox({ x: -15, y: 2399, w: 399, h: 2 }), { x: 0, y: 2200, w: 400, h: 200 })
})
test('all source and visualization defaults create valid, bounded layouts', () => {
  for (const source of m.sources) for (const view of m.views) {
    const w = m.createWidget(source.id, view.id, { x: 20, y: 20, w: 500, h: 300 }, 'test')
    assert.equal(m.widgetSchema.safeParse(w).success, true)
    assert.ok(d.fieldsFor(source.id).some(f => f.key === w.groupBy), `${source.id}/${view.id}: ${w.groupBy}`)
  }
})
test('history is limited to protection sessions within the reported window and retains active state', () => {
  const session = patch => ({ id: 's', name: 'Session', sessionType: 'BackupJob', state: 'Working', creationTime: '2026-10-30T01:00:00Z', result: { result: 'Failed' }, ...patch })
  const data = d.toDataset('history', operations({ sessions: collection([session({}), session({ id: 'restore', sessionType: 'RestoreVm' }), session({ id: 'old', creationTime: '2026-10-28T00:00:00Z' })]) }))
  assert.equal(data.rows.length, 1); assert.equal(data.rows[0].status, 'Working'); assert.equal(data.rows[0].duration, null)
})
test('current job status does not mistake a running retry for its old failed result', () => {
  const data = d.toDataset('jobs', operations({ jobs: collection([{ id: 'j', name: 'Retry', status: 'Running', lastResult: 'Failed', objectsCount: -1 }]) }))
  assert.equal(data.rows[0].status, 'Running'); assert.equal(data.rows[0].result, 'Failed'); assert.equal(data.rows[0].objects, null)
})
test('capacity excludes aggregate parents and preserves missing or impossible readings', () => {
  const data = d.toDataset('repositories', operations({ repositories: collection([{ id: 'parent', name: 'SOBR', capacityGB: 100, freeGB: 50 }, { id: 'extent', name: 'Extent', capacityGB: 100, freeGB: 50, scaleOutRepositoryDetails: { scaleOutRepositoryId: 'parent' } }, { id: 'invalid', name: 'Invalid', capacityGB: 10, freeGB: 20 }]) }))
  assert.equal(data.rows.length, 2); assert.equal(data.rows[0].used, 50); assert.equal(data.rows[1].used, null)
})
test('unique objects fold backup copies by identity and preserve incomplete recovery counts', () => {
  const raw = { sourceName: 'Test', fetchedAt: '', warnings: [], objectsComplete: true, backups: collection([]), latest: {}, data: [
    { id: 'o1', backupId: 'b1', name: 'Same', size: 100, restorePointsCount: 3, lastRunFailed: false },
    { id: 'o1', backupId: 'b2', name: 'Same', size: 120, restorePointsCount: null, lastRunFailed: true },
    { id: 'o2', backupId: 'b1', name: 'Same', size: 0, restorePointsCount: 0 },
  ] }
  const copies = d.toDataset('protected', raw), objects = d.toDataset('objects', raw)
  assert.equal(copies.rows.length, 3); assert.equal(objects.rows.length, 2)
  assert.equal(objects.rows[0].size, 120); assert.equal(objects.rows[0].points, null); assert.equal(objects.rows[0].copies, 2); assert.equal(objects.rows[0].status, 'Restore points available'); assert.equal(objects.rows[0].run, 'Failed')
})
test('unavailable and partial sources preserve evidence flags; malware never promotes heuristics to detections', () => {
  assert.equal(d.toDataset('jobs', operations({ jobs: { data: [], available: false, complete: false } })).available, false)
  assert.equal(d.toDataset('history', operations({ sessions: { data: [], available: true, complete: false } })).complete, false)
  const data = d.toDataset('malware', { sourceName: 'Test', fetchedAt: '', warnings: [], events: collection([]), anomalies: [{ id: 'heuristic' }] })
  assert.equal(data.rows.length, 0)
})
function preferenceHarness(value) {
  const exports = {}, saved = []
  class Response { static json(body, init = {}) { return { body, status: init.status || 200, headers: init.headers, cookies: { set: (...args) => saved.push(args) } } } }
  vm.runInNewContext(compile('app/api/settings/labs/route.ts'), { exports, require: name => ({ 'next/server': { NextResponse: Response }, 'next/headers': { cookies: async () => ({ get: () => ({ value }) }) }, '@/lib/labs/model': m, '@/lib/server/request-origin': require('../lib/server/request-origin.ts') }[name]) })
  const request = (body, headers = {}) => ({ nextUrl: new URL('https://local/api/settings/labs'), headers: new Headers({ origin: 'https://local', ...headers }), text: async () => typeof body === 'string' ? body : JSON.stringify(body) })
  return { exports, saved, request }
}
test('Labs is opt-in and persists only a browser-scoped secure preference', async () => {
  for (const value of [undefined, '', 'false', 'TRUE']) assert.equal((await preferenceHarness(value).exports.GET()).body.enabled, false)
  const h = preferenceHarness('true'); assert.equal((await h.exports.GET()).body.enabled, true)
  assert.equal((await h.exports.PUT(h.request({ enabled: false }))).status, 200)
  const [name, value, options] = h.saved[0]; assert.equal(name, m.LABS_COOKIE); assert.equal(value, 'false'); assert.equal(options.httpOnly, true); assert.equal(options.secure, true); assert.equal(options.sameSite, 'lax')
})
test('Labs preference rejects cross-site writes, oversized payloads and malformed booleans', async () => {
  for (const body of [null, [], {}, { enabled: 'true' }, { enabled: true, extra: 1 }, 'x'.repeat(1001)]) { const h = preferenceHarness(); assert.equal((await h.exports.PUT(h.request(body))).status, 400); assert.equal(h.saved.length, 0) }
  for (const headers of [{ origin: 'https://other.test' }, { 'sec-fetch-site': 'cross-site' }]) { const h = preferenceHarness(); assert.equal((await h.exports.PUT(h.request({ enabled: true }, headers))).status, 403); assert.equal(h.saved.length, 0) }
})
test('Labs settings accept the actual host behind HTTPS termination and reject unrelated origins', async () => {
  const h = preferenceHarness(), request = h.request({ enabled: true }, { host: 'backup.example:3443', origin: 'https://backup.example:3443', 'x-forwarded-proto': 'https' })
  request.nextUrl = new URL('http://localhost:3000/api/settings/labs')
  assert.equal((await h.exports.PUT(request)).status, 200); assert.equal(h.saved[0][2].secure, true)
  const other = h.request({ enabled: true }, { host: 'backup.example', origin: 'https://other.example', 'x-forwarded-host': 'other.example', 'x-forwarded-proto': 'https' })
  assert.equal((await h.exports.PUT(other)).status, 403)
})
