// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm')
const {createHash,randomUUID} = require('node:crypto'), assert = require('node:assert/strict'), {test} = require('node:test')
const ts = require('typescript')
const compile = file => ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{
  target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, esModuleInterop:true,
}}).outputText
require.extensions['.ts'] = (mod,file) => mod._compile(compile(file),file)
const {MigrationOperations} = require('../lib/server/migration-operations.ts')
const {VbrRecoveryError} = require('../lib/recovery/error.ts')
const sourceKey = 'a'.repeat(64)
const newBinding = () => ({sourceKey,mountId:randomUUID(),sessionId:randomUUID(),kind:'hyperV',requestId:randomUUID()})
async function fixture(t,Store=MigrationOperations) {
  const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(),'vbr-migration-test-'))
  t.after(() => fs.promises.rm(folder,{recursive:true,force:true}))
  let now = Date.now()
  const store = () => new Store(folder,()=>now)
  return {store,folder, advance:ms=>{now+=ms}}
}

function unlockedStore() {
  const file=require.resolve('../lib/server/migration-operations.ts'),exports={}
  vm.runInNewContext(compile(file),{exports,require:key=>key==='./file-lease'
    ?{withFileLease:async(_file,_duration,work)=>work()}
    :require(key.startsWith('.')?path.resolve(path.dirname(file),key):key),setTimeout})
  return exports.MigrationOperations
}

test('two workers reserve one migration, survive observer reloads and never repeat an accepted request without a child ID',async t=>{
  const {store} = await fixture(t), binding = newBinding(), scheduled = []
  let calls = 0
  const start = () => store().submit(binding,{placement:'a'},fn=>scheduled.push(fn),async()=>{calls++;return {accepted:true,sessionId:null}})
  const [first,duplicate] = await Promise.all([start(),start()])
  assert.deepEqual(first,{state:'checking'});assert.deepEqual(duplicate,first);assert.equal(scheduled.length,1);assert.equal(calls,0)
  await assert.rejects(store().submit({...binding,requestId:randomUUID()},{},()=>assert.fail(),()=>assert.fail()),{status:409})
  await assert.rejects(store().submit(binding,{placement:'b'},()=>assert.fail(),()=>assert.fail()),{status:409})
  await scheduled[0]()
  assert.deepEqual(await store().observe(binding),{state:'accepted'})
  assert.deepEqual(await start(),{state:'accepted'});assert.equal(calls,1);assert.equal(scheduled.length,1)
  const secondTab = {...binding,requestId:randomUUID()}
  assert.deepEqual(await store().submit(secondTab,{placement:'a'},()=>assert.fail(),()=>assert.fail()),{state:'accepted'})
  assert.deepEqual(await store().observe(secondTab),{state:'accepted'})
  await assert.rejects(store().submit({...binding,requestId:randomUUID()},{placement:'b'},()=>assert.fail(),()=>assert.fail()),{status:409})
  for(const change of [{kind:'vSphere'},{sourceKey:'b'.repeat(64)},{mountId:randomUUID()},{sessionId:randomUUID()},{requestId:randomUUID()}]){
    await assert.rejects(store().observe({...binding,...change}),{status:404})
  }
})

test('interrupted work becomes unknown durably and never replays using the same idempotency key',async t=>{
  const {store,advance} = await fixture(t), binding = newBinding()
  await store().submit(binding,{},()=>{},()=>assert.fail())
  advance(30*60_000)
  assert.equal((await store().observe(binding)).state,'unknown')
  assert.equal((await store().submit(binding,{},()=>assert.fail(),()=>assert.fail())).state,'unknown')
  await assert.rejects(store().submit({...binding,requestId:randomUUID()},{},()=>assert.fail(),()=>assert.fail()),{status:409})
})

