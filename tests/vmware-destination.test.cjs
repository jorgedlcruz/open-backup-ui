const fs = require('node:fs')
const ts = require('typescript')
const test = require('node:test')
const assert = require('node:assert/strict')
require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, path)
const { resolveVmwareDestination, vmwareManagementUrl } = require('../lib/activity/vmware-destination.ts')

const mountId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const pointId = '33333333-3333-4333-8333-333333333333'
const base = '/api/v1/restore/instantRecovery/vSphere/vm/' + mountId
const page = data => ({ data, pagination: { total: data.length, count: data.length, skip: 0, limit: 200 } })

function fixture(vc = false) {
  const server = vc ? 'vc.example.com' : 'esx.example.com'
  const root = { name: server, hostName: server, type: vc ? 'vCenterServer' : 'Host', objectId: server,
    platform: 'VSphere', aclInfo: {isAllowed: true}, urn: (vc ? 'vc:' : 'esx:') + server }
  const cluster = root.urn + ';datacenter:datacenter-2;cluster:domain-c7'
  const destination = vc ? {...root, name: 'compute', type: 'Cluster', urn: cluster, objectId: 'domain-c7'} : {...root}
  const vmId = vc ? 'vm-23' : '23'
  const vm = {...root, objectId: vmId, urn: (vc ? cluster : root.urn) + ';vm:' + vmId,
    type: 'VirtualMachine', name: 'Recovered', powerState: 'PoweredOff'}
  const m = { id: mountId, sessionId, hostName: vc ? 'compute' : server, state: 'Mounted', vmName: 'Recovered',
    spec: { type: 'Customized', restorePointId: pointId, destination: {destinationHost: {...destination}, restoredVmName: 'Recovered'} } }
  const d = { mount: m, point: {id: pointId, name: 'Production', platformName:'VMware', backupId:pointId,
    creationTime:'2026-11-09T00:10:00Z', allowedOperations:['StartViVMInstantRecovery']},
    objects: page([]), membership: page([{id:pointId, backupId:pointId}]), session: {id: sessionId, sessionType: 'InstantRecovery',
    state: 'Working', resourceId: mountId, resourceReference: base}, roots: page([root]), inventory: page([vm]), targets: page([destination]),
    servers: page([{type:'ViHost', viHostType: vc ? 'VC' : 'ESXi', name: server, port:8443, status:'Available'}]) }
  const send = async (path, options = {}) => {
    assert(!options.mutation)
    if (path === base) return d.mount
    if (path === '/api/v1/sessions/' + sessionId) return d.session
    if (path === '/api/v1/restorePoints/' + pointId) return d.point
    if (path.startsWith('/api/v1/backups/' + pointId + '/objects?')) return d.objects
    if (path.startsWith('/api/v1/backupObjects/' + sessionId + '/restorePoints?')) return d.membership
    if (path.startsWith('/api/v1/backupInfrastructure/managedServers?')) return d.servers
    assert.equal(options.body.permissionScope, 'Restore')
    if (path === '/api/v1/inventory') return d.roots
    assert.equal(path, '/api/v1/inventory/' + server)
    if (options.body.filter.items.some(item => item.property === 'type' && item.value === 'VirtualMachine')) {
      assert(options.body.filter.items.some(item => item.property === 'name' && item.value === 'Recovered' && item.operation === 'Equals'))
      return d.inventory
    }
    return d.targets
  }
  return { d, run: () => resolveVmwareDestination(send, sessionId, mountId), send }
}

test('resolves the current, renamed standalone ESXi VM and native management port', async () => {
  assert.deepEqual(await fixture().run(), {provider:'esxi', server:'esx.example.com', port:8443, runtimeHost:'esx.example.com',
    vmId:'23', vmName:'Recovered', powerState:'PoweredOff', canConsole:true, url:'https://esx.example.com:8443/ui/#/host/vms/23'})
})

test('vCenter requires the actual instance UUID to generate its native VM URL', async () => {
  const target = await fixture(true).run()
  assert.equal(target.url, null)
  assert.equal(target.runtimeHost, undefined)
  assert.equal(target.vmId, 'vm-23')
  assert.equal(vmwareManagementUrl(target, 'not-a-uuid'), null)
  assert.equal(vmwareManagementUrl(target, pointId), 'https://vc.example.com:8443/ui/app/vm;nav=h/urn:vmomi:VirtualMachine:vm-23:' + pointId + '/summary')
})

