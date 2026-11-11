// Open Backup UI v1.2.0
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file)
const {vmBatchSchema,checkBatchInput,collide,prepareBatchRow}=require('../lib/recovery/vm-batch.ts'),{runVmBatch}=require('../lib/recovery/run-vm-batch.ts')
const {VbrRecoveryError}=require('../lib/recovery/error.ts'),{RestoreBatches}=require('../lib/server/restore-batches.ts')
const id=n=>'d0000000-0000-4000-8000-'+String(n).padStart(12,'0'),scope={sourceKey:'a'.repeat(64),cacheKey:'b'.repeat(64)}
function fixture(t,op='StartViVMInstantRecovery'){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vm-batch-'));t.after(()=>fs.rmSync(directory,{force:true,recursive:true}))
  let time=Date.now()
  const store=new RestoreBatches(directory,()=>time),calls=[],objects=new Map(),backupObjects=new Map(),points=new Map(),members=new Map(),results=new Map(),logs=[]
  const items=[1,2,3].map((n)=>{
    const objectId=id(n),pointId=id(n+10),backupId=id(20+n),name='vm-'+n
    objects.set(objectId,{id:objectId,name,objectId:'vm-'+(100+n),path:'vc.example\\DC\\'+name,platformName:'VMware',type:'VM',platformId:id(30)})
    backupObjects.set(backupId,[objectId])
    points.set(pointId,{id:pointId,backupId,name,allowedOperations:[op],platformName:'VMware',creationTime:'2026-11-10T12:00:00Z',malwareStatus:'Clean'})
    members.set(objectId,[{id:pointId,backupId}]);results.set(pointId,{id:id(n+40),sessionType:'InstantRecovery',state:'Starting'})
    return {objectId,name,draft:{sourceKey:scope.sourceKey,restorePointId:pointId,backupId,operation:op,mode:'OriginalLocation'}}
  })
  const batch=vmBatchSchema.parse({sourceKey:scope.sourceKey,batchId:id(60),items})
  const send=async(url,opts={})=>{calls.push({url,opts})
    if(opts.mutation){
      const value=results.get(opts.body.restorePointId)
      if(typeof value==='function')return value()
      if(value instanceof Error)throw value
      return value
    }
    const [pathname]=url.split('?'),[,idPart]=pathname.match(/\/backupObjects\/([^/]+)/)||[]
    const backupId=pathname.match(/^\/api\/v1\/backups\/([^/]+)\/objects$/)?.[1]
    if(backupId){
      const all=(backupObjects.get(backupId)||[]).map(id=>objects.get(id)),skip=Number(new URL(url,'http://vbr').searchParams.get('skip'))
      return {data:all.slice(skip,skip+200),pagination:{skip,total:all.length}}
    }
    if(pathname.endsWith('/restorePoints')){const data=members.get(idPart)||[];return {data,pagination:{skip:0,total:data.length}}}
    if(idPart)throw new VbrRecoveryError('Not found',404)
    if(url.includes('/restorePoints/'))return points.get(pathname.split('/').at(-1))
    throw Error('unexpected URL: '+url)
  }
  async function run(runner,db=store){return runVmBatch(db,scope,batch.batchId,runner,send,async(...args)=>logs.push(args))}
  return {batch,store,directory,send,run,calls,objects,backupObjects,points,members,results,logs,advance:()=>{time+=300000},writes:()=>calls.filter(c=>c.opts.mutation)}
}

test('mass recovery resolves exact backup collection IDs when standalone object details return 404',async t=>{
  const f=fixture(t),b=f.batch
  // Public backup collections may return child-backup IDs in their member rows.
  // Membership is established by the backup-scoped URL and exact point check.
  f.objects.get(id(1)).backupId=id(99)
  await assert.rejects(f.send('/api/v1/backupObjects/'+id(1)),error=>error.status===404)
  f.calls.length=0
  await f.run((await f.store.create(scope,b)).runner)
  const receipt=await f.store.get(scope,b.batchId)
  assert.deepEqual(receipt.items.map(i=>i.status),['accepted','accepted','accepted'])
  assert.equal(f.writes().length,3)
  assert.equal(f.calls.filter(c=>/^\/api\/v1\/backups\/[^/]+\/objects\?/.test(c.url)).length,3)
  assert.equal(f.calls.some(c=>/^\/api\/v1\/backupObjects\/[^/?]+$/.test(c.url)),false)
})