test('immutable mount generations fence native writes and exact-child retries even without advisory mutual exclusion',async t=>{
  const {store}=await fixture(t,unlockedStore()),binding=newBinding(),scheduled=[],firstChild=randomUUID(),secondChild=randomUUID()
  let calls=0
  const submit=(request,child,canRetry)=>store().submit(request,{placement:'a'},fn=>scheduled.push({request,fn}),
    async()=>{calls++;return {accepted:true,sessionId:child}},canRetry)
  const race=await Promise.allSettled(Array.from({length:12},()=>submit({...binding,requestId:randomUUID()},firstChild)))
  assert.equal(scheduled.length,1);assert.equal(calls,0)
  assert.ok(race.some(value=>value.status==='fulfilled'))
  for(const result of race)if(result.status==='rejected')assert.equal(result.reason.status,409)
  await Promise.all([scheduled[0].fn(),scheduled[0].fn()])
  assert.equal(calls,1,'duplicating the scheduled callback cannot repeat the native write')
  assert.equal((await store().observe(scheduled[0].request)).sessionId,firstChild)
  await submit({...binding,requestId:randomUUID()},secondChild,async()=>false)
  assert.equal(scheduled.length,1,'a running/successful/unverified child cannot authorize a retry')
  const retries=await Promise.allSettled(Array.from({length:12},()=>submit({...binding,requestId:randomUUID()},secondChild,
    async child=>{assert.equal(child,firstChild);return true})))
  assert.equal(scheduled.length,2)
  assert.ok(retries.some(value=>value.status==='fulfilled'))
  for(const result of retries)if(result.status==='rejected')assert.equal(result.reason.status,409)
  await Promise.all([scheduled[1].fn(),scheduled[1].fn()])
  assert.equal(calls,2)
  assert.equal((await store().observe(scheduled[1].request)).sessionId,secondChild)
  await submit({...binding,requestId:randomUUID()},secondChild,async child=>{assert.equal(child,secondChild);return false})
  assert.equal(scheduled.length,2,'the current owner remains authoritative after concurrent retries')
})

test('competing settings for one migration request cannot replace the winning immutable attempt',async t=>{
  const {store}=await fixture(t,unlockedStore()),binding=newBinding(),scheduled=[],native=[]
  const outcomes=await Promise.allSettled(Array.from({length:10},(_,placement)=>store().submit(binding,{placement},
    fn=>scheduled.push({placement,fn}),async()=>{native.push(placement);return {accepted:true,sessionId:null}})))
  assert.equal(scheduled.length,1)
  for(const result of outcomes)if(result.status==='rejected')assert.equal(result.reason.status,409)
  await Promise.all([scheduled[0].fn(),scheduled[0].fn()])
  assert.deepEqual(native,[scheduled[0].placement])
  assert.equal((await store().observe(binding)).state,'accepted')
})

test('legacy accepted migration receipts remain authoritative until an exact failed child permits the first new generation',async t=>{
  const {store,folder}=await fixture(t),binding=newBinding(),firstChild=randomUUID(),secondChild=randomUUID(),payload={placement:'a'}
  const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const file=path.join(folder,digest([binding.sourceKey,binding.requestId])+'.json')
  const slot=path.join(folder,'mount-'+digest([binding.sourceKey,binding.kind,binding.sessionId,binding.mountId]))
  const outcome={state:'accepted',sessionId:firstChild},legacy={binding,payloadHash:digest(payload),created:Date.now(),outcome}
  await fs.promises.writeFile(file,JSON.stringify(legacy))
  await fs.promises.writeFile(slot,binding.requestId)
  assert.deepEqual(await store().observe(binding),outcome)
  assert.deepEqual(await store().submit({...binding,requestId:randomUUID()},payload,()=>assert.fail(),()=>assert.fail(),async()=>false),outcome)
  const retry={...binding,requestId:randomUUID()},scheduled=[]
  await store().submit(retry,payload,fn=>scheduled.push(fn),async()=>({accepted:true,sessionId:secondChild}),
    async child=>{assert.equal(child,firstChild);return true})
  assert.equal(scheduled.length,1);await scheduled[0]()
  assert.deepEqual(await store().observe(retry),{state:'accepted',sessionId:secondChild})
  assert.deepEqual(await store().observe(binding),outcome,'the original receipt is not rewritten')
  assert.deepEqual(await store().submit({...binding,requestId:randomUUID()},payload,()=>assert.fail(),()=>assert.fail(),
    async child=>{assert.equal(child,secondChild);return false}),{state:'accepted',sessionId:secondChild})
})

test('preflight and explicit rejections remain retryable, ambiguous mutations never masquerade as rejection',async t=>{
  const {store} = await fixture(t)
  for(const [cause,state] of [[new VbrRecoveryError('Inventory unavailable.',502,false),'rejected'],
    [new VbrRecoveryError('denied',403,false),'rejected'],[new VbrRecoveryError('timeout',504,true),'unknown'],[Error('sensitive upstream details'),'unknown']]){
    const binding = newBinding(), scheduled = []
    await store().submit(binding,{},fn=>scheduled.push(fn),async()=>{throw cause});await scheduled[0]()
    const outcome = await store().observe(binding);assert.equal(outcome.state,state)
    if (state==='rejected') assert.equal(outcome.error,cause.message)
    else assert.doesNotMatch(outcome.error,/sensitive|timeout/)
  }
})

