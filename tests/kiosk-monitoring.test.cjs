/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), vm = require('node:vm'), assert = require('node:assert/strict'), { test } = require('node:test')
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
require.extensions['.ts'] = (mod, file) => mod._compile(compile(file), file)
const { forecastDataset } = require('../lib/labs/forecast-data.ts'), { monitoringDataset } = require('../lib/labs/monitoring-data.ts')
const model = require('../lib/labs/model.ts'), { recommendedViews } = require('../lib/labs/chart.ts'), { prepareWidget, publicWidget } = require('../lib/labs/presentation.ts')
const { DAY, GB, projectBackup } = require('../lib/forecast/model.ts'), now = Date.parse('2026-10-30T12:00:00Z')
const collection = data => ({ data, available: true, complete: true })
const snapshot = () => ({ fetchedAt: new Date(now).toISOString(), sourceName: 'Private server', warnings: [], repositories: collection([]), scaleOut: collection([]), configs: collection([]), policies: collection([]), backups: collection([]), objects: collection([]), observations: [], historyAvailable: true })
const repo = (id = 'repo') => ({ id, name: 'Repository ' + id, type: 'LinuxLocal', capacityGB: 100, freeGB: 50 })
const fixture = (source = 'forecast', view = 'line') => model.createWidget(source, view, { x: 20, y: 20, w: 600, h: 400 }, 'widget')
const load = (file, mocks = {}, globals = {}) => {
  const exports = {}, real = require('node:module').createRequire(path.resolve(file))
  vm.runInNewContext(compile(file), { exports, require: key => key in mocks ? mocks[key] : real(key), process, Buffer, URL, URLSearchParams, Headers, AbortController, setTimeout, clearTimeout, ...globals }, { filename: file })
  return exports
}
function modeled() {
  const data = snapshot(); data.repositories.data.push(repo())
  data.configs.data.push({ id: 'repo', type: 'LinuxLocal', repository: { enableGovernanceMode: false, useFastCloningOnXFSVolumes: false } })
  data.policies.data.push({ id: 'job', name: 'Nightly', type: 'VSphereBackup', isDisabled: false, schedule: { runAutomatically: true, daily: { isEnabled: true, dailyKind: 'Everyday' } }, storage: { retentionPolicy: { type: 'RestorePoints', quantity: 3 }, gfsPolicy: { isEnabled: false }, advancedSettings: { backupModeType: 'Incremental', syntheticFulls: { isEnabled: false }, activeFulls: { isEnabled: false } } } })
  data.backups.data.push({ id: 'backup', name: 'Database backup', jobId: 'job', repositoryId: 'repo', complete: true, latestPoint: { state: 'verified', at: new Date(now - 2 * DAY).toISOString() }, files: Array.from({ length: 5 }, (_, i) => ({ id: 'file' + i, backupId: 'backup', objectIds: ['vm'], name: `vm.${i ? 'vib' : 'vbk'}`, creationTime: new Date(now - (4 - i) * DAY - 3600000).toISOString(), backupSize: (i ? 10 : 100) * GB, gfsPeriods: ['None'] })) })
  return data
}

test('local widget IDs work on LAN HTTP without crypto.randomUUID', () => {
  const { webcrypto } = require('node:crypto')
  const lan = load('lib/labs/model.ts', {}, { crypto: { getRandomValues: bytes => webcrypto.getRandomValues(bytes) } })
  const ids = Array.from({ length: 100 }, () => lan.newWidgetId())
  assert.equal(new Set(ids).size, 100); assert.ok(ids.every(id => /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/.test(id)))
})

test('all catalog defaults and useful presets validate, including older saved boards', () => {
  for (const source of model.sources) for (const view of model.views) {
    const widget = fixture(source.id, view.id)
    assert.equal(model.widgetSchema.safeParse(widget).success, true, source.id + '/' + view.id)
    for (const preset of recommendedViews(source.id)) assert.equal(model.widgetSchema.safeParse({ ...widget, ...preset.patch }).success, true, source.id + '/' + preset.name)
  }
  const old = fixture('jobs', 'grid'); delete old.repositoryId; delete old.forecastMode; delete old.horizon
  const parsed = model.parseBoard(JSON.stringify({ ...model.emptyBoard(), widgets: [old] }))
  assert.equal(parsed.widgets[0].repositoryId, ''); assert.equal(parsed.widgets[0].horizon, 30)
  assert.equal(model.widgetSchema.safeParse({ ...fixture(), metrics: ['password'] }).success, false)
})

