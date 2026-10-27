/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm')
const compile = filename => ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
require.extensions['.ts'] = (module, filename) => module._compile(compile(filename), filename)
const { test } = require('node:test'), assert = require('node:assert/strict'), { createHash } = require('node:crypto')
const m = require('../lib/identity/model.ts'), l = require('../lib/identity/load.ts'), a = require('../lib/identity/actions.ts')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const key = 'a'.repeat(64), plain = value => JSON.parse(JSON.stringify(value))
const role = patch => m.roleSchema.parse({ id: id(1), name: 'Operators', description: 'Operations', isBuiltIn: true, ...patch })
const user = patch => { const value = m.userSchema.parse({ id: id(2), name: 'DOMAIN\\operator', type: 'InternalUser', roles: [role()], isServiceAccount: false, mfaEnabled: true, ...patch }); return { ...value, revision: a.userRevision(value) } }
const evidence = (data, complete = true) => ({ data, complete, error: complete ? null : 'Partial read' })
const row = patch => ({ ...role(), permissions: evidence(['ViewJobs']), ...patch })
const snapshot = patch => ({ users: evidence([user()]), roles: evidence([row()]), mfaEnabled: true, ...patch })
const input = (action, patch = {}) => ({ sourceKey: key, action, ...(action !== 'add' && action !== 'mfa' ? { id: id(2), expectedRevision: user().revision } : {}), ...patch })
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data })

