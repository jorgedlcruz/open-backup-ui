// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {randomUUID} = require('node:crypto')
const {readFileSync} = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2020, esModuleInterop:true},
}).outputText, filename)
const {beginBrowseSession} = require('../lib/vbm-recovery/load.ts')
const {recoveryTransport} = require('../lib/vbm-recovery/transport.ts')
const {requestReceipt} = require('../lib/vbm-recovery/store.ts')
const started = Date.parse('2026-11-22T10:00:00Z')
const nil = '00000000-0000-0000-0000-000000000000'
const flush = () => new Promise(resolve => setImmediate(resolve))

function upstream(t, {ownerStatus, poolMembers, exploreError} = {}) {
  t.mock.timers.enable({apis:['setTimeout','Date'], now:started})
  const scope=randomUUID(), org=randomUUID(), proxy=randomUUID(), pool=randomUUID(), repo=randomUUID(), session=randomUUID()
  const input={action:'start',requestId:randomUUID(),workload:'Exchange',objectType:'User',objectId:'user',restorePointId:'point'}
  const calls=[], unexpected=[]
  const fetcher=async (url,{method}) => {
    const path=url.pathname
    calls.push({method,path,at:Date.now()})
    if(method==='GET') {
      if(path==='/v8/ProtectedUsers/user')return Response.json({id:'user',organizationId:org})
      if(path==='/v8/RestorePoints/point')return Response.json({id:'point',repositoryId:repo,
        organizationId:org,backupTime:'2026-11-21T23:27:00Z',isExchange:true,isDeleted:false})
      if(path==='/v8/RestorePoints' && url.searchParams.get('repositoryId')===repo)return Response.json({results:[{id:'point'}]})
      if(path==='/v8/BackupRepositories/'+repo)
        return Response.json(poolMembers ? {id:repo,proxyId:nil,proxyPoolId:pool} : {id:repo,proxyId:proxy,proxyPoolId:nil})
      if(path==='/v8/Proxies/'+proxy && !poolMembers)return Response.json({id:proxy,status:ownerStatus()})
      if(path==='/v8/ProxyPools/'+pool+'/proxies' && poolMembers)
        return Response.json(poolMembers(Number(url.searchParams.get('offset'))))
    } else if(method==='POST' && path==='/v8/Organizations/'+org+'/explore') {
      const rejected=exploreError?.()
      if(rejected)return Response.json({errorCode:rejected.code},{status:rejected.status})
      return Response.json({id:session,type:'Vex',state:'Working',name:'Fixture browse'})
    }
    unexpected.push({method,path})
    return new Response(null,{status:404})
  }
  const execute=recoveryTransport({baseUrl:'https://vb365.invalid',token:'fixture',refresh:async()=>null,fetcher})
  t.after(()=>assert.deepEqual(unexpected,[],'An unexpected resource was accessed'))
  return {session,calls, begin:()=>beginBrowseSession({scope,sourceName:'fixture',execute},input).result,
    receipt:()=>requestReceipt(scope,input.requestId), writes:()=>calls.filter(c=>c.method!=='GET')}
}

test('an offline owner returns after 29 minutes and waiting clients share one explore POST', async t=>{
  const restoredAt=started+29*60_000
  const f=upstream(t,{ownerStatus:()=>Date.now()<restoredAt?'Offline':'Online'})
  const first=f.begin(), duplicate=f.begin()
  await flush()
  assert.equal(f.receipt().phase,'waitingForProxy')
  assert.equal(f.writes().length,0)
  for(let i=0;i<116;i++){t.mock.timers.tick(15_000);await flush()}
  assert.equal((await first).session.id,f.session)
  assert.equal((await duplicate).session.id,f.session)
  assert.equal(f.receipt().status,'completed')
  assert.equal(f.writes().length,1)
  assert.equal(f.writes()[0].at,restoredAt)
})

test('thirty minutes of confirmed offline status ends the request without any upstream write', async t=>{
  const f=upstream(t,{ownerStatus:()=>'Offline'})
  const checked=assert.rejects(f.begin(),error=>!error.outcomeUnknown && error.status===503)
  await flush()
  for(let i=0;i<119;i++){t.mock.timers.tick(15_000);await flush()}
  assert.equal(f.receipt().status,'pending')
  t.mock.timers.tick(15_000)
  await checked
  assert.equal(Date.now()-started,30*60_000)
  assert.equal(f.receipt().status,'failed')
  assert.equal(f.writes().length,0)
})

test('an ambiguous upstream 502 with ProxyOffline retains one write across repeated requests', async t=>{
  const f=upstream(t,{ownerStatus:()=>'Online',exploreError:()=>({status:502,code:'ProxyOffline'})})
  await assert.rejects(f.begin(),error=>error.outcomeUnknown===true)
  assert.equal(f.receipt().status,'unknown')
  await assert.rejects(f.begin(),error=>error.outcomeUnknown===true)
  assert.equal(f.writes().length,1)
})

for(const status of [400,409]){
  test('an explicit ProxyOffline rejection with HTTP '+status+' can be retried after a delay',async t=>{
    let attempts=0
    const f=upstream(t,{ownerStatus:()=>'Online',exploreError:()=>
      ++attempts===1 ? {status,code:'ProxyOffline'} : undefined})
    const result=f.begin()
    await flush()
    assert.equal(f.receipt().phase,'waitingForProxy')
    assert.equal(f.writes().length,1)
    t.mock.timers.tick(14_999)
    await flush()
    assert.equal(f.writes().length,1)
    t.mock.timers.tick(1)
    assert.equal((await result).session.id,f.session)
    assert.deepEqual(f.writes().map(c=>c.at),[started,started+15_000])
    assert.equal(f.receipt().status,'completed')
  })
}

test('a pool-owned repository uses every page of its own members and ignores unrelated proxies', async t=>{
  const first=randomUUID(),second=randomUUID(), offsets=[]
  const f=upstream(t,{poolMembers:offset=>{
    offsets.push(offset)
    return offset===0 ? {offset,limit:1,results:[{id:first,status:'Offline'}],_links:{next:{href:'next'}}}
      : {offset,limit:1,totalCount:2,results:[{id:second,status:'Online'}]}
  }})
  assert.equal((await f.begin()).session.id,f.session)
  assert.deepEqual(offsets,[0,1])
  assert.equal(f.writes().length,1)
  assert.equal(f.writes()[0].at,started)
})
