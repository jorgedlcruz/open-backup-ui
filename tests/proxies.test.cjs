const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { test } = require('node:test'), assert = require('node:assert/strict');
const { buildProxies, proxyConfigSchema, proxyStateSchema, proxyHostSchema, proxyIssues, needsAttention, onlineEnabled, transport, networkFallback, taskLimit, matchesProxy, proxyPage, defaultProxyFilters: defaults } = require('../lib/proxies/model.ts');
const { loadProxyInventory } = require('../lib/proxies/load.ts');
const { TopologyRequestError } = require('../lib/topology/load.ts');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const proxy = uid(1), host = uid(2);
const evidence = (data, extra = {}) => ({ data, available: true, complete: true, ...extra });
const config = (id = proxy, extra = {}) => ({ id, name: 'VMware proxy', type: 'ViProxy', server: { hostId: host, transportMode: 'Auto', maxTaskCount: 4 }, ...extra });
const state = (id = proxy, extra = {}) => ({ id, name: 'VMware proxy', type: 'ViProxy', hostId: host, isOnline: true, isDisabled: false, isOutOfDate: false, ...extra });
const inventory = extra => ({ sourceName: 'Source', fetchedAt: '2026-10-20T12:00:00Z', apiRevision: '1.3-rev2', warnings: [],
  configs: evidence([config()]), states: evidence([state()]), hosts: evidence([{ id: host, name: 'host.example', type: 'WindowsHost' }]), ...extra });
const row = extra => buildProxies(inventory(extra))[0];

