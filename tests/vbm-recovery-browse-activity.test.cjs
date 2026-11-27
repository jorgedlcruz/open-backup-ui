// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const activity=require('../lib/vbm-recovery/browse-activity.ts')
const sid='11111111-1111-4111-8111-111111111111',scope='a'.repeat(64),key={scope,sessionId:sid}
const input={action:'Folder contents loaded',workload:'Exchange',resourceKind:'items',source:'backup.example',ownerId:'mailbox-id',parentId:'folder-id',itemCount:3,durationMs:25}
async function temporary(t){const prefix=path.join(os.tmpdir(),'open-backup-vbm-activity-'),base=await fsp.mkdtemp(prefix);t.after(async()=>{if(!path.resolve(base).startsWith(path.resolve(prefix)))throw Error('Unsafe temporary cleanup');await fsp.rm(base,{recursive:true,force:true})});return base}

const container=(kind,id,name,ownerId='mailbox-id',workload='Exchange')=>({id,kind,name,ownerId:kind==='owner'?undefined:ownerId,workload,isFolder:kind==='folder',selectable:false,raw:{name}})
const location=(overrides={})=>({sessionId:sid,workload:'Exchange',kind:'items',ownerId:'mailbox-id',parentId:'folder-id',scopeKind:'folder',offset:0,limit:100,...overrides})

test('location names come only from source containers and stay within source, session, owner and workload',()=>{
  const names=activity.createBrowseLocationCache()
  names.remember(scope,sid,[container('owner','mailbox-id','Alex'),container('folder','folder-id','Inbox'),container('folder','folder-id','Other Inbox','other-owner'),container('document','document-id','PRIVATE DOCUMENT')])
  assert.deepEqual(names.resolve(scope,location()),{objectName:'Alex',parentName:'Inbox'})
  assert.deepEqual(names.resolve(scope,location({ownerId:'other-owner'})),{parentName:'Other Inbox'})
  for(const value of [location({ownerId:'unknown'}),location({workload:'SharePoint'}),location({sessionId:randomUUID()})])assert.deepEqual(names.resolve(scope,value),{})
  assert.deepEqual(names.resolve('b'.repeat(64),location()),{})
  assert.deepEqual(names.resolve(scope,location({parentId:'document-id'})),{objectName:'Alex'})
  names.remember(scope,sid,[{...container('owner','email-only','user@example.test'),email:'user@example.test'}, {...container('owner','subject-only','PRIVATE SUBJECT'),raw:{subject:'PRIVATE SUBJECT',email:'user@example.test'}}])
  assert.deepEqual(names.resolve(scope,location({ownerId:'email-only',parentId:'root'})),{})
  assert.deepEqual(names.resolve(scope,location({ownerId:'subject-only',parentId:'root'})),{})
})

test('container cache is bounded, expires names, and does not guess ambiguous parent types',()=>{
  let now=Date.parse('2026-11-21T10:00:00Z');const names=activity.createBrowseLocationCache(()=>now)
  names.remember(scope,sid,Array.from({length:513},(_,i)=>container('folder',String(i),'Folder '+i)))
  assert.deepEqual(names.resolve(scope,location({parentId:'0'})),{})
  assert.equal(names.resolve(scope,location({parentId:'512'})).parentName,'Folder 512')
  names.remember(scope,sid,[container('folder','ambiguous','Folder'),container('library','ambiguous','Library')])
  assert.deepEqual(names.resolve(scope,location({parentId:'ambiguous',scopeKind:undefined})),{})
  assert.equal(names.resolve(scope,location({parentId:'ambiguous',scopeKind:'library'})).parentName,'Library')
  now+=24*60*60*1000+1
  assert.deepEqual(names.resolve(scope,location({parentId:'512'})),{})
  for(let i=0;i<129;i++)names.remember(i.toString(16).padStart(64,'0'),sid,[container('owner','mailbox-id','Object '+i)])
  assert.deepEqual(names.resolve('0'.repeat(64),location()),{})
})