test('the tracked HTTP route responds before VBR finishes and observes the exact returned session; legacy writes remain synchronous',async t=>{
  const {store} = await fixture(t), binding = newBinding(), child = randomUUID()
  const scheduled = [], calls = [], links = [], options = []
  let childRecord = {id:child,parentSessionId:binding.sessionId,sessionType:'QuickMigration',state:'Working'}
  let bearerOnly = false, denyBearer = false
  let finish
  const wait = new Promise(resolve=>{finish=resolve})
  const send = async (url,config) => {
    calls.push({url,config})
    if (denyBearer) throw new VbrRecoveryError('Denied.',401)
    if (url === '/api/v1/sessions/' + child) return childRecord
    if (!config?.mutation) return {id:binding.mountId,sessionId:binding.sessionId,state:'Mounted',hostName:'hv-01.example'}
    await wait;return {id:child}
  }
  const ops = require('../lib/server/migration-operations.ts')
  const deps = {
    'zod':require('zod'),'next/server':{NextResponse:Response,after:fn=>scheduled.push(fn)},
    '@/lib/server/migration-operations':{...ops,MigrationOperations:class {constructor(){return store()}}},
    '@/lib/server/migration-links':{saveMigrationLink:async(...args)=>{links.push(args);throw Error('link store unavailable')}},
    '@/lib/investigation/model':require('../lib/investigation/model.ts'),
    '@/lib/activity/instant-vm':require('../lib/activity/instant-vm.ts'),
    '@/lib/activity/model':require('../lib/activity/model.ts'),
    '@/lib/activity/actions':require('../lib/activity/actions.ts'),'@/lib/recovery/inventory':require('../lib/recovery/inventory.ts'),
    '@/lib/recovery/error':require('../lib/recovery/error.ts'),
    '@/lib/server/vbr-recovery':{withVbrRecovery:async(_req,run,opts)=>{
      options.push(opts)
      try {const result=await run({send,sourceKey,bearerOnly});return result instanceof Response ? result : Response.json(result)}
      catch(error){return Response.json({error:error.message},{status:error.status||500})}
    }},
  }
  const exports = {}
  vm.runInNewContext(compile(require.resolve('../app/api/vbr/activity/mounts/[id]/route.ts')), {exports,require:key=>deps[key],Response})
  const {mountId,...params}=binding, context={params:Promise.resolve({id:mountId})}
  const post = payload => exports.POST({json:async()=>payload},context)
  const get = query => exports.GET({nextUrl:new URL('http://unit.test/?'+new URLSearchParams(query))},context)
  const body={...params,action:'migrate'}
  const first=await post(body)
  assert.equal(first.status,202);assert.equal(first.headers.get('Cache-Control'),'private, no-store')
  assert.equal((await first.json()).state,'checking');assert.equal(calls.length,0);assert.equal(options[0].backgroundMigration,true)
  const work=scheduled[0]()
  assert.equal((await get(params)).status,202);assert.equal((await post(body)).status,202);assert.equal(scheduled.length,1)
  finish();await work
  assert.deepEqual(await (await get(params)).json(),{state:'accepted',sessionId:child})
  assert.deepEqual(links,[[sourceKey,binding.sessionId,mountId,child,{host:'hv-01.example'}]])
  assert.equal(calls.filter(c=>c.config?.mutation).length,1)
  for (const record of [childRecord,{...childRecord,state:'Stopped',result:{result:'Success'}},
    {...childRecord,state:'Stopped',result:{result:'Failed'},parentSessionId:randomUUID()}]) {
    childRecord=record
    const again={...params,requestId:randomUUID()}
    assert.deepEqual(await (await post({...again,action:'migrate'})).json(),{state:'accepted',sessionId:child})
    assert.deepEqual(await (await get(again)).json(),{state:'accepted',sessionId:child})
    assert.equal(scheduled.length,1)
  }
  childRecord={id:child,parentSessionId:binding.sessionId,sessionType:'QuickMigration',state:'Stopped',result:{result:'Failed'}}
  const retry=await post({...body,requestId:randomUUID()})
  assert.equal(retry.status,202);assert.equal(scheduled.length,2)
  assert.equal((await get({...params,sessionId:randomUUID()})).status,404)
  assert.equal((await get({...params,sourceKey:'b'.repeat(64)})).status,409)
  assert.equal((await post({...body,action:'unmount'})).status,400)
  const {requestId,...legacy}=body
  assert.ok(requestId)
  assert.deepEqual(await (await post(legacy)).json(),{accepted:true,sessionId:child})
  assert.equal(options.at(-1),undefined);assert.equal(scheduled.length,2)
  bearerOnly=true
  assert.deepEqual(await (await get(params)).json(),{state:'accepted',sessionId:child})
  denyBearer=true
  assert.equal((await get(params)).status,401);assert.equal((await post(body)).status,401);assert.equal(scheduled.length,2)
})
