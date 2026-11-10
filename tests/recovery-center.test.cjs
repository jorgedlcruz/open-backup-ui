// Open Backup UI v1.0.2
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file)
const {loadRecoverySnapshot,recoveryPageQuery}=require('../lib/recovery-center/load.ts')
const {recoveryRows,selectRecoveryRows,defaultGridFilters}=require('../lib/recovery-center/model.ts')
const {mountPaths}=require('../lib/activity/model.ts')
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const source='a'.repeat(64),date='2026-11-09T12:00:00.000Z',session=(n,type,state='Working')=>({id:id(n),name:'test '+n,
  sessionType:type,creationTime:date,state,platformName:'VMware'})
const page=(data,skip=0,total=data.length)=>({data,pagination:{skip,total}})

test('an interrupted Explorer handoff stays distinct from a native restore session for the same VM',()=>{
  const workload='AD-DNS-001'
  const older={...session(9,'ApplicationLevelRestore','Stopped'),name:workload,result:{result:'Success'}}
  const receipt={requestId:id(51),sourceKey:source,operation:'BrowseActiveDirectory',workload,phase:'unknown'}
  const [native,...rest]=recoveryRows(source,[older],[],[],[receipt])
  assert.equal(native.sessionId,id(9));assert.deepEqual(rest,[])
  const request={...receipt,kind:'activeDirectory',requestStatus:'pending',createdAt:date}
  const [server]=recoveryRows(source,[],[],[],[],[request])
  assert.equal(server.category,'pending');assert.match(server.href,/provider=ad/)
  assert.equal(recoveryRows(source,[older],[],[],[receipt],[{...request,requestStatus:'ready',sessionId:id(9)}]).length,1)
  const [checking]=recoveryRows(source,[],[],[],[{...receipt,phase:'starting',explorerStage:'checking'}])
  assert.equal(checking.state,'Checking with VBR')
  assert.equal(checking.category,'pending')
  const accepted=recoveryRows(source,[older],[],[],[{...receipt,phase:'accepted',sessionId:id(9)}])
  assert.equal(accepted.length,1)
})

test('uses native recovery-only history filters and carries snapshot offsets across every upstream page',async()=>{
  const entries=Array.from({length:503},(_,i)=>session(i+1,i%2?'RestoreVm':'ApplicationLevelRestore'))
  const calls=[]
  const read=async path=>{
    const u=new URL(path,'https://source.invalid'),skip=Number(u.searchParams.get('skip'))
    if(u.pathname!=='/api/v1/sessions')return page([])
    const types=u.searchParams.getAll('typeFilter')
    for(const type of ['BackupJob','ConfigurationBackup','ReplicaJob','SureBackup','RepositoryMaintenance'])assert.ok(!types.includes(type))
    for(const type of ['RestoreVm','QuickMigration','FileLevelRestore','ApplicationLevelRestore','Failover','InstantDiskRecovery','AdForestRestore','EntraIdRestore'])assert.ok(types.includes(type))
    calls.push(u.searchParams.get('createdBeforeFilter'));return page(entries.slice(skip,skip+500),skip,entries.length)
  }
  const first=await loadRecoverySnapshot(read,undefined,{skip:0},new Date(date))
  const rest=await loadRecoverySnapshot(read,undefined,recoveryPageQuery.parse({skip:first.nextSkip,sourceKey:source,mode:first.mode,before:first.before}))
  assert.deepEqual(calls,[date,date]);assert.equal(rest.nextSkip,null);assert.equal(first.history.length+rest.history.length,503)
  assert.equal(recoveryPageQuery.safeParse({skip:500}).success,false)
})