test('local browse activity persists separately, isolates scope, and reads newest first',async t=>{
  const base=await temporary(t);let now=Date.parse('2026-11-21T10:00:00Z')
  const store=activity.createBrowseActivityStore(base,()=>now)
  assert.deepEqual(await store.read(key),{events:[],availability:'available'})
  assert.equal((await fsp.readdir(base)).length,0)
  assert.equal(await store.append(key,input),'available');now+=3000
  await store.append(key,{...input,parentId:'second-folder'})
  const restored=await activity.createBrowseActivityStore(base,()=>now).read(key)
  assert.equal(restored.availability,'available');assert.equal(restored.events.length,2);assert.equal(restored.events[0].parentId,'second-folder')
  assert.equal(restored.events[0].source,'backup.example');assert.equal(restored.events[0].actor,undefined)
  assert.deepEqual(await store.read({...key,scope:'b'.repeat(64)}),{events:[],availability:'available'})
})

test('parallel read receipts serialize and tree/grid duplicates are coalesced',async t=>{
  const store=activity.createBrowseActivityStore(await temporary(t),()=>Date.parse('2026-11-21T10:00:00Z'))
  await Promise.all(Array.from({length:20},(_,index)=>store.append(key,{...input,parentId:String(index)})))
  assert.equal((await store.read(key)).events.length,20)
  await Promise.all(Array.from({length:5},()=>store.append(key,{...input,parentId:'0'})))
  assert.equal((await store.read(key)).events.length,20)
  await Promise.all(Array.from({length:2},()=>store.append(key,{...input,parentId:'0',cached:true})))
  assert.equal((await store.read(key)).events.filter(event=>event.cached).length,2)
})

test('activity records are bounded and old events expire',async t=>{
  const base=await temporary(t),now=Date.parse('2026-11-21T10:00:00Z'),store=activity.createBrowseActivityStore(base,()=>now)
  await fsp.mkdir(path.join(base,scope))
  const event=(index,time=now-3000)=>({...input,id:randomUUID(),timestamp:new Date(time).toISOString(),parentId:String(index)})
  await fsp.writeFile(path.join(base,scope,sid+'.json'),JSON.stringify({version:1,scope,sessionId:sid,events:Array.from({length:500},(_,i)=>event(i))}))
  await store.append(key,{...input,parentId:'new'})
  let result=await store.read(key)
  assert.equal(result.events.length,500);assert.equal(result.events[0].parentId,'new');assert.ok(result.events.every(row=>row.parentId!=='0'))
  const later=activity.createBrowseActivityStore(base,()=>now+24*60*60*1000+1)
  result=await later.read(key);assert.equal(result.events.length,0)
})

test('unsafe scopes, extra fields, corrupt records and unavailable storage cannot become audit success',async t=>{
  const base=await temporary(t),store=activity.createBrowseActivityStore(base)
  assert.equal(await store.append({...key,scope:'../outside'},input),'unavailable')
  assert.equal(await store.append(key,{...input,userCode:'must-not-be-persisted'}),'unavailable')
  assert.deepEqual(await store.read(key),{events:[],availability:'unavailable'})
  await store.append(key,input)
  assert.equal((await store.read(key)).availability,'available')
  const file=path.join(base,scope,sid+'.json'),text=await fsp.readFile(file,'utf8')
  assert.ok(!text.includes('must-not-be-persisted'));assert.ok(!text.includes('userCode'))
  await fsp.writeFile(file,JSON.stringify({...JSON.parse(text),scope:'b'.repeat(64)}))
  assert.equal((await store.read(key)).availability,'unavailable')
  const blocked=path.join(base,'blocked');await fsp.writeFile(blocked,'file')
  const unavailable=activity.createBrowseActivityStore(blocked)
  assert.equal(await unavailable.append(key,input),'unavailable');assert.equal((await unavailable.read(key)).availability,'unavailable')
})

