// Open Backup UI v1.0.2
const fs = require('node:fs')
const ts = require('typescript')
const { test } = require('node:test')
const assert = require('node:assert/strict')
require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, path)
const { guestFiles, filesSchema } = require('../lib/recovery/files.ts')
const { guestCrumbs, addToCart, readWorkspace, workspaceKey, searchHasResults, guestRestoreBusy } = require('../lib/restore-points/guest-workspace.ts')
const sourceKey = 'a'.repeat(64)
const sessionId = '11111111-1111-4111-8111-111111111111'
const taskId = '22222222-2222-4222-8222-222222222222'
const key = 'a-test-signing-key'

test('asynchronous search tracks the returned VBR task, pages scoped results, and stops only its own task', async () => {
  const calls = []
  const searchTask = { id: taskId, type: 'FlrSearch', state: 'Working', result: 'None', progressPercent: 25, name: 'Find documents' }
  const base = '/api/v1/backupBrowser/flr/' + sessionId
  const send = async (path, options) => {
    calls.push({ path, options })
    if (path.includes('/tasks/') && path.endsWith('/stop')) return {}
    if (path === base + '/search' || path === '/api/v1/tasks/' + taskId) return searchTask
    if (path.includes('/search/') && path.endsWith('/browse')) return { path: '/home', searchString: '*.docx', items: [],
      pagination: { total: 200, count: 0, limit: 200, skip: 200 } }
    return { sessionId: path.split('/').pop(), type: 'Linux' }
  }
  const run = args => guestFiles(send, sourceKey, filesSchema.parse({ sourceKey, sessionId, ...args }), key)
  const search = await run({ action: 'search', path: '/home', query: '*.docx', recursive: false })
  assert.equal(search.id, taskId)
  assert.deepEqual(calls.at(-1).options.body, { path: '/home', searchString: '*.docx', disableRecursiveSearch: true })
  assert.equal(calls.at(-1).options.mutation, true)
  const receipt = { taskId, searchKey: search.searchKey }
  const status = await run({ action: 'searchStatus', ...receipt })
  assert.equal(status.progressPercent, 25)
  const page = await run({ action: 'searchResults', ...receipt, skip: 200 })
  assert.equal(page.pathSeparator, '/')
  assert.equal(calls.at(-1).path, base + '/search/' + taskId + '/browse')
  assert.equal(calls.at(-1).options.body.pagination.skip, 200)
  await assert.rejects(run({ action: 'stopSearch', ...receipt, sessionId: taskId }), /selected guest file mount/)
  await assert.rejects(run({ action: 'stopSearch', ...receipt, taskId: sessionId }), /selected guest file mount/)
  assert.equal(calls.filter(call => call.path.endsWith('/stop')).length, 0)
  await run({ action: 'stopSearch', ...receipt })
  assert.equal(calls.at(-1).path, '/api/v1/tasks/' + taskId + '/stop')
  searchTask.state = 'Stopped'
  searchTask.result = 'Cancelled'
  await run({ action: 'stopSearch', ...receipt })
  assert.equal(calls.filter(call => call.path.endsWith('/stop')).length, 1)
  assert.equal(searchHasResults(searchTask), false)
  assert.equal(searchHasResults({ ...searchTask, result: 'Success' }), true)
})

test('folder tree browsing requests only folders and drives using VBR filters', async () => {
  const calls = []
  const send = async (path, options) => {
    calls.push({ path, options })
    return options ? { path: '', items: [] } : { sessionId, type: 'Windows' }
  }
  await guestFiles(send, sourceKey, filesSchema.parse({ action: 'browse', sourceKey, sessionId, foldersOnly: true }))
  assert.deepEqual(calls.at(-1).options.body.filter, { itemTypes: ['Drive', 'Folder'] })
  assert.equal(calls.at(-1).options.body.path, '')
})