test('cold cache, removed repositories and unknown readings stay explicit; real zero survives', () => {
  assert.equal(forecastDataset(null, 'forecast').emptyReason, 'cache-empty')
  const data = snapshot(); data.repositories.data.push({ ...repo('a'), capacityGB: -1, freeGB: -1 }, { ...repo('b'), freeGB: 100 })
  const result = forecastDataset(data, 'forecast')
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].repositoryId, 'b'); assert.equal(result.rows[0].recorded, 0); assert.equal(result.rows[0].projected, null)
  assert.equal(forecastDataset(data, 'forecast', { repositoryId: 'gone' }).emptyReason, 'repository-missing')
  assert.equal(forecastDataset(data, 'forecast', { repositoryId: 'a' }).emptyReason, 'no-projection')
  const runway = forecastDataset(data, 'runway').rows[0]
  for (const field of ['used', 'free', 'capacity', 'growth', 'days80', 'projected30']) assert.equal(runway[field], null, field)
})

test('repository selection and 90 day capacity trend preserve cache time and exclude aggregate parents', () => {
  const data = snapshot(); data.repositories.data.push(repo('a'), repo('b'), { ...repo('parent'), type: 'ScaleOut' }); data.scaleOut.data.push({ id: 'parent' })
  data.observations = [0, 1, 2].map(i => ({ id: 'b', at: new Date(now - (2 - i) * DAY).toISOString(), capacityGB: 100, freeGB: 60 - i * 5 }))
  data.observations.push({ id: 'b', at: new Date(now - 3600000).toISOString(), capacityGB: 100, freeGB: 51 })
  data.cache = { stale: true, refreshing: true }
  const original = JSON.stringify(data), result = forecastDataset(data, 'forecast', { repositoryId: 'b', horizon: 90 })
  assert.equal(result.rows.length, 93); assert.equal(result.rows[2].recorded, 50 * GB); assert.equal(result.rows.at(-1).projected, 500 * GB)
  assert.ok(result.rows.every(r => r.repositoryId === 'b')); assert.equal(result.repositories.length, 2)
  assert.equal(result.fetchedAt, data.fetchedAt); assert.equal(result.freshness.stale, true); assert.equal(result.freshness.refreshing, true)
  assert.equal(JSON.stringify(data), original)
  const runway = forecastDataset(data, 'runway', { repositoryId: 'b' }).rows[0]
  assert.equal(runway.growth, 5); assert.equal(runway.days80, 6); assert.equal(runway.projected30, 200); assert.equal(runway.projected60, 350); assert.equal(runway.projected90, 500)
})

test('file scenarios reuse policy projection and refuse duplicate files; partial coverage stays marked', () => {
  const data = modeled(), baseline = projectBackup(data.backups.data[0], data.policies.data[0], data.configs.data[0], now, 60)
  const result = forecastDataset(data, 'forecast', { repositoryId: 'repo', forecastMode: 'files', horizon: 60 })
  assert.equal(result.rows.length, 91); assert.equal(result.rows.at(-1).projected, baseline.values[60].bytes); assert.equal(result.rows.at(-1).peak, baseline.values[60].peak)
  assert.equal(result.complete, true); assert.match(result.warnings.join(' '), /not historical disk/)
  data.backups.data.push({ id: 'unmodeled', repositoryId: 'repo', complete: false, files: [] })
  assert.equal(forecastDataset(data, 'forecast', { forecastMode: 'files' }).complete, false)
  data.backups.data.push({ ...data.backups.data[0], id: 'alias' })
  assert.equal(forecastDataset(data, 'forecast', { forecastMode: 'files' }).emptyReason, 'no-projection')
})

