// Open Backup UI v1.0.2
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)
const {attachApplications,verifyExplorerPoint}=require('../lib/recovery/application-eligibility.ts')
const {authorizeExplorerResume}=require('../lib/recovery/explorer-resume.ts')
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0')
const backupId=id(1),objectId=id(2),restorePointId=id(3),other=id(4),sessionId=id(5)
const permissions=['ViewBackupObjects','ViewRestorePoints','ViewTasks','StartExplorerForMsAd','StartExplorerForMsSql']
const {ExplorerLaunches}=require('../lib/server/explorer-launches.ts')
const {VbrRecoveryError}=require('../lib/recovery/error.ts')
const launchScope={sourceKey:'a'.repeat(64),principalKey:'b'.repeat(64),kind:'activeDirectory'}
const launchPoint={backupId,objectId,restorePointId}
function durableFixture(t){
  const path=require('node:path')
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'explorer-request-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const state={now:1_000_000,created:0,remembered:[],done:false}
  const reopen=()=>new ExplorerLaunches(dir,()=>state.now,async(...data)=>{state.remembered.push(data)})
  const send=async(path,options)=>{
    const base='/private-api/v1/backupBrowser/applicationItems/vead'
    if(path===base){
      assert.deepEqual(options,{method:'POST',mutation:true,body:{restorePointId}})
      state.created++
      return {id:other}
    }
    if(path==='/private-api/v1/tasks/'+other)return {id:other,type:'Common',state:state.done?'Stopped':'Working',result:state.done?'Success':'None'}
    assert.equal(path,base+'/'+other+'/result')
    return {id:sessionId}
  }
  return {state,send,reopen,store:reopen(),key:launchScope,req:id(50)}
}
test('Explorer launch reserves one immutable scoped UUID and reconciles the exact native task after restart',async t=>{
  const {store,reopen,state,send,key,req}=durableFixture(t)
  const owners=await Promise.all([store.reserve(key,req,launchPoint),store.reserve(key,req,launchPoint)])
  assert.deepEqual(owners.sort(),[false,true])
  await assert.rejects(store.reserve(key,req,{...launchPoint,objectId:other}),/another session/)
  const initial=await store.response(key,req,'test-key')
  assert.equal(initial.requestStatus,'starting')
  for(const otherKey of [{...key,principalKey:'c'.repeat(64)},{...key,sourceKey:'c'.repeat(64)}]){
    assert.equal((await store.response(otherKey,req,'test-key')).requestStatus,'missing')
    await assert.rejects(store.response(otherKey,req,'test-key',send,initial.pending),/another session/)
  }
  await Promise.all([store.submit(key,req,launchPoint,async()=>{},send),store.submit(key,req,launchPoint,async()=>{},send)])
  assert.equal(state.created,1)
  const next=reopen(), active=await next.response(key,req,'test-key',send,initial.pending)
  assert.equal(active.requestStatus,'pending')
  state.done=true
  const results=await Promise.all([next.response(key,req,'test-key',send),store.response(key,req,'test-key',send)])
  for(const r of results)assert.deepEqual(r,{sourceKey:key.sourceKey,requestId:req,requestStatus:'ready',sessionId,restorePointId,backupId,backupObjectId:objectId,application:'ActiveDirectory'})
  assert.equal(state.remembered.length,1)
  assert.equal(state.remembered[0][0].sessionId,sessionId)
  assert.equal(state.remembered[0][3],restorePointId)
})
test('a timed-out eligibility worker cannot submit after reporting that nothing was sent',async t=>{
  const {key,req,store,state,send}=durableFixture(t)
  await store.reserve(key,req,launchPoint)
  let release
  const verifying=new Promise(resolve=>{release=resolve})
  const worker=store.submit(key,req,launchPoint,()=>verifying,send)
  state.now+=6*60_000
  assert.equal((await store.response(key,req,'test-key')).requestStatus,'failed')
  release()
  await worker
  assert.equal(state.created,0)
  assert.equal(await store.reserve(key,req,launchPoint),false)
})
test('Recovery Center lists only the authenticated owner’s summaries and old pages cannot start an untracked Explorer',async t=>{
  const {isExplorerLaunchRequest,explorerLaunchRequest}=require('../lib/recovery/explorer-launch-request.ts')
  const {key,req,store,state,send}=durableFixture(t)
  const old={action:'start',sourceKey:key.sourceKey,backupObjectId:objectId,backupId,restorePointId}
  assert.equal(isExplorerLaunchRequest(old),true)
  await assert.rejects(explorerLaunchRequest(old,'activeDirectory',{...key,secret:'fixture'},send,send,()=>assert.fail('scheduled')),e=>e.status===409&&e.message==='This recovery form is out of date. Refresh Recovery Center before starting.')
  await store.reserve(key,req,launchPoint)
  await store.submit(key,req,launchPoint,async()=>{},send)
  state.done=true
  await store.response(key,req,'fixture',send)
  const [summary]=await store.list(key)
  assert.equal(summary.sessionId,sessionId)
  assert.equal(summary.requestStatus,'ready')
  assert.equal(summary.requestId,req)
  assert.ok(!('taskId' in summary)&&!('principalKey' in summary))
  assert.deepEqual(await store.list({...key,principalKey:'c'.repeat(64)}),[])
  assert.deepEqual(await store.list({...key,sourceKey:'c'.repeat(64)}),[])
})
test('lost native acknowledgements remain unknown and definitive rejections are preserved without another write',async t=>{
  const {key,store}=durableFixture(t)
  for(const [index,error,status] of [[1,new VbrRecoveryError('Gateway lost',502,true),'unknown'],[2,new VbrRecoveryError('Forbidden',403),'failed']]){
    const req=id(60+index)
    await store.reserve(key,req,launchPoint)
    let calls=0
    const reject=async()=>{calls++;throw error}
    await store.submit(key,req,launchPoint,async()=>{},reject)
    await store.submit(key,req,launchPoint,async()=>{},reject)
    assert.equal(calls,1)
    assert.equal((await store.response(key,req,'test-key',reject)).requestStatus,status)
  }
})
test('unavailable native task reads retain a safe, recoverable reference without claiming a failed launch',async t=>{
  const {key,req,store,state,send}=durableFixture(t)
  await store.reserve(key,req,launchPoint)
  await store.submit(key,req,launchPoint,async()=>{},send)
  const unavailable=async()=>{throw new VbrRecoveryError('Temporarily unavailable',503)}
  assert.equal((await store.response(key,req,'test-key',unavailable)).requestStatus,'pending')
  state.now+=11*60_000
  assert.equal((await store.response(key,req,'test-key',unavailable)).requestStatus,'unknown')
  await assert.rejects(store.response(key,req,'test-key',async()=>{throw new VbrRecoveryError('Forbidden',403)}),/Forbidden/)
  state.done=true
  assert.equal((await store.response(key,req,'test-key',send)).sessionId,sessionId)
  assert.equal(state.created,1)
})
function fixture({malwareStatus='Clean',member=restorePointId,archive=false,rights=permissions}={}) {
  const point={id:restorePointId,backupId,name:'VM1',platformName:'VMware',creationTime:'2026-01-01T00:00:00Z',allowedOperations:['StartFlrRestore'],malwareStatus}
  const rows=[{backupId,objectId,platformName:'VMware',repositoryType:archive?'ArchiveTier':'Disk',operations:[{operation:'ExploreForMsAd',enabled:false},{operation:'ExploreForMsSql',enabled:true}]}]
  return {send:async path=>{
    const u=new URL(path,'https://fixture.invalid')
    if(u.pathname.endsWith('/permissions'))return {permissions:rights,username:'Operator'}
    const data=u.pathname.endsWith('/objects')?rows:u.pathname.endsWith('/restorePoints')&&u.searchParams.get('backupObjectIdFilter')===objectId?[{id:member,backupId}]:[]
    return {data,pagination:{skip:0,total:data.length}}
  },pub:async()=>point,point}
}
test('calendar links only the point in the enabled SQL object, even with identical VM names',async()=>{
  const {send,point}=fixture(),decoy={...point,id:other}
  await attachApplications(send,[point,decoy])
  assert.deepEqual(point.applications,[{kind:'sql',objectId}]);assert.equal(decoy.applications,undefined)
  for(const opts of [{archive:true},{rights:['ViewBackupObjects','StartExplorerForMsSql']}]){
    const f=fixture(opts);await attachApplications(f.send,[f.point],objectId);assert.ok(!f.point.applications?.length)
  }
})
test('backup-wide selection resolves distinct VM IDs even for shared files and duplicate names',async()=>{
  const {pointSelection,recoveryPickerHref}=require('../lib/restore-points/recovery-selection.ts')
  const vmA=id(11),vmB=id(12),points=[restorePointId,other].map(pid=>({id:pid,backupId,name:'guest',allowedOperations:['StartEntireVmRestore']}))
  const memberships=new Map([[vmA,[points[0]]],[vmB,[points[1]]]])
  const send=async path=>{
    const u=new URL(path,'https://fixture.invalid')
    if(u.pathname.endsWith('/permissions'))return {permissions:['ViewBackupObjects','ViewRestorePoints']}
    const data=u.pathname.endsWith('/objects')?[vmA,vmB].map(objectId=>({objectId,backupId,itemIconType:'Vm'})):memberships.get(u.searchParams.get('backupObjectIdFilter'))
    return {data,pagination:{skip:0,total:data.length}}
  }
  await attachApplications(send,points)
  const select=point=>pointSelection({point,mapping:'confirmed',file:{objectIds:[vmA,vmB]}})
  const seeds=points.map(select)
  assert.deepEqual(seeds.map(s=>s.objectId),[vmA,vmB])
  const href=new URL(recoveryPickerHref('entire-vm','source',seeds),'https://fixture.invalid')
  assert.deepEqual(href.searchParams.getAll('point'),[vmA+'.'+backupId+'.'+restorePointId,vmB+'.'+backupId+'.'+other])
  memberships.set(vmB,points)
  await attachApplications(send,points)
  assert.equal(select(points[0]),undefined)
})
test('rechecks the exact object membership, provider and current malware status before launch',async()=>{
  const req={backupId,objectId,restorePointId}
  const f=fixture({malwareStatus:'Suspicious'})
  await assert.rejects(verifyExplorerPoint(f.send,f.pub,req,'sql'),/malware/)
  assert.equal((await verifyExplorerPoint(f.send,f.pub,{...req,reviewedMalwareStatus:'Suspicious'},'sql')).id,restorePointId)
  await assert.rejects(verifyExplorerPoint(f.send,f.pub,{...req,reviewedMalwareStatus:'Suspicious'},'activeDirectory'),/unavailable/)
  const wrong=fixture({member:other});await assert.rejects(verifyExplorerPoint(wrong.send,wrong.pub,req,'sql'),/unavailable/)
})
test('a native SQL browse session can only resume after matching the current user, live session and native provider',async()=>{
  const session={id:sessionId,sessionType:'ApplicationLevelRestore',state:'Working',name:'Microsoft SQL Server items browsing (VM1)',initiatedBy:'operator'}
  let kept=0
  const send=async path=>{if(path.endsWith('/permissions'))return {permissions,username:'Operator'};assert.equal(path,'/private-api/v1/restore/applicationItems/vesql/'+sessionId+'/keepAlive');kept++}
  await authorizeExplorerResume(async()=>session,send,sessionId,'sql')
  for(const s of [{...session,initiatedBy:'other'},{...session,state:'Stopped'},{...session,sessionType:'Backup'}])await assert.rejects(authorizeExplorerResume(async()=>s,send,sessionId,'sql'))
  assert.equal(kept,1)
})
test('native application launch preflight rereads a temporarily missing row and accepts explicit disabled capability without retry',async()=>{
  const f=fixture(),ids={backupId,objectId,restorePointId}
  let calls=0,disabled=false
  const send=async(p,...options)=>{
    if(!p.includes('/objects?'))return f.send(p,...options)
    calls++
    if(calls===1)return {data:[],pagination:{skip:0,total:0}}
    const page=await f.send(p,...options)
    if(disabled)page.data[0].operations=[]
    return page
  }
  await verifyExplorerPoint(send,f.pub,ids,'sql');assert.equal(calls,2)
  disabled=true;await assert.rejects(verifyExplorerPoint(send,f.pub,ids,'sql'),/unavailable/);assert.equal(calls,3)
})
