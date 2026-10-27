/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { assessWorkload } = require('../lib/resilience/model.ts')
const { loadWorkload } = require('../lib/resilience/load.ts')
const { TopologyRequestError } = require('../lib/topology/load.ts')
const now = Date.parse('2026-09-13T12:00:00Z')
const point = (id, hours, repositoryId = 'r1') => ({ id, backupId: id, repositoryId, creationTime: new Date(now - hours * 3600000).toISOString(), malwareStatus: 'Clean' })
const evidence = points => ({ id: 'w1', name: 'VM', sourceName: 'lab', fetchedAt: new Date(now).toISOString(), points, warnings: [], complete: true })
const state = (result, id) => result.checks.find(c => c.id === id).state

test('freshness includes exact RPO boundary; duplicate repository IDs never earn two-copy credit', () => {
  const result = assessWorkload(evidence([point('b1', 24), point('b2', 1)]), 24, now)
  assert.equal(state(result, 'freshness'), 'pass')
  assert.equal(state(result, 'copies'), 'fail')
  assert.equal(result.score, null)
  assert.equal(result.earned, 25)
  assert.equal(state(result, 'malware'), 'unknown')
})
test('stale secondary copy fails; a fresh second repository meets only copy count', () => {
  assert.equal(state(assessWorkload(evidence([point('a', 1), point('b', 31, 'r2')]), 24, now), 'copies'), 'fail')
  const result = assessWorkload(evidence([point('a', 1), point('b', 2, 'r2')]), 24, now)
  assert.equal(state(result, 'copies'), 'pass')
  assert.equal(result.knownWeight, 45)
  assert.equal(result.score, null)
})
test('incomplete, unmapped and stale evidence do not become confirmed failures or green scores', () => {
  assert.equal(state(assessWorkload({ ...evidence([]), complete: false }, 24, now), 'freshness'), 'unknown')
  assert.equal(state(assessWorkload(evidence([{ ...point('a', 1), repositoryId: undefined }]), 24, now), 'copies'), 'unknown')
  assert.equal(state(assessWorkload(evidence([point('a', 1)]), 24, now + 16 * 60000), 'freshness'), 'unknown')
  assert.equal(state(assessWorkload(evidence([point('a', -1)]), 24, now), 'freshness'), 'unknown')
})
test('security finding overrides positive freshness; clean labels never prove scan coverage', () => {
  const result = assessWorkload(evidence([{ ...point('a', 1), malwareStatus: 'Infected' }, point('b', 1, 'r2')]), 24, now)
  assert.equal(result.status, 'Security review required')
  assert.equal(state(result, 'malware'), 'fail')
  assert.equal(result.score, null)
})
test('confirmed empty response yields gaps; malformed and failed core responses reject', async () => {
  const read = async path => path.includes('restorePoints') ? { data: [] } : { id: 'w1', name: 'VM' }
  const result = await loadWorkload(read, 'lab', 'w1')
  assert.equal(result.complete, true)
  assert.equal(state(assessWorkload(result), 'freshness'), 'fail')
  await assert.rejects(loadWorkload(async () => { throw new Error('offline') }, 'lab', 'w1'))
  await assert.rejects(loadWorkload(async path => path.includes('restorePoints') ? { data: [{ id: 'bad' }] } : { id: 'w1', name: 'VM' }, 'lab', 'w1'))
})
test('destination lookup uses backup IDs, limits concurrency and preserves unresolved evidence', async () => {
  let active = 0; let peak = 0
  const points = Array.from({ length: 8 }, (_, i) => point(`b${i}`, 1))
  const result = await loadWorkload(async path => {
    if (path.includes('restorePoints')) return { data: points }
    if (path.includes('backupObjects')) return { id: 'w1', name: 'VM' }
    const id = path.split('/').pop()
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 2)); active--
    if (id === 'b0') throw new Error('denied')
    return { id, repositoryId: 'r1', repositoryName: 'Primary' }
  }, 'lab', 'w1')
  assert.equal(peak, 4)
  assert.equal(result.points.length, 8)
  assert.equal(result.points[0].repositoryId, undefined)
  assert.ok(result.warnings.length)
  await assert.rejects(loadWorkload(async path => {
    if (path.includes('restorePoints')) return { data: [point('b', 1)] }
    if (path.includes('backupObjects')) return { id: 'w1', name: 'VM' }
    throw new TopologyRequestError('expired', 401)
  }, 'lab', 'w1'))
})
