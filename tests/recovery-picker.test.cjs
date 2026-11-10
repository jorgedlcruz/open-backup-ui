// Open Backup UI v1.0.2
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)
const {pickerPage}=require('../lib/recovery/picker-catalog.ts'),{bulkKind,recoveryKinds}=require('../lib/restore-points/recovery-picker.ts')
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0')
const backup=id(1),copy=id(2),vm=id(3),directory=id(4),row=(backupId,objectId,sql,ad)=>({backupId,objectId,name:objectId===vm?'Data':'Directory',platformName:'VMware',itemIconType:'Vm',
 operations:[{operation:'ExploreForMsSql',enabled:sql},{operation:'ExploreForMsAd',enabled:ad},{operation:'EntireVmRestoreToVi',enabled:true}]})
function api(deny=false){
  const calls=[]
  const privateSend=async p=>{const u=new URL(p,'https://unit.invalid');calls.push(u.pathname)
    if(u.pathname.endsWith('/permissions'))return {permissions:['ViewBackupObjects','ViewRestorePoints','ViewTasks','StartExplorerForMsAd',...(deny?[]:['StartExplorerForMsSql'])]}
    const data=u.pathname==='/private-api/v1/backups'?[backup,copy].map(i=>({id:i,name:i,platformName:'VMware'})):u.pathname.includes(backup)?[row(backup,vm,true,false),row(backup,directory,false,true)]:[row(copy,vm,false,false),{...row(copy,id(9),true,true),itemIconType:'WindowsAgentMachine'}]
    return {data,pagination:{total:data.length,skip:0}}}
  const read=async p=>{const u=new URL(p,'https://unit.invalid');assert.equal(u.pathname,'/api/v1/backupObjects/'+vm+'/restorePoints')
    const data=[{id:id(7),backupId:backup,creationTime:'2026-11-01T00:00:00Z',allowedOperations:['StartEntireVmRestore']},{id:id(8),backupId:copy,creationTime:'2026-11-02T00:00:00Z',allowedOperations:[]}]
    return {data,pagination:{total:data.length,skip:0}}}
  return {calls,privateSend,read}
}
test('picker filters exact native object and backup capability, point operation and membership',async()=>{
  const {read,privateSend,calls}=api(),run=input=>pickerPage(read,privateSend,'operator-one',{offset:0,limit:1,...input})
  assert.deepEqual((await run({kind:'sql',view:'objects'})).data.map(v=>v.objectId),[vm])
  assert.deepEqual((await run({kind:'active-directory',view:'objects'})).data.map(v=>v.objectId),[directory])
  const list=await run({kind:'entire-vm',view:'objects',offset:1});assert.equal(list.total,2);assert.equal(list.data.length,1)
  assert.equal(calls.filter(p=>p.endsWith('/permissions')).length,1)
  assert.deepEqual((await run({kind:'sql',view:'points',objectId:vm})).data.map(p=>[p.id,p.applications[0].kind]),[[id(7),'sql']])
  assert.deepEqual((await run({kind:'entire-vm',view:'points',objectId:vm})).data.map(p=>p.id),[id(7)])
  await assert.rejects(run({kind:'sql',view:'points',objectId:vm,backupId:copy}),/unavailable/)
  assert.equal((await run({kind:'sql',view:'points',objectId:vm,restorePointId:id(8)})).total,0)
  const restricted=api(true);assert.equal((await pickerPage(read,restricted.privateSend,'operator-two',{kind:'sql',view:'objects',offset:0,limit:5})).total,0)
})
test('batch selection only applies to virtual machine and instant VM recovery',()=>{
  assert.deepEqual(recoveryKinds.filter(bulkKind),['instant-vm','entire-vm'])
})
test('bearer-only application selection is empty without enumerating any guesses',async()=>{
  const result=await pickerPage(()=>{throw Error('unexpected read')},undefined,'public',{view:'objects',kind:'sql',limit:40,offset:0})
  assert.equal(result.total,0);assert.equal(result.notices.length,1)
})
test('duplicate VM identities keep their distinguishing path or stable ID even on a pinned page',async()=>{
  const objects=[1,2,3,4].map(n=>id(n+20))
  const send=async url=>{
    if(url.includes('/permissions'))return {permissions:['ViewBackupObjects','ViewRestorePoints','ViewTasks','StartExplorerForMsAd']}
    const data=url.includes('/objects')?objects.map(o=>({...row(backup,o,false,true),name:'Twin'})):[{id:backup,name:'Backup',platformName:'VMware'}]
    return {data,pagination:{total:data.length,skip:0}}
  }
  const read=async url=>{
    const i=objects.indexOf(url.split('/').pop())
    assert.ok(i>=0);return {id:objects[i],name:'Twin',path:i<2?['vc.example\\vm-folder\\Twin','standalone.example\\Twin'][i]:null}
  }
  const get=(input={})=>pickerPage(read,send,'duplicate-names',{kind:'active-directory',view:'objects',offset:0,limit:40,...input})
  const page=await get()
  assert.deepEqual(page.data.map(v=>v.distinguishingLocation),['vc.example / vm-folder','standalone.example',objects[2].slice(-8),objects[3].slice(-8)])
  assert.equal((await get({objectId:objects[1]})).data[0].distinguishingLocation,'standalone.example')
  assert.equal((await get({query:'vm-folder'})).data[0].objectId,objects[0])
})
test('name collisions respect inventory manager and destination folder across sibling VMs',()=>{
  const {sameRecoveryDestination}=require('../lib/restore-points/destination-collision.ts')
  const target={platform:'VSphere',manager:'vc01',folder:'folder-a',name:'vm-restore'}
  assert.equal(sameRecoveryDestination(target,{...target,folder:'folder-b'}),false)
  assert.equal(sameRecoveryDestination(target,{...target,manager:'vc02'}),false)
  assert.equal(sameRecoveryDestination(target,{...target,name:'VM-restore ',folder:'FOLDER-A'}),true)
  assert.equal(sameRecoveryDestination(target,{...target,folder:''}),true)
})
test('private capabilities recover after a transient zero; incomplete lists expire and cannot resurrect old SQL grants',async()=>{
  const capability=row(backup,vm,true,false),permissions=['ViewBackupObjects','ViewRestorePoints','ViewTasks','StartExplorerForMsSql']
  let mode='transient',attempts=0
  const send=async url=>{
    if(url.includes('/permissions'))return {permissions}
    let data
    if(url.includes('/objects')){
      attempts++
      data=mode==='missing'||mode==='transient'&&attempts===1?[]:[{...capability,operations:mode==='revoked'?[]:capability.operations}]
    }else data=[{id:backup,name:'Parent',platformName:'VMware',objectsCount:1}]
    return {data,pagination:{skip:0,total:data.length}}
  }
  const read=async url=>{
    assert.ok(url.startsWith('/api/v1/backups/'+backup+'/objects?'))
    return {data:[{id:vm,name:'Data',type:'VM',backupId:copy}],pagination:{skip:0,total:1}}
  }
  const get=(refresh=false)=>pickerPage(read,send,'flaky-private',{kind:'sql',view:'objects',offset:0,limit:5,refresh})
  const first=await get();assert.equal(first.data[0].objectId,vm);assert.equal(first.complete,true);assert.equal(attempts,2)
  mode='missing';const missing=await get(true)
  assert.equal(missing.total,0);assert.equal(missing.complete,false);assert.ok(missing.notices.length);assert.equal(attempts,6)
  mode='revoked';const denied=await get();assert.equal(denied.complete,true);assert.equal(denied.total,0);assert.equal(attempts,7)
})