test('footprint, retention and hygiene retain their different evidence meanings', () => {
  const data = modeled(), footprint = forecastDataset(data, 'footprint').rows[0]
  assert.equal(footprint.size, 140 * GB); assert.equal(footprint.projected30, 120 * GB); assert.equal(footprint.job, 'Nightly')
  assert.equal(forecastDataset(data, 'hygiene').rows[0].age, 2)
  delete data.backups.data[0].latestPoint
  const hygiene = forecastDataset(data, 'hygiene')
  assert.equal(hygiene.complete, false); assert.equal(hygiene.rows[0].age, null); assert.equal(hygiene.rows[0].time, null); assert.ok(hygiene.rows[0].latestFile)
  const retention = forecastDataset(data, 'retention')
  assert.equal(retention.rows.length, 5); assert.match(retention.warnings.join(' '), /not reclaimable/)
  data.policies.data = []
  assert.equal(forecastDataset(data, 'footprint').rows[0].projected30, null)
})

test('operations pulse distinguishes running retries from attention and unavailable from zero', () => {
  const data = { ...snapshot(), range: '24h', from: new Date(now - DAY).toISOString(), jobs: collection([{ id: 'a', status: 'Running', lastResult: 'Failed' }, { id: 'b', status: 'Stopped', lastResult: 'Failed' }]), sessions: { data: [], available: false, complete: false }, security: collection([]) }
  const result = monitoringDataset('overview', data), row = result.rows[0]
  assert.equal(row.active, 1); assert.equal(row.attention, 1); assert.equal(row.failed, 1); assert.equal(row.failedRuns, null); assert.equal(row.successRate, null); assert.equal(row.securityIssues, 0); assert.equal(result.complete, false)
})

test('infrastructure metrics are reported limits and roles, never inferred live activity', () => {
  const base = { fetchedAt: new Date(now).toISOString(), sourceName: 'Private', warnings: [], apiRevision: 'test' }
  const proxies = monitoringDataset('proxies', { ...base, configs: collection([{ id: 'proxy', name: 'Proxy', server: { maxTaskCount: 8 } }]), states: collection([]), hosts: collection([]) })
  assert.equal(proxies.rows[0].tasks, 8); assert.equal(proxies.rows[0].online, 'Not reported'); assert.equal(proxies.rows[0].status, 'Unknown')
  const servers = monitoringDataset('servers', { ...base, servers: collection([{ id: 'server', name: 'Host', status: 'Unavailable' }]), proxies: collection([]), proxyStates: collection([]), repositories: collection([]), repositoryStates: collection([]), mounts: { data: [], available: false, complete: false } })
  assert.equal(servers.rows[0].status, 'Unavailable'); assert.equal(servers.complete, false)
})

test('licensing exposes named entitlements, not customer identities or workload inventories', () => {
  const result = monitoringDataset('licenses', { fetchedAt: new Date(now).toISOString(), sourceName: '', warnings: [], vbr: { status: 'Valid', licensedTo: 'SECRET-CUSTOMER', supportId: 'SECRET-SUPPORT', instanceLicenseSummary: { licensedInstancesNumber: 100, usedInstancesNumber: 25, workload: [{ name: 'SECRET-VM' }] } } })
  assert.equal(result.rows[0].utilization, 25); assert.equal(result.rows[0].consumed, 25)
  for (const secret of ['SECRET-CUSTOMER', 'SECRET-SUPPORT', 'SECRET-VM']) assert.ok(!JSON.stringify(result).includes(secret))
  assert.match(result.warnings.join(' '), /entitlement units/)
})

test('public forecast projection includes the chosen repository and visible series only', () => {
  const data = modeled(); data.repositories.data.push({ ...repo('hidden-id'), name: 'HIDDEN-REPO' }); data.warnings.push('PRIVATE-DIAGNOSTIC')
  const widget = { ...fixture(), repositoryId: 'repo', forecastMode: 'files' }, dataset = forecastDataset(data, 'forecast', widget)
  const result = prepareWidget(dataset, widget, true), output = JSON.stringify({ widget: publicWidget(widget), result })
  assert.equal(result.contextLabel, 'Repository repo'); assert.ok(result.chart.points.length > 0)
  for (const secret of ['PRIVATE-DIAGNOSTIC', 'HIDDEN-REPO', 'hidden-id', 'modeledFileIds', 'Database backup', 'Private server']) assert.ok(!output.includes(secret), secret)
  assert.equal(publicWidget(widget).repositoryId, ''); assert.equal(result.repositories, undefined)
})

