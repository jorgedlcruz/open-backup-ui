// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm')
const {randomUUID}=require('node:crypto'),assert=require('node:assert/strict'),{test}=require('node:test'),ts=require('typescript')
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText
require.extensions['.ts']=(mod,file)=>mod._compile(compile(file),file)
const {RestoreStarts}=require('../lib/server/restore-starts.ts')
const {VbrRecoveryError}=require('../lib/recovery/error.ts')
const sourceKey='a'.repeat(64),cacheKey='b'.repeat(64),operation='StartFlrRestore'
const binding=()=>({sourceKey,cacheKey,requestId:randomUUID()})
async function fixture(t){
  const folder=await fs.promises.mkdtemp(path.join(os.tmpdir(),'vbr-start-test-'))
  t.after(()=>fs.promises.rm(folder,{recursive:true,force:true}))
  let now=Date.now()
  return {folder,store:()=>new RestoreStarts(folder,()=>now),advance:ms=>{now+=ms}}
}

test('two processes reserve one native start and preserve the exact acknowledgement across reloads',async t=>{
  const {store,folder}=await fixture(t),key=binding(),scheduled=[],sessionId=randomUUID()
  const payload={restorePointId:randomUUID(),reason:'not stored',credentialsId:randomUUID()}
  let posts=0
  const start=()=>store().submit(key,operation,payload,fn=>scheduled.push(fn),async()=>async()=>{
    posts++;return {sourceKey,id:sessionId,mountErrors:[{type:'Mount',message:'One disk was skipped'}]}
  })
  const [first,duplicate]=await Promise.all([start(),start()])
  assert.equal(first.phase,'starting');assert.deepEqual(first,duplicate);assert.equal(scheduled.length,1);assert.equal(posts,0)
  await scheduled[0]()
  const result=await store().observe(key)
  assert.equal(result.phase,'accepted');assert.equal(result.sessionId,sessionId);assert.equal(result.mountErrors[0].type,'Mount')
  assert.deepEqual(await start(),result);assert.equal(posts,1);assert.equal(scheduled.length,1)
  // Even accidentally executing the scheduled closure again cannot replay VBR.
  await scheduled[0]();assert.equal(posts,1)
  const dir=path.join(folder,sourceKey,cacheKey)
  const serialized=(await Promise.all((await fs.promises.readdir(dir)).map(file=>fs.promises.readFile(path.join(dir,file),'utf8')))).join('\n')
  for(const sensitive of Object.values(payload))assert.ok(!serialized.includes(sensitive))
  await assert.rejects(store().submit(key,operation,{different:true},()=>assert.fail(),()=>assert.fail()),{status:409})
  await assert.rejects(store().submit(key,'StartEntireVmRestore',payload,()=>assert.fail(),()=>assert.fail()),{status:409})
  for(const changed of [{sourceKey:'c'.repeat(64)},{cacheKey:'c'.repeat(64)},{requestId:randomUUID()}])
    await assert.rejects(store().observe({...key,...changed}),{status:404})
})

test('preparation failures never submit and ambiguous native results never become retryable rejections',async t=>{
  const {store}=await fixture(t)
  const cases=[
    {prepare:true,error:new VbrRecoveryError('Malware review changed.',409),phase:'rejected',message:'Malware review changed.'},
    {error:new VbrRecoveryError('Denied.',403),phase:'rejected',message:'Denied.'},
    {error:new VbrRecoveryError('Gateway timeout.',504,true),phase:'unknown'},
    {error:new VbrRecoveryError('Request timeout.',408),phase:'unknown'},
    {error:Error('sensitive internal detail'),phase:'unknown'},
    {reply:{sourceKey,id:'not-an-id'},phase:'unknown'},
    {reply:{sourceKey:'c'.repeat(64),id:randomUUID()},phase:'unknown'},
  ]
  for(const item of cases){
    const key=binding(),work=[];let posts=0
    await store().submit(key,operation,{},fn=>work.push(fn),async()=>{
      if(item.prepare)throw item.error
      return async()=>{posts++;if(item.error)throw item.error;return item.reply}
    })
    await work[0]()
    const receipt=await store().observe(key)
    assert.equal(receipt.phase,item.phase);assert.equal(posts,item.prepare?0:1)
    if(item.message)assert.equal(receipt.message,item.message)
    else assert.doesNotMatch(receipt.message,/sensitive|Gateway|timeout/)
    await store().submit(key,operation,{},()=>assert.fail(),()=>assert.fail())
  }
})

