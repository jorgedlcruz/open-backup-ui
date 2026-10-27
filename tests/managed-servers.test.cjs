const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { test } = require('node:test'), assert = require('node:assert/strict');
const { buildServers, hostUpdate, serverIssues, needsServerAttention, matchesServer, serverPage, serverSchema, repositoryRolesSchema, componentPorts, defaultServerFilters: defaults } = require('../lib/managed-servers/model.ts');
const { loadServerInventory } = require('../lib/managed-servers/load.ts');
const { TopologyRequestError } = require('../lib/topology/load.ts');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const host = uid(1), proxy = uid(2), repo = uid(3);
const evidence = (data, extra = {}) => ({ data, available: true, complete: true, ...extra });
const server = (id = host, extra = {}) => ({ id, name: 'host.example', type: 'WindowsHost', status: 'Available', updatesState: 'NotAvailable', ...extra });
const inventory = extra => ({ sourceName: 'Source', fetchedAt: '2026-10-20T12:00:00Z', apiRevision: '1.3-rev2', warnings: [],
  servers: evidence([server()]), proxies: evidence([]), proxyStates: evidence([]), repositories: evidence([]), repositoryStates: evidence([]), mounts: evidence([]), ...extra });
const row = extra => buildServers(inventory(extra))[0];

