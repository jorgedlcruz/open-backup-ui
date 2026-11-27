// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{randomUUID}=require('node:crypto')
require.extensions['.ts']=(loaded,file)=>loaded._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file)
const {loadRecoveryActivity,createRecoveryActivityCache}=require('../lib/vbm-recovery/activity.ts')
const {recoveryGet}=require('../lib/vbm-recovery/load.ts')
const {recoveryTransport}=require('../lib/vbm-recovery/transport.ts')
const row=(values={})=>({id:randomUUID(),jobId:randomUUID(),jobType:'Backup',status:'Running',...values})
test('activity uses one server-filtered page and counts unique running backup and copy jobs',async()=>{
  const job=randomUUID(),calls=[]
  const value=await loadRecoveryActivity(async path=>{calls.push(path);return {results:[row({jobId:job}),row({jobId:job}),row({jobType:'Copy'}),row({status:'Stopped'})]}})
  assert.equal(calls.length,1);assert.equal(calls[0],'/v8/JobSessions?status=Running&offset=0&limit=200')
  assert.equal(value.runningJobs,2);assert.equal(value.hasMore,false);assert.ok(Number.isFinite(Date.parse(value.checkedAt)))
  assert.deepEqual(Object.keys(value).sort(),['checkedAt','hasMore','runningJobs'])
})
test('bounded activity pages expose a lower bound without following upstream links or fetching history',async()=>{
  let calls=0
  const data=await loadRecoveryActivity(async()=>{calls++;return {results:Array.from({length:200},()=>row()),_links:{next:{href:'https://untrusted.example/history'}}}})
  assert.equal(calls,1);assert.equal(data.runningJobs,200);assert.equal(data.hasMore,true)
  const zero=await loadRecoveryActivity(async()=>({results:[]}));assert.equal(zero.runningJobs,0);assert.equal(zero.hasMore,false)
})
test('unreadable or failed activity responses cannot claim there are no running jobs',async()=>{
  for(const data of [{},[],{results:null},{results:[{id:'invalid',status:'Running'}]}])await assert.rejects(()=>loadRecoveryActivity(async()=>data),error=>error.status===502)
  const failure=Error('busy');await assert.rejects(()=>loadRecoveryActivity(async()=>{throw failure}),error=>error===failure)
})
test('activity cache isolates sources, coalesces pending reads, expires, and does not cache failures',async()=>{
  let now=1000,calls=0;const cached=createRecoveryActivityCache(()=>now)
  const execute=async()=>{calls++;await new Promise(resolve=>setImmediate(resolve));return {results:[row()]}}
  const values=await Promise.all([cached(execute,'a'),cached(execute,'a')]);assert.equal(calls,1);assert.equal(values[0],values[1])
  now=2000;await cached(execute,'a');assert.equal(calls,1)
  await cached(execute,'b');assert.equal(calls,2)
  now=31001;await cached(execute,'a');assert.equal(calls,3)
  const failing=async()=>{calls++;throw Error('unavailable')};await assert.rejects(()=>cached(failing,'failed'));await cached(execute,'failed');assert.equal(calls,5)
})
test('activity read is independent of recovery sessions and uses the restricted read-only job resource',async()=>{
  const seen=[],execute=recoveryTransport({baseUrl:'https://source.test',token:'secret',refresh:async()=>null,fetcher:async(url,options)=>{seen.push([url.pathname,options.method]);return new Response(JSON.stringify({results:[row()]}),{status:200})}})
  const data=await recoveryGet({scope:randomUUID(),sourceName:'test',execute},{action:'activity'})
  assert.equal(data.runningJobs,1);assert.deepEqual(seen,[['/v8/JobSessions','GET']])
  await assert.rejects(()=>execute('/v8/JobSessions?status=Running','POST'),/Unsupported/)
  await assert.rejects(()=>execute('/v8/JobSessions/other'),/Unsupported/)
})
