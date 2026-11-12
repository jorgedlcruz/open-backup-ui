// Open Backup UI v1.2.0
const fs = require('node:fs')
const ts = require('typescript')
const test = require('node:test')
const assert = require('node:assert/strict')
require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path,'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true},
}).outputText, path)
const {defaultFilters, activityQuerySchema, sessionTypes, sessionGroups} = require('../lib/activity/filters.ts')
const {loadActivity, loadActivityMounts} = require('../lib/activity/load.ts')
const {mergeActivity, mountBelongsToSession, mountPaths, parseMount} = require('../lib/activity/model.ts')
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
  const result = await loadActivity(read,'vbr','source',defaultFilters,published)
  assert.equal(result.total,2); assert.equal(result.rows.length,5)
  assert.deepEqual(result.warnings,['hyperV'])
  assert.equal(result.rows.filter(row => row.mount?.kind === 'other').length,1)
  assert.equal(result.rows.find(row => row.mount?.kind === 'flr').session.id,id(5))
})

test('an old pinned recovery appears only once when its history row is reached on a later page',async()=>{
  const items=Array.from({length:55},(_,i)=>session(i+1))
  const read=async path=>{
    const url=new URL(path,'https://vbr.invalid')
    if(url.pathname===mountPaths.vSphere)return page([vmMount(90,55)])
    if(!url.pathname.endsWith('/sessions'))return page([])
    const skip=Number(url.searchParams.get('skip'));return {data:items.slice(skip,skip+50),pagination:{total:items.length}}
  }
  const first=await loadActivity(read,'vbr','source',defaultFilters)
  const next=await loadActivity(read,'vbr','source',{...defaultFilters,skip:first.nextSkip,before:first.before})
  assert.equal(first.rows.length,51);assert.equal(first.rows[0].mount.id,id(90));assert.equal(next.rows.length,4)
  assert.equal([...first.rows,...next.rows].filter(row=>row.sessionId===id(55)).length,1)
})
test('category, exact session types, results, state and time reach VBR and exclude unrelated pinned mounts', async () => {
  const seen=[]
  const query={...defaultFilters, group:'Backup', types:['BackupJob','SqlLogBackup'], results:['Warning','Failed'], state:'Stopped', window:'7d', name:'daily'}
  const read=async path => {
    const url=new URL(path,'https://vbr.invalid')
    if(url.pathname === '/private-api/v1/sessions') {seen.push(url);return page([])}
    return url.pathname===mountPaths.vSphere ? page([vmMount(20,2)]) : page([])
  }
  const result=await loadActivity(read,'vbr','source',query,undefined,new Date('2026-11-09T12:00:00Z'))
  assert.equal(result.rows.length,0)
  const params=seen[0].searchParams
  assert.deepEqual(params.getAll('typeFilter'),query.types)
  assert.deepEqual(params.getAll('resultFilter'),query.results)
  assert.equal(params.get('createdAfterFilter'),'2026-11-02T12:00:00.000Z')
  assert.equal(params.get('createdBeforeFilter'),'2026-11-09T12:00:00.000Z')
  assert.equal(params.get('stateFilter'),'Stopped')
  assert.equal(params.get('nameFilter'),'*daily*')
  await loadActivity(read,'vbr','source',{...defaultFilters,group:'Recovery'})
  assert.deepEqual(seen[1].searchParams.getAll('typeFilter'),sessionGroups.Recovery)
})
test('platform filtering scans upstream pages and returns an exact continuation offset for sparse matches', async () => {
  const source=Array.from({length:1200},(_,i)=>({...session(i+1),platformName:i<500 || i%3 ? 'HyperV':'VMware'}))
  const skips=[]
  const read=async path=>{
    const url=new URL(path,'https://vbr.invalid')
    if(!url.pathname.endsWith('/sessions'))return page([])
    const skip=Number(url.searchParams.get('skip')), limit=Number(url.searchParams.get('limit'));skips.push(skip)
    return {data:source.slice(skip,skip+limit),pagination:{total:source.length}}
  }
  const query={...defaultFilters,platform:'VMware'}
  const first=await loadActivity(read,'vbr','scope',query)
  assert.deepEqual(skips,[0,500]);assert.equal(first.total,null);assert.equal(first.rows.length,50);assert.equal(first.hasMore,true)
  const next=await loadActivity(read,'vbr','scope',{...query,skip:first.nextSkip})
  assert.equal(next.rows.length,50)
  assert.equal(new Set([...first.rows,...next.rows].map(row=>row.key)).size,100)
  assert.ok(first.rows.every(row=>row.session.platformName==='VMware'))
  const included=[...first.rows,...next.rows].map(row=>row.key).sort()
  assert.deepEqual(included,source.filter(row=>row.platformName==='VMware').slice(0,100).map(row=>row.id).sort())
})
test('exact type filtering removes VBR family matches before paginating', async () => {
  const source=Array.from({length:110},(_,i)=>({...session(i+1),sessionType:i%2?'BackupJob':'PlatformBackupJob'}))
  const query={...defaultFilters,types:['BackupJob']}
  const read=async path=>{
    const url=new URL(path,'https://vbr.invalid')
    if(!url.pathname.endsWith('/sessions'))return page([])
    const skip=Number(url.searchParams.get('skip'))
    return {data:source.slice(skip,skip+Number(url.searchParams.get('limit'))),pagination:{total:source.length}}
  }
  const first=await loadActivity(read,'vbr','scope',query)
  const next=await loadActivity(read,'vbr','scope',{...query,skip:first.nextSkip})
  assert.equal(first.rows.length,50);assert.equal(next.rows.length,5);assert.equal(next.hasMore,false)
  assert.ok([...first.rows,...next.rows].every(row=>row.session.sessionType==='BackupJob'))
})
test('filters accept the documented enums and reject invalid combinations',()=>{
  assert.equal(sessionTypes.length,109)
  assert.equal(new Set(sessionTypes).size,sessionTypes.length)
  for(const invalid of [{platform:'Unknown/New'}, {skip:-2}, {types:['Other']}, {group:'Recovery',types:['BackupJob']},
    {results:['Working']},{state:'Failed'},{window:'1000d'}]) assert.equal(activityQuerySchema.safeParse(invalid).success,false)
  assert.equal(activityQuerySchema.safeParse({types:['InstantRecovery'],state:'WaitingSlot',platform:'VMware'}).success,true)
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
  const result = await runMountAction(send, async ref => ({...ref, name:'VBR ' + ref.type, verified:true}), 'scope', mountId,
    mountAction.parse({...base, host, datastore, quickMigration:true}))
  assert.equal(result.sessionId, id(99)); assert.equal(calls.length,2)
  assert.deepEqual(result.destination,{host:'VBR Host',datastore:'VBR Datastore'})
  assert.equal(calls[1].path, mountPaths.vSphere+'/'+mountId+'/migrate')
  assert.deepEqual(calls[1].options.body, {destinationHost:{...host,name:'VBR Host',verified:true},datastore:{defaultDatastore:{...datastore,name:'VBR Datastore',verified:true}}, VeeamQMEnabled:true,DeleteSourceVmsFiles:false})
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
  const original = transport({...vmMount(13,15),hostName:'original.example',spec:{type:'OriginalLocation'}})
  const result = await runMountAction(original.send,async ref => ref,'scope',mountId,request)
  assert.deepEqual(result.destination,{host:'original.example',datastore:datastore.name})
  assert.deepEqual(original.calls[1].options.body,{datastore:{defaultDatastore:datastore},VeeamQMEnabled:false,DeleteSourceVmsFiles:false})
  const customized = transport({...vmMount(13,15),spec:{type:'Customized'}})
  await assert.rejects(runMountAction(customized.send,async ref => ref,'scope',mountId,request))
  assert.equal(customized.calls.length,1)
})


