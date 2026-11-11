// Open Backup UI v1.2.0
const fs = require('node:fs')
const ts = require('typescript')
const {randomUUID} = require('node:crypto')
const test = require('node:test')
const assert = require('node:assert/strict')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText, file)
const {scopedRecoveryCache} = require('../lib/recovery/catalog-cache.ts')
const {readObjectRestorePointWindow} = require('../lib/restore-points/cached-collection.ts')

function deferred() {
  let reject
  const promise = new Promise((_, fail) => { reject = fail })
  return {promise, reject}
}
const aborted = () => new DOMException('The owner disconnected.', 'AbortError')
const denied = status => Object.assign(new Error('Access denied.'), {status})
const point = (id, backupId = 'backup') => ({id: String(id), backupId, creationTime: '2026-11-11T00:00:00Z'})

test('a live catalog waiter retries an aborted owner with its own loader', async () => {
  const cache = scopedRecoveryCache(4), gate = deferred(), key = randomUUID()
  const owner = cache(key, () => gate.promise)
  let waiterLoads = 0
  const waiter = cache(key, async () => { waiterLoads++; return {complete: true, objects: ['current']} })
  const settled = Promise.allSettled([owner, waiter])
  gate.reject(aborted())
  const [first, second] = await settled
  assert.equal(first.status, 'rejected')
  assert.equal(first.reason.name, 'AbortError')
  assert.equal(second.status, 'fulfilled')
  assert.deepEqual(second.value.objects, ['current'])
  assert.equal(waiterLoads, 1)
  assert.deepEqual((await cache(key, async () => { throw new Error('Should use the recovered cache.') })).objects, ['current'])
})

test('a live restore-point waiter retries an aborted first page with its own reader', async () => {
  const identity = randomUUID(), gate = deferred(), objectId = randomUUID()
  const owner = readObjectRestorePointWindow(() => gate.promise, identity, objectId)
  const paths = []
  const waiter = readObjectRestorePointWindow(async path => {
    paths.push(path)
    return {data: [point('visible')], pagination: {skip: 0, total: 1}}
  }, identity, objectId)
  const settled = Promise.allSettled([owner, waiter])
  gate.reject(aborted())
  const [first, second] = await settled
  assert.equal(first.status, 'rejected')
  assert.equal(first.reason.name, 'AbortError')
  assert.equal(second.status, 'fulfilled')
  assert.deepEqual(second.value.data.map(row => row.id), ['visible'])
  assert.equal(paths.length, 1)
  assert.equal(new URL(paths[0], 'https://unit.invalid').searchParams.get('skip'), '0')
  assert.deepEqual((await readObjectRestorePointWindow(async () => { throw new Error('Should reuse the recovered cache.') }, identity, objectId)).data.map(row => row.id), ['visible'])
})

test('an aborted extension leaves the first 200 points for a live waiter to extend', async () => {
  const identity = randomUUID(), objectId = randomUUID(), gate = deferred()
  const firstPage = Array.from({length: 200}, (_, index) => point(index))
  await readObjectRestorePointWindow(async () => ({data: firstPage, pagination: {skip: 0, total: 400}}), identity, objectId)
  const owner = readObjectRestorePointWindow(() => gate.promise, identity, objectId, {pointLimit: 400})
  const skips = []
  const waiter = readObjectRestorePointWindow(async path => {
    const skip = Number(new URL(path, 'https://unit.invalid').searchParams.get('skip'))
    skips.push(skip)
    return {data: Array.from({length: 200}, (_, index) => point(skip + index)), pagination: {skip, total: 400}}
  }, identity, objectId, {pointLimit: 400})
  const settled = Promise.allSettled([owner, waiter])
  gate.reject(aborted())
  const [first, second] = await settled
  assert.equal(first.status, 'rejected')
  assert.equal(first.reason.name, 'AbortError')
  assert.equal(second.status, 'fulfilled')
  assert.equal(second.value.data.length, 400)
  assert.equal(second.value.complete, true)
  assert.deepEqual(skips, [200])
})

test('a backup-filtered waiter survives an aborted all-copy page', async () => {
  const identity = randomUUID(), objectId = randomUUID(), gate = deferred()
  const owner = readObjectRestorePointWindow(() => gate.promise, identity, objectId)
  const backupId = randomUUID(), paths = []
  const waiter = readObjectRestorePointWindow(async path => {
    paths.push(path)
    return {data: [point('filtered', backupId)], pagination: {skip: 0, total: 1}}
  }, identity, objectId, {backupId})
  const settled = Promise.allSettled([owner, waiter])
  gate.reject(aborted())
  const [first, second] = await settled
  assert.equal(first.status, 'rejected')
  assert.equal(second.status, 'fulfilled')
  assert.deepEqual(second.value.data.map(row => row.id), ['filtered'])
  assert.equal(paths.length, 1)
  assert.equal(new URL(paths[0], 'https://unit.invalid').searchParams.get('backupIdFilter'), backupId)
})

for (const status of [401, 403]) {
  test(`catalog waiters propagate HTTP ${status} without retrying`, async () => {
    const cache = scopedRecoveryCache(4), key = randomUUID(), gate = deferred()
    const owner = cache(key, () => gate.promise)
    let waiterLoads = 0
    const waiter = cache(key, async () => { waiterLoads++; return {complete: true} })
    const settled = Promise.allSettled([owner, waiter])
    gate.reject(denied(status))
    for (const result of await settled) {
      assert.equal(result.status, 'rejected')
      assert.equal(result.reason.status, status)
    }
    assert.equal(waiterLoads, 0)
  })
  test(`restore-point waiters propagate HTTP ${status} without retrying`, async () => {
    const identity = randomUUID(), objectId = randomUUID(), gate = deferred()
    const owner = readObjectRestorePointWindow(() => gate.promise, identity, objectId)
    let waiterReads = 0
    const waiter = readObjectRestorePointWindow(async () => { waiterReads++; return {data: []} }, identity, objectId)
    const settled = Promise.allSettled([owner, waiter])
    gate.reject(denied(status))
    for (const result of await settled) {
      assert.equal(result.status, 'rejected')
      assert.equal(result.reason.status, status)
    }
    assert.equal(waiterReads, 0)
  })
}
