const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { test } = require('node:test'), assert = require('node:assert/strict');
const { buildInventory, defaultInventoryFilters: defaults, matchesRepository, inventoryPage, rowIssues, needsStorageAttention, policyState } = require('../lib/repositories/inventory.ts');
const { loadRepositoryInventory } = require('../lib/repositories/load-inventory.ts');
const { TopologyRequestError } = require('../lib/topology/load.ts');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const repo = uid(1), parent = uid(2), capacity = uid(3);
const evidence = (data, extra = {}) => ({ data, available: true, complete: true, ...extra });
const state = (id, extra = {}) => ({ id, name: `Repository ${id}`, type: 'LinuxHardened', capacityGB: 100, freeGB: 50, isOnline: true, isOutOfDate: false, ...extra });
const config = (id, extra = {}) => ({ id, name: `Storage ${id}`, type: 'LinuxHardened', repository: { makeRecentBackupsImmutableDays: 7 }, ...extra });
const inventory = extra => ({ sourceName: 'Source', fetchedAt: '2026-10-20T12:00:00Z', apiRevision: '1.3-rev2', warnings: [],
  states: evidence([state(repo)]), configs: evidence([config(repo)]), scaleOuts: evidence([]), ...extra });
const sobr = (id = parent, extra = {}) => ({ id, name: 'Production SOBR', performanceTier: { performanceExtents: [{ id: repo, name: 'Performance extent', status: ['Normal'] }] },
  capacityTier: { isEnabled: true, extents: [{ id: capacity }] }, ...extra });