test('backend records successful source reads and cached revisits separately from Veeam events',async()=>{
  const {recoveryGet,recoveryPost}=require('../lib/vbm-recovery/load.ts'),{RecoveryError}=require('../lib/vbm-recovery/model.ts')
  const originalRecord=activity.recordBrowseActivity,originalRead=activity.readBrowseActivity,calls=[]
  const local={...input,id:randomUUID(),timestamp:new Date().toISOString()}
  activity.recordBrowseActivity=async(...args)=>{calls.push(args);return 'unavailable'}
  activity.readBrowseActivity=async()=>({events:[local],availability:'available'})
  let fail=false
  const context={scope,sourceName:'backup.example',execute:async resource=>{
    if(resource.endsWith('/'+sid))return {id:sid,type:'Vex',state:'Working'}
    if(resource.includes('/Events'))return {results:[{id:'source-event',message:'Restore session started'}]}
    if(fail)throw new RecoveryError('Unavailable source',504)
    return {results:[{id:'item-id',subject:'item-content-never-persisted'}]}
  }}
  try {
    const request={action:'browse',sessionId:sid,workload:'Exchange',ownerId:'mailbox-id',parentId:'folder-id',kind:'items'}
    const result=await recoveryGet(context,request)
    assert.equal(result.items.length,1);assert.equal(result.activityAvailability,'unavailable');assert.equal(calls.length,1)
    assert.ok(!JSON.stringify(calls[0]).includes('item-content-never-persisted'))
    assert.equal(calls[0][3],1)
    assert.ok(Number.isInteger(calls[0][7].sessionCheckMs));assert.ok(Number.isInteger(calls[0][7].sourceReadMs))
    await recoveryPost(context,{...request,action:'search',query:'private search text'})
    assert.equal(calls.length,2);assert.equal(calls[1][5],true)
    fail=true
    assert.deepEqual(await recoveryGet(context,request),result)
    await recoveryPost(context,{...request,action:'search',query:'private search text'})
    assert.deepEqual(calls.map(call=>call[6]),[false,false,true,true])
    await assert.rejects(()=>recoveryGet(context,{...request,offset:100}))
    await assert.rejects(()=>recoveryGet(context,{...request,limit:20}))
    await assert.rejects(()=>recoveryPost(context,{...request,action:'search',query:'another query'}))
    await assert.rejects(()=>recoveryPost(context,{...request,action:'search',query:'private search text',setId:'different-set'}))
    assert.equal(calls.length,4)
    assert.equal(calls[2][7].sourceReadMs,0)
    const failedTiming={}
    await assert.rejects(()=>recoveryGet({...context,browseTiming:failedTiming},{...request,offset:300}))
    assert.ok(Number.isInteger(failedTiming.sessionCheckMs));assert.ok(Number.isInteger(failedTiming.sourceReadMs))
    const session=await recoveryGet(context,{action:'session',sessionId:sid})
    assert.equal(session.browseCacheId,result.browseCacheId)
    assert.deepEqual(session.applicationActivity,[local]);assert.deepEqual(session.events,[{id:'source-event',message:'Restore session started'}])
    assert.equal(session.activityAvailability,'available')
    const deniedTiming={}
    await assert.rejects(()=>recoveryGet({...context,browseTiming:deniedTiming,execute:async()=>{throw new RecoveryError('Denied',403)}},request))
    assert.ok(Number.isInteger(deniedTiming.sessionCheckMs));assert.equal(deniedTiming.sourceReadMs,undefined)
  }finally{activity.recordBrowseActivity=originalRecord;activity.readBrowseActivity=originalRead}
})

test('cached pages respect the current source principal, validation failures, and observed session stops',async()=>{
  const {recoveryGet}=require('../lib/vbm-recovery/load.ts')
  const {RecoveryError}=require('../lib/vbm-recovery/model.ts')
  const id=randomUUID(),request={...location(),action:'browse',sessionId:id}
  let state='Working',denied=false,reads=0,checks=0
  const context={scope:randomUUID(),sourceName:'example.test',execute:async resource=>{
    if(resource.endsWith('/'+id)) {
      checks++
      if(denied)throw new RecoveryError('Unauthorized',403)
      return {id,type:'Vex',state}
    }
    reads++
    return {results:[]}
  }}
  const first=await recoveryGet(context,request)
  assert.ok(first.browseCacheId)
  assert.deepEqual(await recoveryGet(context,request),first)
  assert.equal(checks,2)
  assert.equal(reads,1)
  const other=await recoveryGet({...context,scope:randomUUID()},request)
  assert.notEqual(other.browseCacheId,first.browseCacheId)
  assert.equal(reads,2)
  denied=true
  await assert.rejects(recoveryGet(context,request),error=>error.status===403)
  denied=false
  assert.notEqual((await recoveryGet(context,request)).browseCacheId,first.browseCacheId)
  assert.equal(reads,3)
  state='Stopped'
  await assert.rejects(recoveryGet(context,request),error=>error.status===409)
  assert.equal(reads,3)
})