test('interrupted workers cannot replay, while an exact late acknowledgement replaces displayed uncertainty',async t=>{
  const {store,advance}=await fixture(t),key=binding(),work=[],sessionId=randomUUID()
  let finish,posts=0
  await store().submit(key,operation,{},fn=>work.push(fn),async()=>async()=>{posts++;return new Promise(resolve=>{finish=resolve})})
  const running=work[0]()
  while(!finish)await new Promise(resolve=>setImmediate(resolve))
  advance(31*60_000)
  assert.equal((await store().observe(key)).phase,'unknown')
  await store().submit(key,operation,{},()=>assert.fail(),()=>assert.fail())
  assert.equal(posts,1)
  finish({sourceKey,id:sessionId});await running
  assert.equal((await store().observe(key)).sessionId,sessionId)
  const neverStarted=binding()
  await store().submit(neverStarted,operation,{},()=>{},()=>assert.fail())
  advance(31*60_000)
  assert.equal((await store().observe(neverStarted)).phase,'rejected')
  await store().submit(neverStarted,operation,{},()=>assert.fail(),()=>assert.fail())
})

test('immutable final receipts are checked against intent and caller identity',async t=>{
  const {store,folder}=await fixture(t),key=binding(),work=[]
  await store().submit(key,operation,{},fn=>work.push(fn),async()=>async()=>({sourceKey,id:randomUUID()}))
  await work[0]()
  const file=path.join(folder,sourceKey,cacheKey,key.requestId+'.json.result')
  const receipt=JSON.parse(await fs.promises.readFile(file,'utf8'))
  for(const changes of [{cacheKey:'f'.repeat(64)},{payloadHash:'f'.repeat(64)},{attempted:false},{result:{sourceKey:'f'.repeat(64),id:randomUUID()}}]){
    await fs.promises.writeFile(file,JSON.stringify({...receipt,...changes}))
    await assert.rejects(store().observe(key),{status:409})
  }
})

test('exclusive intent and attempt publications fence native writes even when stale advisory leases overlap',async t=>{
  const {folder}=await fixture(t),exports={}
  // Model the strongest stale-lease failure: both holders enter the critical
  // section. Correctness must come from immutable exclusive publication.
  const deps={
    '../restore-points/workflow':require('../lib/restore-points/workflow.ts'),
    '../recovery/error':require('../lib/recovery/error.ts'),
    './file-lease':{withFileLease:async(file,_duration,work)=>{await fs.promises.mkdir(path.dirname(file),{recursive:true});return work()}},
  }
  vm.runInNewContext(compile(require.resolve('../lib/server/restore-starts.ts')),{exports,require:name=>deps[name]||require(name),process,Buffer,setTimeout,Date})
  const store=()=>new exports.RestoreStarts(folder),key=binding(),scheduled=[],posted=[]
  const start=value=>store().submit(key,operation,{value},fn=>scheduled.push(fn),async()=>async()=>{
    posted.push(value);return {sourceKey,id:randomUUID()}
  })
  const outcomes=await Promise.allSettled([start('first'),start('second')])
  assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,1)
  const loser=outcomes.find(item=>item.status==='rejected');assert.equal(loser.reason.status,409)
  assert.equal(scheduled.length,1)
  // An accidentally duplicated background callback still has one atomic attempt.
  await Promise.all([scheduled[0](),scheduled[0]()])
  assert.equal(posted.length,1)
  const saved=JSON.parse(await fs.promises.readFile(path.join(folder,sourceKey,cacheKey,key.requestId+'.json'),'utf8'))
  const {createHash}=require('node:crypto')
  assert.equal(saved.payloadHash,createHash('sha256').update(JSON.stringify({value:posted[0]})).digest('hex'))
  assert.equal((await store().observe(key)).phase,'accepted')
})

