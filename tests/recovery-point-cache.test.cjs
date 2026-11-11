// Open Backup UI v1.2.0
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)
const {readObjectRestorePointWindow:window,readObjectRestorePoints,restorePointCacheMs}=require('../lib/restore-points/cached-collection.ts')
const {scopedRecoveryCache}=require('../lib/recovery/catalog-cache.ts')
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0')
const makeRows=(count,start=0)=>Array.from({length:count},(_,i)=>({id:id(start+i+1000),backupId:id(1),creationTime:new Date(Date.UTC(2026,10,10,0,0,-i)).toISOString(),allowedOperations:['StartEntireVmRestore']}))
function api(count){
  const state={rows:makeRows(count),calls:[],failure:null,unknownTotal:false}
  state.read=async path=>{
    const url=new URL(path,'https://test.invalid'),skip=Number(url.searchParams.get('skip')),limit=Number(url.searchParams.get('limit'))
    state.calls.push([skip,limit])
    if(state.failure)throw state.failure
    const data=state.rows.slice(skip,skip+limit)
    return {data,pagination:{skip,...(!state.unknownTotal&&{total:state.rows.length})}}
  }
  return state
}
test('first calendar reads 200, extensions coalesce and a reopened calendar retains its loaded depth',async()=>{
  const a=api(653),get=opts=>window(a.read,'window-extensions','vm',opts)
  const first=await get()
  assert.equal(first.data.length,200);assert.equal(first.complete,true);assert.equal(first.hasMorePoints,true);assert.equal(first.pointTotal,653)
  assert.deepEqual(a.calls,[[0,200]])
  const [second,twin,third]=await Promise.all([get({pointLimit:400}),get({pointLimit:400}),get({pointLimit:600})])
  assert.equal(second.data.length,400);assert.equal(twin.data.length,400);assert.equal(third.data.length,600)
  assert.deepEqual(a.calls,[[0,200],[200,200],[400,200]])
  const reopened=await get();assert.equal(reopened.data.length,600);assert.equal(reopened.pointLimit,600)
  reopened.data[0].name='client enrichment';assert.equal((await get()).data[0].name,undefined)
  const full=await readObjectRestorePoints(a.read,'window-extensions','vm')
  assert.equal(full.complete,true);assert.equal(full.data.length,653);assert.equal(new Set(full.data.map(p=>p.id)).size,653)
  assert.deepEqual(a.calls,[[0,200],[200,200],[400,200],[600,200]])
})
test('unknown totals, pinned old points and duplicate responses never invent completion or skip a page',async()=>{
  const a=api(353);a.unknownTotal=true
  const first=await window(a.read,'unknown-count','vm');assert.equal(first.hasMorePoints,true);assert.equal(first.pointTotal,undefined)
  const last=await window(a.read,'unknown-count','vm',{pointLimit:400})
  assert.equal(last.data.length,353);assert.equal(last.hasMorePoints,false);assert.equal(last.complete,true)
  const seeded=api(453),seed=seeded.rows[430].id
  const older=await window(seeded.read,'older-seed','vm',{restorePointId:seed})
  assert.ok(older.data.some(p=>p.id===seed));assert.equal(older.pointLimit,600)
  assert.deepEqual(seeded.calls,[[0,200],[200,200],[400,200]])
  await window(seeded.read,'older-seed','vm',{pointLimit:400});assert.equal(seeded.calls.length,3)
  const duplicate=api(400),read=async path=>{
    const result=await duplicate.read(path)
    if(duplicate.calls.at(-1)[0]===200)result.data=duplicate.rows.slice(0,200)
    return result
  }
  const partial=await window(read,'duplicate-pages','vm',{pointLimit:400})
  assert.equal(partial.complete,false);assert.equal(partial.data.length,200);assert.equal(new Set(partial.data.map(p=>p.id)).size,200)
})
test('30-minute expiry refreshes the retained depth atomically and failed refreshes keep a flagged snapshot',async()=>{
  const a=api(353),originalNow=Date.now;let now=originalNow()
  Date.now=()=>now
  try{
    const get=options=>window(a.read,'expiry-refresh','vm',options)
    const before=await get({pointLimit:400});assert.equal(a.calls.length,2)
    now+=restorePointCacheMs-1;await get();assert.equal(a.calls.length,2)
    a.rows=makeRows(353,5000);now+=2
    const refreshed=await get();assert.equal(refreshed.pointLimit,400);assert.equal(refreshed.data[0].id,a.rows[0].id);assert.equal(a.calls.length,4)
    assert.notEqual(before.pointsFetchedAt,refreshed.pointsFetchedAt)
    a.failure=Object.assign(Error('Gateway unavailable'),{status:502})
    const stale=await get({refresh:true})
    assert.equal(stale.stale,true);assert.equal(stale.complete,false);assert.deepEqual(stale.data,refreshed.data)
    assert.equal(stale.pointsFetchedAt,refreshed.pointsFetchedAt)
    a.failure=null;a.rows=makeRows(3,9000)
    const recovered=await get({refresh:true});assert.equal(recovered.complete,true);assert.equal(recovered.hasMorePoints,false)
    assert.equal(recovered.data.length,3);assert.equal(recovered.pointLimit,400)
  }finally{Date.now=originalNow}
})
test('authorization failures evict the caller scope and foreign backup rows fail closed',async()=>{
  const a=api(5),get=(scope,options)=>window(a.read,scope,'vm',options)
  await get('principal-one');await get('principal-two')
  a.failure=Object.assign(Error('Forbidden'),{status:403})
  await assert.rejects(get('principal-one',{refresh:true}),e=>e.status===403)
  await assert.rejects(get('principal-one'),e=>e.status===403)
  assert.equal((await get('principal-two')).data.length,5)
  a.failure=null
  await assert.rejects(window(a.read,'foreign-backup','vm',{backupId:id(999)}),/outside the selected backup/)
})
test('workload catalogs cache complete and verified partial results for 30 minutes and refresh explicitly',async()=>{
  const cache=scopedRecoveryCache(5,value=>({...value,complete:false,stale:true})),originalNow=Date.now
  let now=originalNow(),calls=0,mode='partial'
  Date.now=()=>now
  const read=async()=>{calls++;if(mode==='fail')throw Error('offline');if(mode==='deny')throw Object.assign(Error('denied'),{status:401});return {complete:mode!=='partial',data:[mode]}}
  try{
    const first=await cache('source/operator',read);assert.equal(first.complete,false)
    now+=29*60_000;assert.deepEqual(await cache('source/operator',read),first);assert.equal(calls,1)
    mode='complete';now+=60_001
    await cache('source/operator',read);assert.equal(calls,2)
    mode='fail';assert.equal((await cache('source/operator',read,true)).stale,true)
    mode='deny';await assert.rejects(cache('source/operator',read,true),e=>e.status===401)
    await assert.rejects(cache('source/operator',read),e=>e.status===401)
  }finally{Date.now=originalNow}
})
test('goal refresh describes only this caller’s visited windows and point refresh does not rescan workloads',async()=>{
  const {pickerPage}=require('../lib/recovery/picker-catalog.ts'),a=api(353),backup=id(1),object=id(2)
  let inventoryCalls=0,privateCalls=0
  const native={id:id(3),backupId:backup,objectId:object,name:'Server',platformName:'VMware',itemIconType:'Vm',operations:[{operation:'EntireVmRestoreToVi',enabled:true}]}
  const send=async url=>{
    privateCalls++
    if(url.endsWith('/permissions'))return {permissions:['ViewBackupObjects','ViewRestorePoints']}
    const data=url.includes('/objects')?[native]:[{id:backup,name:'Backup',platformName:'VMware',objectsCount:1}]
    return {data,pagination:{skip:0,total:data.length}}
  }
  const read=async url=>{
    if(url.includes('/restorePoints'))return a.read(url)
    inventoryCalls++
    if(url.includes('/backups/'+backup+'/objects'))return {data:[{id:object,name:'Server',type:'VM',platformName:'VMware',backupId:backup}],pagination:{skip:0,total:1}}
    if(url.includes('/inventory/unstructuredDataServers')||url.includes('/backups?'))return {data:[],pagination:{skip:0,total:0}}
    throw Error('unexpected '+url)
  }
  const request={view:'points',kind:'entire-vm',objectId:object,offset:0,limit:50,calendarZone:'UTC',calendarIndex:true}
  const get=(extra={},identity='visited-scope')=>pickerPage(read,send,identity,{...request,...extra})
  const first=await get();assert.equal(first.pointCount,200);assert.equal(first.hasMorePoints,true);assert.equal(first.complete,true)
  await get({pointLimit:400})
  const goals=await get({view:'goals',refresh:true})
  assert.deepEqual(goals.pointRefreshes,[{objectId:object,pointLimit:400,kind:'entire-vm',backupId:undefined}])
  const nativeBefore=privateCalls,inventoryBefore=inventoryCalls
  await get({refresh:true,pointLimit:400});assert.equal(privateCalls,nativeBefore);assert.equal(inventoryCalls,inventoryBefore)
  const other=await get({view:'goals',refresh:true},'another-visited-scope');assert.deepEqual(other.pointRefreshes,[])
})