test('unknown flags and absent role arrays stay unknown; source secrets are stripped', () => {
  const value = m.userSchema.parse({ id: id(2), password: 'private', mfaEnabled: 'false' })
  assert.equal(value.mfaEnabled, null); assert.equal(value.isServiceAccount, null); assert.equal(value.enabled, null); assert.equal(value.roles, null)
  assert.doesNotMatch(JSON.stringify(value), /private|password/)
  assert.equal(m.roleKind(role({ isBuiltIn: undefined })), 'Unknown')
})
test('MFA review distinguishes standard users, service exemptions, groups and unknown flags', () => {
  assert.ok(m.userIssues(user({ mfaEnabled: false }), [row()]).includes('mfa-off'))
  for (const patch of [{ type: 'ExternalGroup' }, { isServiceAccount: true }, { isServiceAccount: undefined }, { mfaEnabled: undefined }]) assert.ok(!m.userIssues(user({ mfaEnabled: false, ...patch }), [row()]).includes('mfa-off'))
  assert.ok(m.userIssues(user({ roles: undefined }), [row()]).includes('unknown'))
  assert.ok(!m.userIssues(user({ roles: undefined }), [row()]).includes('no-roles'))
})
test('permission unions deduplicate and require every assigned role; identity grants use exact API claims', () => {
  const roles = [row({ permissions: evidence(['UpdateUser', 'ViewJobs']) }), row({ ...role({ id: id(3) }), permissions: evidence(['ViewJobs', 'RestoreVM']) })]
  const account = user({ roles: roles })
  assert.deepEqual(m.assignedPermissions(account, roles), { permissions: ['RestoreVM', 'UpdateUser', 'ViewJobs'], complete: true })
  assert.equal(m.assignedPermissions(account, roles.slice(0, 1)).complete, false)
  assert.ok(m.userIssues(account, roles).includes('identity-admin'))
  assert.ok(!m.userIssues(user(), [row({ permissions: evidence(['ViewUsers', 'UpdateUserRoles']) })]).includes('identity-admin'))
})
test('unassigned and no-permission claims need complete evidence; filters compose by IDs', () => {
  assert.ok(!m.roleIssues(row({ permissions: evidence([], false) }), evidence([], false)).includes('no-permissions'))
  assert.ok(!m.roleIssues(row(), evidence([user({ roles: undefined })])).includes('unassigned'))
  assert.ok(m.roleIssues(row({ permissions: evidence([]) }), evidence([])).includes('unassigned'))
  const data = snapshot({ users: evidence([user(), user({ id: id(4), name: 'service', isServiceAccount: true })]) })
  assert.equal(m.filterUsers(data, { ...m.emptyFilters, issue: 'service', role: id(1), query: 'service', mfa: 'enabled', type: 'InternalUser' }).length, 1)
  assert.equal(m.filterUsers(data, { ...m.emptyFilters, role: id(9) }).length, 0)
  assert.equal(m.filterRoles(data, { ...m.emptyFilters, query: 'viewjobs', type: 'Built-in' }).length, 1)
})
test('collection follows explicit totals beyond short pages and retains prior pages on failure', async () => {
  const calls = []
  const result = await l.collection(async path => { calls.push(path); if (calls.length === 3) throw new l.IdentityError('secret', 403); return { data: [role({ id: id(calls.length) })], pagination: { total: 3 } } }, '/roles', m.roleSchema, 'Roles')
  assert.equal(calls.length, 3); assert.match(calls[1], /skip=1/); assert.equal(result.data.length, 2); assert.equal(result.complete, false); assert.match(result.error, /permissions/); assert.doesNotMatch(result.error, /secret/)
})
test('collection detects repeated pages, truncated totals and view caps without pretending completion', async () => {
  assert.equal((await l.collection(async () => ({ data: [role()], pagination: { total: 2 } }), '/roles', m.roleSchema, 'Roles')).complete, false)
  assert.equal((await l.collection(async () => ({ data: [], pagination: { total: 2 } }), '/roles', m.roleSchema, 'Roles')).complete, false)
  const capped = await l.collection(async () => ({ data: [role(), role({ id: id(3) })], pagination: { total: 2 } }), '/roles', m.roleSchema, 'Roles', 1)
  assert.equal(capped.data.length, 1); assert.equal(capped.complete, false)
})
test('authentication failures propagate through lists and role permissions', async () => {
  const read = async () => { throw new l.IdentityError('Reconnect', 401) }
  await assert.rejects(l.collection(read, '/roles', m.roleSchema, 'Roles'), error => error.status === 401)
  await assert.rejects(l.permissions(read, id(1)), error => error.status === 401)
})
test('permission replies validate role identity and deduplicate entries', async () => {
  assert.deepEqual((await l.permissions(async () => ({ roleId: id(1), permissions: ['ViewJobs', 'ViewJobs'] }), id(1))).data, ['ViewJobs'])
  for (const value of [{ roleId: id(9), permissions: ['DeleteUser'] }, {}, { roleId: id(1), permissions: [null] }]) assert.equal((await l.permissions(async () => value, id(1))).complete, false)
})
test('overview bounds permission concurrency and preserves partial MFA evidence', async () => {
  let active = 0, peak = 0, permissionCalls = 0
  const read = async path => {
    if (path.includes('users?')) return { data: [user()] }
    if (path.includes('roles?')) return { data: Array.from({ length: 10 }, (_, n) => role({ id: id(n + 1) })) }
    if (path.endsWith('/settings')) throw Error('private failure')
    active++; peak = Math.max(peak, active); permissionCalls++; await new Promise(resolve => setImmediate(resolve)); active--
    return { roleId: path.split('/').at(-2), permissions: ['ViewJobs'] }
  }
  const result = await l.loadIdentity(read, 'server', key, a.userRevision)
  assert.equal(result.users.complete, true); assert.equal(result.roles.data.length, 10); assert.equal(peak, 4); assert.equal(permissionCalls, 10); assert.equal(result.mfaEnabled, null); assert.ok(result.settingsError)
  assert.match(result.users.data[0].revision, /^[a-f0-9]{64}$/)
})
test('custom scope summaries preserve owned-backup semantics and unknown fields without raw data', () => {
  const scopes = l.scopeSummary({ id: id(1), password: 'private', restorePermissionsScope: { restoreBackupScope: { entireBackupScope: false, backupSources: [] } }, repositoryScope: { allRepositories: false, repositories: [{ repositoryName: 'Repo A' }] } }, id(1))
  assert.equal(scopes.find(row => row.name === 'Restore sources').value, 'Owned backups + additional sources')
  assert.equal(scopes.find(row => row.name === 'Manage backups').value, 'Not reported')
  assert.equal(scopes.find(row => row.name === 'Repositories').detail, 'Repo A'); assert.doesNotMatch(JSON.stringify(scopes), /private|password/)
})
test('built-in roles skip custom scope reads; custom scope failures leave permissions usable', async () => {
  for (const isBuiltIn of [true, false]) {
    const paths = [], result = await l.loadRole(async path => { paths.push(path); if (path.endsWith('/details')) throw new l.IdentityError('unsupported', 404); return path.endsWith('/permissions') ? { roleId: id(1), permissions: ['ViewJobs'] } : role({ isBuiltIn }) }, id(1), key)
    assert.equal(paths.length, isBuiltIn ? 2 : 3); assert.equal(result.permissions.complete, true); assert.equal(result.scopes.complete, isBuiltIn)
  }
})
test('strict action validation rejects injection, duplicate roles, invalid IDs and missing revisions', () => {
  for (const patch of [{ roleIds: [] }, { roleIds: [id(1), id(1)] }, { roleIds: ['../other'] }, { expectedRevision: '' }, { permissions: ['DeleteUser'] }, { sourceKey: 'bad' }]) assert.equal(a.actionSchema.safeParse(input('roles', { roleIds: [id(1)], ...patch })).success, false)
  assert.equal(a.actionSchema.safeParse(input('add', { name: 'bad\nname', type: 'InternalUser', roleIds: [id(1)], isServiceAccount: false })).success, false)
})
test('revisions are stable across role ordering but change for account security changes', () => {
  assert.equal(user({ roles: [role(), role({ id: id(3) })] }).revision, user({ roles: [role({ id: id(3) }), role()] }).revision)
  for (const patch of [{ name: 'changed' }, { mfaEnabled: false }, { isServiceAccount: true }, { roles: [] }]) assert.notEqual(user(patch).revision, user().revision)
})
test('all account actions preflight stale state before any write', async () => {
  for (const action of ['delete', 'reset-mfa', 'service', 'roles']) {
    const calls = []
    await assert.rejects(a.executeAction(async (path, method) => { calls.push(method || 'GET'); return user({ mfaEnabled: false }) }, input(action, { enabled: true, roleIds: [id(1)] })), error => error.status === 409)
    assert.deepEqual(calls, ['GET'])
  }
})
test('role changes resolve authoritative names and recheck account after role reads', async () => {
  const calls = []
  await a.executeAction(async (path, method, body) => { calls.push({ path, method: method || 'GET', body }); return path.includes('/roles/') ? role({ name: 'Verified name', injected: 'private' }) : user() }, input('roles', { roleIds: [id(1)] }))
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'GET', 'PUT'])
  assert.deepEqual(calls[3].body, { roles: [{ id: id(1), name: 'Verified name', description: 'Operations' }] })
})
test('a concurrent role assignment change during role lookup prevents overwrite', async () => {
  let reads = 0
  await assert.rejects(a.executeAction(async (path, method) => { assert.ok(!method); return path.includes('/roles/') ? role() : ++reads === 1 ? user() : user({ roles: [] }) }, input('roles', { roleIds: [id(1)] })), error => error.status === 409)
})
test('add, service mode, MFA reset and deletion use the documented payloads and verbs', async () => {
  for (const [action, patch, method, suffix, body] of [['add', { name: 'DOMAIN\\existing', type: 'InternalUser', roleIds: [id(1)], isServiceAccount: false }, 'POST', '/users', { name: 'DOMAIN\\existing', type: 'InternalUser', roles: [{ id: id(1), name: 'Operators', description: 'Operations' }], isServiceAccount: false }], ['service', { enabled: true }, 'POST', '/changeServiceAccountMode', { isServiceAccountEnable: true }], ['reset-mfa', {}, 'POST', '/resetMFA', undefined], ['delete', {}, 'DELETE', `/users/${id(2)}`, undefined]]) {
    const writes = []
    const result = await a.executeAction(async (path, verb, payload) => { if (verb) writes.push({ path, verb, payload }); return path.includes('/roles/') ? role() : user() }, input(action, patch))
    assert.deepEqual(result, { accepted: true }); assert.equal(writes.length, 1); assert.equal(writes[0].verb, method); assert.ok(writes[0].path.endsWith(suffix)); assert.deepEqual(writes[0].payload, body)
  }
})
test('server MFA policy changes require the reviewed current flag', async () => {
  await assert.rejects(a.executeAction(async () => ({ mfaEnabled: true }), input('mfa', { expectedEnabled: false, enabled: true })), error => error.status === 409)
  const calls = []
  await a.executeAction(async (path, method, body) => { calls.push({ path, method, body }); return { mfaEnabled: true } }, input('mfa', { expectedEnabled: true, enabled: false }))
  assert.equal(calls[1].method, 'PUT'); assert.deepEqual(calls[1].body, { mfaEnabled: false })
})