test('browser request deduplication keeps repository, horizon and basis selections isolated', async () => {
  const calls = [], d = load('lib/labs/data.ts', { '../api/application-request': { applicationRequest: async url => { calls.push(url); return forecastDataset(snapshot(), 'forecast') } } })
  const first = { ...fixture(), repositoryId: 'a' }, second = { ...first, repositoryId: 'b' }, third = { ...second, forecastMode: 'files', horizon: 90 }
  const result = await d.loadDatasets([first, first, second, third], new AbortController().signal)
  assert.equal(calls.length, 3); assert.equal(Object.keys(result).length, 3)
  assert.ok(calls.some(url => new URL(url, 'http://local').searchParams.get('repository') === 'b' && url.includes('horizon=90')))
})

test('private forecast route passes authenticated scope and only reads cache; rejects invalid selectors', async () => {
  const { NextRequest } = require('next/server'), context = { sourceId: 'trusted', cacheKey: 'trusted-scope', serverCredentials: true }, cacheReads = []
  const api = load('app/api/labs/forecast/route.ts', {
    '@/lib/server/vbr-read': { withVbrRead: async (_request, callback) => callback(() => { throw new Error('Must not query VBR') }, '', null, context) },
    '@/lib/server/forecast-cache': { readCachedForecastSnapshot: actual => { cacheReads.push(actual); return modeled() } },
    '@/lib/labs/forecast-data': { forecastDataset }, '@/lib/labs/model': model,
  })
  const result = await api.GET(new NextRequest('http://console/api/labs/forecast?repository=repo&mode=files&horizon=90&sourceId=attacker'))
  assert.equal(cacheReads[0], context); assert.equal(result.rows.length, 121)
  for (const query of ['mode=bad', 'horizon=999', 'source=jobs', 'repository=' + 'a'.repeat(81)]) assert.equal((await api.GET(new NextRequest('http://console/api/labs/forecast?' + query))).status, 400)
  assert.equal(cacheReads.length, 1)
})

test('published cached widgets never authenticate to VBR or expose unselected repositories', async () => {
  const store = require('../lib/server/kiosk-shares.ts'), source = { id: 'saved', platform: 'vbr', protocol: 'https', host: 'private.invalid', port: 9419, username: 'reader', password: 'SECRET-PASSWORD' }
  let reads = 0, changed = false
  const reader = load('lib/server/kiosk-reader.ts', {
    './config-store': { configStore: { getById: () => changed ? { ...source, host: 'changed.invalid' } : source } },
    './token-manager': { tokenManager: { getToken: () => { throw new Error('Cached views must not authenticate to VBR') } } },
    './capacity-collector': { configuredScope: actual => { assert.equal(actual, source); return { scope: 'saved-scope' } } },
    './forecast-cache': { readCachedForecastSnapshot: context => { assert.equal(context.cacheKey, 'saved-scope'); assert.equal(context.sourceId, 'saved'); reads++; return modeled() } },
  })
  const widget = { ...fixture(), repositoryId: 'repo', forecastMode: 'files' }, record = { id: 'b'.repeat(43), sourceId: source.id, sourceBinding: store.sourceBinding(source), revision: 'v1', updatedAt: '', theme: {}, mode: 'dark', board: { ...model.emptyBoard(), widgets: [widget, { ...widget, id: 'second' }] } }
  const result = await reader.readPublicKiosk(record)
  assert.equal(result.widgets.length, 2); assert.ok(result.widgets[0].presentation.chart.points.length > 0); assert.equal(reads, 1)
  await reader.readPublicKiosk(record); assert.equal(reads, 1)
  for (const secret of ['SECRET-PASSWORD', 'private.invalid', 'saved-scope', 'modeledFileIds']) assert.ok(!JSON.stringify(result).includes(secret))
  changed = true; assert.throws(() => reader.readPublicKiosk(record), { status: 503 })
})
