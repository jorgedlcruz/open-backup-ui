const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { revisionForBuild, recordStatus, tone, duration, attemptLabel, linkedAttempts, taskSchema } = require('../lib/investigation/model.ts');
const { loadJobInvestigation, loadSessionInvestigation, loadTaskInvestigation, loadLogs } = require('../lib/investigation/load.ts');
const { TopologyRequestError } = require('../lib/topology/load.ts');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const jobId = uid(1), rootId = uid(10), retryId = uid(11), taskId = uid(20);
const now = new Date('2026-10-19T12:00:00Z');
const session = (id = rootId, extra = {}) => ({ id, jobId, name: 'Backup', sessionType: 'BackupJob', state: 'Stopped', creationTime: '2026-10-18T23:00:00Z', result: { result: 'Failed', message: 'Object failed' }, ...extra });
const task = (extra = {}) => ({ id: taskId, sessionId: rootId, name: 'VM01', type: 'Backup', ...extra });
const collection = data => ({ data, pagination: { total: data.length } });
function source(overrides = {}) {
  const calls = [];
  const read = async (path, revision) => {
    calls.push([path, revision]);
    const url = new URL(path, 'https://vbr.invalid');
    const handler = overrides[url.pathname];
    if (handler instanceof Error) throw handler;
    if (typeof handler === 'function') return handler(url, revision);
    if (handler !== undefined) return handler;
    if (url.pathname === '/api/v1/serverInfo') return { buildVersion: '13.1.0.411' };
    if (url.pathname === '/api/v1/jobs/states') return collection([{ id: jobId, name: 'Backup', status: 'Stopped' }]);
    if (url.pathname === '/api/v1/sessions') return collection([session()]);
    if (url.pathname === `/api/v1/sessions/${rootId}`) return session();
    if (url.pathname.endsWith('/taskSessions')) return collection([task()]);
    if (url.pathname === `/api/v1/taskSessions/${taskId}`) return task();
    if (url.pathname.endsWith('/logs')) return { records: [], totalRecords: 0 };
    throw new Error(`Unexpected route ${url.pathname}`);
  };
  return { read, calls };
}

