const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const {test}=require('node:test'),assert=require('node:assert/strict')
const {loadVbrSearch,loadVbmSearch}=require('../lib/search/load.ts')
const {searchIndex,searchable}=require('../lib/search/model.ts')
const {SearchCache}=require('../lib/search/cache.ts')
const {searchPlatforms}=require('../lib/search/client.ts')
const {TopologyRequestError}=require('../lib/topology/load.ts')
const {VbmRequestError}=require('../lib/vbm-dashboard/load.ts')
const {readCacheScope}=require('../lib/server/read-cache-scope.ts')
const {loadPreview}=require('../lib/search/preview.ts')
const {readRecents,rememberResult,recentResult}=require('../lib/search/recent.ts')
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`
const vbrPage=data=>({data,pagination:{total:data.length}}),vbmPage=results=>({results,limit:500,totalCount:results.length})
const empty=(patch={})=>({items:[],warnings:[],complete:true,fetchedAt:'2026-10-26T12:00:00Z',...patch})
const response=(patch={})=>({results:[],total:0,warnings:[],fetchedAt:'2026-10-26T12:00:00Z',...patch})
const signal=()=>new AbortController().signal
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no});return {promise,resolve,reject}}

test('workload copies collapse into one result with distinct job identity and safe navigation',async()=>{
  const index=await loadVbrSearch(async path=>vbrPage(path.includes('/repositories/') ? [] : path.includes('/jobs/') ? [{id:id(1),name:'AD-DNS backup',type:'Backup'}] : [
    {id:id(1),name:'AD-DNS & primary',backupId:id(2),platformName:'VMware'},
    {id:id(1),name:'AD-DNS & primary',backupId:id(3),path:'Offsite/AD-DNS'},
  ]))
  const matches=searchIndex(index,'ad-dns')
  assert.equal(matches.total,2);assert.equal(new Set(matches.results.map(row=>row.key)).size,2)
  const object=matches.results.find(row=>row.type==='VBR Workload'),url=new URL(object.url,'http://localhost')
  assert.match(object.description,/2 backup copies/);assert.equal(url.searchParams.get('objectId'),id(1))
  assert.equal(url.searchParams.get('name'),'AD-DNS & primary');assert.equal(url.searchParams.has('backupId'),false)
  assert.equal(searchIndex(index,'offsite').total,1);assert.equal(searchIndex(index,id(3)).total,1)
  assert.equal('terms' in object,false)
})

test('VBR searches paginated inventory beyond the first API page without restore-point fan-out',async()=>{
  const reads=[]
  const index=await loadVbrSearch(async path=>{
    const url=new URL(path,'https://source.test');reads.push(url)
    if(url.pathname.includes('/jobs/') || url.pathname.includes('/repositories/'))return vbrPage([])
    assert.equal(url.pathname,'/api/v1/backupObjects')
    assert.equal(url.searchParams.get('orderColumn'),'Name');assert.equal(url.searchParams.get('orderAsc'),'true')
    assert.equal(url.searchParams.get('nameFilter'),'*')
    const skip=Number(url.searchParams.get('skip'))
    return {data:skip===0 ? Array.from({length:200},(_,i)=>({id:id(i),name:`VM ${i}`})):[{id:id(201),name:'Last machine'}],pagination:{total:201}}
  })
  assert.equal(searchIndex(index,'Last machine').total,1)
  assert.deepEqual(reads.filter(url=>url.pathname.includes('backupObjects')).map(url=>url.searchParams.get('skip')),['0','200'])
})

test('repeated records in a complete VBR page do not imply missing inventory or invented backup copies',async()=>{
  const object={id:id(1),name:'AD-DNS',path:'vcenter/cluster/AD-DNS'}
  const index=await loadVbrSearch(async path=>vbrPage(path.includes('/jobs/') || path.includes('/repositories/') ? []:[object,object,{...object,id:id(2),path:'other-host/AD-DNS'}]))
  assert.equal(index.complete,true);assert.equal(index.items.length,2)
  assert.notEqual(index.items[0].description,index.items[1].description)
  assert.doesNotMatch(index.items[0].description,/backup copies/)
})

test('VBR repeated pages are bounded and failed later pages keep earlier matches as partial',async()=>{
  for(const fail of [false,true]) {
    let pages=0
    const index=await loadVbrSearch(async path=>{
      if(path.includes('/jobs/') || path.includes('/repositories/'))return vbrPage([])
      if(pages++ && fail)throw Error('network')
      return {data:[{id:id(1),name:'Still searchable'}],pagination:{total:200}}
    })
    assert.equal(pages,2);assert.equal(index.complete,false);assert.equal(searchIndex(index,'searchable').total,1)
  }
})

test('VBR partial failures remain explicit and complete failures or expired sessions reject',async()=>{
  const index=await loadVbrSearch(async path=>{if(path.includes('backupObjects'))throw new TopologyRequestError('denied',403);return vbrPage(path.includes('/repositories/') ? []:[{id:id(1),name:'Daily'}])})
  assert.equal(index.complete,false);assert.equal(searchIndex(index,'Daily').total,1);assert.match(index.warnings.join(' '),/workloads/)
  await assert.rejects(loadVbrSearch(async()=>{throw Error('network')}),error=>error.status===502)
  await assert.rejects(loadVbrSearch(async()=>{throw new TopologyRequestError('expired',401)}),error=>error.status===401)
})

test('Microsoft 365 links, opaque IDs, nested mailbox emails and object kinds are preserved',async()=>{
  const opaque='Tenant:Case&x=1?/#',reads=[]
  const index=await loadVbmSearch(async path=>{
    const url=new URL(path,'https://source.test');reads.push(url.pathname)
    if(url.pathname==='/v8/Jobs')return vbmPage([{id:id(1),name:'Daily tenant backup'}])
    if(['/v8/ProtectedUsers','/v8/ProtectedGroups'].includes(url.pathname))return vbmPage([{id:opaque,displayName:'Person & team',organizationId:id(2),mailboxes:[{id:'mail',email:'person@example.test'}]}])
    return vbmPage([])
  })
  assert.equal(index.items.find(row=>row.type==='VB365 Job').url,`/vbm/jobs/${id(1)}/sessions`)
  const matches=searchIndex(index,'PERSON@EXAMPLE.TEST');assert.equal(matches.total,2)
  assert.notEqual(matches.results[0].key,matches.results[1].key)
  for(const item of matches.results){const url=new URL(item.url,'http://localhost');assert.equal(url.pathname,'/vbm/protected-items/restore-points');assert.equal(url.searchParams.get('id'),opaque);assert.equal(url.searchParams.get('name'),'Person & team')}
  assert.equal(reads.length,6);assert.ok(reads.every(path=>!path.includes('RestorePoints')))
})

test('Microsoft 365 pagination retains same IDs in different organizations and limits concurrency',async()=>{
  let active=0,peak=0
  const index=await loadVbmSearch(async path=>{
    active++;peak=Math.max(active,peak);await new Promise(resolve=>setImmediate(resolve))
    try {
      const url=new URL(path,'https://source.test')
      if(url.pathname!=='/v8/ProtectedUsers')return vbmPage([])
      const offset=Number(url.searchParams.get('offset'))
      return {results:[{id:'shared-id',displayName:'User',organizationId:id(offset+1)}],limit:1,totalCount:2,offset}
    }finally{active--}
  })
  assert.equal(index.items.length,2);assert.equal(new Set(index.items.map(row=>row.key)).size,2);assert.ok(peak<=3)
})

test('Microsoft 365 partial failures preserve jobs, while expired authentication stays actionable',async()=>{
  const index=await loadVbmSearch(async path=>{if(path.includes('ProtectedSites'))throw new VbmRequestError('denied',403);return vbmPage(path.includes('/Jobs') ? [{id:id(1),name:'Daily'}]:[])})
  assert.equal(index.complete,false);assert.equal(searchIndex(index,'Daily').total,1);assert.match(index.warnings.join(' '),/Read access denied/)
  await assert.rejects(loadVbmSearch(async()=>{throw Error('network')}),error=>error.status===502)
  await assert.rejects(loadVbmSearch(async()=>{throw new VbmRequestError('expired',401)}),error=>error.status===401)
})

test('name matches rank ahead of incidental metadata and all query words must match',()=>{
  const item=(key,name,extra)=>({key,id:key,name,type:'VBR Job',url:'/vbr/jobs/'+key,description:'',terms:searchable([name,extra])})
  const index=empty({items:[item('a','A different job','daily'),item('b','Daily copy','offsite'),item('c','Daily','')]})
  assert.deepEqual(searchIndex(index,' DAILY ').results.map(row=>row.key),['c','b','a'])
  assert.deepEqual(searchIndex(index,'offsite DAILY').results.map(row=>row.key),['b'])
  assert.equal(searchIndex(index,'d').total,0);assert.equal(searchIndex(index,'daily',1).total,3);assert.equal(searchIndex(index,'daily',1).results.length,1)
})

test('cache reuses even empty inventories, expires and isolates credentials and sources',async()=>{
  let now=0,calls=0;const cache=new SearchCache(()=>now),load=async()=>{calls++;return empty()}
  const key=readCacheScope('https://a.test','token',{id:'a',username:'u',password:'one'})
  await cache.read(key,load,signal());await cache.read(key,load,signal());assert.equal(calls,1)
  await cache.read(readCacheScope('https://a.test','token',{id:'a',username:'u',password:'two'}),load,signal());assert.equal(calls,2)
  await cache.read(readCacheScope('https://b.test','token',{id:'b',username:'u',password:'one'}),load,signal());assert.equal(calls,3)
  now=300001;await cache.read(key,load,signal());assert.equal(calls,4)
})

test('partial inventories expire quickly and failed builds are never cached',async()=>{
  let now=0,calls=0;const cache=new SearchCache(()=>now),load=async()=>{calls++;return empty({complete:false,warnings:['Unavailable']})}
  await cache.read('a',load,signal());now=14999;await cache.read('a',load,signal());assert.equal(calls,1)
  now=15001;await cache.read('a',load,signal());assert.equal(calls,2)
  await assert.rejects(cache.read('b',async()=>{throw new TopologyRequestError('expired',401)},signal()))
  assert.equal((await cache.read('b',async()=>empty(),signal())).complete,true)
})

test('concurrent searches share an inventory build and a cancelled leader cannot poison its follower',async()=>{
  const cache=new SearchCache(),work=deferred();let calls=0
  const first=cache.read('a',async()=>{calls++;return work.promise},signal())
  const second=cache.read('a',async()=>{calls++;return empty()},signal())
  work.resolve(empty());assert.equal(await first,await second);assert.equal(calls,1)
  const controller=new AbortController(),cancelled=deferred()
  const leader=cache.read('b',()=>cancelled.promise,controller.signal)
  const follower=cache.read('b',async()=>empty({fetchedAt:'new'}),signal())
  controller.abort();cancelled.resolve(empty())
  await assert.rejects(leader,error=>error.name==='AbortError');assert.equal((await follower).fetchedAt,'new')
})

test('cache bounds retained source inventories',async()=>{
  const cache=new SearchCache(Date.now,2);let firstCalls=0
  const first=async()=>{firstCalls++;return empty()}
  await cache.read('a',first,signal());await cache.read('b',async()=>empty(),signal());await cache.read('c',async()=>empty(),signal())
  await cache.read('a',first,signal());assert.equal(firstCalls,2)
})

test('manual refresh rebuilds the selected inventory while concurrent refreshes coalesce',async()=>{
  const cache=new SearchCache(),work=deferred();let calls=0
  await cache.read('selected',async()=>empty(),signal())
  const first=cache.read('selected',async()=>{calls++;return work.promise},signal(),true)
  const second=cache.read('selected',async()=>{calls++;return empty()},signal(),true)
  work.resolve(empty({fetchedAt:'refreshed'}))
  assert.equal((await first).fetchedAt,'refreshed');assert.equal(await first,await second);assert.equal(calls,1)
})

test('fast platforms publish before slow platforms and failures do not hide successful matches',async()=>{
  const slow=deferred(),published=[]
  const pending=searchPlatforms('AD & DNS',['vbr','vb365'],signal(),(platform,value)=>published.push({platform,value}),async path=>{
    assert.equal(new URL(path,'http://localhost').searchParams.get('q'),'AD & DNS')
    return path.startsWith('/api/vbr/') ? response({results:[{key:'one'}]}):slow.promise
  })
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(published.length,1);assert.equal(published[0].platform,'vbr');assert.equal(published[0].value.status,'ready')
  slow.reject(Error('Reconnect Microsoft 365'));await pending
  assert.equal(published[1].value.status,'error');assert.match(published[1].value.message,/Reconnect/)
})

test('stale search responses and errors are ignored after cancellation',async()=>{
  const old=deferred(),controller=new AbortController(),published=[]
  const pending=searchPlatforms('old',['vbr'],controller.signal,(platform,value)=>published.push(value),()=>old.promise)
  controller.abort()
  await searchPlatforms('new',['vbr'],signal(),(platform,value)=>published.push(value),async()=>response({results:[{key:'new'}]}))
  old.resolve(response({results:[{key:'old'}]}));await pending
  assert.equal(published.length,1);assert.equal(published[0].data.results[0].key,'new')
  await searchPlatforms('old',['vbr'],controller.signal,()=>assert.fail('aborted error published'),async()=>{throw Error('old error')})
})

test('type filtering happens before the result limit and name typos are a labeled fallback',()=>{
  const item=(key,name,type,extra='')=>({key,id:key,name,type,url:'/local',description:'',terms:searchable([name,extra])})
  const index=empty({items:[...Array.from({length:25},(_,i)=>item(`job${i}`,`Daily job ${i}`,'VBR Job')),item('repo','Daily repository','VBR Repository'),item('mail','Exchange protection','VB365 Job','offsite')]})
  assert.equal(searchIndex(index,'daily',20,'repositories').results[0].key,'repo')
  const fuzzy=searchIndex(index,'exchnage');assert.equal(fuzzy.total,1);assert.equal(fuzzy.results[0].approximate,true)
  assert.equal(searchIndex(index,'offiste').total,0);assert.equal(searchIndex(index,'ex').results[0].approximate,undefined)
  index.items.push(item('exact','exchnage','VBR Job'));assert.deepEqual(searchIndex(index,'exchnage').results.map(row=>row.key),['exact'])
})

test('repository indexing includes capacity signals and does not infer unavailable health',async()=>{
  const index=await loadVbrSearch(async path=>vbrPage(path.includes('/repositories/') ? [{id:id(1),name:'Low space',capacityGB:100,freeGB:10,isOnline:true},{id:id(2),name:'Unknown'}]:[]))
  assert.equal(index.items[0].signal.tone,'danger');assert.equal(index.items[0].facts.find(f=>f.label==='Space used').value,'90.0%')
  assert.equal(index.items[1].signal.tone,'neutral');assert.equal(index.items[1].facts.find(f=>f.label==='Free space').value,'Not reported')
  assert.equal(searchIndex(index,'space').results[0].url,`/vbr/infrastructure/repositories/${id(1)}`)
})

test('job evidence distinguishes last result from current activity and never exposes config secrets',async()=>{
  const index=await loadVbmSearch(async path=>vbmPage(path.startsWith('/v8/Jobs?') ? [{id:id(1),name:'Mail',lastStatus:'Failed',lastRun:'2026-10-26T10:00:00Z',password:'private',isEnabled:false}]:[]))
  const result=searchIndex(index,'mail').results[0]
  assert.equal(result.signal.tone,'danger');assert.equal(result.facts.find(f=>f.label==='Enabled').value,'No')
  assert.doesNotMatch(JSON.stringify(result),/private|password|terms|detail/)
})

test('workload preview reads only selected points and preserves unknown dates and security evidence',async()=>{
  const item={key:'vbr:workload:'+id(1),id:id(1),name:'AD',type:'VBR Workload',url:'/local',description:'VM',terms:'ad',facts:[]},paths=[]
  const result=await loadPreview(async path=>{paths.push(path);return vbrPage([
    {id:'p1',backupId:id(2),creationTime:'2026-10-26T10:00:00Z',malwareStatus:'Suspicious'},
    {id:'p2',backupId:id(3),creationTime:'2030-01-01T00:00:00Z'},
  ])},item,'old',Date.parse('2026-10-26T12:00:00Z'))
  assert.equal(paths.length,1);assert.ok(paths[0].startsWith(`/api/v1/backupObjects/${id(1)}/restorePoints?`))
  assert.equal(result.result.signal.label,'Security review needed');assert.equal(result.result.facts[0].value,'2026-10-26T10:00:00Z')
  assert.equal(result.result.facts.find(f=>f.label==='Flagged points observed').value,'1');assert.equal(result.warnings.length,2)
  assert.doesNotMatch(JSON.stringify(result),/within.*RPO|terms|detail/)
})

test('partial point collection does not claim an authoritative total',async()=>{
  const item={key:'vbr:workload:'+id(1),id:id(1),name:'AD',type:'VBR Workload',url:'/local',description:'VM',terms:'ad'}
  const result=await loadPreview(async()=>({data:[{id:'p',backupId:id(2)}],pagination:{total:2}}),item,'old')
  assert.equal(result.complete,false);assert.equal(result.result.facts.find(f=>f.label==='Restore points observed').value,'1+')
  assert.match(result.warnings.join(' '),/partial/)
})

test('Microsoft 365 preview scopes opaque IDs and excludes foreign tenants and unknown deletion states',async()=>{
  const item={key:'vb365:item:opaque',id:'Tenant:User&x=1?/#',name:'User',type:'VB365 Item',url:'/local',description:'',terms:'user',detail:{objectType:'User',organizationId:id(1)}}
  const result=await loadPreview(async path=>{
    const url=new URL(path,'https://source.test');assert.equal(url.searchParams.get('userId'),item.id);assert.equal(url.searchParams.get('organizationId'),id(1))
    assert.equal(url.searchParams.get('limit'),'100')
    return vbmPage([{id:'one',organizationId:id(1),isDeleted:false,backupTime:'2026-10-26T10:00:00Z',repositoryId:id(3)},
      {id:'foreign',organizationId:id(2),isDeleted:false},{id:'unknown',organizationId:id(1)}])
  },item,'old',Date.parse('2026-10-26T12:00:00Z'))
  assert.equal(result.complete,false);assert.equal(result.result.facts.find(f=>f.label==='Retained points observed').value,'1+')
  assert.equal(result.result.facts.find(f=>f.label==='Repositories observed').value,'1+')
  assert.match(result.warnings.join(' '),/outside.*organization/)
})

test('an unavailable Microsoft 365 preview keeps unknown counts instead of zero',async()=>{
  const item={key:'vb365:item:opaque',id:'opaque',name:'User',type:'VB365 Item',url:'/local',description:'',terms:'user',detail:{objectType:'User'}}
  const result=await loadPreview(async()=>{throw new VbmRequestError('denied',403)},item,'old')
  assert.equal(result.result.facts.find(f=>f.label==='Retained points observed').value,'Unknown')
  assert.equal(result.result.signal.tone,'neutral');assert.equal(result.complete,false)
})

test('repository preview verifies identity and reports configuration without exporting credentials',async()=>{
  const item={key:'vbr:repository:'+id(1),id:id(1),name:'Repository',type:'VBR Repository',url:'/local',description:'',terms:'repository'}
  const result=await loadPreview(async path=>{assert.equal(path,`/api/v1/backupInfrastructure/repositories/${id(1)}`);return {id:id(1),type:'LinuxHardened',repository:{makeRecentBackupsImmutableDays:7},credentials:{password:'secret'}}},item,'old')
  assert.equal(result.result.facts.find(f=>f.label==='Immutable retention').value,'7 days');assert.doesNotMatch(JSON.stringify(result),/secret|credentials/)
  await assert.rejects(loadPreview(async()=>({id:id(2)}),item,'old'),/identity/)
})

test('recent history is bounded, deduplicated and cannot supply navigation URLs or stale health',()=>{
  const item={key:'vbr:job:'+id(1),id:id(1),name:'Job',type:'VBR Job',url:'javascript:alert(1)',signal:{label:'Success'},facts:[{password:'secret'}]}
  const list=rememberResult([item,item],item)
  assert.deepEqual(list,[{key:item.key,name:'Job',type:'VBR Job'}])
  assert.equal(recentResult(list[0]).url,'');assert.equal(recentResult(list[0]).lazy,true)
  assert.equal(readRecents([{...item,key:'vb365:bad'},{...item,type:'Unknown'}]).length,0)
  assert.equal(readRecents(Array.from({length:9},(_,i)=>({...item,key:`vbr:job:${i}`}))).length,6)
})