test('backup collection lookup never substitutes a same-name VM or bypasses denied access',async t=>{
  const f=fixture(t),row=f.batch.items[0]
  f.objects.get(id(2)).name=f.objects.get(id(1)).name
  f.backupObjects.set(row.draft.backupId,[id(2)])
  await assert.rejects(prepareBatchRow(f.send,scope.sourceKey,row),/could not be verified in this backup/)
  await assert.rejects(prepareBatchRow(async(url,opts)=>{
    if(url.includes('/objects?'))throw new VbrRecoveryError('Access denied',403)
    return f.send(url,opts)
  },scope.sourceKey,row),error=>error.status===403)
  assert.equal(f.writes().length,0)
})

test('backup object resolution follows pagination and refuses incomplete or ambiguous inventories',async t=>{
  const f=fixture(t),row=f.batch.items[0],requested=[]
  const paginated=async(url,opts)=>{
    if(!url.includes('/objects?'))return f.send(url,opts)
    const skip=Number(new URL(url,'http://vbr').searchParams.get('skip'));requested.push(skip)
    return {data:[f.objects.get(skip===0?id(2):id(1))],pagination:{skip,total:2}}
  }
  const ready=await prepareBatchRow(paginated,scope.sourceKey,row)
  assert.equal(ready.name,'vm-1');assert.deepEqual(requested,[0,1])
  for(const data of [[],[f.objects.get(id(1)),f.objects.get(id(1))]]){
    await assert.rejects(prepareBatchRow(async(url,opts)=>url.includes('/objects?')
      ?{data,pagination:{skip:0,total:2}}:f.send(url,opts),scope.sourceKey,row),/incomplete|could not be verified/)
  }
  await assert.rejects(prepareBatchRow(async(url,opts)=>url.includes('/objects?')
    ?{data:[f.objects.get(id(1))],pagination:{skip:1,total:1}}:f.send(url,opts),scope.sourceKey,row),/invalid selection list/)
  assert.equal(f.writes().length,0)
})
test('same scope/id reserves once before native writes, unrelated accounts cannot observe or resume, receipts survive process restart',async t=>{
  const f=fixture(t),b=f.batch;checkBatchInput(b,scope.sourceKey)
  const [a,c]=await Promise.all([f.store.create(scope,b),f.store.create(scope,b)]),runner=a.runner||c.runner
  assert.equal(Number(!!a.runner)+Number(!!c.runner),1)
  const seen=await f.store.get(scope,b.batchId);assert.ok(seen.items.every(i=>i.status==='queued'))
  await f.run(runner)
  const next=new RestoreBatches(f.directory),result=await next.get(scope,b.batchId)
  assert.deepEqual(result.items.map(i=>i.sessionId),[id(41),id(42),id(43)])
  assert.equal(f.writes().length,3);assert.ok(f.writes().every(c=>c.url==='/api/v1/restore/instantRecovery/vSphere/vm'&&c.opts.body.overwrite===false))
  assert.equal((await next.create(scope,b)).runner,undefined)
  assert.equal((await next.resume(scope,b.batchId)).runner,undefined)
  await assert.rejects(next.create(scope,{...b,items:b.items.slice(1)}),/different recovery/)
  const other={...scope,cacheKey:'c'.repeat(64)};assert.deepEqual(await next.list(other),[])
  await assert.rejects(next.get(other,b.batchId),/not found/)
  assert.equal((await next.list(scope)).length,1)
})
test('per-point validation completes before any write; exact public membership matters across backups and failed rows are never replayed',async t=>{
  const f=fixture(t,'StartEntireVmRestore'),b=f.batch
  f.members.set(id(2),[{id:id(12),backupId:id(21)}])
  await f.run((await f.store.create(scope,b)).runner)
  assert.equal(f.writes().length,0)
  assert.deepEqual((await f.store.get(scope,b.batchId)).items.map(i=>i.status),['notStarted','failed','notStarted'])
  await f.run((await f.store.resume(scope,b.batchId)).runner)
  assert.deepEqual(f.writes().map(c=>c.opts.body.restorePointId),[id(11),id(13)])
  assert.equal(f.logs.length,2);assert.equal(f.logs[0][1],id(41))
})
test('different point permissions or fresh malware status fail, duplicate object/point aliases or target names fail as a batch',async t=>{
  const f=fixture(t),b=f.batch
  const second=b.items[1],first=b.items[0]
  assert.throws(()=>checkBatchInput({...b,items:[first,{...second,objectId:first.objectId}]},scope.sourceKey),/one restore point/)
  assert.throws(()=>checkBatchInput({...b,items:[first,{...second,draft:{...second.draft,operation:'StartEntireVmRestore'}}]},scope.sourceKey),/one recovery method/)
  assert.throws(()=>checkBatchInput({...b,items:[{...first,draft:{...first.draft,operation:'StartHvVMInstantRecovery'}}]},scope.sourceKey),/Confirm the original/)
  assert.throws(()=>checkBatchInput(b,'f'.repeat(64)),/source changed/)
  f.objects.get(id(2)).objectId=f.objects.get(id(1)).objectId
  f.points.get(id(13)).malwareStatus='Infected'
  await f.run((await f.store.create(scope,b)).runner)
  assert.equal(f.writes().length,0)
  const receipt=await f.store.get(scope,b.batchId)
  assert.match(receipt.items[0].message,/one restore point/);assert.match(receipt.items[1].message,/one restore point/);assert.match(receipt.items[2].message,/malware/)
  const dest={platform:'vmware',manager:'vc',folder:'f1',name:'recovered'}
  assert.match(collide({sourceVm:'x',destination:dest},{sourceVm:'y',destination:{...dest,folder:''}}),/same destination/)
  assert.equal(collide({sourceVm:'x',destination:dest},{sourceVm:'y',destination:{...dest,manager:'other'}}),undefined)
})
test('uncertain and rejected submissions preserve separate outcomes and accepted IDs without inferential matching',async t=>{
  const f=fixture(t),b=f.batch
  f.results.set(id(12),new VbrRecoveryError('Target exists',409));f.results.set(id(13),{})
  await f.run((await f.store.create(scope,b)).runner)
  const result=await f.store.get(scope,b.batchId)
  assert.deepEqual(result.items.map(i=>i.status),['accepted','failed','unknown'])
  assert.equal(result.items[0].sessionId,id(41));assert.equal(result.items[2].sessionId,undefined)
  assert.equal((await f.store.resume(scope,b.batchId)).runner,undefined);assert.equal(f.writes().length,3)
})
test('crash recovery can resume untouched VMs while an in-flight submission remains unknown',async t=>{
  const f=fixture(t),b=f.batch,started=await f.store.create(scope,b)
  await f.store.update(scope,b.batchId,started.runner,r=>{r.rows[0].item.status='submitting'})
  f.advance()
  assert.deepEqual((await f.store.get(scope,b.batchId)).items.map(i=>i.status),['unknown','notStarted','notStarted'])
  const resumed=await f.store.resume(scope,b.batchId);await f.run(resumed.runner)
  assert.deepEqual(f.writes().map(c=>c.opts.body.restorePointId),[id(12),id(13)])
  assert.deepEqual((await f.store.get(scope,b.batchId)).items.map(i=>i.status),['unknown','accepted','accepted'])
})
test('an authorization or malware change between group review and individual submission prevents that native write',async t=>{
  const f=fixture(t),b=f.batch,reads=new Map()
  const send=async(url,opts)=>{
    const row=await f.send(url,opts)
    if(!/^\/api\/v1\/restorePoints\//.test(url))return row
    const n=reads.get(row.id)||0;reads.set(row.id,n+1)
    if(n&&row.id===id(11))return {...row,malwareStatus:'Infected'}
    if(n&&row.id===id(12))return {...row,allowedOperations:[]}
    return row
  }
  await runVmBatch(f.store,scope,b.batchId,(await f.store.create(scope,b)).runner,send,async()=>{})
  const receipt=await f.store.get(scope,b.batchId)
  assert.deepEqual(receipt.items.map(i=>i.status),['failed','failed','accepted'])
  assert.deepEqual(f.writes().map(c=>c.opts.body.restorePointId),[id(13)])
  assert.equal(receipt.items[2].pointTime,'2026-11-10T12:00:00Z')
})
test('custom destinations and collision keys use provider-resolved inventory, keeping the Instant Recovery write cache distinct',async t=>{
  const f=fixture(t),b=f.batch
  const native=type=>({platform:'VSphere',type,hostName:'vc.example',objectId:type+'-109',urn:'urn-'+type,name:'Resolved '+type})
  const ref=type=>({...native(type),objectId:undefined,name:'Client label'})
  const target={host:ref('Host'),folder:ref('Folder'),datastore:ref('Datastore'),vmName:'Alternate'}
  const [a,c]=await Promise.all([b.items[0],b.items[1]].map((row,i)=>prepareBatchRow(async(url,opts)=>{
    if(!url.startsWith('/api/v1/inventory/'))return f.send(url,opts)
    const type=opts.body.filter.items.find(item=>item.property==='type').value
    return {data:[native(type)],pagination:{total:1,count:1,skip:0,limit:200}}
  },scope.sourceKey,{...row,draft:{...row.draft,mode:'Customized',target:i?{...target,folder:{...target.folder,objectId:native('Folder').objectId}}:target}})))
  assert.equal(a.placement.targetHost,'Resolved Host')
  assert.equal(a.placement.targetFolder,'Resolved Folder')
  assert.equal(a.placement.writeCacheDatastore,'Resolved Datastore')
  assert.equal(a.placement.targetDatastore,undefined)
  assert.match(collide(a.identity,c.identity),/same destination/)
})
