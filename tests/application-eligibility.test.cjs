// Open Backup UI v1.0.2
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)
const {attachApplications,verifyExplorerPoint}=require('../lib/recovery/application-eligibility.ts')
const {authorizeExplorerResume}=require('../lib/recovery/explorer-resume.ts')
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0')
const backupId=id(1),objectId=id(2),restorePointId=id(3),other=id(4),sessionId=id(5)
const permissions=['ViewBackupObjects','ViewRestorePoints','ViewTasks','StartExplorerForMsAd','StartExplorerForMsSql']
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
