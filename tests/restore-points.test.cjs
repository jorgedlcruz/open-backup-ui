const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enrichPoints, fileAccounting, formatBytes, knownSize, recoveryReadiness } = require('../lib/restore-points/model.ts');
const { loadRestorePoints } = require('../lib/restore-points/load.ts');
const { TopologyRequestError } = require('../lib/topology/load.ts');

const now = Date.parse('2026-10-17T12:00:00Z');
const point = (id, extra = {}) => ({ id, backupId: 'b1', creationTime: '2026-10-17T10:00:00Z', ...extra });
const file = (extra = {}) => ({ id: 'f1', backupId: 'b1', name: 'shared.vbk', backupSize: 100, dataSize: 400, objectIds: ['o1', 'o2'], restorePointIds: ['p1', 'p2'], ...extra });
const snapshot = (data, files = [], extra = {}) => ({ sourceName: 'test', fetchedAt: new Date(now).toISOString(), subject: null, data, pointsComplete: true, filesComplete: true, files, backups: [], repositories: [], warnings: [], ...extra });

test('missing, negative and unsafe sizes remain unknown, but zero is a measured value', () => {
  for (const value of [undefined, null, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0']) {
    assert.equal(knownSize(value), null); assert.equal(formatBytes(value), 'Unknown');
  }
  assert.equal(formatBytes(0), '0 B'); assert.equal(formatBytes(1024), '1 KiB');
});
test('shared files are counted once across points and unrelated files are excluded', () => {
  const rows = enrichPoints(snapshot([point('p1'), point('p2')], [file(), file(), file({ id: 'unrelated', restorePointIds: [] })]));
  const result = fileAccounting(rows);
  assert.equal(result.files, 1); assert.equal(result.shared, 1); assert.equal(result.physical.bytes, 100);
  assert.equal(result.logical.bytes, 400); assert.equal(result.reduction, 75);
});
test('direct file ID takes precedence and never falls back when it cannot be resolved', () => {
  const rows = enrichPoints(snapshot([point('p1', { backupFileId: 'missing' }), point('p2', { backupFileId: 'f1' })], [file()]));
  assert.equal(rows.find(row => row.point.id === 'p1').file, null);
  assert.equal(rows.find(row => row.point.id === 'p2').file.id, 'f1');
});
test('ambiguous membership and conflicting file IDs are not assigned arbitrary sizes', () => {
  const ambiguous = enrichPoints(snapshot([point('p1')], [file(), file({ id: 'f2' })]))[0];
  assert.equal(ambiguous.mapping, 'ambiguous'); assert.equal(ambiguous.file, null);
  const conflict = enrichPoints(snapshot([point('p1', { backupFileId: 'f1' })], [file(), file({ backupSize: 999 })]))[0];
  assert.equal(conflict.mapping, 'ambiguous'); assert.equal(fileAccounting([conflict]).physical.bytes, null);
});
test('file ownership is enforced in point-to-file mapping', () => {
  const row = enrichPoints(snapshot([point('p1', { backupFileId: 'f1' })], [file({ backupId: 'different' })]))[0];
  assert.equal(row.file, null);
});
test('unknown types remain unknown; extension inference is explicit and API type wins', () => {
  assert.equal(enrichPoints(snapshot([point('p1')]))[0].type, 'Unknown');
  const inferred = enrichPoints(snapshot([point('p1')], [file()]))[0];
  assert.equal(inferred.type, 'Full'); assert.match(inferred.typeSource, /Inferred/);
  const reported = enrichPoints(snapshot([point('p1', { type: 'Increment' })], [file()]))[0];
  assert.equal(reported.type, 'Incremental'); assert.equal(reported.typeSource, 'Reported by VBR');
});
test('file GFS flags survive empty VM point defaults and do not imply a Full type', () => {
  const row = enrichPoints(snapshot([point('p1', { type: 'Increment', gfsPeriods: [], platformName: 'VMware' })], [file({ gfsPeriods: ['Monthly'] })]))[0];
  assert.deepEqual(row.gfs, ['Monthly']); assert.equal(row.gfsSource, 'Backup file'); assert.equal(row.type, 'Incremental');
  const nas = enrichPoints(snapshot([point('p1', { platformName: 'UnstructuredData', gfsPeriods: ['Yearly'] })], [file({ gfsPeriods: ['Monthly'] })]))[0];
  assert.deepEqual(nas.gfs, ['Yearly']); assert.equal(nas.gfsSource, 'Restore point');
});
test('partial file metrics expose measured subtotals and suppress an incomplete reduction', () => {
  const rows = enrichPoints(snapshot([point('p1'), point('p2', { backupFileId: 'f2' }), point('p3')], [file({ restorePointIds: ['p1'] }), file({ id: 'f2', backupSize: null, restorePointIds: ['p2'] })]));
  const result = fileAccounting(rows);
  assert.equal(result.physical.bytes, 100); assert.equal(result.physical.unknown, 1); assert.equal(result.unmatched, 1); assert.equal(result.reduction, null);
});
test('freshness excludes invalid and future dates; empty data never becomes zero-age', () => {
  const data = snapshot([point('p1'), point('future', { creationTime: '2027-01-01' }), point('invalid', { creationTime: 'bad' })]);
  const result = recoveryReadiness(data, enrichPoints(data), now);
  assert.equal(result.ageHours, 2); assert.equal(result.invalidDates, 2);
  assert.equal(recoveryReadiness(snapshot([]), [], now).ageHours, null);
});
test('point Clean does not hide a flagged file; missing operation lists stay distinct from empty lists', () => {
  const data = snapshot([point('p1', { malwareStatus: 'Clean', allowedOperations: [] }), point('p2')], [file({ severity: 'Infected' })]);
  const rows = enrichPoints(data); const result = recoveryReadiness(data, rows, now);
  assert.equal(result.flagged, 2); assert.equal(result.reportedClean, 0); assert.equal(result.unknownMalware, 1);
  assert.deepEqual(rows[0].point.allowedOperations, []); assert.equal(rows[1].point.allowedOperations, undefined);
});
test('repository evidence counts IDs, not names or claimed independent copies', () => {
  const data = snapshot([point('p1'), point('p2', { backupId: 'b2' }), point('p3', { backupId: 'b3' })], [], {
    backups: [{ id: 'b1', repositoryId: 'r1' }, { id: 'b2', repositoryId: 'r1' }, { id: 'b3', repositoryId: '00000000-0000-0000-0000-000000000000' }],
    repositories: [{ id: 'r1', isOnline: false }],
  });
  const result = recoveryReadiness(data, enrichPoints(data), now);
  assert.equal(result.locations.length, 1); assert.equal(result.locations[0].points, 2); assert.equal(result.locations[0].online, false); assert.equal(result.unmappedLocations, 1);
});

function reader(overrides = {}) {
  return async path => {
    const url = new URL(path, 'https://test.invalid');
    if (overrides[url.pathname]) return overrides[url.pathname](url);
    if (url.pathname.endsWith('/restorePoints') || url.pathname === '/api/v1/restorePoints') return { data: [point('p1')], pagination: { total: 1 } };
    if (url.pathname.endsWith('/backupFiles')) return { data: [file()], pagination: { total: 1 } };
    if (url.pathname.endsWith('/repositories/states')) return { data: [], pagination: { total: 0 } };
    if (url.pathname.endsWith('/backupObjects/o1')) return { id: 'o1', name: 'Workload' };
    if (url.pathname.endsWith('/backups/b1')) return { id: 'b1', name: 'Backup', repositoryId: 'r1' };
    throw new Error(`Unexpected request: ${path}`);
  };
}
test('loader paginates files, preserves backup filters, and uses documented ordering', async () => {
  const calls = [];
  const base = reader({ '/api/v1/backups/b1/backupFiles': url => ({ data: [file({ id: url.searchParams.get('skip') === '0' ? 'f1' : 'f2' })], pagination: { total: 2 } }) });
  const result = await loadRestorePoints(async path => { calls.push(new URL(path, 'https://test.invalid')); return base(path); }, 'source', { backupId: 'b1' });
  assert.equal(result.files.length, 2); assert.equal(result.filesComplete, true);
  assert.equal(calls.find(url => url.pathname === '/api/v1/restorePoints').searchParams.get('backupIdFilter'), 'b1');
  for (const url of calls.filter(url => url.pathname.endsWith('/backupFiles'))) assert.equal(url.searchParams.get('orderColumn'), 'CreationTime');
});
test('core API errors propagate instead of returning an empty successful collection', async () => {
  await assert.rejects(loadRestorePoints(reader({ '/api/v1/backupObjects/o1/restorePoints': () => { throw new TopologyRequestError('Failed', 502); } }), 'source', { objectId: 'o1' }), error => error.status === 502);
});
test('optional file failure preserves points but reports unknown file evidence', async () => {
  const result = await loadRestorePoints(reader({ '/api/v1/backups/b1/backupFiles': () => { throw new Error('Unavailable'); } }), 'source', { objectId: 'o1' });
  assert.equal(result.data.length, 1); assert.equal(result.filesComplete, false); assert.equal(result.files.length, 0);
  assert.match(result.warnings.join(' '), /file evidence unavailable/); assert.equal(fileAccounting(enrichPoints(result)).physical.bytes, null);
});
test('expired authorization in optional reads remains an authentication failure', async () => {
  await assert.rejects(loadRestorePoints(reader({ '/api/v1/backups/b1/backupFiles': () => { throw new TopologyRequestError('Expired', 401); } }), 'source', { objectId: 'o1' }), error => error.status === 401);
});
test('ignored backup filter fails closed and mismatched file ownership stays unavailable', async () => {
  await assert.rejects(loadRestorePoints(reader(), 'source', { backupId: 'other' }), error => error.status === 502);
  const result = await loadRestorePoints(reader({ '/api/v1/backups/b1/backupFiles': () => ({ data: [file({ backupId: 'other' })] }) }), 'source', { objectId: 'o1' });
  assert.equal(result.files.length, 0); assert.equal(result.filesComplete, false);
});
test('repeated pages are marked partial and never inflate point counts', async () => {
  const result = await loadRestorePoints(reader({ '/api/v1/backupObjects/o1/restorePoints': () => ({ data: [point('p1')], pagination: { total: 5 } }) }), 'source', { objectId: 'o1' });
  assert.equal(result.data.length, 1); assert.equal(result.pointsComplete, false); assert.match(result.warnings.join(' '), /collection is partial/);
});
