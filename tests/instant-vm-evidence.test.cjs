// Open Backup UI v1.2.0
const fs = require('node:fs'), ts = require('typescript')
const test = require('node:test'), assert = require('node:assert/strict')
require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true},
}).outputText, path)
const { parseMount } = require('../lib/activity/model.ts')
const { enrichInstantVm, relatedMigration } = require('../lib/activity/instant-vm-evidence.ts')
const { migrationTransfer } = require('../lib/activity/instant-vm.ts')
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0')
const host = 'esx.example.net'
const row = { id:id(1), sessionId:id(2), vmName:'Recovered', hostName:host, jobName:'Nightly', state:'Mounted',
  spec:{ type:'Customized', powerUp:true, restorePointId:id(3), destination:{restoredVmName:'Recovered',
    destinationHost:{type:'Host',name:host,hostName:host}}, datastore:{redirectEnabled:false,cacheDatastore:{type:'Datastore',name:'Unused cache'}} } }
const points = {id:id(3), name:'Original', backupId:id(4)}
const backup = {id:id(4), name:'VM backup', repositoryName:'Backup repository'}
const vm = {name:'Recovered', type:'VirtualMachine', platform:'VSphere', hostName:host, objectId:'23',
  urn:'esx:'+host+';vm:23', aclInfo:{isAllowed:true}, powerState:'PoweredOff'}
const page = (data, total = data.length) => ({data,pagination:{skip:0,count:data.length,total}})
const read = async path => path === '/api/v1/restorePoints/'+id(3) ? points : path === '/api/v1/backups/'+id(4) ? backup : assert.fail(path)

test('labels source, destination and actual power independently from mount request options', async () => {
  const parsed = parseMount('vSphere',row)
  assert.equal(parsed.instantVm.writeCache, undefined)
  const mount = await enrichInstantVm(read, parsed, async (server,platform,name) => {
    assert.deepEqual([server,platform,name],[host,'VSphere','Recovered'])
    return page([vm])
  })
  assert.equal(mount.instantVm.repository, 'Backup repository')
  assert.equal(mount.instantVm.backupName, 'VM backup')
  assert.equal(mount.instantVm.sourceVm, 'Original')
  assert.equal(mount.instantVm.powerState, 'PoweredOff')
  const redirected = parseMount('vSphere',{...row,spec:{...row.spec,datastore:{...row.spec.datastore,redirectEnabled:true}}})
  assert.equal(redirected.instantVm.writeCache, 'Unused cache')
})

test('does not infer VM power from request intent or ambiguous, denied or out-of-scope inventory', async () => {
  const parsed = parseMount('vSphere',row)
  for (const records of [page([vm],2), page([{...vm,hostName:'wrong'}]), page([{...vm,aclInfo:{isAllowed:false}}]), page([{...vm,urn:'esx:other;vm:23'}])]) {
    const m=await enrichInstantVm(read,parsed,async()=>records)
    assert.equal(m.instantVm.powerState,undefined)
  }
  const same = async path => path.includes('restorePoints') ? {...points,name:'Recovered'} : backup
  const original = await enrichInstantVm(same,parsed,()=>assert.fail('must not query production by name'))
  assert.equal(original.instantVm.powerState,undefined)
  const foreign = await enrichInstantVm(async()=>({...points,id:id(6)}),parsed,()=>assert.fail())
  assert.equal(foreign.instantVm.sourceVm,undefined)
})

test('Hyper-V placement comes from its native host model and can omit runtime power', () => {
  const h = parseMount('hyperV',{...row,hostName:'node01',spec:{type:'Customized',powerUp:true,target:{vmName:'Alt'},
    destinationHost:{type:'Cluster',name:'HV Cluster',hostName:'scvmm.example.net'}}})
  assert.equal(h.instantVm.platform,'HyperV')
  assert.equal(h.instantVm.host,'node01')
  assert.equal(h.instantVm.cluster,'HV Cluster')
  assert.equal(h.instantVm.manager,'scvmm.example.net')
  assert.equal(h.instantVm.powerState,undefined)
})

test('migration progress uses the linked operation, keeps zero, and respects explicit terminal results', () => {
  const mount = {state:'Mounted'}, parent = {id:id(1),sessionType:'InstantRecovery',state:'Working',progressPercent:100}
  const child = {id:id(2),sessionType:'QuickMigration',state:'Working',progress:{progressPercent:0}}
  assert.deepEqual(migrationTransfer(mount,parent),{phase:'idle'})
  assert.deepEqual(migrationTransfer({state:'Migrating'},parent),{phase:'migrating'})
  assert.deepEqual(migrationTransfer(mount,parent,child),{phase:'migrating',progress:0})
  assert.deepEqual(migrationTransfer(mount,parent,{...child,progressPercent:57}),{phase:'migrating',progress:57})
  for (const state of ['Starting','WaitingSlot','Pausing','Postprocessing','Stopping']) {
    assert.deepEqual(migrationTransfer(mount,parent,{...child,state,progress:{progressPercent:20,transferredSize:1024}}),
      {phase:'pending',progress:20,transferredBytes:1024})
  }
  assert.deepEqual(migrationTransfer(mount,parent,{...child,parentSessionId:id(3)}),{phase:'unknown'})
  for (const [result,phase] of [['None','unknown'],['Success','succeeded'],['Warning','warning'],['Failed','failed']]) {
    assert.equal(migrationTransfer(null,parent,{...child,state:'Stopped',result:{result}}).phase,phase)
  }
  assert.equal(migrationTransfer(null,parent,{...child,state:'Stopped',result:{result:'Failed',isCanceled:true}}).phase,'canceled')
  assert.equal(migrationTransfer(null,parent,{...child,progressPercent:150}).progress,undefined)
})

test('only loads an explicit VBR relation to the correct type and parent', async () => {
  const parent = {id:id(1),sessionType:'InstantRecovery',relatedSessionId:id(2)}
  const child = {id:id(2),sessionType:'QuickMigration',parentSessionId:id(1)}
  const found = await relatedMigration(async path=>{assert.equal(path,'/api/v1/sessions/'+id(2));return child},parent)
  assert.equal(found.id,id(2))
  for (const wrong of [{...child,id:id(3)}, {...child,sessionType:'BackupJob'}, {...child,parentSessionId:id(3)}]) {
    assert.equal(await relatedMigration(async()=>wrong,parent),null)
  }
  assert.equal(await relatedMigration(()=>assert.fail(),{...parent,relatedSessionId:undefined}),null)
})
