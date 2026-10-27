/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { z } = require('zod')
const { filterJobs, filterRepositories, capacityRepositories, needsAttention, utilization, repositoryRisk, capacitySummary, sessionSummary, activityBuckets, exportJobsCsv } = require('../lib/operations/model.ts')
const { readOperationsCollection, loadOperations } = require('../lib/operations/load.ts')
const { TopologyRequestError } = require('../lib/topology/load.ts')
const now = new Date('2026-10-16T12:00:00Z')
const collection = data => ({ data, available: true, complete: true })
const session = (id, result, extra = {}) => ({ id, jobId: 'j1', name: 'Backup', sessionType: 'BackupJob', state: 'Stopped', creationTime: '2026-10-16T01:00:00Z', result: { result }, ...extra })
const snapshot = sessions => ({ range: '24h', from: '2026-10-15T12:00:00Z', fetchedAt: now.toISOString(), sessions: collection(sessions) })

test('current job results drive triage, active retries do not become unresolved failures', () => {
  assert.equal(needsAttention({ lastResult: 'Failed', status: 'Running' }), false)
  assert.equal(needsAttention({ lastResult: 'Success', status: 'Stopped' }), false)
  assert.equal(needsAttention({ lastResult: 'Failed', status: 'Disabled' }), true)
  assert.equal(needsAttention({ status: 'Stopped' }), false)
})
test('failed jobs rank before warnings and search includes repositories', () => {
  const jobs = [{ id: 'a', name: 'Warning', lastResult: 'Warning' }, { id: 'b', name: 'Failed', lastResult: 'Failed', repositoryName: 'Offsite' }, { id: 'c', name: 'Active', status: 'Running' }]
  assert.deepEqual(filterJobs(jobs, 'attention', '').map(j => j.id), ['b', 'a'])
  assert.deepEqual(filterJobs(jobs, 'all', '  OFFSITE ').map(j => j.id), ['b'])
  assert.deepEqual(filterJobs(jobs, 'running', '').map(j => j.id), ['c'])
})
test('success denominator excludes maintenance, restores, active and unknown results', () => {
  const data = snapshot([session('a', 'Success'), session('b', 'Warning'), session('c', 'Failed'), session('d', 'Success', { sessionType: 'RestoreVm' }), session('e', 'Success', { sessionType: 'RepositoryMaintenance' }), session('f', 'None'), session('g', 'Success', { state: 'Working' }), session('h', 'Success', { creationTime: '2026-10-14T00:00:00Z' })])
  const summary = sessionSummary(data)
  assert.equal(summary.completed, 3)
  assert.ok(Math.abs(summary.percent - 100 / 3) < 0.000001)
  assert.equal(activityBuckets(data).reduce((n, b) => n + b.Success + b.Warning + b.Failed, 0), 3)
  assert.equal(sessionSummary(snapshot([])).percent, null)
})
test('invalid and unlimited capacity remains unknown; offline has priority', () => {
  for (const repo of [{}, { capacityGB: 0, freeGB: 0 }, { capacityGB: -1, freeGB: -1 }, { capacityGB: 100, freeGB: 101 }]) assert.equal(utilization(repo), null)
  assert.equal(repositoryRisk({ capacityGB: 100, freeGB: 5, isOnline: true }), 'Critical')
  assert.equal(repositoryRisk({ capacityGB: 100, freeGB: 20, isOnline: true }), 'Low space')
  assert.equal(repositoryRisk({ capacityGB: 100, freeGB: 95, isOnline: false }), 'Offline')
  assert.equal(repositoryRisk({ capacityGB: 100, freeGB: 95 }), 'Unknown')
})
test('SOBR parents and unknown capacity do not inflate reported repository totals', () => {
  const result = capacitySummary([{ id: 'parent', capacityGB: 100, freeGB: 20 }, { id: 'extent', capacityGB: 100, freeGB: 20, scaleOutRepositoryDetails: { scaleOutRepositoryId: 'parent' } }, { id: 'unknown', capacityGB: -1, freeGB: -1 }])
  assert.equal(result.total, 100)
  assert.equal(result.percent, 80)
  assert.equal(result.measured, 1)
})

test('capacity metric drilldowns use the same measured set as reported capacity totals', () => {
  const repos = [
    {id:'parent',name:'Parent',capacityGB:500,freeGB:100},
    {id:'typed-parent',name:'Aggregate',type:'ScaleOut',capacityGB:500,freeGB:100},
    {id:'extent',name:'Extent',capacityGB:500,freeGB:100,scaleOutRepositoryDetails:{scaleOutRepositoryId:'parent'}},
    {id:'full',name:'Full',capacityGB:100,freeGB:0},
    {id:'unknown',name:'Unmeasured',capacityGB:-1,freeGB:-1},
  ]
  const measured = filterRepositories(repos,'measured','')
  assert.deepEqual(measured.map(r=>r.id),['extent','full'])
  assert.deepEqual(capacityRepositories(repos).map(r=>r.id),['extent','full','unknown'])
  assert.equal(capacitySummary(repos).measured,measured.length)
  assert.equal(capacitySummary(repos).total,600)
  assert.equal(capacitySummary(repos).free,100)
  assert.deepEqual(filterRepositories(repos,'unmeasured','').map(r=>r.id),['unknown'])
  assert.deepEqual(filterRepositories(repos,'all','').map(r=>r.id),repos.map(r=>r.id))
})

