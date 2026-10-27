/* eslint-disable @typescript-eslint/no-require-imports */
// Use the existing TypeScript compiler with Node's test runner; no extra runner.
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { z } = require('zod')
const { buildTopology, relatedEntities, filterTopology } = require('../lib/topology/model.ts')
const { readCollection, loadTopology, TopologyRequestError } = require('../lib/topology/load.ts')

const fixture = () => ({
  objects: [{ id: 'w1', name: 'Same name', restorePointsCount: 4 }, { id: 'w2', name: 'Same name' }, { id: 'w3', name: 'Unlinked' }],
  jobs: [{ id: 'j1', name: 'Shared job', lastResult: 'Success' }],
  repositories: [{ id: 'r1', name: 'Primary', isOnline: true }, { id: 'r2', name: 'Archive', isOnline: false }],
  backups: [{ id: 'b1', name: 'First', jobId: 'j1', repositoryId: 'r1' }, { id: 'b2', name: 'Second', jobId: 'j1', repositoryId: 'r2' }],
  memberships: [{ backupId: 'b1', objects: [{ id: 'w1', name: 'Same name' }] }, { backupId: 'b2', objects: [{ id: 'w2', name: 'Same name' }] }],
})

test('repository impact follows exact backup paths, not shared job reachability', () => {
  const graph = buildTopology(fixture())
  assert.deepEqual([...relatedEntities(graph, 'repository:r1')].sort(), ['job:j1', 'repository:r1', 'workload:w1'])
  assert.equal(graph.entities.filter(e => e.name === 'Same name').length, 2)
  assert.ok(!graph.links.some(l => l.source === 'workload:w3'))
})

test('repository filter preserves provenance and excludes other copies', () => {
  const filtered = filterTopology(buildTopology(fixture()), '', false, 'repository:r1')
  assert.deepEqual(filtered.entities.map(e => e.id).sort(), ['job:j1', 'repository:r1', 'workload:w1'])
  assert.equal(filtered.links.length, 2)
  assert.ok(filtered.paths.every(p => p.backupId === 'b1'))
})

test('search and attention filters retain useful path context', () => {
  const graph = buildTopology(fixture())
  assert.equal(filterTopology(graph, '  primary  ', false, '').entities.length, 3)
  const attention = filterTopology(graph, '', true, '')
  assert.deepEqual(attention.entities.map(e => e.id).sort(), ['job:j1', 'repository:r2', 'workload:w2'])
  assert.equal(filterTopology(graph, 'nonexistent', false, '').entities.length, 0)
})

test('restore points never imply RPO compliance and missing status stays unknown', () => {
  const graph = buildTopology(fixture())
  assert.equal(graph.entities.find(e => e.id === 'workload:w1').health, 'unknown')
  assert.equal(graph.entities.find(e => e.id === 'workload:w2').status, 'Coverage unknown')
  assert.equal(graph.entities.find(e => e.id === 'repository:r2').health, 'attention')
})

test('zero job IDs never become fabricated jobs; repository-only paths remain usable', () => {
  const data = fixture()
  data.backups[0].jobId = '00000000-0000-0000-0000-000000000000'
  const graph = buildTopology(data)
  assert.ok(!graph.entities.some(e => e.sourceId.startsWith('00000000')))
  assert.ok(graph.links.some(e => e.source === 'workload:w1' && e.target === 'repository:r1'))
})

test('unavailable details produce unknown placeholders and duplicate memberships are deduplicated', () => {
  const data = fixture()
  data.jobs = []
  data.repositories = []
  data.memberships[0].objects.push(data.memberships[0].objects[0])
  const graph = buildTopology(data)
  assert.equal(graph.entities.find(e => e.id === 'job:j1').health, 'unknown')
  assert.equal(graph.paths.filter(p => p.backupId === 'b1').length, 1)
  assert.ok(graph.links.every(link => graph.entities.some(e => e.id === link.source) && graph.entities.some(e => e.id === link.target)))
})

test('pagination follows server totals even when pages are smaller than requested', async () => {
  const requests = []
  const result = await readCollection(async path => {
    requests.push(path)
    const skip = Number(new URL(path, 'https://example.test').searchParams.get('skip'))
    return { data: [{ id: String(skip) }], pagination: { total: 3 } }
  }, '/objects', z.object({ id: z.string() }))
  assert.equal(result.data.length, 3)
  assert.equal(requests.length, 3)
  assert.equal(result.truncated, false)
})