test('an abandoned immutable attempt stays unknown and is never reclaimed after restart',async t=>{
  const {store,folder,advance}=await fixture(t),key=binding()
  await store().submit(key,operation,{},()=>{},()=>assert.fail())
  const file=path.join(folder,sourceKey,cacheKey,key.requestId+'.json')
  const receipt=JSON.parse(await fs.promises.readFile(file,'utf8'))
  await fs.promises.writeFile(file+'.attempt',JSON.stringify({...receipt,attempted:true}),{flag:'wx'})
  await fs.promises.writeFile(file+'.lock',JSON.stringify({owner:randomUUID(),expires:Date.now()-1000}),{flag:'wx'})
  advance(31*60_000)
  const calls=await Promise.all([store().submit(key,operation,{},()=>assert.fail(),()=>assert.fail()),store().submit(key,operation,{},()=>assert.fail(),()=>assert.fail())])
  assert.ok(calls.every(row=>row.phase==='unknown'))
})

test('the single-start route acknowledges before preparation and status reads never submit',async t=>{
  const {store}=await fixture(t),scheduled=[],settings=[],writes=[],checks=[],sessionId=randomUUID()
  const draft={sourceKey,restorePointId:randomUUID(),backupId:randomUUID(),operation:'StartEntireVmRestore',mode:'OriginalLocation',requestId:randomUUID()}
  let currentKey=cacheKey,deny=false
  const start=require('../lib/recovery/start.ts')
  const deps={
    'zod':require('zod'),'next/server':{after:fn=>scheduled.push(fn)},
    '@/lib/recovery/start':{draftSchema:start.draftSchema,prepareRestore:async(_send,source,input)=>{checks.push('prepare');assert.equal(source,sourceKey);return {point:{id:input.restorePointId}}},
      checkPointOperation:()=>checks.push('fresh rights and malware'),submitPreparedRestore:async()=>{writes.push('POST');return {sourceKey,id:sessionId}}},
    '@/lib/recovery/options':{findPoint:async()=>{checks.push('fresh point');return {}}},
    '@/lib/recovery/error':require('../lib/recovery/error.ts'),
    '@/lib/server/entire-restore-records':{saveEntireRestore:()=>{}},
    '@/lib/server/restore-starts':{restoreStarts:store()},
    '@/lib/server/vbr-recovery':{VbrRecoveryError,withVbrRecovery:async(_req,run,opts)=>{
      settings.push(opts)
      try{return Response.json(await run({sourceKey,cacheKey:currentKey,getExplorer:()=>({send:()=>{}}),send:async endpoint=>{assert.equal(endpoint,'/api/v1/serverInfo');if(deny)throw new VbrRecoveryError('Denied.',401);return {}}}))}
      catch(error){return Response.json({error:error.message},{status:error.status||500})}
    }},
  }
  const exports={}
  vm.runInNewContext(compile(require.resolve('../app/api/vbr/restore/start/route.ts')),{exports,require:key=>deps[key],Object,Response})
  const post=payload=>exports.POST({json:async()=>payload})
  const get=query=>exports.GET({nextUrl:new URL('http://unit.test/?'+new URLSearchParams(query))})
  const first=await post(draft)
  assert.equal(first.status,200);assert.equal((await first.json()).phase,'starting')
  assert.equal(settings[0].backgroundRestore,true);assert.deepEqual(checks,[]);assert.deepEqual(writes,[])
  assert.equal((await (await get(draft)).json()).phase,'starting')
  await post(draft);assert.equal(scheduled.length,1)
  await scheduled[0]()
  assert.deepEqual(checks,['prepare','fresh point','fresh rights and malware']);assert.deepEqual(writes,['POST'])
  assert.equal((await (await get(draft)).json()).sessionId,sessionId)
  await post(draft);assert.equal(scheduled.length,1)
  assert.equal((await post({...draft,sourceKey:'f'.repeat(64)})).status,409)
  assert.equal((await get({...draft,sourceKey:'f'.repeat(64)})).status,409)
  currentKey='c'.repeat(64);assert.equal((await get(draft)).status,404)
  deny=true;assert.equal((await get(draft)).status,401)
  assert.deepEqual(writes,['POST'])
})