test('pages stay available throughout a live restore session even after a day without navigation',()=>{
  const {sessionBrowseCache,sessionContext,forgetBrowseSession}=require('../lib/vbm-recovery/store.ts')
  const id=randomUUID(),scope=randomUUID(),clock=Date.now
  const cache=sessionBrowseCache(scope,id)
  const abandonedId=randomUUID(),abandoned=sessionBrowseCache(scope,abandonedId)
  const empty={items:[],offset:0,nextOffset:0,hasMore:false}
  cache.pages.set('first',empty)
  try {
    const later=clock()+48*60*60*1000
    Date.now=()=>later
    sessionContext(scope,id)
    assert.equal(sessionBrowseCache(scope,id).id,cache.id)
    assert.equal(cache.pages.get('first'),empty)
    assert.notEqual(sessionBrowseCache(scope,abandonedId).id,abandoned.id)
    assert.equal(abandoned.closed,true)
  } finally {
    Date.now=clock
    forgetBrowseSession(scope,id)
    forgetBrowseSession(scope,abandonedId)
  }
})

test('a malformed item listing cannot turn into a cached empty folder',async()=>{
  const { recoveryGet }=require('../lib/vbm-recovery/load.ts')
  const id=randomUUID(),request={...location(),action:'browse',sessionId:id}
  let reads=0
  const context={scope:randomUUID(),sourceName:'backup.example',execute:async path=>{
    if(path.endsWith('/'+id))return {id,type:'Vex',state:'Working'}
    return ++reads===1 ? {} : {results:[{id:'restored-message-list'}]}
  }}
  await assert.rejects(recoveryGet(context,request),error=>error.status===502)
  assert.equal((await recoveryGet(context,request)).items.length,1)
  assert.equal((await recoveryGet(context,request)).items.length,1)
  assert.equal(reads,2)
})

test('failed and cancelled reads can be retried and a late page cannot revive a stopped session',async()=>{
  const {recoveryGet,recoveryPost}=require('../lib/vbm-recovery/load.ts')
  const {RecoveryError}=require('../lib/vbm-recovery/model.ts')
  const id=randomUUID(),request={...location(),action:'browse',sessionId:id}
  let resolvePage,started,waitForPage,fail=true,reads=0
  const context={scope:randomUUID(),sourceName:'example.test',execute:async resource=>{
    if(resource.endsWith('/'+id))return {id,type:'Vex',state:'Working'}
    if(resource.endsWith('/Stop'))return {}
    reads++
    if(fail)throw new RecoveryError('Transient read',504)
    started?.()
    return await waitForPage
  }}
  await assert.rejects(recoveryGet(context,request),error=>error.status===504)
  fail=false
  const controller=new AbortController()
  let pending=new Promise(resolve=>{started=resolve})
  waitForPage=new Promise(resolve=>{resolvePage=resolve})
  const cancelled=recoveryGet({...context,signal:controller.signal},request)
  await pending
  controller.abort()
  resolvePage({results:[{id:'old'}]})
  await assert.rejects(cancelled,error=>error.status===499)
  pending=new Promise(resolve=>{started=resolve})
  waitForPage=new Promise(resolve=>{resolvePage=resolve})
  const late=recoveryGet(context,request)
  await pending
  await recoveryPost(context,{action:'stop',sessionId:id})
  resolvePage({results:[{id:'late'}]})
  await assert.rejects(late,error=>error.status===409)
  await assert.rejects(recoveryGet(context,request),error=>error.status===409)
  assert.equal(reads,3)
})

