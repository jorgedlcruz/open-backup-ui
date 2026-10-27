const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const {test}=require('node:test'),assert=require('node:assert/strict')
const m=require('../lib/vbm-protected/model.ts'),{loadInventory,loadDetail,pointsFor}=require('../lib/vbm-protected/load.ts'),{VbmRequestError}=require('../lib/vbm-dashboard/load.ts')
const now=new Date('2026-10-22T12:00:00Z'),id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`
const obj=(patch={})=>({...m.objectSchema.parse({id:'Tenant:CaseSensitive:object',displayName:'User One',organizationId:id(1),mailboxes:[{id:'mail',email:'user@example.com',isArchive:false}],oneDrives:[],sites:[],...patch}),type:patch.type || 'User'})
const point=(patch={})=>m.pointSchema.parse({id:'two-concatenated-uuids',organizationId:id(1),repositoryId:id(2),jobId:id(3),backupTime:'2026-10-22T10:00:00Z',isDeleted:false,isExchange:true,isSharePoint:false,isOneDrive:false,isTeams:false,isCopy:false,isLongTermCopy:false,...patch})
const ev=(data,patch={})=>({data,available:true,complete:true,...patch}),page=data=>({results:data,limit:500})
const sum=(points,patch)=>m.summary(ev(points,patch),now.getTime())
const read=async path=>{const url=new URL(path,'https://source.test');if(url.pathname==='/v8/Organizations')return page([{id:id(1),name:'Tenant'}]);if(url.pathname==='/v8/ProtectedUsers')return page([obj()]);if(url.pathname==='/v8/RestorePoints')return page([point()]);if(url.pathname.startsWith('/v8/ProtectedUsers/'))return obj();return page([])}
test('schemas preserve opaque IDs and all protected components, strip unrelated fields',()=>{
  const object=m.objectSchema.parse({...obj(),password:'secret',sites:[{id:'site',url:'https://example.com',displayName:'Site'}]})
  assert.equal(object.id,'Tenant:CaseSensitive:object');assert.equal(object.mailboxes[0].email,'user@example.com');assert.equal(object.sites[0].url,'https://example.com');assert.equal(object.password,undefined)
  assert.equal(m.pointSchema.parse({...point(),_links:{self:'not trusted'},sizeBytes:999}).sizeBytes,undefined)
})
test('identity keeps users and groups with the same source ID distinct',()=>{
  assert.notEqual(m.objectKey(obj()),m.objectKey(obj({type:'Group'})))
  assert.notEqual(m.objectKey(obj()),m.objectKey(obj({organizationId:id(9)})))
})
test('restore links preserve composite IDs and special characters in the M365 route',()=>{
  const object=obj({id:'Tenant:ID&x=1?/#',displayName:'A & B'}),url=new URL(m.restoreHref(object),'http://localhost')
  assert.equal(url.pathname,'/vbm/protected-items/restore-points');assert.equal(url.searchParams.get('id'),object.id);assert.equal(url.searchParams.get('name'),'A & B')
})
test('count excludes deleted and unknown-deletion records',()=>{
  const result=sum([point(),point({id:'deleted',isDeleted:true}),point({id:'unknown',isDeleted:null})])
  assert.equal(result.count,1);assert.equal(result.deleted,1);assert.equal(result.unknownDeletion,1);assert.equal(m.countLabel(result),'1+')
})
test('empty complete history differs from unavailable and partial history',()=>{
  assert.equal(m.coverage(sum([])),'No restore points')
  assert.equal(m.coverage(sum([],{available:false,complete:false})),'Unknown')
  assert.equal(m.coverage(sum([],{complete:false})),'Unknown')
  assert.equal(m.countLabel(sum([],{available:false,complete:false})),'Unknown')
  assert.equal(m.countLabel(sum([],{complete:false})),'0+')
})
test('future and invalid times never imply a healthy backup',()=>{
  for(const backupTime of ['tomorrow','2026-10-23T12:00:00Z',null])assert.equal(m.freshness(sum([point({backupTime})]),24,now.getTime()),'Unknown')
})
test('partial history can confirm a fresh point but cannot claim stale evidence',()=>{
  assert.equal(m.freshness(sum([point()],{complete:false}),24,now.getTime()),'Within threshold')
  assert.equal(m.freshness(sum([point({backupTime:'2026-10-19T12:00:00Z'})],{complete:false}),24,now.getTime()),'Unknown')
  assert.equal(m.freshness(sum([point({backupTime:'2026-10-19T12:00:00Z'})]),24,now.getTime()),'Outside threshold')
})
test('freshness threshold is inclusive and supports minutes',()=>{
  const value=sum([point()]);assert.equal(m.freshness(value,2,now.getTime()),'Within threshold');assert.equal(m.freshness(value,1/60,now.getTime()),'Outside threshold')
})
test('unknown flags do not become primary copies; all content flags survive',()=>{
  assert.equal(m.copyKind(point({isCopy:null})),'Not reported');assert.equal(m.copyKind(point({isLongTermCopy:true,isCopy:true})),'Archive')
  assert.deepEqual(m.content(point({isOneDrive:true,isSharePoint:true})),['Exchange','SharePoint','OneDrive'])
})
test('scoped point reads encode opaque IDs, paginate short pages and deduplicate',async()=>{
  const offsets=[],objectId='Tenant:User&scope=x',reader=async path=>{const url=new URL(path,'https://source.test');assert.equal(url.searchParams.get('userId'),objectId);assert.equal(url.searchParams.get('organizationId'),id(1));const offset=Number(url.searchParams.get('offset'));offsets.push(offset);return offset===0 ? {results:[point()],limit:1,_links:{next:{href:'https://untrusted.test'}}}:{results:[point({id:'next'})],limit:500}}
  const result=await pointsFor(reader,'User',objectId,id(1));assert.deepEqual(offsets,[0,1]);assert.equal(result.data.length,2);assert.equal(result.complete,true)
})
test('point read excludes evidence from a different organization',async()=>{
  const result=await pointsFor(async()=>page([point(),point({id:'other',organizationId:id(9)})]),'User','opaque',id(1))
  assert.equal(result.data.length,1);assert.equal(result.complete,false)
})
test('a failed later page preserves earlier points as partial',async()=>{
  let calls=0;const result=await pointsFor(async()=>{if(calls++)throw new VbmRequestError('failed',500);return {results:[point()],_links:{next:{href:'next'}}}},'User','opaque')
  assert.equal(result.data.length,1);assert.equal(result.complete,false);assert.equal(result.available,true)
})
test('authentication failures remain actionable rather than empty success',async()=>{
  await assert.rejects(()=>loadInventory(async()=>{throw new VbmRequestError('expired',401)},'source',now),error=>error.status===401)
})
test('inventory preserves typed objects, actual counts and zero-sized storage',async()=>{
  const data=await loadInventory(async path=>path.includes('/usedRepositories') ? page([{repositoryId:id(2),localCacheUsedSpaceBytes:0,objectStorageUsedSpaceBytes:'1024',usedSpaceBytes:1024,isAvailable:true}]):read(path),'source',now)
  assert.equal(data.objects.data.length,1);assert.equal(data.objects.data[0].summary.count,1);assert.equal(data.objects.data[0].summary.latest,point().backupTime)
  assert.equal(data.usage[0].evidence.data[0].localCacheUsedSpaceBytes,0);assert.equal(data.usage[0].evidence.data[0].objectStorageUsedSpaceBytes,1024)
})
test('one unavailable category does not discard other protected objects',async()=>{
  const data=await loadInventory(async path=>path.startsWith('/v8/ProtectedSites') ? Promise.reject(new VbmRequestError('denied',403)):read(path),'source',now)
  assert.equal(data.objects.data.length,1);assert.equal(data.objects.complete,false);assert.match(data.warnings.join(' '),/Read access denied/)
})
test('all category failures return an actionable error',async()=>{
  await assert.rejects(()=>loadInventory(async path=>path.startsWith('/v8/Protected') ? Promise.reject(new VbmRequestError('denied',403)):read(path),'source',now),error=>error.status===502)
})
test('large inventory bounds restore-point fan-out and preserves uninspected objects',async()=>{
  let requests=0,active=0,peak=0
  const data=await loadInventory(async path=>{active++;peak=Math.max(active,peak);await new Promise(resolve=>setImmediate(resolve));try {if(path.startsWith('/v8/ProtectedUsers?'))return page(Array.from({length:202},(_,i)=>obj({id:`object:${i}`})));if(path.startsWith('/v8/RestorePoints?')){requests++;return page([])}return read(path)}finally{active--}},'source',now)
  assert.equal(requests,200);assert.equal(data.objects.data.length,202);assert.equal(data.objects.data[201].summary.available,false);assert.ok(peak<=4)
})
test('object filters combine issues, types, organizations, repositories and nested addresses',async()=>{
  const data=await loadInventory(read,'source',now),filters={...m.emptyFilters,query:'user@example.com',types:['User'],organizations:[id(1)],repository:id(2),issue:'available'}
  assert.equal(m.filterObjects(data,filters,24,now.getTime()).length,1);assert.equal(m.filterObjects(data,{...filters,issue:'stale'},24,now.getTime()).length,0)
  assert.equal(m.filterObjects(data,{...filters,types:['Team']},24,now.getTime()).length,0)
})
test('detail keeps all points and supports multi-content matching',async()=>{
  const data=await loadDetail(async path=>path.startsWith('/v8/RestorePoints?') ? page([point({isOneDrive:true}),point({id:'gone',isDeleted:true})]):read(path),'source','User',obj().id,now)
  assert.equal(data.object.id,obj().id);assert.equal(data.points.data.length,2);assert.equal(data.summary.count,1)
  const filters={query:'',content:['OneDrive'],repository:'all',kind:'Primary',state:'Retained'};assert.equal(m.filterPoints(data,filters).length,1)
})
test('failed object lookup does not discard scoped restore points',async()=>{
  const data=await loadDetail(async path=>path.startsWith('/v8/ProtectedUsers/') ? Promise.reject(new VbmRequestError('missing',404)):read(path),'source','User','opaque',now)
  assert.equal(data.object,null);assert.equal(data.points.data.length,1);assert.ok(data.warnings.length)
})
test('invalid IDs and object types are rejected before reads',async()=>{
  let reads=0;for(const value of ['', '..', '\n', 'x'.repeat(2049)])await assert.rejects(()=>loadDetail(async()=>{reads++;return {}},'source','User',value,now))
  await assert.rejects(()=>loadDetail(async()=>{reads++;return {}},'source','Other','valid',now));assert.equal(reads,0)
})

test('storage totals separate shared cache and object data from overlapping used-space figures',async()=>{
  const data=await loadInventory(async path=>path.includes('/usedRepositories') ? page([{repositoryId:id(2),localCacheUsedSpaceBytes:100,objectStorageUsedSpaceBytes:900,usedSpaceBytes:1000}]):read(path),'source',now)
  assert.equal(m.storageSummary(data,[]).total,1000);assert.equal(m.storageSummary(data,[]).complete,true)
  assert.equal(m.storageSummary(data,[id(9)]).total,null)
  data.usage[0].evidence.data[0].objectStorageUsedSpaceBytes=null
  assert.equal(m.storageSummary(data,[]).total,100);assert.equal(m.storageSummary(data,[]).complete,false)
})
test('unknown storage never turns into zero and safe zeros remain visible',async()=>{
  const data=await loadInventory(read,'source',now);assert.equal(m.storageSummary(data,[]).total,null)
  data.usage[0].evidence.data=[{repositoryId:id(2),localCacheUsedSpaceBytes:0,objectStorageUsedSpaceBytes:0}]
  assert.equal(m.storageSummary(data,[]).total,0)
})