test('scale-out grouping joins by IDs and counts physical repositories once, excluding logical parents', () => {
  const result = buildInventory(inventory({ states: evidence([state(repo), state(capacity), state(parent, { type: 'ExtendableRepository' })]), scaleOuts: evidence([sobr()]) }));
  assert.equal(result.rows.length, 2);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].rows.length, 2);
  assert.equal(result.rows.find(r => r.id === capacity).memberships[0].tier, 'Capacity');
  assert.ok(!result.rows.some(r => r.id === parent));
});
test('same names do not create membership and config-only/state-only rows remain visible', () => {
  const result = buildInventory(inventory({ states: evidence([state(repo, { name: 'Same' }), state(uid(9), { name: 'Same' })]), configs: evidence([config(uid(8))]), scaleOuts: evidence([sobr(parent, { capacityTier: null })]) }));
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows.find(r => r.id === uid(9)).groupId, 'standalone');
  assert.equal(result.rows.find(r => r.id === uid(8)).state, null);
  assert.equal(policyState(result.rows.find(r => r.id === repo)), 'unknown');
});
test('missing extent data creates an unknown placeholder rather than losing a dependency', () => {
  const result = buildInventory(inventory({ scaleOuts: evidence([sobr()]) }));
  const missing = result.rows.find(r => r.id === capacity);
  assert.equal(missing.state, null);
  assert.equal(missing.config, null);
  assert.equal(rowIssues(missing).unmeasured, true);
  assert.equal(rowIssues(missing).offline, false);
  assert.equal(policyState(missing), 'unknown');
});
test('reported parent membership survives unavailable scale-out configuration', () => {
  const result = buildInventory(inventory({ states: evidence([state(repo, { scaleOutRepositoryDetails: { scaleOutRepositoryId: parent, membership: 'Known parent', extentType: 'Performance' } })]),
    scaleOuts: evidence([], { available: false, complete: false }) }));
  assert.equal(result.groups[0].name, 'Known parent');
  assert.equal(result.groups[0].inferred, true);
  assert.equal(result.rows[0].groupId, parent);
});
test('an unavailable membership inventory does not label unverified rows standalone', () => {
  const result = buildInventory(inventory({ scaleOuts: evidence([], { available: false, complete: false }) }));
  assert.equal(result.rows[0].groupId, 'unverified');
  assert.equal(matchesRepository(result.rows[0], { ...defaults, membership: 'standalone' }), false);
  assert.equal(matchesRepository(result.rows[0], { ...defaults, membership: 'unverified' }), true);
});
test('multiple parent references are explicit and never duplicate the storage ID', () => {
  const result = buildInventory(inventory({ scaleOuts: evidence([sobr(parent, { capacityTier: null }), sobr(uid(8), { name: 'Second', capacityTier: null })]) }));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].memberships.length, 2);
  assert.equal(result.rows[0].groupId, 'multiple');
  assert.equal(result.groups.flatMap(g => g.rows).length, 1);
});
test('offline, outdated, and maintenance conditions are independently filterable', () => {
  const row = buildInventory(inventory({ states: evidence([state(repo, { freeGB: 0, isOnline: false, isOutOfDate: true })]),
    scaleOuts: evidence([sobr(parent, { capacityTier: null, performanceTier: { performanceExtents: [{ id: repo, status: ['Normal', 'Maintenance'] }] } })]) })).rows[0];
  for (const issue of ['attention', 'critical', 'low', 'offline', 'outdated', 'extent-state']) assert.equal(matchesRepository(row, { ...defaults, issue }), true, issue);
  assert.deepEqual(rowIssues(row).extentStates, ['Maintenance']);
});
test('capacity filters use headroom instead of Fast Clone file-size totals', () => {
  const row = buildInventory(inventory({ states: evidence([state(repo, { freeGB: 80, usedSpaceGB: 900 })]) })).rows[0];
  assert.equal(needsStorageAttention(row), false);
  assert.equal(matchesRepository(row, { ...defaults, issue: 'critical' }), false);
  const unknown = buildInventory(inventory({ states: evidence([state(repo, { capacityGB: -1, freeGB: -1 })]) })).rows[0];
  assert.equal(matchesRepository(unknown, { ...defaults, issue: 'unmeasured' }), true);
  assert.equal(matchesRepository(unknown, { ...defaults, issue: 'critical' }), false);
});
test('immutability filters keep explicitly disabled and missing policies separate', () => {
  const rows = buildInventory(inventory({ configs: evidence([config(repo), config(uid(5), { type: 'WinLocal', repository: {} }), config(uid(6), { type: 'WasabiCloud', bucket: { immutability: { isEnabled: false } } })]) })).rows;
  assert.equal(rows.filter(r => matchesRepository(r, { ...defaults, immutability: 'configured' })).length, 1);
  assert.equal(rows.filter(r => matchesRepository(r, { ...defaults, immutability: 'disabled' })).length, 1);
  assert.equal(rows.filter(r => matchesRepository(r, { ...defaults, immutability: 'unknown' })).length, 1);
});
test('search by parent name retains matching children while other filters remain conjunctive', () => {
  const built = buildInventory(inventory({ states: evidence([state(repo, { freeGB: 5 }), state(capacity, { capacityGB: -1, freeGB: -1 })]), scaleOuts: evidence([sobr()]) }));
  const view = inventoryPage(built.groups, { ...defaults, query: 'production sobr', issue: 'critical' }, 'risk', true, 0);
  assert.equal(view.count, 1);
  assert.equal(view.groups[0].id, parent);
  assert.equal(view.rows[0].id, repo);
});
test('paging keeps group context and visits every repository once', () => {
  const states = Array.from({ length: 19 }, (_, i) => state(uid(i + 100)));
  const built = buildInventory(inventory({ states: evidence(states), configs: evidence([]) }));
  const first = inventoryPage(built.groups, defaults, 'name', true, 0), second = inventoryPage(built.groups, defaults, 'name', true, 1);
  assert.equal(first.rows.length, 15); assert.equal(second.rows.length, 4);
  assert.equal(new Set([...first.rows, ...second.rows].map(r => r.id)).size, 19);
  assert.equal(first.groups[0].matching, 19);
  assert.equal(inventoryPage(built.groups, { ...defaults, query: uid(100) }, 'name', true, 9).current, 0);
});
test('empty scale-out parents remain discoverable without becoming a physical repository', () => {
  const built = buildInventory(inventory({ scaleOuts: evidence([sobr(parent, { performanceTier: { performanceExtents: [] }, capacityTier: null })]) }));
  const view = inventoryPage(built.groups, defaults, 'risk', true, 0);
  assert.equal(view.emptyParents.length, 1);
  assert.equal(view.rows.length, 1);
  assert.equal(inventoryPage(built.groups, { ...defaults, issue: 'offline' }, 'risk', true, 0).emptyParents.length, 0);
});
test('highest-utilization sorting places unknown values last in grouped and flat views', () => {
  const built = buildInventory(inventory({ states: evidence([state(repo, { freeGB: 1 }), state(capacity, { capacityGB: -1, freeGB: -1, isOnline: false })]),
    scaleOuts: evidence([sobr(parent, { performanceTier: { performanceExtents: [{ id: capacity }] }, capacityTier: null })]) }));
  assert.equal(inventoryPage(built.groups, defaults, 'usage', true, 0).rows[0].id, repo);
  assert.equal(inventoryPage(built.groups, defaults, 'usage', false, 0).rows[0].id, repo);
});
function fixture(overrides = {}) {
  const calls = [], list = data => ({ data, pagination: { total: data.length } });
  const routes = { '/api/v1/serverInfo': { buildVersion: '13.1.0.411' },
    '/api/v1/backupInfrastructure/repositories/states': list([state(repo)]),
    '/api/v1/backupInfrastructure/repositories': list([config(repo, { account: { credentialsId: 'PRIVATE' } })]),
    '/api/v1/backupInfrastructure/scaleOutRepositories': list([sobr()]), ...overrides };
  return { calls, read: async (path, revision) => {
    calls.push({ path, revision });
    const value = routes[path.split('?')[0]];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error('Unexpected API call');
    return typeof value === 'function' ? value(new URL(path, 'https://vbr.invalid')) : value;
  } };
}
test('list loader reads paginated inventory without backup-file fan-out and strips credentials', async () => {
  const f = fixture(), result = await loadRepositoryInventory(f.read, 'Source');
  assert.equal(f.calls.length, 4);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(result.apiRevision, '1.3-rev2');
  assert.ok(f.calls.slice(1).every(c => c.revision === '1.3-rev2'));
});
test('permission gaps retain useful rows with explicit coverage warnings', async () => {
  const f = fixture({ '/api/v1/backupInfrastructure/repositories': new TopologyRequestError('Denied', 403) });
  const result = await loadRepositoryInventory(f.read, 'Source');
  assert.equal(result.configs.available, false);
  assert.equal(result.states.available, true);
  assert.ok(result.warnings.some(w => w.includes('cannot read')));
  assert.equal(policyState(buildInventory(result).rows[0]), 'unknown');
});
test('expired auth is never swallowed as an optional collection', async () => {
  const f = fixture({ '/api/v1/backupInfrastructure/repositories': new TopologyRequestError('Expired', 401) });
  await assert.rejects(loadRepositoryInventory(f.read, 'Source'), error => error.status === 401);
});
test('version lookup failure falls back explicitly and total data failure is an error', async () => {
  const f = fixture({ '/api/v1/serverInfo': new Error('Unavailable') });
  const result = await loadRepositoryInventory(f.read, 'Source');
  assert.equal(result.apiRevision, '1.3-rev1');
  assert.ok(result.warnings.some(w => w.includes('Server version')));
  const noData = fixture(Object.fromEntries(['/repositories', '/repositories/states', '/scaleOutRepositories'].map(path => [`/api/v1/backupInfrastructure${path}`, new Error('Unavailable')])));
  await assert.rejects(loadRepositoryInventory(noData.read, 'Source'), error => error.status === 502);
});
test('list pagination reads further pages and detects repeated pages', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => state(uid(100 + i)));
  const f = fixture({ '/api/v1/backupInfrastructure/repositories/states': url => ({ data: rows.slice(Number(url.searchParams.get('skip')), Number(url.searchParams.get('skip')) + 200), pagination: { total: 201 } }) });
  const complete = await loadRepositoryInventory(f.read, 'Source');
  assert.equal(complete.states.data.length, 201); assert.equal(complete.states.complete, true);
  const repeated = fixture({ '/api/v1/backupInfrastructure/repositories/states': { data: rows.slice(0, 200), pagination: { total: 500 } } });
  const partial = await loadRepositoryInventory(repeated.read, 'Source');
  assert.equal(partial.states.data.length, 200); assert.equal(partial.states.complete, false);
});