test('ZIP preparation, cancellation and delivery bind to the selected source, mount, task type and successful completion', async () => {
  const base = '/api/v1/backupBrowser/flr/' + sessionId
  const task = { id: taskId, type: 'FlrDownload', state: 'Working', result: 'None', progressPercent: 35, name: 'Archive' }
  const calls = []
  const stream = new Response(new Uint8Array([80, 75]))
  const send = async (path, options) => {
    calls.push({ path, options })
    if (path === base + '/prepareDownload' || path === '/api/v1/tasks/' + taskId) return task
    if (path.endsWith('/stop')) return {}
    if (path.endsWith('/download')) return stream
    return { sessionId: path.split('/').pop(), type: 'Windows' }
  }
  const run = args => guestFiles(send, sourceKey, filesSchema.parse({ sourceKey, sessionId, ...args }), key)
  const issued = await run({ action: 'prepareDownload', sourcePaths: ['/first','/second'] })
  assert.deepEqual(calls.at(-1).options.body, { sourcePath: ['/first','/second'] })
  const receipt = { taskId, downloadKey: issued.downloadKey }
  await assert.rejects(run({ action: 'streamDownload', ...receipt }), /not ready/)
  await assert.rejects(run({ action: 'streamDownload', ...receipt, sessionId: taskId }), /selected guest file mount/)
  await assert.rejects(run({ action: 'stopSearch', taskId, searchKey: issued.downloadKey }), /selected guest file mount/)
  assert.equal(calls.filter(call => call.path.endsWith('/download') || call.path.endsWith('/stop')).length, 0)
  await run({ action: 'stopDownload', ...receipt })
  assert.equal(calls.at(-1).path, '/api/v1/tasks/' + taskId + '/stop')
  task.state = 'Stopped'; task.result = 'Success'
  const result = await run({ action: 'streamDownload', ...receipt })
  assert.strictEqual(result, stream)
  assert.deepEqual(calls.at(-1), { path: base + '/prepareDownload/' + taskId + '/download', options: {method:'POST', archive:true} })
  task.type = 'FlrRestore'
  await assert.rejects(run({ action: 'streamDownload', ...receipt }), /unavailable/)
})

test('guest carts survive reload scoped to mount and source and remove nested selections', () => {
  const folder = { path: '/home/ops', type: 'Folder' }
  const first = { path: '/home/ops/doc.txt', type: 'File' }
  const other = { path: '/etc/hosts', type: 'File' }
  let cart = addToCart([], first, '/')
  cart = addToCart(cart, other, '/')
  cart = addToCart(cart, folder, '/')
  assert.deepEqual(cart, [other, folder])
  assert.deepEqual(addToCart(cart, first, '/'), cart)
  assert.deepEqual(readWorkspace(JSON.stringify({cart,path:'/etc'})), {cart,path:'/etc'})
  assert.notEqual(workspaceKey(sourceKey,sessionId),workspaceKey(sourceKey,taskId))
  assert.notEqual(workspaceKey(sourceKey,sessionId),workspaceKey('b'.repeat(64),sessionId))
  assert.deepEqual(readWorkspace('broken data'), { cart: [] })
  const win = [{path:'C:\\Users\\Ops',type:'Folder'}]
  assert.deepEqual(addToCart(win, {path:'c:\\users\\OPS\\doc.txt',type:'File'}, '\\'), win)
  assert.deepEqual(guestCrumbs('C:\\Users\\Ops', '\\').map(x => x.path), ['C:\\','C:\\Users','C:\\Users\\Ops'])
  assert.deepEqual(guestCrumbs('/home/ops','/').map(x=>x.path), ['/home','/home/ops'])
})

test('reopening a cart preserves the destination and requires explicit review of an interrupted submission', () => {
  const cart = [{ path: '/home/report', type: 'File' }]
  const receipt = { phase: 'sending', count: 1, target: 'Destination VM', folder: '/srv/recovered', policy: 'Keep' }
  const pending = readWorkspace(JSON.stringify({ cart, restore: receipt }))
  assert.deepEqual(pending, { cart, restore: { ...receipt, phase: 'unconfirmed' } })
  assert.equal(guestRestoreBusy(pending), true)
  assert.equal(guestRestoreBusy({ ...pending, restore: undefined }), false)
  const accepted = { ...receipt, phase: 'accepted' }
  assert.equal(guestRestoreBusy({ cart, restore: accepted, task: { id: taskId, state: 'Working' } }), true)
  assert.equal(guestRestoreBusy({ cart, restore: accepted, task: { id: taskId, state: 'Stopped', result: 'Success' } }), false)
})
