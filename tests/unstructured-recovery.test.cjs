// Open Backup UI v1.2.0
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)
const {unstructuredKinds,unstructuredCapabilities,unstructuredPoints}=require('../lib/recovery/unstructured-catalog.ts')
const {unstructuredAction,unstructuredOptions,unstructuredCommand,buildUnstructuredStart}=require('../lib/recovery/unstructured.ts')
const {UnstructuredReceipts}=require('../lib/server/unstructured-receipts.ts')
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0')
const sourceKey='e'.repeat(64),cacheKey='a'.repeat(64),backupId=id(1),objectId=id(2),restorePointId=id(3),targetId=id(4),sid=id(5),taskId=id(6)
const selection={sourceKey,backupId,objectId,restorePointId},time='2026-11-10T09:00:00Z'
const rights=['ViewBackups','ViewInventory','ViewTasks','StartEntireVmRestore','ViewBackupObjects','ViewRestorePoints','BrowseFlr','StartFlrRestore','DownloadFlrItem','RestoreFlrItem','RestoreGuestFiles','StartUnstructuredDataInstantRecovery','RestoreEntireFileShare','PerformInstantFileShareRecovery','RollbackFileShare','RestoreEntireBucket','RollbackObjectStorge','PerformRestoreToOriginal','BrowseFLRUnstructuredData','UnstructuredDataFlrSearchFor','CopyUnstructuredDataFlrItem','RestoreFileShareFiles','UnmountUnstructuredDataFLRVolumes','RestoreObjects']
const operations=['NasFileLevelRestore','NasEntireRestore','NasRollback','NasInstantRecovery','NasObjectStorageFileLevelRestore','NasObjectStorageEntireRestore','NasObjectStorageRollback'].map(operation=>({operation,enabled:true}))
const pager=data=>({data,pagination:{skip:0,total:data.length}})
const row={id:restorePointId,name:'Archive',objectId,backupId,fileServerId:targetId,itemIconType:'CifsServer',platformName:'UnstructuredData',operations}
const p={id:restorePointId,name:'Archive',backupId,platformName:'UnstructuredData',creationTime:time,allowedOperations:['StartFlrRestore']}
function context(t,kind='SMBShare'){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unstructured-test-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}))
  const ctx={sourceKey,cacheKey,secret:'fixtures',receipts:new UnstructuredReceipts(dir),posts:[]}
  const object={id:objectId,name:'Archive',type:'Directory',platformName:'UnstructuredData',fileServerId:targetId,backupId}
  const sibling={...object,id:id(20),fileServerId:id(22)}
  ctx.privateSend=async url=>url.endsWith('/permissions')?{permissions:rights}:pager([row,{...row,id:id(21),objectId:sibling.id,fileServerId:sibling.fileServerId}])
  ctx.send=async(url,options={})=>{
    const route=url.split('?')[0]
    if(route.endsWith('/objects'))return pager([object,sibling])
    if(route.endsWith('/unstructuredDataServers'))return pager([{id:targetId,name:'Source',type:kind},{id:id(22),name:'Sibling',type:'NFSShare'}])
    if(route.endsWith('/restorePoints'))return pager([{...p,id:id(21)},p])
    if(route.includes('/restorePoints/'))return {...p,id:route.split('/').at(-1)}
    ctx.posts.push([route,options])
    if(route.endsWith('/flr/unstructuredData'))return {sessionId:sid}
    if(route.endsWith('/instantRecovery/unstructuredData'))return pager([{id:sid}])
    return {id:sid}
  }
  return ctx
}
const launch=(kind,settings={})=>unstructuredCommand.parse({action:'start',kind,requestId:id(51),...selection,...settings})
test('multi-share copy uses explicit native object/point pairs and suppresses foreign or unauthorized workloads',async t=>{
  const ctx=context(t)
  const points=await unstructuredPoints(ctx.send,objectId,backupId,ctx.privateSend)
  assert.deepEqual(points.data.map(x=>x.id),[restorePointId]);assert.equal(points.complete,false)
  await assert.rejects(unstructuredOptions(ctx,{...selection,restorePointId:id(21)}),/no longer/)
  assert.deepEqual(unstructuredCapabilities(row,'AzureBlob',new Set(rights)),['object-files','object-entire','object-rollback'])
  assert.deepEqual(unstructuredCapabilities({...row,itemIconType:'EntraIdAuditLog'},'SMBShare',new Set(rights)),[])
  assert.deepEqual(unstructuredCapabilities(row,'AmazonS3',new Set()),[])
  assert.ok(!unstructuredCapabilities({...row,tenantName:'managed'},'NFSShare',new Set(rights)).includes('nas-instant'))
})
test('all seven launches use the native endpoint and reviewed point, with separate rollback and explicit Instant publication access',async t=>{
  const ctx=context(t)
  const options=await unstructuredOptions(ctx,selection)
  for(const kind of unstructuredKinds){
    const sourceType=kind.startsWith('object-')?'AmazonS3':'SMBShare'
    const opt={...options,kinds:unstructuredCapabilities(row,sourceType,new Set(rights)),sourceType}
    const input=launch(kind,{confirmOverwrite:true,owner:'Test User'})
    const plan=buildUnstructuredStart(input,opt)
    if(kind.endsWith('files')){assert.deepEqual(plan.body,{restorePointId});assert.match(plan.path,/flr\/unstructuredData$/)}
    else if(kind==='nas-instant'){assert.deepEqual(plan.body.restoreOptions,[{restorePointId,permissions:{owner:'Test User',permissionType:'DenyEveryone',permissionScope:[]}}]);assert.ok(plan.body.autoSelectMountServers)}
    else{assert.equal(plan.body.restorePointId,restorePointId);assert.equal(plan.path.endsWith('objectStorage'),kind.startsWith('object-'))
      if(kind.endsWith('rollback'))assert.deepEqual(plan.body.restoreOptions,{rollback:true})}
  }
  assert.throws(()=>buildUnstructuredStart(launch('nas-rollback'),options),/Confirm the overwrite/)
  assert.throws(()=>buildUnstructuredStart(launch('nas-entire',{overwriteMode:'Overwrite'}),options),/Confirm the overwrite/)
  assert.throws(()=>buildUnstructuredStart(launch('nas-entire'),{...options,originalAllowed:false}),/no longer/)
  assert.throws(()=>buildUnstructuredStart(launch('nas-files'),{...options,point:{...p,malwareStatus:'Suspicious'}}),/malware/)
  assert.throws(()=>buildUnstructuredStart(launch('nas-instant',{owner:'A',permissionType:'AllowSelected'}),options),/permissions/)
  const request=launch('nas-files'),a=await unstructuredAction(ctx,request),b=await unstructuredAction(ctx,request)
  assert.equal(a.id,sid);assert.deepEqual(a,b);assert.equal(ctx.posts.length,1)
  const status=(source=sourceKey,principal=cacheKey,kind='nas-files',requestId=request.requestId)=>ctx.receipts.launchStatus(source,principal,requestId,kind)
  assert.deepEqual(await status(),{phase:'accepted',sessionId:sid})
  for(const foreign of [await status('1'.repeat(64)),await status(sourceKey,'2'.repeat(64)),await status(sourceKey,cacheKey,'object-files'),
    await status(sourceKey,cacheKey,'nas-files',id(99))])assert.deepEqual(foreign,{phase:'unknown'})
  assert.equal(ctx.posts.length,1)
  await assert.rejects(unstructuredAction(ctx,launch('nas-entire')),/different recovery/)
})
test('mounted item recovery binds task progress and versions to the authorized source/session, and replays a committed receipt',async t=>{
  const ctx=context(t),requests=[],mounted='/api/v1/backupBrowser/flr/unstructuredData/'+sid
  const read=ctx.send
  ctx.send=async(url,o={})=>{
    if(url===mounted)return {sessionId:sid,properties:{pathSeparator:'/'},sourceProperties:{backupId}}
    if(url.startsWith('/api/v1/inventory')||url.startsWith('/api/v1/backups'))return read(url,o)
    requests.push([url,o])
    if(url.endsWith('/restorePoints'))return pager([{id:restorePointId,creationTime:time}])
    if(url.endsWith('/search'))return {id:taskId,type:'FlrSearch',state:'Starting'}
    if(url.endsWith('/restore')||url.endsWith('/copyTo'))return {id:taskId,type:'FlrRestore',state:'Starting'}
    if(url.includes('/tasks/'))return {id:taskId,type:'FlrSearch',state:'Stopped',result:'Success'}
    return {items:[{name:'a',location:'/root',type:'File',versionsCount:2}],pagination:{total:1}}
  }
  const run=(action,opts={})=>unstructuredAction(ctx,unstructuredCommand.parse({sourceKey,sessionId:sid,action,...opts}))
  const status=await run('status')
  assert.equal(status.pathSeparator,'/');assert.equal(status.actions.includes('versions'),false)
  const search=await run('search',{query:'*.txt'});assert.ok(search.taskKey)
  assert.equal((await run('results',{taskId,taskKey:search.taskKey})).total,1)
  assert.equal((await run('task',{taskId,taskKey:search.taskKey})).state,'Stopped')
  await assert.rejects(run('task',{taskId,taskKey:'wrong'}))
  const opts={requestId:id(80),path:'/root/a'}
  const receipt=await run('restore',opts);assert.equal(receipt.taskId,taskId)
  assert.deepEqual(await run('restore',opts),receipt)
  const writes=requests.filter(([u])=>u.endsWith('/restore'));assert.equal(writes.length,1)
  assert.deepEqual(writes[0][1].body.sourcePath,['/root/a']);assert.equal('restoreMode' in writes[0][1].body,false)
  await assert.rejects(run('restore',{...opts,requestId:id(81),toDateTime:time}),/required restore point/)
  await assert.rejects(run('copy',{...opts,requestId:id(85),toDateTime:time,destinationId:targetId,targetPath:'/out'}),/required restore point/)
  await assert.rejects(run('versions',{path:'/root/a'}),/required restore point/)
  assert.equal(requests.filter(([u])=>u.endsWith('/restore')||u.endsWith('/copyTo')).length,1,'Historical selection must not silently submit the mounted point')
  await assert.rejects(run('copy',{requestId:id(82),path:'/root/a',destinationId:id(99),targetPath:'/out'}),/destination/)
  const copy=await run('copy',{requestId:id(83),sourcePaths:['/root/a','/other/b'],destinationId:targetId,targetPath:'/srv/ reports '})
  assert.equal(copy.taskId,taskId)
  const copyWrite=requests.find(([u])=>u.endsWith('/copyTo'))
  assert.equal(copyWrite[1].body.unstructuredDataServerId,targetId)
  assert.equal(copyWrite[1].body.path,'/srv/ reports ','Preserve the exact native destination folder, including spaces')
  assert.equal('restoreMode' in copyWrite[1].body,false,'A browse mounted by restorePointId must keep that point, not force LatestPoint')
  assert.equal('toDateTime' in copyWrite[1].body,false)
  await run('restore',{requestId:id(84),sourcePaths:['mnt|backup|dashboards|file.json']})
  const ordinaryRestore=requests.filter(([u])=>u.endsWith('/restore')).at(-1)[1].body
  assert.deepEqual(ordinaryRestore.sourcePath,['mnt|backup|dashboards|file.json'])
  assert.equal('restoreMode' in ordinaryRestore,false)
  assert.equal('toDateTime' in ordinaryRestore,false)
})