test('older sources and over-broad native filters never leak ordinary jobs; keeps mount-only and partial availability explicit',async()=>{
  const records=[session(1,'BackupJob'),session(2,'InstantRecovery'),session(3,'ReplicaJob'),session(4,'AdForestRestore')]
  const read=async(path,rev)=>{
    const u=new URL(path,'https://source.invalid')
    if(u.pathname.endsWith('/sessions')){
      if(rev!=='1.3-rev1')throw Error('Unsupported revision')
      assert.equal(u.searchParams.has('typeFilter'),false);return page(records)
    }
    if(u.pathname===mountPaths.vSphere)return page([{id:id(15),sessionId:id(9),vmName:'external VM',state:'Mounted'}])
    return page([])
  }
  const feed=await loadRecoverySnapshot(read,async()=>{throw Error('Not available')})
  assert.deepEqual(feed.history.map(r=>r.id),[id(2),id(4)])
  assert.ok(feed.warnings.includes('Mounted recoveries'))
  const rows=recoveryRows(source,records,feed.mounts,[],[])
  assert.equal(rows.length,3)
  const mount=rows.find(r=>r.name==='external VM')
  assert.equal(mount.category,'ready');assert.equal(mount.href,'/vbr/recovery-center/'+id(9)+'?sourceKey='+source+'&mount='+id(15)+'&kind=vSphere')
})

test('queued, actionable, active, uncertain and terminal states have distinct filters and session links',()=>{
  const jobs=[session(1,'RestoreVm','WaitingSlot'),session(2,'RestoreVm'),{...session(3,'RestoreVm','Stopped'),result:{result:'Success'}},
    {...session(4,'ApplicationLevelRestore'),name:'Microsoft SQL Server items browsing (DATABASE-01)'},session(5,'ApplicationLevelRestore'),
    {...session(6,'InstantRecovery','Stopped'),result:{result:'Failed'}}]
  const batch={id:id(20),sourceKey:source,createdAt:date,items:[
    {objectId:id(50),name:'Queued VM',operation:'StartViVMInstantRecovery',status:'queued'},
    {objectId:id(51),name:'Started VM',operation:'StartEntireVmRestore',status:'accepted',sessionId:id(2)},
    {objectId:id(52),name:'Unconfirmed VM',operation:'StartEntireVmRestore',status:'unknown'},
    {objectId:id(53),name:'Awaiting native history',operation:'StartEntireVmRestoreHyperV',status:'accepted',sessionId:id(8)}]}
  const launch={requestId:id(30),sourceKey:source,operation:'StartViVMInstantRecovery',workload:'New VM',createdAt:date,phase:'starting'}
  const rows=recoveryRows(source,jobs,[],[batch,{...batch,sourceKey:'another'}],[launch,{...launch,requestId:id(31),phase:'accepted',sessionId:id(2)},
    {...launch,requestId:id(32),phase:'unknown',sourceKey:'another'}])
  assert.equal(rows.length,10);assert.equal(rows.filter(r=>r.sessionId===id(2)).length,1)
  assert.ok(rows.find(r=>r.sessionId===id(2)).batchHref.endsWith(id(20)+'?sourceKey='+source))
  assert.ok(rows.find(r=>r.name==='Queued VM').href.includes('/batches/'))
  assert.ok(rows.find(r=>r.name==='New VM').href.includes('/preparing?request='+id(30)))
  assert.ok(rows.find(r=>r.name==='Awaiting native history').href.includes('/'+id(8)+'?sourceKey='))
  const select=filter=>selectRecoveryRows(rows,{...defaultGridFilters,...filter},'name',true,'en',s=>s,Date.parse(date))
  assert.deepEqual(select({quick:'pending'}).map(r=>r.name),['New VM','Queued VM','test 1'])
  assert.equal(select({quick:'ready'})[0].sessionId,id(4));assert.equal(select({quick:'active'}).length,2)
  assert.equal(select({quick:'attention'}).length,2);assert.equal(select({quick:'completed'}).length,1)
  assert.deepEqual(select({types:['ApplicationLevelRestore'],search:'DATABASE-01'}).map(r=>r.sessionId),[id(4)])
  assert.deepEqual(select({platforms:['HyperV']}).map(r=>r.sessionId),[id(8)])
})