test('host availability and update NotAvailable have separate meanings', () => {
  const r = row();
  assert.equal(r.server.status, 'Available');
  assert.equal(hostUpdate(r.server).label, 'No updates available');
  assert.equal(serverIssues(r).unavailable, false);
  assert.equal(needsServerAttention(r), false);
});
test('every documented host update state is handled without treating checking as failure', () => {
  for (const value of ['CheckInProgress', 'Installing', 'LastInstallFailed', 'Available', 'NotAvailable', 'CheckUpdatesFailed', 'OutOfDate']) {
    const update = hostUpdate(server(host, { updatesState: value }));
    assert.equal(update.unknown, false);
    assert.equal(update.failed, ['LastInstallFailed', 'CheckUpdatesFailed'].includes(value));
    assert.equal(update.active, ['CheckInProgress', 'Installing'].includes(value));
    assert.equal(update.issue, ['LastInstallFailed', 'Available', 'CheckUpdatesFailed', 'OutOfDate'].includes(value));
  }
});
test('missing and unfamiliar updates are unknown while non-host inventory types are scoped', () => {
  assert.equal(hostUpdate(server(host, { updatesState: null })).unknown, true);
  assert.equal(hostUpdate(server(host, { updatesState: 'FutureState' })).unknown, true);
  assert.equal(hostUpdate(server(host, { type: 'ViHost', updatesState: null })).unknown, false);
  assert.equal(serverIssues(row({ servers: evidence([server(host, { status: null })]) })).unavailable, false);
});
test('backup/default-mount roles require explicit true and appliance does not imply backup role', () => {
  assert.equal(row({ servers: evidence([server(host, { isVBRLinuxAppliance: true })]) }).roles.length, 0);
  assert.equal(row({ servers: evidence([server(host, { isBackupServer: false, isDefaultMountServer: null })]) }).roles.length, 0);
  assert.deepEqual(row({ servers: evidence([server(host, { isBackupServer: true, isDefaultMountServer: true })]) }).roles.map(r => r.kind), ['backup', 'defaultMount']);
});
test('proxy roles join by normalized IDs, not names, and retain resource state independently', () => {
  const r = row({ proxies: evidence([{ id: proxy, name: 'Proxy', server: { hostId: host } }]),
    proxyStates: evidence([{ id: proxy, hostId: host, isOnline: false, isOutOfDate: true, isDisabled: true }]) });
  assert.equal(r.roles.length, 1); assert.equal(r.server.status, 'Available');
  assert.equal(serverIssues(r).updates, true); assert.equal(serverIssues(r).roles, true);
  const wrong = row({ proxies: evidence([{ id: proxy, name: 'host.example', server: { hostId: uid(8) } }]) });
  assert.equal(wrong.roles.length, 0);
});
test('state-only proxy and local repository assignments survive missing configuration', () => {
  const r = row({ proxyStates: evidence([{ id: proxy, hostId: host }]), repositoryStates: evidence([{ id: repo, type: 'LinuxHardened', hostId: host }]) });
  assert.deepEqual(r.roles.map(r => r.kind), ['proxy', 'repository']);
  assert.ok(r.roles.every(r => r.outdated == null));
});
test('conflicting proxy and repository hosts attach neither assignment and expose the conflict', () => {
  const result = buildServers(inventory({ servers: evidence([server(), server(uid(8))]),
    proxies: evidence([{ id: proxy, server: { hostId: host } }]), proxyStates: evidence([{ id: proxy, hostId: uid(8) }]),
    repositories: evidence([{ id: repo, type: 'WinLocal', hostId: host }]), repositoryStates: evidence([{ id: repo, type: 'WinLocal', hostId: uid(8) }]) }));
  assert.ok(result.every(r => r.roles.length === 0 && r.conflicts.length === 2 && serverIssues(r).unknown));
});
test('automatic or unreported gateway selection never assigns candidate IDs', () => {
  for (const autoSelectEnabled of [true, undefined, null]) {
    const r = row({ repositories: evidence([{ id: repo, type: 'Nfs', share: { gatewayServer: { autoSelectEnabled, gatewayServerIds: [host] } } }]),
      repositoryStates: evidence([{ id: repo, type: 'Nfs', hostId: host, isOutOfDate: true }]) });
    assert.equal(r.roles.length, 0); assert.equal(serverIssues(r).updates, false);
  }
});
test('explicit SMB/NFS, dedupe, and selected object gateways map once and direct mode does not', () => {
  const r = row({ repositories: evidence([
    { id: repo, share: { gatewayServer: { autoSelectEnabled: false, gatewayServerIds: [host, host] } } },
    { id: uid(4), hpeStoreOnce: { gatewayServer: { autoSelection: false, gatewayServerIds: [host] } } },
    { id: uid(5), account: { connectionSettings: { connectionType: 'SelectedGateway', gatewayServerIds: [host] } } },
    { id: uid(6), account: { connectionSettings: { connectionType: 'Direct', gatewayServerIds: [host] } } },
  ]) });
  assert.equal(r.roles.length, 3); assert.ok(r.roles.every(r => r.kind === 'gateway'));
  assert.ok(r.roles.every(r => r.outdated == null));
});
test('mount settings respect selected platforms and deduplicate identical repository assignments', () => {
  const r = row({ repositories: evidence([{ id: repo, mountServer: { mountServerSettingsType: 'Both', windows: { mountServerId: host }, linux: { mountServerId: host } } },
    { id: uid(4), mountServers: { mountServerSettingsType: 'Windows', linux: { mountServerId: host }, windows: { mountServerId: uid(9) } } }]) });
  assert.equal(r.roles.length, 1); assert.equal(r.roles[0].kind, 'mount');
});
test('mount inventory ID matches host ID and default role deduplicates host flags', () => {
  const r = row({ servers: evidence([server(host, { isDefaultMountServer: true })]), mounts: evidence([{ id: host, type: 'Windows', isDefault: true }]) });
  assert.equal(r.roles.filter(r => r.kind === 'defaultMount').length, 1);
  assert.equal(r.roles.filter(r => r.kind === 'mount').length, 1);
});
test('optional components and configured service ports do not infer assigned roles', () => {
  const r = row({ servers: evidence([server(host, { networkSettings: { components: [{ componentName: 'WanAccelerator', port: 6164 }] }, optionalComponents: { optionalComponents: [{ optionalComponent: 'MountTarget' }] } })]) });
  assert.equal(r.roles.length, 0); assert.equal(componentPorts(r.server).length, 1);
});
test('missing role collections remain partial instead of claiming no assignments', () => {
  const r = row({ proxies: evidence([], { available: false, complete: false }) });
  assert.equal(r.rolesComplete, false); assert.equal(serverIssues(r).unknown, true);
  assert.equal(needsServerAttention(r), false);
});
test('schema strips host secrets and nested repository account secrets', () => {
  const safeHost = serverSchema.parse({ ...server(), credentialsId: 'SECRET', handshakeCode: 'SECRET', singleUseCredentials: { password: 'SECRET' }, sshSettings: { password: 'SECRET', components: [{ componentName: 'TransportSvc', port: 6162 }] } });
  const safeRepo = repositoryRolesSchema.parse({ id: repo, account: { credentialsId: 'SECRET', connectionSettings: { connectionType: 'SelectedGateway', gatewayServerIds: [host] } } });
  assert.ok(!JSON.stringify([safeHost, safeRepo]).includes('SECRET'));
  assert.equal(componentPorts(safeHost)[0].port, 6162);
});
test('UUID case is normalized and zero host IDs do not create roles', () => {
  const upper = 'ABCD0000-ABCD-4000-8000-000000000001';
  const s = serverSchema.parse(server(upper));
  const repoConfig = repositoryRolesSchema.parse({ id: repo, hostId: upper });
  assert.equal(buildServers(inventory({ servers: evidence([s]), repositories: evidence([repoConfig]) }))[0].roles.length, 1);
  assert.equal(row({ proxies: evidence([{ id: proxy, server: { hostId: '00000000-0000-0000-0000-000000000000' } }]) }).roles.length, 0);
});
test('filters combine resource search, role, type, and host update state', () => {
  const r = row({ repositories: evidence([{ id: repo, name: 'Critical storage', type: 'WinLocal', hostId: host }]) });
  assert.equal(matchesServer(r, { ...defaults, query: 'critical storage', role: 'repository', type: 'WindowsHost', update: 'NotAvailable' }), true);
  assert.equal(matchesServer(r, { ...defaults, role: 'proxy' }), false);
  assert.equal(matchesServer(r, { ...defaults, update: 'unknown' }), false);
});
test('pagination visits unique hosts and clamps the page after filtering', () => {
  const rows = buildServers(inventory({ servers: evidence(Array.from({ length: 19 }, (_, i) => server(uid(100 + i), { name: `Host ${i}` }))) }));
  const a = serverPage(rows, defaults, 'name', 0), b = serverPage(rows, defaults, 'name', 1);
  assert.equal(a.rows.length, 15); assert.equal(b.rows.length, 4);
  assert.equal(new Set([...a.rows, ...b.rows].map(r => r.server.id)).size, 19);
  assert.equal(serverPage(rows, { ...defaults, query: 'Host 18' }, 'name', 8).current, 0);
});
function fixture(overrides = {}) {
  const calls = [], list = data => ({ data, pagination: { total: data.length } });
  const routes = { '/api/v1/serverInfo': { buildVersion: '13.1.0.411' },
    '/api/v1/backupInfrastructure/managedServers': list([server()]),
    '/api/v1/backupInfrastructure/proxies': list([]), '/api/v1/backupInfrastructure/proxies/states': list([]),
    '/api/v1/backupInfrastructure/repositories': list([]), '/api/v1/backupInfrastructure/repositories/states': list([]),
    '/api/v1/backupInfrastructure/mountServers': list([]), ...overrides };
  return { calls, read: async (path, revision) => {
    calls.push({ path, revision });
    const value = routes[path.split('?')[0]];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error('Unexpected path');
    return typeof value === 'function' ? value(new URL(path, 'https://vbr.invalid')) : value;
  } };
}
test('loader requests nested hosts and revision-aware role collections without per-host fan-out', async () => {
  const f = fixture(), result = await loadServerInventory(f.read, 'Source');
  assert.equal(f.calls.length, 7); assert.equal(result.apiRevision, '1.3-rev2');
  assert.ok(f.calls.slice(1).every(c => c.revision === '1.3-rev2'));
  assert.ok(f.calls.find(c => c.path.includes('managedServers')).path.includes('includeNestedHosts=true'));
});
test('core server failure propagates even if all role sources succeed', async () => {
  await assert.rejects(loadServerInventory(fixture({ '/api/v1/backupInfrastructure/managedServers': new TopologyRequestError('Down', 502) }).read, 'Source'), e => e.status === 502);
});
test('optional role permission failure retains servers with explicit missing evidence', async () => {
  const result = await loadServerInventory(fixture({ '/api/v1/backupInfrastructure/mountServers': new TopologyRequestError('Denied', 403) }).read, 'Source');
  assert.equal(result.servers.data.length, 1); assert.equal(result.mounts.available, false);
  assert.equal(buildServers(result)[0].rolesComplete, false);
  assert.ok(result.warnings.some(w => w.includes('cannot read')));
});
test('401 propagates from version lookup and optional role data', async () => {
  for (const path of ['/api/v1/serverInfo', '/api/v1/backupInfrastructure/proxies/states']) {
    await assert.rejects(loadServerInventory(fixture({ [path]: new TopologyRequestError('Expired', 401) }).read, 'Source'), e => e.status === 401);
  }
});
test('version failure falls back and malformed optional data cannot remove core servers', async () => {
  const result = await loadServerInventory(fixture({ '/api/v1/serverInfo': new Error('Down'), '/api/v1/backupInfrastructure/repositories': { data: [{ id: 'invalid' }] } }).read, 'Source');
  assert.equal(result.apiRevision, '1.3-rev1'); assert.equal(result.repositories.available, false);
  assert.equal(result.servers.data.length, 1); assert.equal(result.warnings.length, 2);
});
test('pagination preserves nested-host selection and repeated pages are partial', async () => {
  const values = Array.from({ length: 201 }, (_, i) => server(uid(100 + i)));
  const f = fixture({ '/api/v1/backupInfrastructure/managedServers': url => ({ data: values.slice(Number(url.searchParams.get('skip')), Number(url.searchParams.get('skip')) + 200), pagination: { total: 201 } }) });
  const result = await loadServerInventory(f.read, 'Source');
  assert.equal(result.servers.data.length, 201); assert.equal(result.servers.complete, true);
  assert.ok(f.calls.filter(c => c.path.includes('managedServers')).every(c => c.path.includes('includeNestedHosts=true')));
  const partial = await loadServerInventory(fixture({ '/api/v1/backupInfrastructure/managedServers': { data: values.slice(0, 200), pagination: { total: 500 } } }).read, 'Source');
  assert.equal(partial.servers.data.length, 200); assert.equal(partial.servers.complete, false);
  assert.ok(partial.warnings.some(w => w.includes('Managed servers: partial')));
});
