// Open Backup UI v1.2.0
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText,file)
const {latestDefaultPoint,applyDefaultPoint,suggestedOperation}=require('../lib/restore-points/default-point.ts')
const object={objectId:'vm',name:'VM',platform:'VMware',copies:[{backupId:'backup',name:'Backup',kinds:['entire-vm','instant-vm','guest-files','sql']}]}
const selection={object}
const point=(id,day=11,extra={})=>({id,backupId:'backup',creationTime:`2026-11-${day}T12:00:00Z`,allowedOperations:['StartEntireVmRestore'],...extra})

test('latest default chooses the newest eligible time and retains all point evidence',()=>{
  const older=point('older',10),newest=point('newest',11,{malwareStatus:'Infected'}),unavailable=point('unavailable',12,{allowedOperations:[]})
  const input=[older,unavailable,newest]
  assert.equal(latestDefaultPoint(selection,'entire-vm',input),newest)
  assert.equal(latestDefaultPoint(selection,'machines',input),newest)
  assert.deepEqual(input,[older,unavailable,newest])
  assert.equal(latestDefaultPoint(selection,'entire-vm',[{...newest,creationTime:null}]),undefined)
})

test('application and NAS defaults use their actual eligibility evidence',()=>{
  const sql=point('sql',11,{applications:[{objectId:'vm',kind:'sql'}]})
  assert.equal(latestDefaultPoint(selection,'apps',[point('not-sql',12),sql]),sql)
  const nas={object:{objectId:'share',name:'Share',platform:'SMBShare',workloadType:'nas',copies:[{backupId:'backup',name:'Backup',kinds:['nas-files']}]}}
  const filePoint=point('files',11,{recoveryKinds:['nas-files']})
  assert.equal(latestDefaultPoint(nas,'files',[filePoint]),filePoint)
  assert.equal(latestDefaultPoint(nas,'files',[point('vm-only',12)]),undefined)
})

test('manual and pinned selections never get replaced by a newer point',()=>{
  const explicit={...selection,point:point('chosen',10)},latest=point('latest',12)
  assert.equal(latestDefaultPoint(explicit,'entire-vm',[latest]),undefined)
  assert.equal(latestDefaultPoint({...selection,seed:{objectId:'vm',restorePointId:'missing'}},'entire-vm',[latest]),undefined)
  assert.equal(latestDefaultPoint({...selection,seed:{objectId:'vm',backupId:'other-copy'}},'entire-vm',[latest]),undefined)
  const current=[explicit]
  assert.equal(applyDefaultPoint(current,explicit,'entire-vm',[latest]),current)
})

test('a late automatic response cannot overwrite a manual choice or reselected workload',()=>{
  const older=point('chosen',10),latest=point('latest',12)
  const explicit=[{...selection,point:older}]
  assert.equal(applyDefaultPoint(explicit,selection,'entire-vm',[latest]),explicit)
  const removed=[]
  assert.equal(applyDefaultPoint(removed,selection,'entire-vm',[latest]),removed)
  const reselected=[{object}]
  assert.equal(applyDefaultPoint(reselected,selection,'entire-vm',[latest]),reselected)
})

test('each batch member receives only its own default without changing its siblings',()=>{
  const second={object:{...object,objectId:'vm-2',name:'VM 2'}},firstPoint=point('first'),secondPoint=point('second')
  const first=applyDefaultPoint([selection,second],selection,'machines',[firstPoint])
  assert.equal(first[0].point,firstPoint);assert.equal(first[1],second)
  const both=applyDefaultPoint(first,second,'machines',[secondPoint])
  assert.equal(both[0],first[0]);assert.equal(both[1].point,secondPoint)
  assert.equal(applyDefaultPoint(both,selection,'machines',[point('newer',12)]),both)
})

test('default operation prefers the original platform while keeping platform alternatives available',()=>{
  const candidate=point('cross-platform',11,{platformName:'HyperV',allowedOperations:['StartViVMInstantRecovery','StartHvVMInstantRecovery']})
  assert.equal(suggestedOperation(candidate,'instant-vm'),'StartHvVMInstantRecovery')
  assert.equal(candidate.allowedOperations.length,2)
})
