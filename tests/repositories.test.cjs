const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configuredImmutability, summarizeFiles, affectedJobs, reportedGB, configSchema } = require('../lib/repositories/model.ts');
const { loadRepository } = require('../lib/repositories/load.ts');
const { TopologyRequestError } = require('../lib/topology/load.ts');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const repo = uid(1), parent = uid(2), backup = uid(3), job = uid(4), other = uid(5);
const file = (n, overrides = {}) => ({ id: uid(n), backupId: backup, backupSize: 100, dataSize: 200, ...overrides });
const collection = data => ({ data, pagination: { total: data.length } });
const now = new Date('2026-10-20T09:00:00Z');
const config = { id: repo, name: 'Storage', type: 'LinuxHardened', repository: { makeRecentBackupsImmutableDays: 7 } };
const state = { id: repo, name: 'Storage', type: 'LinuxHardened', capacityGB: 100, freeGB: 0, isOnline: true };
function fixture(overrides = {}) {
  const calls = [];
  const routes = {
    '/api/v1/serverInfo': { buildVersion: '13.1.0.411' },
    '/api/v1/backupInfrastructure/repositories/states': collection([state]),
    '/api/v1/backupInfrastructure/scaleOutRepositories': collection([]),
    '/api/v1/jobs/states': collection([{ id: job, name: 'Backup job', repositoryId: repo, lastResult: 'Failed' }]),
    '/api/v1/backups': collection([{ id: backup, name: 'Backup job', jobId: job, repositoryId: repo }]),
    [`/api/v1/backupInfrastructure/repositories/${repo}`]: config,
    [`/api/v1/backups/${backup}/backupFiles`]: collection([file(10)]),
    ...overrides,
  };
  return { calls, read: async (path, revision) => {
    calls.push({ path, revision });
    const key = path.split('?')[0];
    const value = routes[key];
    if (value instanceof Error) throw value;
    if (typeof value === 'function') return value(new URL(path, 'https://vbr.test'));
    if (value === undefined) throw new Error(`Unexpected read ${key}`);
    return value;
  } };
}
test('file accounting deduplicates shared files without multiplying by objects or points', () => {
  const shared = file(10, { objectIds: [uid(20), uid(21)], restorePointIds: [uid(30), uid(31)] });
  const result = summarizeFiles([shared, shared, file(11, { backupSize: 0, dataSize: 0 })], true);
  assert.equal(result.physical, 100);
  assert.equal(result.logical, 200);
  assert.equal(result.files, 2);
  assert.equal(result.shared, 1);
  assert.equal(result.complete, true);
});
test('unknown, negative, fractional and unsafe sizes cannot silently become zero', () => {
  const result = summarizeFiles([file(10, { backupSize: null }), file(11, { backupSize: -1 }), file(12, { backupSize: 1.5 }), file(13, { backupSize: Number.MAX_SAFE_INTEGER + 1 }), file(14)], true);
  assert.equal(result.physical, 100);
  assert.equal(result.unknownPhysical, 4);
  assert.equal(result.complete, false);
  assert.equal(summarizeFiles([], false).physical, null);
  assert.equal(summarizeFiles([], true).physical, 0);
  assert.equal(summarizeFiles([file(10, { backupSize: Number.MAX_SAFE_INTEGER }), file(11)], true).physical, null);
});
test('conflicting IDs are excluded, including cross-backup ownership', () => {
  const result = summarizeFiles([file(10), file(10, { backupId: other }), file(11), file(11, { backupSize: 300 }), file(12)], true);
  assert.equal(result.conflicts, 2);
  assert.equal(result.physical, 100);
  assert.equal(result.complete, false);
});
test('capacity unknown sentinels stay unknown and zero free space is retained', () => {
  assert.equal(reportedGB(-1), 'Not reported');
  assert.equal(reportedGB(null), 'Not reported');
  assert.equal(reportedGB(0), '0 GB');
});
test('immutability is configuration evidence; missing values are not disabled', () => {
  assert.equal(configuredImmutability(config).period, '7 days');
  assert.equal(configuredImmutability(config).status, 'Configured');
  assert.equal(configuredImmutability({ ...config, repository: {} }).status, 'Not reported');
  assert.equal(configuredImmutability({ ...config, repository: { makeRecentBackupsImmutableDays: 0 } }).status, 'Not reported');
  assert.equal(configuredImmutability({ id: repo, type: 'WinLocal' }).status, 'Not reported');
});
test('object retention mode and explicit disabled governance have distinct meanings', () => {
  assert.equal(configuredImmutability({ id: repo, container: { immutability: { isEnabled: true, daysCount: 7, immutabilityMode: 'RetentionSettings' } } }).period, 'Follows backup retention');
  assert.equal(configuredImmutability({ id: repo, bucket: { immutability: { isEnabled: false, daysCount: 7 } } }).period, 'Not applicable');
  assert.equal(configuredImmutability({ id: repo, type: 'LinuxLocal', repository: { enableGovernanceMode: false } }).status, 'Disabled');
});
test('configuration whitelist strips credentials and provider accounts recursively', () => {
  const sanitized = configSchema.parse({ ...config, account: { credentialsId: 'secret' }, repository: { ...config.repository, credentials: 'secret' }, password: 'secret' });
  assert.ok(!JSON.stringify(sanitized).includes('secret'));
});
test('job links distinguish direct targets, parent dependencies and historical owners', () => {
  const jobs = [{ id: job, name: 'Direct', repositoryId: repo }, { id: other, name: 'Parent', repositoryId: parent }, { id: uid(6), name: 'Moved', repositoryId: uid(9) }];
  const rows = affectedJobs(jobs, [{ id: backup, jobId: uid(6) }, { id: uid(7), name: 'Deleted', jobId: uid(8) }], new Set([repo]), new Set([parent]));
  assert.deepEqual(rows.find(j => j.id === job).relationships, ['Configured target']);
  assert.deepEqual(rows.find(j => j.id === other).relationships, ['Via scale-out parent']);
  assert.deepEqual(rows.find(j => j.id === uid(6)).relationships, ['Retained backup']);
  assert.equal(rows.find(j => j.id === uid(8)).job, null);
});
test('loader scopes backups and files by exact IDs, negotiates revision, and keeps failed jobs', async () => {
  const f = fixture({
    '/api/v1/backups': collection([{ id: backup, name: 'Backup job', jobId: job, repositoryId: repo }, { id: other, name: 'Same name', repositoryId: parent }]),
    [`/api/v1/backups/${backup}/backupFiles`]: collection([file(10), file(11, { backupId: other })]),
  });
  const result = await loadRepository(f.read, 'Source', repo, now);
  assert.equal(result.backups.data.length, 1);
  assert.equal(result.consumption.physical, 100);
  assert.equal(result.consumption.complete, false);
  assert.equal(result.jobs.data[0].job.lastResult, 'Failed');
  assert.equal(result.apiRevision, '1.3-rev2');
  assert.ok(f.calls.slice(1).every(call => call.revision === '1.3-rev2'));
  assert.ok(!f.calls.some(call => call.path.includes(`/backups/${other}/`)));
});
test('extent view exposes parent dependency without charging parent files to that extent', async () => {
  const f = fixture({
    '/api/v1/backupInfrastructure/repositories/states': collection([{ ...state, scaleOutRepositoryDetails: { scaleOutRepositoryId: parent, membership: 'SOBR', extentType: 'Performance' } }]),
    '/api/v1/jobs/states': collection([{ id: job, name: 'Parent job', repositoryId: parent }]),
    '/api/v1/backups': collection([{ id: backup, name: 'Parent backup', repositoryId: parent, jobId: job }]),
  });
  const result = await loadRepository(f.read, 'Source', repo, now);
  assert.equal(result.parents[0].id, parent);
  assert.equal(result.parentBackups, 1);
  assert.equal(result.backups.data.length, 0);
  assert.deepEqual(result.jobs.data[0].relationships, ['Via scale-out parent']);
  assert.ok(!f.calls.some(c => c.path.includes('/backupFiles')));
});
test('scale-out parent shows extent readings separately and never sums parent and child capacity', async () => {
  const f = fixture({
    '/api/v1/backupInfrastructure/scaleOutRepositories': collection([{ id: parent, name: 'SOBR', performanceTier: { performanceExtents: [{ id: repo, name: 'Storage', status: ['Maintenance'] }] } }]),
    '/api/v1/backups': collection([{ id: backup, name: 'SOBR backup', repositoryId: parent }]),
  });
  const result = await loadRepository(f.read, 'Source', parent, now);
  assert.equal(result.state, null);
  assert.equal(result.extents.length, 1);
  assert.equal(result.extents[0].state.freeGB, 0);
  assert.deepEqual(result.extents[0].status, ['Maintenance']);
  assert.equal(result.backups.data.length, 1);
  assert.equal(result.consumption.physical, 100);
  assert.ok(!f.calls.some(c => c.path === `/api/v1/backupInfrastructure/repositories/${parent}`));
});
test('unavailable optional sections retain capacity and do not claim complete zero consumption', async () => {
  const f = fixture({ '/api/v1/backups': new TopologyRequestError('Denied', 403) });
  const result = await loadRepository(f.read, 'Source', repo, now);
  assert.equal(result.state.freeGB, 0);
  assert.equal(result.backups.available, false);
  assert.equal(result.consumption.physical, null);
  assert.equal(result.jobs.complete, false);
  assert.match(result.warnings.join(' '), /account cannot read/);
});
test('authentication expiry propagates even from optional file reads', async () => {
  const f = fixture({ [`/api/v1/backups/${backup}/backupFiles`]: new TopologyRequestError('Expired', 401) });
  await assert.rejects(loadRepository(f.read, 'Source', repo, now), error => error.status === 401);
});
test('missing or mismatched repository identity never loads another repository as the subject', async () => {
  const f = fixture({ '/api/v1/backupInfrastructure/repositories/states': collection([]), [`/api/v1/backupInfrastructure/repositories/${repo}`]: { ...config, id: other } });
  await assert.rejects(loadRepository(f.read, 'Source', repo, now), error => error.status === 404);
});
test('file loading is bounded and unloaded backups are labelled rather than counted as zero', async () => {
  const backups = Array.from({ length: 31 }, (_, n) => ({ id: uid(n + 100), name: `Backup ${n}`, repositoryId: repo }));
  const overrides = { '/api/v1/backups': collection(backups) };
  for (const b of backups) overrides[`/api/v1/backups/${b.id}/backupFiles`] = collection([]);
  const f = fixture(overrides), result = await loadRepository(f.read, 'Source', repo, now);
  assert.equal(f.calls.filter(c => c.path.includes('/backupFiles')).length, 30);
  assert.equal(result.backups.data.length, 31);
  assert.equal(result.backups.data.filter(b => !b.available).length, 1);
  assert.equal(result.consumption.complete, false);
  assert.ok(result.warnings.some(w => w.includes('30 backups')));
});
test('empty NAS file inventory is unmeasured even when the API marks the collection complete', async () => {
  const f = fixture({ [`/api/v1/backups/${backup}/backupFiles`]: collection([]) });
  const result = await loadRepository(f.read, 'Source', repo, now);
  assert.equal(result.backups.data[0].consumption.physical, null);
  assert.equal(result.consumption.complete, false);
  assert.match(result.backups.data[0].error, /unmeasured/);
});
test('loader preserves contradictory duplicate file records for accounting exclusion', async () => {
  const f = fixture({ [`/api/v1/backups/${backup}/backupFiles`]: collection([file(10), file(10, { backupSize: 200 }), file(11)]) });
  const result = await loadRepository(f.read, 'Source', repo, now);
  assert.equal(result.consumption.conflicts, 1);
  assert.equal(result.consumption.physical, 100);
  assert.equal(result.backups.data[0].consumption.conflicts, 1);
});
test('file pagination retains all pages and repeated pages are labelled partial', async () => {
  const rows = Array.from({ length: 201 }, (_, n) => file(n + 100));
  const f = fixture({ [`/api/v1/backups/${backup}/backupFiles`]: url => ({ data: rows.slice(Number(url.searchParams.get('skip')), Number(url.searchParams.get('skip')) + 200), pagination: { total: 201 } }) });
  const result = await loadRepository(f.read, 'Source', repo, now);
  assert.equal(result.consumption.files, 201);
  assert.equal(result.consumption.physical, 20100);
  assert.equal(result.consumption.complete, true);
  const repeated = fixture({ [`/api/v1/backups/${backup}/backupFiles`]: { data: rows.slice(0, 200), pagination: { total: 500 } } });
  const partial = await loadRepository(repeated.read, 'Source', repo, now);
  assert.equal(partial.consumption.files, 200);
  assert.equal(partial.consumption.complete, false);
  assert.equal(repeated.calls.filter(c => c.path.includes('/backupFiles')).length, 2);
});