test('same-name and original-location recovery require the selected point’s own source MoRef to differ', async () => {
  for (const vc of [false, true]) {
    const f = fixture(vc)
    const manager = f.d.roots.data[0].hostName
    f.d.mount.spec.type = 'OriginalLocation'
    delete f.d.mount.spec.destination
    f.d.mount.hostName = manager
    f.d.point.name = 'Recovered'
    f.d.objects = page([{id:sessionId, name:'Recovered', viType:'VirtualMachine', platformName:'VMware',
      path:manager+'\\Folder\\Recovered', objectId:vc ? 'vm-22' : '22'}])
    assert.equal((await f.run()).vmId, vc ? 'vm-23' : '23')
    f.d.point.allowedOperations = undefined
    assert.equal((await f.run()).canConsole, false)
    f.d.membership = page([])
    await assert.rejects(f.run, err => err.status === 409)
    f.d.membership = page([{id:pointId, backupId:pointId}])
    f.d.objects.data[0].objectId = vc ? 'vm-23' : '23'
    await assert.rejects(f.run, err => err.status === 409)
  }
})

test('same-name recovery to another manager requires a separately verified source VM and comparable native IDs', async () => {
  const f = fixture(true)
  const sourceServer = 'source-vcenter.example.com'
  const sourceRoot = {...f.d.roots.data[0], name:sourceServer, hostName:sourceServer, objectId:sourceServer, urn:'vc:'+sourceServer}
  const source = {...f.d.inventory.data[0], hostName:sourceServer, objectId:'vm-19', urn:sourceRoot.urn+';datacenter:datacenter-4;vm:vm-19'}
  f.d.roots = page([...f.d.roots.data, sourceRoot])
  f.d.point.name = 'Recovered'
  f.d.objects = page([{id:sessionId, name:'Recovered', viType:'VirtualMachine', platformName:'VMware',
    path:sourceServer+'\\Folder\\Recovered', objectId:'vm-19'}])
  const send = (path, options) => path === '/api/v1/inventory/' + sourceServer ? page([source]) : f.send(path, options)
  assert.equal((await resolveVmwareDestination(send, sessionId, mountId)).vmId, 'vm-23')
  source.name = 'Unrelated VM'
  await assert.rejects(resolveVmwareDestination(send, sessionId, mountId), err => err.status === 409)
  f.d.objects.data[0].objectId = '19'
  await assert.rejects(resolveVmwareDestination(send, sessionId, mountId), err => err.status === 409)
})

test('rejects expired mounts, conflicting sessions, reused source names and unverified inventory identities', async () => {
  const changes = [
    d => { d.mount.state = 'Dismounting' },
    d => { d.mount.id = sessionId },
    d => { d.mount.sessionId = pointId },
    d => { d.session.resourceReference = '/api/v1/restore/instantRecovery/vSphere/vm/' + pointId },
    d => { d.session.endTime = '2026-11-09T01:00:00Z' },
    d => { d.mount.spec.type = 'OriginalLocation' },
    d => { d.point.name = 'rEcOvErEd' },
    d => { d.point.name = 'Recovered'; d.point.platformName = 'CloudDirector' },
    d => { d.mount.spec.destination.restoredVmName = 'Some other VM' },
    d => { d.inventory.pagination.total = 2 },
    d => { d.inventory = page([d.inventory.data[0], d.inventory.data[0]]) },
    d => { d.roots.data[0].aclInfo = undefined },
    d => { d.servers.data[0].name = 'different.example.com' },
    d => { d.servers.data[0].viHostType = 'VC' },
    d => { d.servers.data[0].status = 'Unavailable' },
    d => { d.servers.data[0].port = 65536 },
    d => { d.inventory.data[0].hostName = 'elsewhere.example.com' },
    d => { d.mount.spec.destination.destinationHost.hostName = 'esx.example.com@untrusted.example.com' },
    d => { d.mount.spec.destination.destinationHost.urn = 'esx:some-other-server' },
    d => { d.inventory.data[0].urn = 'esx:some-other-server;vm:23' },
    d => { d.inventory.data[0].objectId = 'vm-23' },
    d => { d.inventory.data[0].name = 'Production' },
  ]
  for (const change of changes) {
    const f = fixture()
    change(f.d)
    await assert.rejects(f.run, err => err.status === 409, change.toString())
  }
})

test('rejects vCenter objects outside the chosen cluster and mounts removed during inventory reads', async () => {
  const vc = fixture(true)
  vc.d.inventory.data[0].urn = vc.d.inventory.data[0].urn.replace('domain-c7', 'domain-c9')
  await assert.rejects(vc.run, err => err.status === 409)
  const f = fixture()
  let count = 0
  const send = (path, options) => {
    if (path === base && ++count === 2) f.d.mount.state = 'Dismounting'
    return f.send(path, options)
  }
  await assert.rejects(resolveVmwareDestination(send, sessionId, mountId), err => err.status === 409)
  const closing = fixture()
  let reads = 0
  await assert.rejects(resolveVmwareDestination((path, options) => {
    if (path === '/api/v1/sessions/' + sessionId && ++reads === 2) closing.d.session.state = 'Stopping'
    return closing.send(path, options)
  }, sessionId, mountId), err => err.status === 409)
})