test('roles sharing one host remain separate proxies with their original names', () => {
  const result = buildProxies(inventory({ configs: evidence([config(), config(uid(3), { name: 'File proxy', type: 'GeneralPurposeProxy' })]) }));
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'VMware proxy');
  assert.equal(result[1].name, 'File proxy');
  assert.equal(result[0].hostName, 'host.example');
  assert.equal(result[1].hostId, host);
});
test('configuration-only and state-only rows survive partial inventories', () => {
  const result = buildProxies(inventory({ states: evidence([state(uid(9))]) }));
  assert.equal(result.length, 2);
  assert.equal(result.find(r => r.id === proxy).state, null);
  assert.equal(result.find(r => r.id === uid(9)).config, null);
  assert.ok(result.every(r => proxyIssues(r).unknown));
});
test('missing booleans never become offline, enabled, or up to date', () => {
  const r = row({ states: evidence([state(proxy, { isOnline: null, isDisabled: null, isOutOfDate: null })]) });
  assert.equal(onlineEnabled(r), false);
  assert.equal(needsAttention(r), false);
  assert.equal(proxyIssues(r).offline, false);
  assert.equal(proxyIssues(r).unknown, true);
});
test('offline, disabled, and update issues remain independently filterable', () => {
  const r = row({ states: evidence([state(proxy, { isOnline: false, isDisabled: true, isOutOfDate: true })]) });
  for (const issue of ['offline', 'disabled', 'outdated', 'attention']) assert.equal(matchesProxy(r, { ...defaults, issue }), true);
  assert.equal(matchesProxy(r, { ...defaults, issue: 'onlineEnabled' }), false);
});
test('host metadata joins by ID, never by duplicated names', () => {
  const r = row({ hosts: evidence([{ id: uid(8), name: 'VMware proxy', type: 'LinuxHost' }]) });
  assert.equal(r.host, null);
  assert.equal(r.hostName, 'Not reported');
});
test('conflicting host IDs cannot attach another server metadata', () => {
  const r = row({ states: evidence([state(proxy, { hostId: uid(9) })]) });
  assert.equal(r.hostId, null); assert.equal(r.host, null);
  assert.equal(r.hostConflict, true); assert.equal(proxyIssues(r).unknown, true);
});
test('schemas normalize identifier case before joining', () => {
  const upperId = 'ABCD0000-ABCD-4000-8000-000000000001';
  const result = buildProxies(inventory({ configs: evidence([proxyConfigSchema.parse(config(upperId))]), states: evidence([proxyStateSchema.parse(state(upperId.toLowerCase()))]) }));
  assert.equal(result.length, 1);
  assert.equal(result[0].id, upperId.toLowerCase());
});
test('VMware modes are distinct from non-applicable proxy types and unknown VMware settings', () => {
  for (const type of ['GeneralPurposeProxy', 'HvProxy', 'NutanixAHV', 'PVE']) {
    const r = row({ configs: evidence([config(proxy, { type })]) });
    assert.equal(transport(r).key, 'na'); assert.equal(networkFallback(r), 'Not applicable');
    assert.equal(proxyIssues(r).noFallback, false);
  }
  assert.equal(transport(row({ configs: evidence([config(proxy, { server: {} })]) })).key, 'unknown');
});
test('NBD fallback review only flags explicit false in applicable fixed modes', () => {
  for (const mode of ['DirectAccess', 'VirtualAppliance', 'Auto', 'Network']) {
    const r = row({ configs: evidence([config(proxy, { server: { transportMode: mode, failoverToNetwork: false, maxTaskCount: 4 } })]) });
    assert.equal(proxyIssues(r).noFallback, ['DirectAccess', 'VirtualAppliance'].includes(mode));
    assert.equal(needsAttention(r), false);
    if (mode === 'Network') assert.equal(networkFallback(r), 'Already using network');
  }
  assert.equal(proxyIssues(row()).noFallback, false);
});
test('task limits preserve zero and reject missing, fractional, negative, and unsafe readings', () => {
  for (const [value, expected] of [[0, 0], [4, 4], [null, null], [undefined, null], [-1, null], [2.5, null], [Number.MAX_SAFE_INTEGER + 1, null]]) {
    const r = row({ configs: evidence([config(proxy, { server: { maxTaskCount: value } })]) });
    assert.equal(taskLimit(r), expected);
    assert.equal(proxyIssues(r).zeroTasks, value === 0);
  }
});
test('search, type, transport, and task filters combine instead of replacing one another', () => {
  const r = row();
  assert.equal(matchesProxy(r, { ...defaults, query: 'host.example', type: 'ViProxy', transport: 'Auto', tasks: 'positive' }), true);
  assert.equal(matchesProxy(r, { ...defaults, query: 'host.example', type: 'HvProxy' }), false);
  assert.equal(matchesProxy(r, { ...defaults, tasks: 'zero' }), false);
  assert.equal(matchesProxy(r, { ...defaults, tasks: 'unknown' }), false);
});
test('pagination is stable, clamps filtered pages, and task ordering places unknown last', () => {
  const rows = buildProxies(inventory({ configs: evidence(Array.from({ length: 19 }, (_, i) => config(uid(100 + i), { name: `Proxy ${String(i).padStart(2, '0')}`, server: { maxTaskCount: i === 0 ? null : i } }))), states: evidence([]) }));
  const first = proxyPage(rows, defaults, 'tasks', 0), last = proxyPage(rows, defaults, 'tasks', 1);
  assert.equal(first.rows.length, 15); assert.equal(last.rows.length, 4);
  assert.equal(new Set([...first.rows, ...last.rows].map(r => r.id)).size, 19);
  assert.equal(taskLimit(first.rows[0]), 18); assert.equal(taskLimit(last.rows.at(-1)), null);
  assert.equal(proxyPage(rows, { ...defaults, query: 'Proxy 00' }, 'name', 5).current, 0);
});
test('sanitized host and proxy settings exclude credentials and unrelated metadata', () => {
  const safeHost = proxyHostSchema.parse({ id: host, credentialsId: 'SECRET', singleUseCredentials: { password: 'SECRET' }, handshakeCode: 'SECRET' });
  const safeConfig = proxyConfigSchema.parse(config(proxy, { credentialsId: 'SECRET', server: { maxTaskCount: 4, password: 'SECRET', connectedDatastores: { datastores: [{ datastore: { name: 'DS', aclInfo: 'SECRET' }, vmCount: 0 }] } } }));
  assert.ok(!JSON.stringify([safeHost, safeConfig]).includes('SECRET'));
  assert.equal(safeConfig.server.connectedDatastores.datastores[0].vmCount, 0);
});
function fixture(overrides = {}) {
  const calls = [], list = data => ({ data, pagination: { total: data.length } });
  const routes = { '/api/v1/serverInfo': { buildVersion: '13.1.0.411' },
    '/api/v1/backupInfrastructure/proxies': list([config()]),
    '/api/v1/backupInfrastructure/proxies/states': list([state()]),
    '/api/v1/backupInfrastructure/managedServers': list([{ id: host, name: 'host.example', credentialsId: 'SECRET' }]), ...overrides };
  return { calls, read: async (path, revision) => {
    calls.push({ path, revision });
    const value = routes[path.split('?')[0]];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error('Unexpected read');
    return typeof value === 'function' ? value(new URL(path, 'https://vbr.invalid')) : value;
  } };
}
test('loader selects revision and includes nested managed hosts without per-proxy fan-out', async () => {
  const f = fixture(), result = await loadProxyInventory(f.read, 'Source');
  assert.equal(f.calls.length, 4); assert.equal(result.apiRevision, '1.3-rev2');
  assert.ok(f.calls.slice(1).every(c => c.revision === '1.3-rev2'));
  assert.ok(f.calls.find(c => c.path.includes('managedServers')).path.includes('includeNestedHosts=true'));
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('host permission failures preserve proxy data with explicit coverage gaps', async () => {
  const f = fixture({ '/api/v1/backupInfrastructure/managedServers': new TopologyRequestError('Denied', 403) });
  const result = await loadProxyInventory(f.read, 'Source');
  assert.equal(result.hosts.available, false); assert.equal(buildProxies(result).length, 1);
  assert.ok(result.warnings.some(w => w.includes('cannot read')));
});
test('unavailable states do not turn configuration into empty success or offline defaults', async () => {
  const f = fixture({ '/api/v1/backupInfrastructure/proxies/states': new Error('Unavailable') });
  const result = await loadProxyInventory(f.read, 'Source'), r = buildProxies(result)[0];
  assert.equal(result.states.available, false); assert.equal(proxyIssues(r).offline, false);
  assert.equal(proxyIssues(r).unknown, true);
});
test('401 from optional host reads or version lookup propagates', async () => {
  for (const path of ['/api/v1/serverInfo', '/api/v1/backupInfrastructure/managedServers']) {
    await assert.rejects(loadProxyInventory(fixture({ [path]: new TopologyRequestError('Expired', 401) }).read, 'Source'), e => e.status === 401);
  }
});
test('host metadata alone cannot masquerade as a loaded proxy inventory', async () => {
  await assert.rejects(loadProxyInventory(fixture({ '/api/v1/backupInfrastructure/proxies': new Error('Down'), '/api/v1/backupInfrastructure/proxies/states': new Error('Down') }).read, 'Source'), e => e.status === 502);
});
test('version lookup failure uses rev1 and malformed configuration retains state-only evidence', async () => {
  const f = fixture({ '/api/v1/serverInfo': new Error('Down'), '/api/v1/backupInfrastructure/proxies': { data: [{ id: 'invalid' }] } });
  const result = await loadProxyInventory(f.read, 'Source');
  assert.equal(result.apiRevision, '1.3-rev1'); assert.equal(result.configs.available, false);
  assert.equal(buildProxies(result).length, 1); assert.equal(result.warnings.length, 2);
});
test('collections paginate beyond 200 and repeated pages remain visibly partial', async () => {
  const values = Array.from({ length: 201 }, (_, i) => state(uid(100 + i)));
  const f = fixture({ '/api/v1/backupInfrastructure/proxies/states': url => ({ data: values.slice(Number(url.searchParams.get('skip')), Number(url.searchParams.get('skip')) + 200), pagination: { total: 201 } }) });
  const result = await loadProxyInventory(f.read, 'Source');
  assert.equal(result.states.data.length, 201); assert.equal(result.states.complete, true);
  const repeated = fixture({ '/api/v1/backupInfrastructure/proxies/states': { data: values.slice(0, 200), pagination: { total: 500 } } });
  const partial = await loadProxyInventory(repeated.read, 'Source');
  assert.equal(partial.states.data.length, 200); assert.equal(partial.states.complete, false);
  assert.ok(partial.warnings.some(w => w.includes('partial collection')));
});
