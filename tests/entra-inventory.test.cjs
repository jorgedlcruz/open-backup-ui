// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename)
const { loadEntraInventory } = require('../lib/entra-inventory/load.ts')
const { TopologyRequestError } = require('../lib/topology/load.ts')
const uuid = n => 'abcdef12-3456-4123-8123-' + String(n).padStart(12, '0')
const tenants = '/api/v1/inventory/entraId/tenants', jobs = '/api/v1/jobs', states = '/api/v1/jobs/states'
const repos = '/api/v1/backupInfrastructure/repositories/states', points = '/api/v1/restorePoints'
const type = 'EntraIDTenantBackup'
const page = data => ({ data, pagination: { total: data.length } })
const tenant = (id, azureId, extra) => ({ id: uuid(id), azureTenantId: uuid(azureId), cacheRepositoryId: uuid(50), ...extra })
function fixture(overrides = {}) {
  const calls = []
  const read = async path => {
    const url = new URL(path, 'https://vbr.test')
    calls.push(url)
    assert.ok([tenants, jobs, states, repos, points].includes(url.pathname))
    if ([jobs, states].includes(url.pathname)) assert.equal(url.searchParams.get('typeFilter'), type)
    if (url.pathname === points) {
      assert.equal(url.searchParams.get('platformNameFilter'), 'EntraID')
      assert.equal(url.searchParams.get('orderColumn'), 'CreationTime')
      assert.equal(url.searchParams.get('orderAsc'), 'false')
      assert.equal(url.searchParams.get('limit'), '1')
    }
    const response = overrides[url.pathname]
    if (response instanceof Error) throw response
    return typeof response === 'function' ? response(url) : response ?? page([])
  }
  return { load: () => loadEntraInventory(read, 'backup.example', 'source-scope'), calls }
}

test('uses tenant IDs for job assignment and keeps a failed run separate from the newest restore point', async () => {
  const time = '2026-11-21T15:00:00.1234567+00:00'
  const api = fixture({
    [tenants]: page([tenant(1, 2, { description: 'Same', region: 'Global',
      authentication: { secret: 'PRIVATE', certificate: { data: 'PRIVATE' } } }), tenant(2, 3, { description: 'Same', name: 'Live tenant' })]),
    [jobs]: page([{id: uuid(4), name: 'First', type, storage: { tenantId: uuid(1).toUpperCase() }},
      {id: uuid(5), name: 'Second', type, storage: { tenantId: uuid(1) }}]),
    [states]: page([{ id: uuid(5), type, lastRun: '2026-11-22T11:25:00Z', lastResult: 'Failed' },
      { id: uuid(4), type, lastRun: '2026-11-20T01:00:00Z', lastResult: 'Success' }]),
    [repos]: page([{ id: uuid(50), name: 'Fast cache' }]),
    [points]: page([{ id: uuid(6), name: 'Backed up tenant', platformName: 'EntraID', creationTime: time }]),
  })
  const result = await api.load()
  assert.deepEqual(result.warnings, [])
  assert.equal(result.sourceKey, 'source-scope')
  assert.deepEqual(result.latestRestorePoint, { id: uuid(6), name:'Backed up tenant', creationTime: time })
  assert.equal(result.tenants[0].lastRun.result, 'Failed')
  assert.deepEqual(result.tenants[0].backupJobs.map(x => x.name), ['First','Second'])
  assert.equal(result.tenants[0].cacheRepositoryName, 'Fast cache')
  assert.equal(result.tenants[0].name, null)
  assert.equal(result.tenants[1].name, 'Live tenant')
  assert.deepEqual(result.tenants[1].backupJobs, [])
  assert.equal(result.backupJobCount, 2)
  assert.equal(api.calls.length, 5)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|authentication|certificate|secret/)
})

test('follows VBR pagination and distinguishes unavailable associations from zero jobs', async () => {
  const api = fixture({
    [tenants]: url => ({ data: [url.searchParams.get('skip') === '1' ? tenant(2, 12) : tenant(1, 11)], pagination: { total: 2 } }),
    [jobs]: new TopologyRequestError('Forbidden', 403),
    [points]: new Error('Timeout'),
    [repos]: page([]),
  })
  const result = await api.load()
  assert.equal(result.tenants.length, 2)
  assert.equal(result.tenantInventoryComplete, true)
  assert.equal(result.jobsAvailable, false)
  assert.equal(result.backupJobCount, null)
  assert.equal(result.tenants[0].cacheRepositoryId, uuid(50))
  assert.equal(result.tenants[0].cacheRepositoryName, null)
  assert.equal(result.restorePointsAvailable, false)
  assert.deepEqual(result.warnings, ['jobsUnavailable', 'restorePointsUnavailable'])
  const empty = await fixture().load()
  assert.equal(empty.restorePointsAvailable, true)
  assert.equal(empty.jobsAvailable, true)
  assert.equal(empty.latestRestorePoint, null)
  assert.equal(empty.backupJobCount, 0)
})

test('never reports an unsupported restore point, incomplete point page, or mismatched job filter as Entra evidence', async () => {
  const point = { id: uuid(10), name: 'Other VM', platformName: 'VMware', creationTime: '2026-11-22T12:00:00Z' }
  const ignored = await fixture({
    [jobs]: page([{ id: uuid(10), type:'EntraIDAuditLogBackup', name:'Logs', tenant: { tenantId: uuid(1) } }]),
    [points]: page([point]),
  }).load()
  assert.equal(ignored.restorePointsAvailable, false)
  assert.equal(ignored.latestRestorePoint, null)
  assert.equal(ignored.jobsAvailable, false)
  const incomplete = await fixture({ [points]:{data:[], pagination:{total:1}} }).load()
  assert.equal(incomplete.restorePointsAvailable, false)
})

test('retains partial collections, passes expired auth through and refuses missing tenant inventory', async () => {
  const badPage = {data:[tenant(1, 11)], pagination:{total:2}}
  const partial = await fixture({ [tenants]: badPage }).load()
  assert.equal(partial.tenants.length, 1)
  assert.equal(partial.tenantInventoryComplete, false)
  assert.ok(partial.warnings.includes('partialTenants'))
  const expired = new TopologyRequestError('Old credentials', 401)
  await assert.rejects(fixture({ [states]: expired }).load(), error => error === expired)
  const denied = new TopologyRequestError('Forbidden', 403)
  await assert.rejects(fixture({ [tenants]: denied }).load(), error => error === denied)
})
