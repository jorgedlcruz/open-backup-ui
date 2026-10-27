const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const {test}=require('node:test'),assert=require('node:assert/strict')
const m=require('../lib/vbm-jobs/model.ts'),{loadJobs,loadSession}=require('../lib/vbm-jobs/load.ts'),{VbmRequestError}=require('../lib/vbm-dashboard/load.ts')
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`,now=new Date('2026-10-22T12:00:00Z')
const job=patch=>m.backupJobSchema.parse({id:id(1),name:'Backup',isEnabled:true,lastStatus:'Success',organizationId:id(4),repositoryId:id(5),backupType:'SelectedItems',schedulePolicy:{scheduleEnabled:true},...patch})
const session=patch=>m.backupSessionSchema.parse({id:id(2),jobId:id(1),creationTime:'2026-10-22T10:00:00Z',endTime:'2026-10-22T11:05:08Z',status:'Success',...patch})
const log=patch=>m.logSchema.parse({id:id(3),type:'Success',message:'Job finished',creationTime:'2026-10-22T10:00:00Z',...patch})
const page=data=>({results:data,limit:500}),ev=data=>({data,available:true,complete:true})
const read=async path=>{
  const url=new URL(path,'https://source.test')
  if(url.pathname===`/v8/Jobs/${id(1)}`)return job()
  if(url.pathname==='/v8/Jobs')return page([job()])
  if(url.pathname==='/v8/JobSessions')return page([session()])
  if(url.pathname===`/v8/JobSessions/${id(2)}`)return session()
  if(url.pathname.endsWith('/LogItems'))return page([log()])
  return page([])
}
test('schemas preserve previous session statistics and system fields without leaking unrelated fields',()=>{
  const row=session({proxyId:id(7),proxyPoolId:id(8),jobSessionConfigType:'Incremental',credentials:'secret',statistics:{readRateBytesPS:'0',transferredDataBytes:null,processedObjects:0}})
  assert.equal(row.proxyId,id(7));assert.equal(row.proxyPoolId,id(8));assert.equal(row.statistics.readRateBytesPS,0);assert.equal(row.statistics.transferredDataBytes,null);assert.equal(row.credentials,undefined)
  const policy=job({schedulePolicy:{backupWindowEnabled:false,periodicallyWindowEnabled:true,retryWaitInterval:'10'}}).schedulePolicy
  assert.equal(policy.backupWindowEnabled,false);assert.equal(policy.retryWaitInterval,10)
  assert.equal(log({_links:{self:{href:'https://elsewhere.test'}},usn:'2'})._links,undefined)
})
test('job filters combine health, multiple organizations, repository, type and text',()=>{
  const data={jobs:ev([job({name:'Exchange',lastStatus:'Warning',description:'Important accounts'}),job({id:id(9),organizationId:id(10)})]),organizations:ev([{id:id(4),name:'Tenant A'}]),repositories:ev([{id:id(5),name:'Wasabi'}])}
  const filters={query:'accounts',issue:'attention',organizations:[id(4),id(10)],repository:id(5),type:'SelectedItems'}
  assert.deepEqual(m.filterJobs(data,filters).map(row=>row.id),[id(1)])
  assert.equal(m.filterJobs(data,{...filters,repository:id(8)}).length,0)
  assert.equal(m.filterJobs(data,{...filters,query:'wasabi'}).length,1)
})
test('duration distinguishes zero, unknown, running, invalid and long sessions',()=>{
  assert.equal(m.duration(session()),'1h 5m 8s')
  assert.equal(m.duration(session({endTime:'2026-10-22T10:00:00Z'})),'0m 0s')
  assert.equal(m.duration(session({endTime:null})),'Not reported')
  assert.equal(m.duration(session({endTime:null,status:'Running'})),'In progress')
  assert.equal(m.duration(session({endTime:'2026-10-20T10:00:00Z'})),'Not reported')
})
test('retry chains use explicit parent IDs and never neighboring runs or another job',()=>{
  const root=session(),child=session({id:id(6),mainSessionId:id(2),retryCount:1,creationTime:'2026-10-22T12:00:00Z'})
  const rows=[child,root,session({id:id(9),jobId:id(8),mainSessionId:id(2)}),session({id:id(10),retryCount:1})]
  assert.deepEqual(m.retryChain(child,rows).map(row=>row.id),[id(2),id(6)])
  assert.deepEqual(m.retryChain(root,rows).map(row=>row.id),[id(2),id(6)])
  assert.deepEqual(m.retryChain(root,[root,rows[3]]),[])
  assert.deepEqual(m.retryChain(session({mainSessionId:'00000000-0000-0000-0000-000000000000'}),[root]),[])
})
test('workloads come from explicit message text, ignoring URL hostnames and ambiguous categories',()=>{
  assert.equal(m.workload(log({message:'OneDrive is already being processed: https://tenant-my.sharepoint.com/personal/user'})),'OneDrive')
  assert.equal(m.workload(log({message:'Processing mailbox: user@example.test'})),'Exchange')
  assert.equal(m.workload(log({message:'Processing site: Portal'})),'SharePoint')
  assert.equal(m.workload(log({message:'Processing team: Sales'})),'Teams')
  assert.equal(m.workload(log({message:'Exchange and SharePoint failed'})),'Other / session')
  assert.equal(m.workload(log({message:'Job finished with warnings and errors'})),'Other / session')
  assert.equal(m.workload(log({message:'https://tenant.sharepoint.com'})),'Other / session')
})
test('referenced workloads retain exact names or URLs and do not invent object identities',()=>{
  assert.equal(m.workloadTarget(log({message:'Processing OneDrive: Example (https://tenant/personal/example)'})),'Example (https://tenant/personal/example)')
  assert.equal(m.workloadTarget(log({message:'OneDrive is already being processed by another job: https://tenant/personal/example ()'})),'https://tenant/personal/example')
  assert.equal(m.workloadTarget(log({message:'Mailbox error for user@example.test'})),'user@example.test')
  assert.equal(m.workloadTarget(log({message:'Backup failed for an object'})),null)
})
test('log filters retain full messages, combine severity/workload/search and sort missing timestamps last',()=>{
  const rows=[log({id:id(1),type:'Warning',message:'OneDrive throttled for user@example.test'}),log({id:id(2),type:'Success',message:'Processing OneDrive: user@example.test'}),log({id:id(3),type:'Error',message:'Mailbox inaccessible',creationTime:null}),log({id:id(4),type:'Error',message:'OneDrive denied',creationTime:'2026-10-22T12:00:00Z'})]
  assert.deepEqual(m.filterLogs(rows,{query:'user@',severity:'issues',workload:'OneDrive',order:'oldest'}).map(row=>row.id),[id(1)])
  assert.deepEqual(m.filterLogs(rows,{query:'',severity:'issues',workload:'all',order:'newest'}).map(row=>row.id),[id(4),id(1),id(3)])
  assert.equal(m.logIssue(log({type:'Success',message:'Previous error resolved'})),false)
  assert.equal(m.filterLogs([log({type:null})],{query:'',severity:'Not reported',workload:'all',order:'oldest'}).length,1)
})
test('job loader scopes session requests, supports all retained history and bounds concurrency',async()=>{
  const paths=[];let active=0,max=0
  const result=await loadJobs(async path=>{paths.push(path);active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return read(path)},'Source','all',id(1),now)
  const sessions=new URL(paths.find(path=>path.startsWith('/v8/JobSessions?')),'https://source.test')
  assert.equal(sessions.searchParams.get('jobId'),id(1));assert.equal(sessions.searchParams.has('endTimeLowerBound'),false);assert.equal(result.jobs.data.length,1);assert.ok(max<=4)
})
test('7 and 30 day history use explicit bounds and list requests preserve all jobs',async()=>{
  for(const days of ['7','30']) {
    let sessionPath
    const result=await loadJobs(async path=>{if(path.startsWith('/v8/JobSessions?'))sessionPath=path;return read(path)},'Source',days,undefined,now)
    const url=new URL(sessionPath,'https://source.test')
    assert.equal(url.searchParams.get('endTimeLowerBound'),new Date(now.getTime()-Number(days)*86400000).toISOString());assert.equal(result.jobs.data.length,1)
  }
})
test('job and session IDs are validated before any source request',async()=>{
  let calls=0;const never=async()=>{calls++;throw Error('unexpected')}
  await assert.rejects(loadJobs(never,'Source','all','../Jobs'),error=>error.status===400)
  await assert.rejects(loadSession(never,'Source','bad',id(1)),error=>error.status===400)
  assert.equal(calls,0)
})
test('unscoped sessions are excluded and visibly reported as incomplete',async()=>{
  const result=await loadJobs(async path=>path.startsWith('/v8/JobSessions?') ? page([session(),session({id:id(9),jobId:id(8)})]):read(path),'Source','all',id(1),now)
  assert.equal(result.sessions.data.length,1);assert.equal(result.sessions.complete,false);assert.match(result.warnings.join(' '),/outside this job/)
})
test('deleted or inaccessible job configuration does not hide retained sessions',async()=>{
  const result=await loadJobs(async path=>path===`/v8/Jobs/${id(1)}` ? Promise.reject(new VbmRequestError('not found',502)):read(path),'Source','all',id(1),now)
  assert.equal(result.jobs.available,false);assert.equal(result.sessions.data.length,1);assert.ok(result.warnings.length)
})
test('optional repository failure is visible and authentication failures propagate',async()=>{
  const result=await loadJobs(async path=>path.startsWith('/v8/BackupRepositories') ? Promise.reject(new VbmRequestError('forbidden',403)):read(path),'Source','7',undefined,now)
  assert.equal(result.repositories.available,false);assert.match(result.warnings.join(' '),/denied/)
  await assert.rejects(loadJobs(async()=>{throw new VbmRequestError('expired',401)},'Source','7'),error=>error.status===401)
})
test('log investigation validates session ownership before reading logs',async()=>{
  const paths=[]
  await assert.rejects(loadSession(async path=>{paths.push(path);return session({jobId:id(9)})},'Source',id(2),id(1)),error=>error.status===404)
  assert.equal(paths.length,1)
})
test('complete logs preserve API severity, sequence and full message',async()=>{
  const result=await loadSession(read,'Source',id(2),id(1),now)
  assert.equal(result.logs.complete,true);assert.equal(result.logs.data[0].message,'Job finished');assert.equal(result.warnings.length,0)
})
test('partial general log separately retrieves earlier errors and warnings without duplicate IDs',async()=>{
  const result=await loadSession(async path=>{
    const url=new URL(path,'https://source.test')
    if(!url.pathname.endsWith('/LogItems'))return read(path)
    if(url.searchParams.get('type')==='Error')return page([log({id:id(8),type:'Error',message:'Old mailbox error'})])
    if(url.searchParams.get('type')==='Warning')return page([log({id:id(3),type:'Warning',message:'Warning detail'})])
    return {results:[log()],offset:0,limit:1,_links:{next:{href:'https://untrusted.test/page'}}}
  },'Source',id(2),id(1),now)
  assert.equal(result.logs.complete,false);assert.equal(result.logs.data.length,2);assert.ok(result.logs.data.some(row=>row.type==='Error'));assert.match(result.warnings.join(' '),/additionally read in full/)
})
test('action paths restrict UUIDs and the four retained job controls',()=>{
  for(const action of m.actions)assert.equal(m.actionPath(id(1),action),`/v8/Jobs/${id(1)}/${action}`)
  assert.throws(()=>m.actionPath('../Jobs','start'));assert.throws(()=>m.actionPath(id(1),'delete'))
})

// Exercise the real source wrapper with in-memory source/auth/HTTP adapters; no live mutations.
function serverHarness(options={}) {
  const calls=[],source={id:'selected',platform:'vb365',protocol:'https',host:'selected.test',port:4443}
  let refreshes=0
  const exports={},dependencies={
    'next/server':{NextResponse:{json:(body,init={})=>({body,status:init.status || 200,headers:init.headers})}},
    'next/headers':{cookies:async()=>({get:()=>options.noCookie ? undefined:({value:options.sourceId || 'selected'})})},
    './config-store':{configStore:{getById:id=>id==='selected' ? source:null,getAll:()=>[source]}},
    './token-manager':{tokenManager:{getToken:async()=> 'stored-token',refreshToken:async()=>{refreshes++;return 'refreshed-token'}}},
    './vb365-helper':{getVB365Config:async()=>null,refreshVB365Token:async()=>null},
    './read-cache-scope':require('../lib/server/read-cache-scope.ts'),'../vbm-dashboard/load':{VbmRequestError},'../vbm-jobs/model':m,'../vbm-proxies/actions':require('../lib/vbm-proxies/actions.ts'),
  }
  const context={exports,require:key=>{if(!dependencies[key])throw Error(key);return dependencies[key]},process:{env:{VBM_API_URL:'https://different.test:4443'}},URL,AbortController,setTimeout,clearTimeout,
    fetch:async(url,init)=>{calls.push({url:String(url),...init});return options.fetch ? options.fetch(url,init):{ok:true,status:204,json:async()=>({ok:true})}}}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../lib/server/vbm-read.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context)
  const request={headers:new Headers({origin:options.origin || 'http://localhost:3000',authorization:'Bearer client-token'}),nextUrl:new URL('http://localhost:3000/api/vbm/jobs'),signal:new AbortController().signal}
  return {exports,request,calls,source,refreshes:()=>refreshes}
}
test('job controls use the selected source and its server token, including 204 responses',async()=>{
  for(const action of m.actions) {
    const h=serverHarness(),result=await h.exports.withVbmJobAction(h.request,id(1),action)
    assert.equal(result.status,200);assert.equal(result.body.accepted,true);assert.equal(h.calls[0].url,`https://selected.test:4443/v8/Jobs/${id(1)}/${action}`)
    assert.equal(h.calls[0].headers.Authorization,'Bearer stored-token');assert.equal(h.calls[0].method,'POST');assert.equal(h.calls[0].redirect,'error');assert.equal(result.headers['Cache-Control'],'private, no-store')
  }
})
test('foreign origins, invalid job IDs and invalid selected sources cannot trigger mutations',async()=>{
  for(const [options,jobId,status] of [[{origin:'https://foreign.test'},id(1),403],[{},'invalid',400],[{sourceId:'missing'},id(1),400]]) {
    const h=serverHarness(options),result=await h.exports.withVbmJobAction(h.request,jobId,'start')
    assert.equal(result.status,status);assert.equal(h.calls.length,0)
  }
})
test('job controls refresh once on 401 without exposing source errors',async()=>{
  const h=serverHarness({fetch:async(url,init)=>init.headers.Authorization==='Bearer stored-token' ? {ok:false,status:401}:{ok:true,status:204}})
  assert.equal((await h.exports.withVbmJobAction(h.request,id(1),'stop')).status,200);assert.equal(h.refreshes(),1);assert.equal(h.calls.length,2)
  const bad=serverHarness({fetch:async()=>({ok:false,status:500,text:async()=> 'secret server trace'})})
  const result=await bad.exports.withVbmJobAction(bad.request,id(1),'start');assert.equal(result.status,502);assert.doesNotMatch(JSON.stringify(result),/secret server trace/)
})
test('read wrapper stays GET-only and shares refresh across parallel source reads',async()=>{
  const h=serverHarness({fetch:async(url,init)=>init.headers.Authorization==='Bearer stored-token' ? {ok:false,status:401}:{ok:true,status:200,json:async()=>({ok:true})}})
  const result=await h.exports.withVbmRead(h.request,read=>Promise.all([read('/v8/Jobs'),read('/v8/JobSessions')]))
  assert.equal(result.status,200);assert.equal(h.refreshes(),1);assert.ok(h.calls.every(call=>call.method==='GET' && !call.body))
})

test('read cache scope changes with configured credentials, including the default saved source',async()=>{
  for(const noCookie of [false,true]) {
    const h=serverHarness({noCookie})
    h.source.username='operator';h.source.password='first'
    const before=await h.exports.withVbmRead(h.request,async(_read,_source,context)=>({scope:context.cacheKey}))
    h.source.password='second'
    const after=await h.exports.withVbmRead(h.request,async(_read,_source,context)=>({scope:context.cacheKey}))
    assert.equal(before.status,200);assert.equal(after.status,200);assert.notEqual(before.body.scope,after.body.scope)
    assert.doesNotMatch(JSON.stringify(after),/second|operator|stored-token/)
  }
})
