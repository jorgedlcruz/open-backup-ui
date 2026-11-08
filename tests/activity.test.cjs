const fs = require('node:fs')
const ts = require('typescript')
const test = require('node:test')
const assert = require('node:assert/strict')
require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path,'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true},
}).outputText, path)
const {loadActivity} = require('../lib/activity/load.ts')
const {mergeActivity, mountPaths, parseMount} = require('../lib/activity/model.ts')
const {runMountAction, mountAction} = require('../lib/activity/actions.ts')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const page = data => ({data, pagination: {total: data.length}})
const session = (n, state = 'Working') => ({id: id(n), name: 'vm', state, sessionType: 'InstantRecovery', creationTime: '2026-11-08T12:30:00Z'})
const vmMount = (n, s) => ({id: id(n), sessionId: id(s), state: 'Mounted', vmName: 'vm-recovered', restorePointDate: '2026-10-08T19:14:00Z'})

test('links distinct mount and session IDs without conflating identically named sessions or multiple mounts', () => {
  const mounts = [vmMount(30,1), vmMount(31,1)].map(mount => parseMount('vSphere', mount))
  const rows = mergeActivity([session(1),session(2),session(2)], mounts)
  assert.deepEqual(rows.map(row => row.key), [`vSphere/${id(30)}`,`vSphere/${id(31)}`,id(2)])
  assert.equal(rows[0].mount.pointTime, '2026-10-08T19:14:00Z')
  assert.equal(rows[0].session.state,'Working')
})

test('returns regular VBR history, verified FLR, mounted disks and cross-platform recoveries in one view', async () => {
  const read = async path => {
    const url = new URL(path, 'https://vbr.invalid')
    if (url.pathname === '/private-api/v1/sessions') throw new Error('private API unavailable on REST port')
    if (url.pathname === '/api/v1/sessions') {
      assert.equal(url.searchParams.get('orderColumn'),'CreationTime')
      return page([session(2),session(5)])
    }
    if (url.pathname === mountPaths.vSphere) return page([vmMount(30,1)])
    if (url.pathname === mountPaths.hyperV) throw new Error('permission denied')
    if (url.pathname === mountPaths.flr) return page([{sessionId:id(5),type:'Windows',sourceProperties:{machineName:'vm'}}])
    if (url.pathname === mountPaths.publish) return page([{id:id(9), mountState:'Mounted',restorePointName:'published'}])
    return page([])
  }
  const published = async (skip, limit) => {
    assert.equal(skip,0); assert.equal(limit,200)
    return {sessions:[{sessionId:id(30),mountState:'Mounted',sessionType:'InstantRecovery'}, {sessionId:id(32),mountState:'Mounted',sessionType:'AzureInstantRecovery'}], pagination:{total:2}}
  }
  const result = await loadActivity(read,'vbr','source',{skip:0,name:'',state:''},published)
  assert.equal(result.total,2); assert.equal(result.rows.length,5)
  assert.deepEqual(result.warnings,['hyperV'])
  assert.equal(result.rows.filter(row => row.mount?.kind === 'other').length,1)
  assert.equal(result.rows.find(row => row.mount?.kind === 'flr').session.id,id(5))
})

