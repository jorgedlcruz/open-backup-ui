// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm'), assert = require('node:assert/strict'), { test } = require('node:test')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file)
const { forecastPreview } = require('../lib/lens/forecast-preview.ts')
const { ForecastCache, FORECAST_CACHE_INTERVAL } = require('../lib/forecast/cache.ts')
const { DAY, GB } = require('../lib/forecast/model.ts')
const now = Date.parse('2026-10-30T12:00:00Z'), collection = data => ({ data, available: true, complete: true })
const snapshot = () => ({ fetchedAt: new Date(now).toISOString(), sourceName: 'Selected source', warnings: [], repositories: collection([]), scaleOut: collection([]), configs: collection([]), policies: collection([]), backups: collection([]), objects: collection([]), observations: [], historyAvailable: true })
const repo = (id = 'repo') => ({ id, name: 'Repository ' + id, type: 'LinuxLocal', capacityGB: 100, freeGB: 50 })
function modeledSnapshot() {
  const data = snapshot()
  data.repositories.data.push(repo())
  data.configs.data.push({ id: 'repo', type: 'LinuxLocal', repository: { enableGovernanceMode: false, useFastCloningOnXFSVolumes: false } })
  data.policies.data.push({ id: 'job', type: 'VSphereBackup', isDisabled: false, schedule: { runAutomatically: true, daily: { isEnabled: true, dailyKind: 'Everyday' } }, storage: { retentionPolicy: { type: 'RestorePoints', quantity: 3 }, gfsPolicy: { isEnabled: false }, advancedSettings: { backupModeType: 'Incremental', syntheticFulls: { isEnabled: false }, activeFulls: { isEnabled: false } } } })
  data.backups.data.push({ id: 'backup', jobId: 'job', repositoryId: 'repo', complete: true, files: Array.from({ length: 5 }, (_, i) => ({ id: 'file' + i, backupId: 'backup', objectIds: ['vm'], name: `vm.${i ? 'vib' : 'vbk'}`, creationTime: new Date(now - (4 - i) * DAY - 3600000).toISOString(), backupSize: (i ? 10 : 100) * GB, gfsPeriods: ['None'] })) })
  return data
}

test('forecast preview distinguishes absent evidence, unknown capacity, and a genuine zero', () => {
  assert.equal(forecastPreview(null), null)
  const data = snapshot(); data.repositories.data.push({ id: 'unknown', capacityGB: -1, freeGB: -1 })
  assert.equal(forecastPreview(data), null)
  data.repositories.data.push({ ...repo(), freeGB: 100 })
  const preview = forecastPreview(data)
  assert.equal(preview.current, 0); assert.equal(preview.projected, null); assert.deepEqual(preview.future, [])
  assert.equal(preview.history.length, 1)
})

test('preview uses the existing policy model and identifies partial modeled coverage', () => {
  const data = modeledSnapshot(), original = JSON.stringify(data)
  let preview = forecastPreview(data)
  assert.equal(preview.mode, 'files'); assert.equal(preview.repositoryId, 'repo'); assert.equal(preview.name, 'Repository repo')
  assert.equal(preview.current, 140 * GB); assert.equal(preview.projected, 120 * GB)
  assert.equal(preview.history.at(-1).bytes, preview.current); assert.equal(preview.future.length, 31)
  assert.equal(JSON.stringify(data), original); assert.equal(preview.partial, false)
  data.backups.data.push({ id: 'unmodeled', repositoryId: 'repo', complete: false, files: [] })
  data.cache = { stale: true, refreshing: true }
  preview = forecastPreview(data)
  assert.equal(preview.current, 140 * GB); assert.equal(preview.partial, true); assert.equal(preview.stale, true); assert.equal(preview.refreshing, true)
  assert.equal('backups' in preview, false); assert.equal('policies' in preview, false)
})

test('duplicate physical file identities cannot inflate the preview projection', () => {
  const data = modeledSnapshot()
  data.backups.data.push({ ...data.backups.data[0], id: 'alias' })
  const preview = forecastPreview(data)
  assert.equal(preview.mode, 'capacity'); assert.equal(preview.current, 50 * GB); assert.equal(preview.projected, null)
})

test('recorded capacity can supply a real trend without manufacturing history or using aggregate parents', () => {
  const data = snapshot(); data.repositories.data.push(repo(), { ...repo('parent'), type: 'ScaleOut' })
  data.scaleOut.data.push({ id: 'parent' })
  data.observations = [0, 1, 2].map(i => ({ id: 'repo', at: new Date(now - (2 - i) * DAY).toISOString(), capacityGB: 100, freeGB: 60 - i * 5 }))
  const preview = forecastPreview(data)
  assert.equal(preview.mode, 'capacity'); assert.equal(preview.repositoryId, 'repo')
  assert.equal(preview.current, 50 * GB); assert.equal(preview.projected, 200 * GB); assert.equal(preview.history.length, 3)
  data.observations = data.observations.slice(1)
  assert.equal(forecastPreview(data).projected, null)
})

test('a sampled repository remains stable across polling and inventory ordering', () => {
  const data = snapshot(); data.repositories.data.push(repo('a'), repo('b'), repo('c'))
  const id = forecastPreview(data).repositoryId
  data.repositories.data.reverse()
  assert.equal(forecastPreview(data).repositoryId, id)
})

test('cache peek neither starts nor waits for work, isolates scopes, preserves age and honours eviction', async () => {
  let time = now, finish
  const cache = new ForecastCache(() => time)
  assert.equal(cache.peek('a'), null); assert.equal(cache.has('a'), false)
  const pending = cache.read('a', () => new Promise(resolve => { finish = resolve }))
  await new Promise(setImmediate)
  assert.equal(cache.peek('a'), null)
  finish(modeledSnapshot()); await pending
  assert.equal(cache.peek('other'), null)
  time += FORECAST_CACHE_INTERVAL
  assert.equal(cache.peek('a').cache.stale, true); assert.equal(cache.peek('a').fetchedAt, new Date(now).toISOString())
  await assert.rejects(cache.read('a', async () => { throw Object.assign(new Error('Denied'), { status: 403 }) }, { force: true }))
  assert.equal(cache.peek('a'), null)
})

test('preview route uses authenticated context and cannot trigger a collection even with refresh=1', async () => {
  const exports = {}, seen = [], context = { cacheKey: 'authenticated-source' }
  const dependencies = {
    '@/lib/server/vbr-read': { withVbrRead: async (_request, callback) => { seen.push('authenticated'); return callback(() => { throw Error('Must not read VBR') }, 'Source', null, context) } },
    '@/lib/server/capacity-collector': { startCapacityCollector: () => { throw Error('Must not start collection') } },
    '@/lib/server/forecast-cache': { readForecastPreview: actual => { assert.equal(actual, context); return { preview: null } }, readForecastSnapshot: () => { throw Error('Must not refresh') }, startForecastRefresh: () => { throw Error('Must not refresh') } },
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/vbr/forecast/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: name => dependencies[name] })
  const result = await exports.GET({ nextUrl: new URL('http://local/api/vbr/forecast?preview=1&refresh=1') })
  assert.equal(result.preview, null); assert.deepEqual(seen, ['authenticated'])
})
