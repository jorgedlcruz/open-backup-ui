// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename)
const { createReadPool } = require('../components/vbm-recovery/read-pool.ts')
const { initialOwnerRetryDelay,browseCollectionNotFound } = require('../lib/vbm-recovery/read-retry.ts')

test('only a recent working session with an unavailable root collection can get bounded automatic reads', () => {
  const now=Date.now(), started=new Date(now-5000).toISOString()
  const issue={status:404,code:browseCollectionNotFound}
  const delays=[5000,12000,25000,45000,60000,90000,90000]
  let elapsed=0
  for(const [attempt,expected] of delays.entries()) {
    const delay=initialOwnerRetryDelay(issue,started,attempt,now+elapsed)
    assert.equal(delay,expected)
    elapsed+=delay
  }
  assert.equal(elapsed,327000)
  assert.equal(initialOwnerRetryDelay(issue,started,delays.length,now+elapsed),null)
  const almostExpired=new Date(now-595000).toISOString()
  assert.equal(initialOwnerRetryDelay(issue,almostExpired,6,now),5000)
  assert.equal(initialOwnerRetryDelay(issue,almostExpired,6,now+5000),null)
  for(const status of [400,401,403,409,429,500,502,504,undefined])
    assert.equal(initialOwnerRetryDelay({...issue,status},started,0,now),null)
  assert.equal(initialOwnerRetryDelay({status:404},started,0,now),null)
  for(const since of [undefined,'invalid',new Date(now-600000).toISOString(),new Date(now+1).toISOString()])
    assert.equal(initialOwnerRetryDelay(issue,since,0,now),null)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('tree and grid share a pending read; canceling one consumer leaves the other read alive', async () => {
  const pool = createReadPool(), page = deferred(), tree = new AbortController()
  let calls = 0, upstream
  const load = signal => { calls++; upstream = signal; return page.promise }
  const left = pool.run('site/libraries/0', load, tree.signal)
  const right = pool.run('site/libraries/0', load)
  const canceled = assert.rejects(left, { name: 'AbortError' })
  await Promise.resolve()
  tree.abort()
  await canceled
  assert.equal(calls, 1)
  assert.equal(upstream.aborted, false)
  page.resolve({ items: ['Documents'] })
  assert.deepEqual(await right, { items: ['Documents'] })
})

test('canceling every consumer aborts upstream; a late old result cannot displace its replacement', async () => {
  const pool = createReadPool(), oldPage = deferred(), nextPage = deferred()
  const tree = new AbortController(), grid = new AbortController()
  let upstream, calls = 0, aborts = 0
  const load = signal => { calls++; upstream = signal; signal.addEventListener('abort', () => aborts++); return oldPage.promise }
  const left = pool.run('folders', load, tree.signal), right = pool.run('folders', load, grid.signal)
  const canceled = Promise.all([assert.rejects(left, { name: 'AbortError' }), assert.rejects(right, { name: 'AbortError' })])
  await Promise.resolve()
  tree.abort()
  grid.abort()
  await canceled
  assert.equal(upstream.aborted, true)
  assert.equal(aborts, 1)
  const replacement = pool.run('folders', () => { calls++; return nextPage.promise })
  oldPage.resolve('outdated')
  // Let the abandoned loader settle before joining its replacement.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  const joined = pool.run('folders', () => { throw new Error('replacement was discarded') })
  nextPage.resolve('current')
  assert.deepEqual(await Promise.all([replacement, joined]), ['current', 'current'])
  assert.equal(calls, 2)
})

test('completed and failed reads are released; the pool never retains a page cache', async () => {
  const pool = createReadPool()
  let calls = 0
  const load = async () => ++calls
  assert.equal(await pool.run('items', load), 1)
  assert.equal(await pool.run('items', load), 2)
  const failure = new Error('temporary read failure')
  const page = deferred()
  const one = pool.run('items', () => page.promise), two = pool.run('items', () => page.promise)
  const rejected = Promise.all([assert.rejects(one, error => error === failure), assert.rejects(two, error => error === failure)])
  page.reject(failure)
  await rejected
  assert.equal(await pool.run('items', load), 3)
  await assert.rejects(pool.run('items', () => { throw failure }), error => error === failure)
  assert.equal(await pool.run('items', load), 4)
})

test('dispose rejects every active consumer and aborts every read, even if loaders ignore cancellation', async () => {
  const pool = createReadPool(), page = deferred(), signals = []
  const load = signal => { signals.push(signal); return page.promise }
  const first = pool.run('site-a', load), second = pool.run('site-b', load), joined = pool.run('site-a', load)
  const canceled = Promise.all([first, second, joined].map(promise => assert.rejects(promise, { name: 'AbortError' })))
  await Promise.resolve()
  pool.dispose()
  pool.dispose()
  await canceled
  assert.equal(signals.length, 2)
  assert.ok(signals.every(signal => signal.aborted))
  // Reusable after a React StrictMode effect cleanup/setup cycle.
  assert.equal(await pool.run('site-a', async () => 'fresh'), 'fresh')
  page.resolve('old')
})

test('an already canceled caller neither creates nor joins a read', async () => {
  const pool = createReadPool(), controller = new AbortController()
  controller.abort()
  await assert.rejects(pool.run('items', () => { throw new Error('must not load') }, controller.signal), { name: 'AbortError' })
  assert.equal(await pool.run('items', async () => 'fresh'), 'fresh')
})

test('returning to an immutable folder joins the original read, and ending the workspace cancels orphan reads', async () => {
  const pool = createReadPool({ finishOnNavigate: true })
  const page = deferred(), visit = new AbortController()
  let upstream
  const first = pool.run('mailbox/inbox/0', signal => {
    upstream = signal
    return page.promise
  }, visit.signal)
  const navigatedAway = assert.rejects(first, { name: 'AbortError' })
  await Promise.resolve()
  visit.abort()
  await navigatedAway
  assert.equal(upstream.aborted, false)

  const returning = pool.run('mailbox/inbox/0', () => assert.fail('the Inbox was fetched twice'))
  page.resolve('first 100')
  assert.equal(await returning, 'first 100')

  const nextPage = deferred(), nextVisit = new AbortController()
  const more = pool.run('mailbox/inbox/100', signal => {
    upstream = signal
    return nextPage.promise
  }, nextVisit.signal)
  const left = assert.rejects(more, { name: 'AbortError' })
  await Promise.resolve()
  nextVisit.abort()
  await left
  pool.dispose()
  assert.equal(upstream.aborted, true)
  nextPage.resolve('late page')
})