test('pagination flags view limits and stops repeated pages', async () => {
  const schema = z.object({ id: z.string() })
  const limited = await readCollection(async () => ({ data: [{ id: 'a' }, { id: 'b' }], pagination: { total: 10 } }), '/objects', schema, 1)
  assert.equal(limited.data.length, 1)
  assert.equal(limited.truncated, true)
  const withoutTotal = await readCollection(async () => ({ data: [{ id: 'a' }, { id: 'b' }] }), '/objects', schema, 1)
  assert.equal(withoutTotal.truncated, true)
  let calls = 0
  const repeated = await readCollection(async () => { calls++; return { data: [{ id: 'a' }], pagination: { total: 10 } } }, '/objects', schema)
  assert.equal(calls, 2)
  assert.equal(repeated.truncated, true)
})

test('loader reports failed membership and optional status requests as partial data', async () => {
  const result = await loadTopology(async path => {
    if (path.startsWith('/api/v1/backupObjects?')) return { data: [{ id: 'w1', name: 'Workload' }] }
    if (path.startsWith('/api/v1/backups?')) return { data: [{ id: 'b1', name: 'Backup', repositoryId: 'r1' }] }
    throw new TopologyRequestError('Unavailable', 403)
  }, 'Test source')
  assert.equal(result.warnings.length, 3)
  assert.equal(result.entities.find(e => e.id === 'repository:r1').health, 'unknown')
  assert.equal(result.sourceName, 'Test source')
})

test('core errors, malformed records, and expired authentication are never empty success', async () => {
  await assert.rejects(loadTopology(async () => { throw new TopologyRequestError('Expired', 401) }, 'source'))
  await assert.rejects(readCollection(async () => ({ data: [{ name: 'No ID' }] }), '/objects', z.object({ id: z.string() })))
})

test('membership loading never exceeds four concurrent requests', async () => {
  let active = 0
  let peak = 0
  await loadTopology(async path => {
    if (path.startsWith('/api/v1/backups?')) return { data: Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `Backup ${i}` })) }
    if (path.includes('/objects?')) {
      active++; peak = Math.max(active, peak)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
    }
    return { data: [] }
  }, 'source')
  assert.equal(peak, 4)
})

const { investigateTopology, focusTopology, topologySummary, graphFromPaths } = require('../lib/topology/investigation.ts')

test('investigation repository scope preserves existing search and attention semantics', () => {
  const graph = buildTopology(fixture())
  for (const [query, attention, repository] of [['primary', false, ''], ['', true, ''], ['', false, 'repository:r1'], ['same', false, 'repository:r1']]) {
    const old = filterTopology(graph, query, attention, repository)
    const current = investigateTopology(graph, query, repository, attention ? 'attention' : 'all', 'all')
    assert.deepEqual(current.entities.map(e => e.id), old.entities.map(e => e.id))
    assert.deepEqual(current.paths, old.paths)
  }
})

test('focus on one workload never follows another workload through a shared job', () => {
  const graph = buildTopology(fixture()), focused = focusTopology(graph, 'workload:w1')
  assert.deepEqual(focused.entities.map(e => e.id).sort(), ['job:j1', 'repository:r1', 'workload:w1'])
  assert.equal(focused.links.length, 2)
  assert.ok(focused.links.every(link => link.backupIds.every(id => id === 'b1')))
})

test('path segment highlighting excludes unrelated edges even when both endpoints are visible', () => {
  const graph = buildTopology(fixture())
  graph.entities.push({ ...graph.entities[0], id: 'workload:w4', sourceId: 'w4', name: 'Selected', kind: 'workload' })
  graph.paths.push({ backupId: 'b3', backupName: 'Direct', workloadId: 'workload:w4', repositoryId: 'repository:r2' }, { backupId: 'b4', backupName: 'Job', workloadId: 'workload:w4', jobId: 'job:j1', repositoryId: 'repository:r1' })
  graph.links.push({ id: 'workload:w4->repository:r2', source: 'workload:w4', target: 'repository:r2', backupIds: ['b3'] }, { id: 'workload:w4->job:j1', source: 'workload:w4', target: 'job:j1', backupIds: ['b4'] })
  graph.links.find(link => link.id === 'job:j1->repository:r1').backupIds.push('b4')
  const focused = focusTopology(graph, 'workload:w4')
  assert.ok(focused.entities.some(entity => entity.id === 'repository:r2'))
  assert.ok(focused.entities.some(entity => entity.id === 'job:j1'))
  assert.ok(!focused.links.some(link => link.id === 'job:j1->repository:r2'))
  assert.deepEqual(focused.links.find(link => link.id === 'job:j1->repository:r1').backupIds, ['b4'])
})