test('a same-source stop releases every operator cache, while a denied session check forgets only its principal',async()=>{
  const {recoveryGet,recoveryPost}=require('../lib/vbm-recovery/load.ts')
  const {RecoveryError}=require('../lib/vbm-recovery/model.ts')
  for(const stopMethod of ['accepted','observed']) {
    const id=randomUUID(),request={...location(),action:'browse',sessionId:id}
    let denied=false,stopped=false
    function operator(name,origin) {
      return {scope:randomUUID(),sourceName:'vb.example',sourceOrigin:origin,execute:async resource=>{
        if(resource.endsWith('/'+id)) {
          if(name==='A'&&denied)throw new RecoveryError('Access denied',403)
          return {id,type:'Vex',state:name==='A'&&stopped?'Stopped':'Working'}
        }
        if(resource.endsWith('/Stop'))return {}
        return {results:[{id:name}]}
      }}
    }
    const a=operator('A','https://vb.example:4443'),b=operator('B','https://vb.example:4443'),other=operator('C','https://vb.example:4444')
    const [first,second,isolated]=await Promise.all([a,b,other].map(context=>recoveryGet(context,request)))
    assert.deepEqual([first,second,isolated].map(page=>page.items[0].id),['A','B','C'])
    assert.notEqual(first.browseCacheId,second.browseCacheId)
    denied=true
    await assert.rejects(recoveryGet(a,request),error=>error.status===403)
    denied=false
    assert.equal((await recoveryGet(b,request)).browseCacheId,second.browseCacheId)
    assert.notEqual((await recoveryGet(a,request)).browseCacheId,first.browseCacheId)
    if(stopMethod==='accepted')await recoveryPost(a,{action:'stop',sessionId:id})
    else {
      stopped=true
      await recoveryGet(a,{action:'sessionState',sessionId:id})
    }
    await assert.rejects(recoveryGet(b,request),error=>error.status===409)
    assert.deepEqual(await recoveryGet(other,request),isolated)
  }
})

test('opening an authenticated workspace skips all history reads and preserves the cache and operation identity',async()=>{
  const {recoveryGet}=require('../lib/vbm-recovery/load.ts')
  const {rememberSession}=require('../lib/vbm-recovery/store.ts')
  const {restoreAudit}=require('../lib/vbm-recovery/restore-audit.ts')
  const id=randomUUID(),parentSessionId=randomUUID(),requests=[],auditReads=[]
  const context={scope:randomUUID(),sourceName:'example.test',execute:async path=>{
    requests.push(path)
    assert.equal(path,'/v8/RestoreSessions/'+id)
    return {id,type:'Vex',state:'Working'}
  }}
  const original=restoreAudit.read
  restoreAudit.read=async(scope,sessionId)=>{auditReads.push(sessionId);return {availability:'available',entries:[{sessionId:id,browseSessionId:parentSessionId}]}}
  try {
    const input={action:'session',sessionId:id}
    const head=await recoveryGet(context,{...input,view:'workspace'})
    assert.equal(requests.length,1);assert.deepEqual(auditReads,[]);assert.ok(head.browseCacheId)
    assert.equal(head.events,undefined);assert.equal(head.restoreAudit,undefined)
    const operations=await recoveryGet(context,{...input,view:'operations'})
    assert.equal(requests.length,2);assert.deepEqual(auditReads,[id]);assert.equal(operations.session.parentSessionId,parentSessionId)
    assert.equal(operations.browseCacheId,head.browseCacheId);assert.equal(operations.events,undefined)
    rememberSession(context.scope,id,{parentSessionId})
    const known=await recoveryGet(context,{...input,view:'workspace'})
    assert.equal(known.session.parentSessionId,parentSessionId);assert.deepEqual(auditReads,[id])
    const other=await recoveryGet({...context,scope:randomUUID()},{...input,view:'workspace'})
    assert.notEqual(other.browseCacheId,head.browseCacheId);assert.equal(other.session.parentSessionId,undefined)
  }finally{restoreAudit.read=original}
})