test('only published rev2 builds enable extended session reads', () => {
  for (const build of [null, 'unknown', '13.1', '13.1.0.411-preview', '13.0.1.9999', '13.1.0.410', '12.3.1.9999']) assert.equal(revisionForBuild(build), '1.3-rev1');
  for (const build of ['13.1.0.411', '13.1.0.500', '13.2.0.1', '14.0.0.1']) assert.equal(revisionForBuild(build), '1.3-rev2');
});
test('missing results never imply success or an active task; null progress is supported', () => {
  assert.equal(recordStatus(taskSchema.parse(task({ progress: null, result: null }))), 'Not reported');
  assert.equal(recordStatus({ state: 'Stopped', result: { result: 'None' } }), 'Stopped');
  assert.equal(recordStatus({ state: 'Working', result: { result: 'Failed' } }), 'Working');
  assert.equal(recordStatus({ state: 'Stopped', result: { result: 'Failed', isCanceled: true } }), 'Canceled');
  assert.equal(recordStatus({ scanState: 'Finished', scanResult: 'Infected' }), 'Infected');
  assert.equal(recordStatus({ scanState: 'InProgress', scanResult: 'None' }), 'Scanning');
  assert.equal(tone('Infected'), 'danger');
});
test('duration preserves reported values and does not manufacture missing elapsed time', () => {
  assert.equal(duration({ progress: { duration: '00:00:00' } }), '00:00:00');
  assert.equal(duration({ creationTime: 'bad', endTime: now.toISOString() }), 'Not reported');
  assert.equal(duration({ creationTime: now.toISOString() }), 'Not reported');
  assert.equal(duration({ creationTime: now.toISOString(), endTime: now.toISOString() }), '0h 0m 0s');
});
test('retry labels preserve health-check and unnumbered retry semantics', () => {
  assert.equal(attemptLabel(session()), 'Run linkage not reported');
  assert.equal(attemptLabel(session(rootId, { originalSessionId: rootId })), 'Original run');
  assert.equal(attemptLabel(session(retryId, { retryInfo: { isRecheckRetry: true, retryNumber: null } })), 'Health-check retry · unnumbered');
});
test('chains use explicit root and job IDs, not names, chronology, or parent links', () => {
  const selected = session(retryId, { originalSessionId: rootId });
  const chain = linkedAttempts(selected, [session(rootId, { originalSessionId: rootId }), selected, session(uid(12)), session(uid(13), { originalSessionId: rootId, jobId: uid(2) }), session(uid(14), { parentSessionId: rootId })]);
  assert.deepEqual(chain.map(s => s.id), [rootId, retryId]);
  assert.deepEqual(linkedAttempts(session(), [selected]), []);
});
test('job history paginates, preserves filters, sorts newest first and excludes foreign jobs', async () => {
  const src = source({ '/api/v1/sessions': url => {
    assert.equal(url.searchParams.get('jobIdFilter'), jobId);
    assert.equal(url.searchParams.get('createdAfterFilter'), '2026-10-12T12:00:00.000Z');
    return url.searchParams.get('skip') === '0' ? { data: [session(), session(uid(12), { jobId: uid(2) })], pagination: { total: 3 } } : { data: [session(retryId, { creationTime: now.toISOString() })], pagination: { total: 3 } };
  } });
  const result = await loadJobInvestigation(src.read, 'source', jobId, '7d', now);
  assert.deepEqual(result.sessions.data.map(s => s.id), [retryId, rootId]);
  assert.equal(result.sessions.complete, false); assert.match(result.sessions.error, /outside/);
  assert.ok(src.calls.filter(([p]) => p.startsWith('/api/v1/sessions?')).every(([, rev]) => rev === '1.3-rev2'));
});
test('failed history remains unavailable while job metadata can render', async () => {
  const src = source({ '/api/v1/sessions': new Error('offline') });
  const result = await loadJobInvestigation(src.read, 'source', jobId, '30d', now);
  assert.equal(result.sessions.available, false); assert.equal(result.sessions.complete, false); assert.ok(result.job);
});
test('older servers load base session evidence without requesting rev2 or inventing chains', async () => {
  const src = source({ '/api/v1/serverInfo': { buildVersion: '13.0.1.180' } });
  const result = await loadSessionInvestigation(src.read, 'source', rootId, now);
  assert.equal(result.apiRevision, '1.3-rev1'); assert.equal(result.chain.originalId, null);
  assert.deepEqual(result.chain.data, []); assert.ok(result.tasks.available);
  assert.ok(src.calls.every(([, rev]) => rev !== '1.3-rev2'));
});
test('exact same-session history can supply omitted progress without changing the primary result', async () => {
  const src = source({ [`/api/v1/sessions/${rootId}`]: session(rootId, { originalSessionId: rootId, progress: null }), '/api/v1/sessions': collection([session(rootId, { originalSessionId: rootId, result: { result: 'Success' }, progress: { duration: '00:03:28', transferredSize: 0, bottleneck: 'Source' } }), session(uid(15), { jobId: uid(2), originalSessionId: rootId, progress: { transferredSize: 999 } })]) });
  const result = await loadSessionInvestigation(src.read, 'source', rootId, now);
  assert.equal(result.progressSource, 'history'); assert.equal(result.session.progress.transferredSize, 0);
  assert.equal(result.session.result.result, 'Failed');
});
test('version lookup failure keeps base evidence available and visibly explains capability limits', async () => {
  const src = source({ '/api/v1/serverInfo': new TopologyRequestError('Forbidden', 403) });
  const result = await loadSessionInvestigation(src.read, 'source', rootId, now);
  assert.equal(result.apiRevision, '1.3-rev1'); assert.match(result.warnings[0], /version/);
});
test('selecting a retry fetches the original outside the job UI history window', async () => {
  const old = session(rootId, { creationTime: '2026-01-01T00:00:00Z', originalSessionId: rootId });
  const retry = session(retryId, { originalSessionId: rootId, retryInfo: { isRecheckRetry: false, retryNumber: 1 } });
  const src = source({ [`/api/v1/sessions/${retryId}`]: retry, [`/api/v1/sessions/${rootId}`]: old, '/api/v1/sessions': url => {
    assert.equal(url.searchParams.get('createdAfterFilter'), '2025-12-31T23:59:59.999Z');
    return collection([retry, old]);
  }, [`/api/v1/sessions/${retryId}/taskSessions`]: collection([]) });
  const result = await loadSessionInvestigation(src.read, 'source', retryId, now);
  assert.deepEqual(result.chain.data.map(s => s.id), [rootId, retryId]); assert.equal(result.chain.complete, true);
});
test('foreign, cyclic or missing originals do not join unrelated chains', async () => {
  for (const original of [session(rootId, { jobId: uid(2) }), session(rootId, { originalSessionId: retryId }), new TopologyRequestError('Not found', 404)]) {
    const src = source({ [`/api/v1/sessions/${retryId}`]: session(retryId, { originalSessionId: rootId }), [`/api/v1/sessions/${rootId}`]: original });
    const result = await loadSessionInvestigation(src.read, 'source', retryId, now);
    assert.equal(result.chain.complete, false); assert.deepEqual(result.chain.data.map(s => s.id), [retryId]);
    assert.ok(!src.calls.some(([p]) => p.startsWith('/api/v1/sessions?')));
  }
});
test('task collection excludes records from other sessions', async () => {
  const src = source({ [`/api/v1/sessions/${rootId}/taskSessions`]: collection([task(), task({ id: uid(21), sessionId: retryId })]) });
  const result = await loadSessionInvestigation(src.read, 'source', rootId, now);
  assert.equal(result.tasks.data.length, 1); assert.equal(result.tasks.complete, false);
});
test('unavailable task/log endpoints are explicit partial evidence, not empty success', async () => {
  const src = source({ [`/api/v1/sessions/${rootId}/taskSessions`]: new TopologyRequestError('Forbidden', 403), [`/api/v1/sessions/${rootId}/logs`]: new Error('offline') });
  const result = await loadSessionInvestigation(src.read, 'source', rootId, now);
  assert.equal(result.tasks.available, false); assert.equal(result.logs.available, false); assert.equal(result.logs.complete, false);
});
test('authentication failures propagate from optional evidence and capability lookups', async () => {
  for (const path of ['/api/v1/serverInfo', `/api/v1/sessions/${rootId}/logs`, `/api/v1/sessions/${rootId}/taskSessions`]) {
    const src = source({ [path]: new TopologyRequestError('Expired', 401) });
    await assert.rejects(loadSessionInvestigation(src.read, 'source', rootId, now), error => error.status === 401);
  }
});
test('logs use the records envelope, preserve metadata and flag incomplete totals', async () => {
  const record = { id: 0, status: 'Failed', title: '<script>plain text</script>', description: 'line 1\nline 2', additionalInfo: [{ field: 'Object', data: 'VM01' }] };
  const logs = await loadLogs(async path => { assert.equal(path, '/logs'); return { totalRecords: 2, records: [record] }; }, '/logs');
  assert.equal(logs.complete, false); assert.equal(logs.total, 2); assert.deepEqual(logs.data[0], record);
  assert.equal((await loadLogs(async () => ({ data: [] }), '/logs')).available, false);
});
test('large logs are bounded and cannot be exported as a falsely complete collection', async () => {
  const logs = await loadLogs(async () => ({ records: Array.from({ length: 10001 }, (_, id) => ({ id, title: `Event ${id}` })), totalRecords: 10001 }), '/logs');
  assert.equal(logs.data.length, 10000); assert.equal(logs.complete, false);
});
test('legacy log metadata remains readable as text alongside rev2 key/value metadata', async () => {
  const logs = await loadLogs(async () => ({ records: [{ id: 1, additionalInfo: 'Proxy: proxy01\nTransport: nbd' }, { id: 2, additionalInfo: '' }], totalRecords: 2 }), '/logs');
  assert.equal(logs.available, true); assert.equal(logs.complete, true);
  assert.equal(logs.data[0].additionalInfo[0].data, 'Proxy: proxy01\nTransport: nbd');
  assert.deepEqual(logs.data[1].additionalInfo, []);
});
test('task ownership is validated before fetching its logs', async () => {
  const src = source({ [`/api/v1/taskSessions/${taskId}`]: task({ sessionId: retryId }) });
  await assert.rejects(loadTaskInvestigation(src.read, rootId, taskId, now), error => error.status === 404);
  assert.ok(!src.calls.some(([p]) => p.endsWith('/logs')));
});
test('task detail and logs retain workload-specific error messages', async () => {
  const src = source({ [`/api/v1/taskSessions/${taskId}`]: task({ result: { result: 'Failed', message: 'No space left on device' } }), [`/api/v1/taskSessions/${taskId}/logs`]: { records: [{ status: 'Failed', title: 'Cannot write backup', description: 'No space left on device' }], totalRecords: 1 } });
  const result = await loadTaskInvestigation(src.read, rootId, taskId, now);
  assert.equal(result.task.result.message, 'No space left on device'); assert.equal(result.logs.data[0].description, 'No space left on device'); assert.equal(result.logs.complete, true);
});
test('a mismatched primary session is rejected before any evidence is fetched', async () => {
  const src = source({ [`/api/v1/sessions/${rootId}`]: session(retryId) });
  await assert.rejects(loadSessionInvestigation(src.read, 'source', rootId, now), error => error.status === 502);
  assert.equal(src.calls.length, 2);
});