function harness(options = {}) {
  let source = { id: 'source-one', platform: 'vbr', host: 'vbr.test', port: 9419, protocol: 'https' }, refreshes = 0
  const calls = [], cookies = { veeam_source_id: 'source-one', ...options.cookies }
  class Response { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.headers = init.headers } static json(body, init) { return new Response(body, init) } }
  const exports = {}, deps = { 'node:crypto': require('node:crypto'), 'next/server': { NextResponse: Response }, 'next/headers': { cookies: async () => ({ get: key => cookies[key] ? { value: cookies[key] } : undefined }) }, './config-store': { configStore: { getById: value => source && value === source.id ? source : null } }, './token-manager': { tokenManager: { getToken: async () => options.noToken ? null : 'bound-token', refreshToken: async () => { refreshes++; return 'refreshed-token' } } }, '../utils/cookie-manager': { getChunkedCookie: (_, name) => cookies[name] }, '../identity/actions': a, '../identity/load': l, '../identity/model': m }
  const mock = async (url, init) => {
    const path = url.pathname
    if (init.method !== 'GET') return reply(200, { private: 'secret mutation body' })
    if (path.endsWith('/permissions')) return reply(200, { roleId: id(1), permissions: ['ViewJobs'] })
    if (path.endsWith(`/roles/${id(1)}`)) return reply(200, role())
    if (path.endsWith(`/users/${id(2)}`)) return reply(200, user())
    if (path.endsWith('/users')) return reply(200, { data: [user()] })
    if (path.endsWith('/roles')) return reply(200, { data: [role()] })
    return reply(200, { mfaEnabled: true })
  }
  vm.runInNewContext(compile(require.resolve('../lib/server/identity.ts')), { exports, require: name => { if (!(name in deps)) throw Error(name); return deps[name] }, process: { env: options.env || {} }, URL, AbortController, setTimeout, clearTimeout, fetch: async (url, init) => { calls.push({ url: String(url), ...init }); return options.fetch ? options.fetch(url, init, mock) : mock(url, init) } })
  const sourceKey = createHash('sha256').update(JSON.stringify(['source-one', 'https://vbr.test:9419'])).digest('hex')
  const request = (body = {}, headers = {}, query = '') => ({ nextUrl: new URL(`http://localhost:3000/api/vbr/identity${query}`), signal: new AbortController().signal, headers: new Headers({ origin: 'http://localhost:3000', ...headers }), json: async () => ({ sourceKey, ...body }) })
  return { exports, calls, request, sourceKey, refreshes: () => refreshes, changeSource: patch => { source = patch === null ? null : { ...source, ...patch } } }
}
test('source-bound reads use only the selected source token and return no credential material', async () => {
  const h = harness({ cookies: { veeam_vbr_token: 'foreign-token' } }), result = await h.exports.readIdentity(h.request())
  assert.equal(result.status, 200); assert.equal(result.headers['Cache-Control'], 'private, no-store'); assert.equal(result.body.users.data.length, 1)
  for (const call of h.calls) { assert.match(call.url, /^https:\/\/vbr.test:9419\//); assert.equal(call.headers.Authorization, 'Bearer bound-token'); assert.equal(call.redirect, 'error'); assert.equal(call.cache, 'no-store'); assert.equal(call.method, 'GET') }
  assert.doesNotMatch(JSON.stringify(result), /bound-token|foreign-token/)
})
test('missing selected-source credentials never fall back to another browser token', async () => {
  const h = harness({ noToken: true, cookies: { veeam_vbr_token: 'foreign-token' } })
  assert.equal((await h.exports.readIdentity(h.request())).status, 401); assert.equal(h.calls.length, 0)
})
test('stale source, unknown selection, foreign origin and invalid actions fail before network', async () => {
  const h = harness()
  assert.equal((await h.exports.mutateIdentity(h.request(input('delete')))).status, 409)
  assert.equal((await h.exports.mutateIdentity(h.request({}, { origin: 'https://foreign.test' }))).status, 403)
  assert.equal((await h.exports.mutateIdentity(h.request({ action: 'delete' }))).status, 400)
  h.changeSource(null); assert.equal((await h.exports.readIdentity(h.request())).status, 400); assert.equal(h.calls.length, 0)
})
test('environment credentials are checked against their original origin', async () => {
  const h = harness({ cookies: { veeam_source_id: undefined, veeam_vbr_token: 'token', veeam_vbr_token_url: 'https://other.test' }, env: { VBR_API_URL: 'https://vbr.test:9419' } })
  assert.equal((await h.exports.readIdentity(h.request())).status, 401); assert.equal(h.calls.length, 0)
})
test('GET requests negotiate older revisions and refresh authentication once', async () => {
  const h = harness({ fetch: async (url, init, mock) => init.headers['x-api-version'] === '1.3-rev2' ? reply(406, {}) : init.headers.Authorization === 'Bearer bound-token' ? reply(401, {}) : mock(url, init) })
  const result = await h.exports.readIdentity(h.request({}, {}, `?roleId=${id(1)}`))
  assert.equal(result.status, 200); assert.equal(h.refreshes(), 1); assert.equal(h.calls.at(-1).headers['x-api-version'], '1.3-rev1')
})
test('mutation failures never trigger token refresh or API-version replay', async () => {
  for (const status of [400, 401, 406]) {
    const h = harness({ fetch: async (url, init, mock) => init.method === 'DELETE' ? reply(status, { message: 'secret source stack' }) : mock(url, init) })
    const result = await h.exports.mutateIdentity(h.request({ ...input('delete'), sourceKey: h.sourceKey }))
    assert.equal(h.calls.filter(call => call.method === 'DELETE').length, 1); assert.equal(h.refreshes(), 0); assert.doesNotMatch(JSON.stringify(result), /secret source stack/)
  }
})
test('configured source changes during preflight prevent sending a mutation', async () => {
  let h
  h = harness({ fetch: async (url, init, mock) => { const response = await mock(url, init); h.changeSource({ host: 'changed.test' }); return response } })
  const result = await h.exports.mutateIdentity(h.request({ ...input('delete'), sourceKey: h.sourceKey }))
  assert.equal(result.status, 409); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].method, 'GET')
})
test('four-eyes failures are actionable without exposing raw messages', async () => {
  const h = harness({ fetch: async (url, init, mock) => init.method === 'DELETE' ? reply(403, { message: 'Four-eyes authorization required: private account details' }) : mock(url, init) })
  const result = await h.exports.mutateIdentity(h.request({ ...input('delete'), sourceKey: h.sourceKey }))
  assert.match(result.body.error, /four-eyes/); assert.doesNotMatch(result.body.error, /private account/)
})
test('unconfirmed mutation transport outcomes require refresh and are not retried', async () => {
  const h = harness({ fetch: async (url, init, mock) => { if (init.method === 'DELETE') throw Error('private transport trace'); return mock(url, init) } })
  const result = await h.exports.mutateIdentity(h.request({ ...input('delete'), sourceKey: h.sourceKey }))
  assert.equal(result.status, 502); assert.match(result.body.error, /outcome could not be confirmed/); assert.equal(h.calls.filter(call => call.method === 'DELETE').length, 1)
})
test('accepted mutations expose no source response metadata', async () => {
  const h = harness(), result = await h.exports.mutateIdentity(h.request({ ...input('delete'), sourceKey: h.sourceKey }))
  assert.deepEqual(plain(result.body), { accepted: true }); assert.doesNotMatch(JSON.stringify(result), /secret mutation/)
})

test('custom scopes expose allowlisted workload and restore-option names, excluding arbitrary metadata', () => {
  const scopes = l.scopeSummary({ id: id(1), inventoryScope: { entireInventory: false, workloads: [{ type: 'VSphere', inventoryObjects: [{ name: 'Cluster A', type: 'Cluster', hostName: 'vcenter', objectId: 'domain-c1', metadata: 'secret' }] }] }, restorePermissionsScope: { restoreOptions: { allOptions: false, restoreOptions: [{ code: 1, name: 'Entire VM', group: 'VMware', description: 'Restore VM', password: 'secret' }] } } }, id(1))
  assert.match(scopes.find(row => row.name === 'Inventory').detail, /Cluster A.*vcenter.*domain-c1/)
  assert.match(scopes.find(row => row.name === 'Restore options').detail, /Entire VM.*VMware/)
  assert.doesNotMatch(JSON.stringify(scopes), /secret|password|metadata/)
})