test('deep-linked running session is fetched even if absent from this history page', async () => {
  const result = await loadActivity(async path => path === '/api/v1/sessions/'+id(77) ? session(77, 'Starting') : page([]),
    'vbr','source',{skip:0,name:'',state:'',focus:id(77)})
  assert.equal(result.rows[0].state,'Starting')
})
const mountId = id(13), sessionId = id(15)
const base = {kind:'vSphere', action:'migrate', sessionId, sourceKey:'scope'}
const host = {platform:'VSphere',name:'esxi',hostName:'vc',type:'Host',objectId:'host-1'}
const datastore = {...host,name:'production',type:'Datastore',objectId:'ds-99'}
function transport(raw = vmMount(13,15)) {
  const calls = []
  return {calls, send: async (path, options) => { calls.push({path, options}); return options?.mutation ? {id:id(99)} : raw }}
}
test('migration resolves selected inventory and posts once to the mount ID', async () => {
  const {calls, send} = transport()
  const result = await runMountAction(send, async ref => ({...ref, verified:true}), 'scope', mountId,
    mountAction.parse({...base, host, datastore, quickMigration:true}))
  assert.equal(result.sessionId, id(99)); assert.equal(calls.length,2)
  assert.equal(calls[1].path, mountPaths.vSphere+'/'+mountId+'/migrate')
  assert.deepEqual(calls[1].options.body, {destinationHost:{...host,verified:true},datastore:{defaultDatastore:{...datastore,verified:true}}, VeeamQMEnabled:true,DeleteSourceVmsFiles:false})
})
test('stale source, state, mount and session identity prevent mutations', async () => {
  for (const [raw,source] of [[vmMount(13,15),'different'],[vmMount(13,16),'scope'],[vmMount(14,15),'scope'],[{...vmMount(13,15),state:'Dismounting'},'scope']]) {
    const {calls,send} = transport(raw)
    await assert.rejects(runMountAction(send, async () => {},source,mountId,{...base,action:'unmount'}))
    assert.equal(calls.some(call => call.options?.mutation), false)
  }
  const {calls,send} = transport()
  await assert.rejects(runMountAction(send,async ref=>ref,'scope',mountId,{...base,host,datastore:{...datastore,hostName:'different'}}))
  assert.equal(calls.length,1)
})
test('per-platform stop and migration contracts preserve dismount naming, disk names and empty bodies', async () => {
  for (const [kind,action,ending,raw] of [
    ['hyperV','migrate','migrate',vmMount(13,15)], ['vSphere','unmount','unmount',vmMount(13,15)],
    ['fcd','unmount','dismount',vmMount(13,15)], ['publish','unmount','unpublish',{id:mountId,mountState:'Mounted'}],
  ]) {
    const {calls,send}=transport(raw)
    await runMountAction(send,async ref=>ref,'scope',mountId,{...base,kind,action,sessionId:kind === 'publish' ? mountId : sessionId})
    assert.equal(calls[1].path, mountPaths[kind]+'/'+mountId+'/'+ending); assert.equal(calls[1].options.body,undefined)
  }
  const {calls,send}=transport({...vmMount(13,15),mountedDisks:[{mountedDiskName:'mounted.vmdk'}]})
  await runMountAction(send,async ref=>ref,'scope',mountId,{...base,kind:'fcd',action:'migrate',datastore})
  assert.deepEqual(calls[1].options.body,{mountedDiskNames:['mounted.vmdk'],targetDatastore:datastore})
})


test('optional migration placement uses verified pool and folder, including cluster destinations', async () => {
  const cluster = {...host, type:'Cluster', objectId:'domain-c100'}
  const pool = {...host, type:'ResourcePool', objectId:'resgroup-3'}
  const folder = {...host, type:'Folder', objectId:'group-v21'}
  const request = mountAction.parse({...base, host:cluster, resourcePool:pool, folder, datastore})
  const {calls, send} = transport()
  const resolved = []
  await runMountAction(send, async (ref,kind) => {
    assert.equal(kind,ref.type)
    resolved.push(kind)
    return {...ref,verified:true}
  }, 'scope', mountId, request)
  assert.deepEqual(resolved.sort(), ['Cluster','Datastore','Folder','ResourcePool'])
  assert.deepEqual(calls[1].options.body.resourcePool,{...pool,verified:true})
  assert.deepEqual(calls[1].options.body.folder,{...folder,verified:true})
  const wrongServer = transport()
  await assert.rejects(runMountAction(wrongServer.send,async ref=>ref,'scope',mountId,
    {...request,resourcePool:{...pool,hostName:'foreign'}}))
  assert.equal(wrongServer.calls.length,1)
})
test('original-location mounts can keep source placement while selecting production storage', async () => {
  const request = mountAction.parse({...base, useOriginalPlacement:true, datastore})
  const original = transport({...vmMount(13,15),spec:{type:'OriginalLocation'}})
  await runMountAction(original.send,async ref => ref,'scope',mountId,request)
  assert.deepEqual(original.calls[1].options.body,{datastore:{defaultDatastore:datastore},VeeamQMEnabled:false,DeleteSourceVmsFiles:false})
  const customized = transport({...vmMount(13,15),spec:{type:'Customized'}})
  await assert.rejects(runMountAction(customized.send,async ref => ref,'scope',mountId,request))
  assert.equal(customized.calls.length,1)
})