test('disk publication is joined by an explicit resource despite differing session and mount IDs', () => {
  const mount=parseMount('publish',{id:id(90), mountState:'Mounted', restorePointName:'VM',info:{mode:'ISCSI',serverPort:3260,
    disks:[{diskName:'disk-1.vmdk',accessLink:'iqn.example:LUN(0)',mountPoints:['X:/published']}]}})
  assert.deepEqual(mount.publication,{mode:'ISCSI',port:3260,disks:[{name:'disk-1.vmdk',accessLink:'iqn.example:LUN(0)',mountPoints:['X:/published']}]})
  const publish={...session(2),sessionType:'PublishBackupContentViaMount',resourceId:id(90)}
  for(const record of [publish,{...publish,resourceId:undefined,resourceReference:mountPaths.publish+'/'+mount.id}]) {
    assert.equal(mountBelongsToSession(mount,record),true)
    const rows=mergeActivity([record],[mount]);assert.equal(rows.length,1);assert.equal(rows[0].sessionId,id(2))
    assert.equal(rows[0].mount.sessionId,id(2));assert.equal(rows[0].mount.id,id(90))
  }
  for(const mismatch of [
    {...publish,sessionType:'BackupJob'}, {...publish,resourceReference:mountPaths.publish+'/'+id(40)}, {...publish,resourceId:id(50)},
    {...publish,resourceId:undefined,resourceReference:'https://foreign.invalid'+mountPaths.publish+'/'+id(90)},
  ]) assert.equal(mountBelongsToSession(mount,mismatch),false)
  const rows=mergeActivity([publish,{...publish,id:id(4)}],[mount])
  assert.equal(rows.length,3);assert.equal(rows.find(row=>row.mount).session,undefined)
})
test('unpublishing a disk with distinct IDs rechecks the server-supplied session association',async()=>{
  const raw={id:mountId,mountState:'Mounted'}
  for(const resourceId of [mountId,id(99)]) {
    const calls=[]
    const send=async (path,options)=>{
      calls.push({path,options});if(options?.mutation)return {id:id(33)}
      return path==='/api/v1/sessions/'+sessionId?{...session(15),sessionType:'PublishBackupContentViaMount',resourceId}:raw
    }
    const run=runMountAction(send,async()=>{},'scope',mountId,{...base,kind:'publish',action:'unmount'})
    if(resourceId===mountId){await run;assert.equal(calls[2].path,mountPaths.publish+'/'+mountId+'/unpublish')}
    else{await assert.rejects(run);assert.equal(calls.some(c=>c.options?.mutation),false)}
    assert.equal(calls[1].path,'/api/v1/sessions/'+sessionId)
  }
})
test('a scoped detail mount read fetches only requested collections and reports their exact warning labels',async()=>{
  const calls=[]
  const read=async path=>{calls.push(new URL(path,'https://vbr.invalid').pathname);throw Error('Forbidden')}
  const privateRead=()=>{throw Error('Unexpected private read')}
  const partial=await loadActivityMounts(read,privateRead,['flr','publish'])
  assert.deepEqual(calls,[mountPaths.flr,mountPaths.publish])
  assert.deepEqual(partial.warnings,['flr','publish']);assert.equal(partial.available,false)
})
