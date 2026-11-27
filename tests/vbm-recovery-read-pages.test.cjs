// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename)
const { combineReadPages } = require('../components/vbm-recovery/read-pages.ts')

const item = (id, changes = {}) => ({ id, name: id, kind: 'folder', ownerId: 'site', isFolder: true, workload: 'SharePoint', selectable: true, raw: {}, ...changes })
const page = (items, changes = {}) => ({ items, offset: 100, nextOffset: 100 + items.length, hasMore: false, ...changes })

test('successful sibling pages combine in order with scoped identity deduplication and pagination', async () => {
  const shared = item('id'), otherOwner = item('id', { ownerId: 'other-site' }), otherKind = item('id', { kind: 'document' }), otherChannel = item('id', { channelId: 'channel' })
  const result = await combineReadPages([
    Promise.resolve(page([shared, otherOwner], { nextOffset: 200, hasMore: true, setId: 'snapshot' })),
    Promise.resolve(page([item('id', { name: 'duplicate' }), otherKind, otherChannel], { nextOffset: 150 })),
  ], 100)
  assert.deepEqual(result.items, [shared, otherOwner, otherKind, otherChannel])
  assert.equal(result.offset, 100)
  assert.equal(result.nextOffset, 200)
  assert.equal(result.hasMore, true)
  assert.equal(result.setId, 'snapshot')
  assert.equal(result.readError, undefined)
})

test('partial failure retains successful items and retries the same offset instead of skipping a failed page', async () => {
  const error = Object.assign(new Error('Folder read timed out'), { status: 504 })
  const result = await combineReadPages([
    Promise.reject(error),
    Promise.resolve(page([item('folder')], { nextOffset: 200, hasMore: true })),
    Promise.reject(new Error('another failed read')),
    Promise.resolve(page([item('folder'), item('document', { kind: 'document' })])),
  ], 100)
  assert.deepEqual(result.items.map(value => value.id), ['folder', 'document'])
  assert.equal(result.readError, error)
  assert.equal(result.nextOffset, 100)
  assert.equal(result.hasMore, false)
})

test('all failed reads throw the first failure and cannot look like an empty successful folder', async () => {
  const error = new Error('first failure')
  await assert.rejects(combineReadPages([Promise.reject(error), Promise.reject(new Error('second failure'))], 0), value => value === error)
})

test('authentication, ended sessions, and cancellation reject the entire page despite successful siblings', async () => {
  const failures = [401, 403, 409, 499].map(status => Object.assign(new Error('Cannot continue this read'), { status }))
  failures.push(new DOMException('Canceled', 'AbortError'))
  for (const failure of failures) {
    await assert.rejects(combineReadPages([
      Promise.reject(new Error('transient sibling failure')),
      Promise.resolve(page([item('must-not-be-published')])),
      Promise.reject(failure),
    ], 100), value => value === failure)
  }
})

test('empty reads produce an empty terminal page, while non-Error failures remain visible', async () => {
  assert.deepEqual(await combineReadPages([], 100), { items: [], offset: 100, nextOffset: 100, hasMore: false })
  const result = await combineReadPages([Promise.reject('temporary failure'), Promise.resolve(page([]))], 100)
  assert.equal(result.readError.message, 'temporary failure')
  assert.equal(result.hasMore, false)
})
