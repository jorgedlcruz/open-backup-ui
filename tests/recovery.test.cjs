// Open Backup UI v1.0.2
const fs = require('node:fs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, path)

const { draftSchema, startRestore } = require('../lib/recovery/start.ts')
const { guestFiles, filesSchema } = require('../lib/recovery/files.ts')
const { browseInventory } = require('../lib/recovery/inventory.ts')
const sourceKey = 'a'.repeat(64)
const pointId = '11111111-1111-4111-8111-111111111111'
const backupId = '22222222-2222-4222-8222-222222222222'
const sessionId = '33333333-3333-4333-8333-333333333333'
const point = { id: pointId, backupId, name: 'my VM', creationTime: '2026-06-02T12:00:00Z', guestOsFamily: 'Windows', platformName: 'VMware' }
const ref = (type, platform = 'VSphere') => ({ platform, type, hostName: 'lab.test', objectId: type + '-1', name: type })
const page = data => ({ data, pagination: { count: data.length, total: data.length, skip: 0, limit: 200 } })

async function launch(operation, input = {}, opts = {}) {
  const draft = draftSchema.parse({ sourceKey, restorePointId: pointId, backupId, operation, ...input })
  const calls = []
  const send = async (path, options = {}) => {
    calls.push({ path, ...options })
    if (options.mutation) return operation === 'StartFlrRestore' ? { sessionId } : { id: sessionId }
    if (path === '/api/v1/restorePoints/' + pointId) return { ...point, allowedOperations: [operation], ...opts.point }
    if (path.startsWith('/api/v1/inventory/')) {
      const rules = options.body.filter.items
      assert.equal(options.body.permissionScope, 'Restore')
      const kind = rules.find(item => item.property === 'type').value
      return page([{ ...ref(kind, rules[0].value), name: 'Authoritative ' + kind, aclInfo: { isAllowed: true } }])
    }
    if (path.includes('/disks?')) return page([{ name: 'source-disk', uid: 'disk-1', state: 'Processed' }])
    if (path.includes('/mountServers/')) return { id: backupId, type: 'Linux' }
    throw Error(path)
  }
  const result = await startRestore(send, opts.sourceKey || sourceKey, draft)
  assert.equal(result.id, sessionId)
  assert.equal(calls.filter(call => call.mutation).length, 1)
  return calls.at(-1)
}

test('selected point is pinned to source, backup and currently allowed action', async () => {
  await assert.rejects(launch('StartEntireVmRestore', {}, { sourceKey: 'b'.repeat(64) }), /source changed/)
  await assert.rejects(launch('StartEntireVmRestore', {}, { point: { backupId: sessionId } }), /no longer belongs/)
  await assert.rejects(launch('StartEntireVmRestore', {}, { point: { allowedOperations: [] } }), /no longer allows/)
  await assert.rejects(launch('StartEntireVmRestore', { reviewedMalwareStatus: 'Clean' }, { point: { malwareStatus: 'Infected' } }), /flagged/)
})

test('instant VMware uses the selected point and native inventory with independent network and write cache settings', async () => {
  const call = await launch('StartViVMInstantRecovery', { mode: 'Customized', reason: 'Isolated recovery', powerUp: true,
    target: { host: { ...ref('Host'), name: 'Injected' }, folder: ref('Folder'), resourcePool: ref('ResourcePool'), datastore: ref('Datastore'), vmName: 'restored' } })
  assert.equal(call.path, '/api/v1/restore/instantRecovery/vSphere/vm')
  assert.equal(call.body.restorePointId, pointId)
  assert.equal(call.body.type, 'Customized')
  assert.equal(call.body.destination.destinationHost.name, 'Authoritative Host')
  assert.equal(call.body.destination.restoredVmName, 'restored')
  assert.equal(call.body.datastore.cacheDatastore.type, 'Datastore')
  assert.equal(call.body.datastore.redirectEnabled, true)
  assert.equal(call.body.nicsEnabled, false)
  assert.equal(call.body.overwrite, false)
  assert.equal(call.body.powerUp, true)
})

test('entire recovery and cross-hypervisor requests use their own schemas', async () => {
  const full = await launch('StartEntireVmRestore', { mode: 'Customized', target: { host: ref('Host'), folder: ref('Folder'), vmName: 'new vm' } })
  assert.equal(full.path, '/api/v1/restore/vmRestore/vSphere')
  assert.equal(full.body.folder.vmName, 'new vm')
  assert.equal(full.body.destinationHost.type, 'Host')
  assert.equal(full.body.destination, undefined)
  const hyperV = await launch('StartHvVMInstantRecovery', { mode: 'Customized', target: { host: ref('Host', 'HyperV'), vmName: 'restored' } })
  assert.equal(hyperV.body.type, 'OtherPlatform')
  assert.equal(hyperV.body.target.vmName, 'restored')
  await assert.rejects(launch('StartHvVMInstantRecovery'), /destination/)
  for (const [operation, path] of [['StartEntireVmRestoreHyperV', 'hyperV'], ['StartEntireVmRestoreCloudDirector', 'cloudDirector']]) {
    const original = await launch(operation, { quickRollback: true })
    assert.equal(original.path, '/api/v1/restore/vmRestore/' + path)
    assert.equal(original.body.type, 'OriginalLocation')
    assert.equal(original.body.quickRollback, true)
  }
})

test('disk recovery checks disk membership and resolves cluster and cache datastore separately', async () => {
  const selected = { uid: 'disk-1', mountedName: 'mounted', registeredName: 'registered' }
  const target = { cluster: ref('Cluster'), datastore: ref('Datastore') }
  const call = await launch('StartFCDInstantRecovery', { disks: [selected], target })
  assert.deepEqual(call.body.disksMapping, [{ nameInBackup: 'source-disk', mountedDiskName: 'mounted', registeredFcdName: 'registered' }])
  assert.equal(call.body.writeCache.cacheDatastore.type, 'Datastore')
  await assert.rejects(launch('StartFCDInstantRecovery', { disks: [{ ...selected, uid: 'absent' }], target }), /unavailable/)
  const publish = await launch('StartDiskPublish', { disks: [{ uid: 'disk-1' }], allowedIps: ['192.0.2.1'] })
  assert.equal(publish.path, '/api/v1/dataIntegration/publish')
  assert.deepEqual(publish.body.diskNames, ['source-disk'])
})

test('Windows and Linux mount workflows return VBR sessionId and require an available Linux mount server', async () => {
  const windows = await launch('StartFlrRestore')
  assert.equal(windows.body.mountMode, 'Automatic')
  const linux = await launch('StartFlrRestore', { mountServerId: backupId }, { point: { guestOsFamily: 'Linux' } })
  assert.deepEqual(linux.body.mountServer, { mountServerType: 'MountServer', mountServerId: backupId })
})

test('guest file browse and restore use the selected mount and original-guest paths', async () => {
  const calls = []
  const send = async (path, options = {}) => {
    calls.push({ path, ...options })
    if (path.endsWith('/browse')) return { path: '/', items: [] }
    if (path.endsWith('/validateCredentials')) return { isSuccessful: true }
    if (path.endsWith('/restore')) return { id: pointId, type: 'FlrRestore', state: 'Starting', name: 'Restore files', progressPercent: 0, result: 'None' }
    return { sessionId, type: 'Linux', properties: { pathSeparator: '/' } }
  }
  await guestFiles(send, sourceKey, filesSchema.parse({ sourceKey, sessionId, action: 'browse' }))
  assert.equal(calls.at(-1).body.path, '/')
  await guestFiles(send, sourceKey, filesSchema.parse({ sourceKey, sessionId, action: 'restore', sourcePaths: ['/etc/hosts'], restoreType: 'Keep' }))
  assert.deepEqual(calls.at(-1).body.sourcePath, ['/etc/hosts'])
  assert.equal(calls.at(-1).path, '/api/v1/backupBrowser/flr/' + sessionId + '/restore')
  assert.equal(calls.filter(call => call.mutation).length, 1)
})

test('standalone default folder requires a matching ESXi root in restore-scoped inventory', async () => {
  for (const [type, urn, expected] of [['Host', 'esx:host.test', 1], ['vCenterServer', 'vc:host.test', 0]]) {
    const send = async (path, options) => {
      assert.equal(options.body.permissionScope, 'Restore')
      return path.endsWith('/inventory') ? page([{ ...ref(type), hostName: 'host.test', urn }]) : page([])
    }
    const result = await browseInventory(send, 'VSphere', 'Folder', 'host.test')
    assert.equal(result.data.length, expected)
    if (expected) assert.equal(result.data[0].objectId, 'ha-folder-vm')
  }
})

test('VMware network mapping resolves original distributed port group against backed-up VM ancestry', async () => {
  const { compileNetworks } = require('../lib/recovery/networks.ts')
  const host = ref('Host')
  const target = { ...ref('DVSNetwork'), urn: 'dest;net:1' }
  const original = { ...ref('DVSNetwork'), name: 'Production(DSwitch)', objectId: 'dvportgroup-32' }
  const send = async (path, options) => {
    assert.equal(options?.mutation, undefined)
    if (path.endsWith('networkInfo')) return page([{ id: '192', name: 'Production' }])
    if (path.includes('/objects?')) return page([{ name: point.name, platformName: 'VMware', path: 'source.example\\DC\\my VM' }])
    if (path.endsWith('source.example')) return page([{ ...original, urn: 'host:1;net:32' }, { ...original, urn: 'host:2;net:32' }])
    return page([target])
  }
  const result = await compileNetworks(send, point, host, 'StartEntireVmRestore', 'Mapped', [{ sourceId: '192', target }])
  assert.equal(result.network.networks[0].sourceNetwork.objectId, 'dvportgroup-32')
  assert.equal(result.network.networks[0].targetNetwork.type, 'DVSNetwork')
  await assert.rejects(compileNetworks(send, point, host, 'StartEntireVmRestore', 'Mapped', []), /every source/)
  const disconnected = await compileNetworks(send, point, host, 'StartEntireVmRestore', 'Disconnected', [])
  assert.deepEqual(disconnected.network, { networks: [], disconnected: true })
  const hv = await compileNetworks(send, point, ref('Host', 'HyperV'), 'StartHvVMInstantRecovery', 'Disconnected', [])
  assert.equal(hv.network.mappings[0].sourceNetwork.disconnect, true)
})

function mockRecoveryTransport(overrides = {}) {
  const Module = require('node:module')
  const originalLoad = Module._load
  const source = { id: 'source', platform: 'vbr', protocol: 'https', host: 'vbr.example', port: 9419, ...overrides }
  const mocks = {
    'next/headers': { cookies: async () => ({ get: name => name === 'veeam_source_id' ? { value: 'source' } : undefined }) },
    'next/server': { NextResponse: Response },
    './config-store': { configStore: { getById: () => source } },
    './token-manager': { tokenManager: { getToken: async () => 'test-token' } },
  }
  let withVbrRecovery
  try {
    Module._load = function (name, parent, isMain) {
      if (parent?.filename.endsWith('vbr-recovery.ts') && Object.hasOwn(mocks, name)) return mocks[name]
      return originalLoad.call(this, name, parent, isMain)
    }
    delete require.cache[require.resolve('../lib/server/vbr-recovery.ts')]
    ;({ withVbrRecovery } = require('../lib/server/vbr-recovery.ts'))
  } finally { Module._load = originalLoad }
  const request = { method: 'POST', headers: new Headers({ host: 'ui.example', origin: 'https://ui.example' }),
    nextUrl: new URL('https://ui.example/api/vbr/restore/start'), signal: new AbortController().signal }
  return { withVbrRecovery, request }
}

test('an ambiguous recovery submission is never replayed', async () => {
  const { withVbrRecovery, request } = mockRecoveryTransport()
  const originalFetch = global.fetch
  try {
    for (const simulateFailure of [() => { throw new TypeError('dropped') }, () => Response.json({}, { status: 500 })]) {
      let calls = 0
      global.fetch = async () => { calls++; return simulateFailure() }
      const result = await withVbrRecovery(request, ({ send }) => send('/api/v1/restore/flr', { method: 'POST', body: {}, mutation: true }))
      assert.equal(calls, 1)
      assert.equal(result.status, 502)
      assert.equal((await result.json()).uncertain, true)
    }
  } finally { global.fetch = originalFetch }
})

test('migration receives the session even after the browser disconnects and the ordinary read deadline expires', async t => {
  const http = require('node:http')
  const inbound = new AbortController(), readDeadline = new AbortController()
  let posts = 0
  const server = http.createServer((req, res) => {
    posts++
    assert.equal(req.method, 'POST')
    assert.equal(req.headers.authorization, 'Bearer test-token')
    inbound.abort()
    readDeadline.abort()
    setTimeout(() => {res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({id:sessionId}))}, 15)
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  t.after(() => {server.closeAllConnections(); server.close()})
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
  t.mock.method(AbortSignal,'timeout',ms => ms === 60000 ? readDeadline.signal : nativeTimeout(ms))
  const {request,withVbrRecovery} = mockRecoveryTransport({protocol:'http',host:'127.0.0.1',port:server.address().port})
  request.signal = inbound.signal
  const result = await withVbrRecovery(request, ({send}) => send('/api/v1/restore/instantRecovery/vSphere/vm/'+pointId+'/migrate',
    {method:'POST',body:{},mutation:true}), {backgroundMigration:true})
  assert.equal(result.status,200)
  assert.deepEqual(await result.json(),{id:sessionId})
  assert.equal(posts,1)
})

test('the scoped binary endpoint sends the bearer only to VBR and streams the archive without reading it into memory', async () => {
  const { withVbrRecovery, request } = mockRecoveryTransport()
  const originalFetch = global.fetch
  const archive = '/api/v1/backupBrowser/flr/' + sessionId + '/prepareDownload/' + pointId + '/download'
  try {
    let finish, calls = 0
    global.fetch = async (url, options) => {
      calls++
      assert.equal(new URL(url).hostname, 'vbr.example')
      assert.equal(options.headers.Authorization, 'Bearer test-token')
      assert.equal(options.headers.Accept, 'application/octet-stream')
      assert.equal(options.redirect, 'error')
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array([80,75]))
        finish = () => controller.close()
      } }), { headers: { 'Content-Type': 'application/octet-stream' } })
    }
    const result = await withVbrRecovery(request, ({send}) => send(archive, {method: 'POST', archive:true}))
    assert.equal(result.headers.get('Content-type'), 'application/zip')
    assert.match(result.headers.get('Content-Disposition'), /attachment; filename="guest-files-.*\.zip"/)
    const reader = result.body.getReader()
    assert.deepEqual((await reader.read()).value, new Uint8Array([80,75]))
    finish()
    assert.equal((await reader.read()).done, true)
    const refused = await withVbrRecovery(request, ({send}) => send('/api/v1/tasks', {method:'POST', archive:true}))
    assert.equal(refused.status, 400)
    assert.equal(calls, 1)
  } finally { global.fetch = originalFetch }
})