test('unmeasured drilldown distinguishes missing capacity from genuinely zero free space and combines with search', () => {
  const repos = [
    {id:'full',name:'Full',capacityGB:100,freeGB:0},
    {id:'missing',name:'Cloud Missing'},
    {id:'unlimited',name:'Cloud Unlimited',capacityGB:-1,freeGB:-1},
    {id:'invalid',name:'Invalid',capacityGB:100,freeGB:110},
    {id:'zero',name:'Zero capacity',capacityGB:0,freeGB:0},
  ]
  assert.deepEqual(filterRepositories(repos,'unmeasured','').map(r=>r.id),['missing','unlimited','invalid','zero'])
  assert.deepEqual(filterRepositories(repos,'unmeasured',' CLOUD ').map(r=>r.id),['missing','unlimited'])
  assert.equal(capacitySummary([repos[0]]).free,0)
  assert.equal(capacitySummary([repos[0]]).measured,1)
  assert.equal(capacitySummary(repos.slice(1)).measured,0)
})

test('capacity issue filters retain offline and critical overlap, boundaries, and updates without flagging unknown as healthy', () => {
  const repos = [
    {id:'both',name:'Offline full',capacityGB:100,freeGB:1,isOnline:false},
    {id:'critical',name:'Critical',capacityGB:100,freeGB:10,isOnline:true},
    {id:'low',name:'Low',capacityGB:100,freeGB:20,isOnline:true},
    {id:'update',name:'Update',capacityGB:100,freeGB:80,isOnline:true,isOutOfDate:true},
    {id:'healthy',name:'Healthy',capacityGB:100,freeGB:80,isOnline:true},
    {id:'unknown',name:'Unknown'},
  ]
  assert.deepEqual(filterRepositories(repos,'attention','').map(r=>r.id),['both','critical','low','update'])
  assert.deepEqual(filterRepositories(repos,'critical','').map(r=>r.id),['both','critical'])
  assert.deepEqual(filterRepositories(repos,'offline','').map(r=>r.id),['both'])
  assert.deepEqual(filterRepositories(repos,'attention','offline').map(r=>r.id),['both'])
})

test('job metric categories exclude active retries from failures while disabled results remain independently visible', () => {
  const jobs = [
    {id:'retry',name:'Retry',status:'Running',lastResult:'Failed'},
    {id:'starting',name:'Starting',status:'Starting',lastResult:'Warning'},
    {id:'failed',name:'Failed',status:'Stopped',lastResult:'Failed'},
    {id:'disabled',name:'Disabled',status:'Disabled',lastResult:'Failed'},
    {id:'warning',name:'Warning',status:'Stopped',lastResult:'Warning'},
  ]
  assert.deepEqual(filterJobs(jobs,'failed','').map(j=>j.id),['disabled','failed'])
  assert.deepEqual(filterJobs(jobs,'warning','').map(j=>j.id),['warning'])
  assert.deepEqual(filterJobs(jobs,'running','').map(j=>j.id),['retry','starting'])
  assert.deepEqual(filterJobs(jobs,'disabled','').map(j=>j.id),['disabled'])
})
test('CSV escapes formulas, embedded quotes and commas', () => {
  const csv = exportJobsCsv([{ name: '=HYPERLINK("bad")', repositoryName: 'one,two', type: '@evil' }])
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'))
  assert.ok(csv.includes('"one,two"'))
  assert.ok(csv.includes('"\'@evil"'))
})
test('pagination preserves history filters and follows server totals', async () => {
  const paths = []
  const result = await readOperationsCollection(async path => {
    paths.push(path)
    const url = new URL(path, 'https://test.invalid')
    return { data: [{ id: url.searchParams.get('skip') }], pagination: { total: 3 } }
  }, '/sessions?createdAfterFilter=yesterday', z.object({ id: z.string() }))
  assert.equal(result.data.length, 3)
  assert.equal(result.complete, true)
  assert.ok(paths.every(path => path.includes('createdAfterFilter=yesterday')))
})
test('repeated pages and view limits never claim complete coverage', async () => {
  const schema = z.object({ id: z.string() })
  const read = async () => ({ data: [{ id: 'a' }], pagination: { total: 20 } })
  assert.equal((await readOperationsCollection(read, '/jobs', schema)).complete, false)
  assert.equal((await readOperationsCollection(read, '/jobs', schema, 1)).complete, false)
})
test('one unavailable optional collection preserves successful sections', async () => {
  const result = await loadOperations(async path => {
    if (path.includes('repositories')) throw new Error('Unsupported')
    if (path.includes('bestPractices')) return { items: [] }
    return { data: [], pagination: { total: 0 } }
  }, 'VBR', '24h', now)
  assert.equal(result.jobs.available, true)
  assert.equal(result.repositories.available, false)
  assert.equal(result.sessions.available, true)
  assert.equal(result.warnings.length, 1)
})
test('authentication failure is propagated instead of reporting empty healthy sections', async () => {
  await assert.rejects(() => loadOperations(async () => { throw new TopologyRequestError('Reconnect', 401) }, 'VBR', '24h', now), { status: 401 })
})
test('a completely unavailable source is an error, never a connected empty snapshot', async () => {
  await assert.rejects(() => loadOperations(async () => { throw new Error('offline') }, 'VBR', '24h', now), { status: 502 })
})