test('unlinked filter retains isolated items without inventing backup paths', () => {
  const graph = buildTopology(fixture())
  const result = investigateTopology(graph, '', '', 'unlinked', 'all')
  assert.deepEqual(result.entities.map(entity => entity.id), ['workload:w3'])
  assert.equal(result.paths.length, 0)
  assert.equal(focusTopology(graph, 'workload:w3').entities.length, 1)
})

test('missing details excludes workloads with counts whose recovery readiness is unevaluated', () => {
  const graph = buildTopology(fixture())
  const result = investigateTopology(graph, '', '', 'unknown', 'workload')
  assert.ok(!result.entities.some(entity => entity.id === 'workload:w1'))
  assert.ok(result.entities.some(entity => entity.id === 'workload:w2'))
  assert.ok(result.entities.some(entity => entity.id === 'workload:w3'))
})

test('backup name and ID search retain exact workload and destination context', () => {
  const graph = buildTopology(fixture())
  for (const query of [' First ', 'b1', 'w1']) {
    const result = investigateTopology(graph, query, '', 'all', 'workload')
    assert.equal(result.paths.length, 1)
    assert.equal(result.paths[0].backupId, 'b1')
  }
  assert.equal(investigateTopology(graph, 'not-present', '', 'all', 'all').entities.length, 0)
})

test('summary counts unique entities and backups while retaining all path rows', () => {
  const graph = buildTopology(fixture())
  graph.paths.push({ ...graph.paths[0], workloadId: 'workload:w3' })
  const result = topologySummary(graph)
  assert.equal(result.workload, 3)
  assert.equal(result.backups, 2)
  assert.equal(graph.paths.length, 3)
  assert.equal(result.attention, 1)
})

test('repository-only and metadata-only paths survive investigation', () => {
  const data = fixture()
  data.backups[0].jobId = undefined
  data.memberships[1].objects = []
  const graph = buildTopology(data)
  assert.equal(focusTopology(graph, 'repository:r1').links[0].source, 'workload:w1')
  const scoped = graphFromPaths(graph, graph.paths.filter(path => path.backupId === 'b2'))
  assert.equal(scoped.paths.length, 1)
  assert.equal(scoped.entities.length, 2)
  assert.equal(scoped.links.length, 1)
})

test('nullable and sentinel repository capacity does not discard availability or other repositories', async () => {
  const snapshot = await loadTopology(async path => ({ data: path.includes('repositories/states') ? [
    { id: 'r1', name: 'Unmeasured', capacityGB: -1, freeGB: -1, isOnline: true },
    { id: 'r2', name: 'No measurement', capacityGB: null, freeGB: null, isOnline: null },
    { id: 'r3', name: 'Low space', capacityGB: 100, freeGB: 5, isOnline: true },
  ] : [] }), 'source')
  assert.equal(snapshot.warnings.length, 0)
  assert.equal(snapshot.entities.length, 3)
  assert.equal(snapshot.entities.find(e => e.sourceId === 'r1').status, 'Online')
  assert.equal(snapshot.entities.find(e => e.sourceId === 'r1').facts[0].value, 'Unknown')
  assert.equal(snapshot.entities.find(e => e.sourceId === 'r2').health, 'unknown')
  assert.equal(snapshot.entities.find(e => e.sourceId === 'r3').health, 'attention')
})

test('documented job status identifies disabled and running jobs without legacy booleans', () => {
  const graph = buildTopology({ ...fixture(), jobs: [
    { id: 'j1', name: 'Disabled', status: 'Disabled', lastResult: 'Success' },
    { id: 'j2', name: 'Active', status: 'Running', lastResult: 'None' },
    { id: 'j3', name: 'Not run', lastResult: 'None' },
  ] })
  assert.equal(graph.entities.find(e => e.sourceId === 'j1').health, 'attention')
  assert.equal(graph.entities.find(e => e.sourceId === 'j1').status, 'Disabled')
  assert.equal(graph.entities.find(e => e.sourceId === 'j2').status, 'Running')
  assert.equal(graph.entities.find(e => e.sourceId === 'j3').status, 'Status unknown')
})
