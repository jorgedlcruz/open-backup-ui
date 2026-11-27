// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(loaded,file)=>loaded._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const {createStopSessionController}=require('../components/vbm-recovery/stop-session-controller.ts')
const {recoveryEndTime,recoveryDurationSeconds}=require('../lib/vbm-recovery/presentation.ts')
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}

test('stop submission is single-flight and acknowledgment waits for the actual Stopped state',async()=>{
 const sent=deferred();let posts=0,reads=0,state='Working'
 const stop=createStopSessionController({post:()=>{posts++;return sent.promise},read:async id=>{reads++;return {session:{id,state}}}})
 const first=stop.request('a');await stop.request('a');assert.equal(posts,1);assert.equal(stop.snapshot('a').phase,'submitting')
 sent.resolve({accepted:true,sessionId:'a'});await first
 assert.equal(stop.snapshot('a').phase,'waiting');await stop.request('a');assert.equal(posts,1)
 await stop.check('a');assert.equal(stop.snapshot('a').phase,'waiting')
 state='Stopped';await stop.check('a');assert.equal(stop.snapshot('a').phase,'stopped');assert.equal(reads,2)
 await stop.request('a');assert.equal(posts,1)
})
test('ambiguous stop outcomes reconcile only with reads and survive another consumer observing them',async()=>{
 let posts=0
 const stop=createStopSessionController({post:async()=>{posts++;throw Error('connection lost')},read:async id=>({session:{id,state:'Stopped'}})})
 let changes=0;const unsubscribe=stop.subscribe('a',()=>changes++)
 await stop.request('a');assert.equal(stop.snapshot('a').phase,'unconfirmed');await stop.request('a');assert.equal(posts,1)
 await stop.check('a');assert.equal(stop.snapshot('a').phase,'stopped');assert.ok(changes>=3);unsubscribe()
})
test('a known rejection permits a deliberate new request, but an unreadable success does not',async()=>{
 let calls=0
 const stop=createStopSessionController({post:async()=>{calls++;if(calls===1)throw Object.assign(Error('forbidden'),{outcomeUnknown:false});return {}},read:async id=>({session:{id,state:'Working'}})})
 await stop.request('a');assert.equal(stop.snapshot('a').phase,'failed')
 await stop.request('a');assert.equal(stop.snapshot('a').phase,'unconfirmed');await stop.request('a');assert.equal(calls,2)
})
test('status checks coalesce and failures never turn an accepted stop into a completed session',async()=>{
 const reading=deferred();let reads=0
 const stop=createStopSessionController({post:async id=>({accepted:true,sessionId:id}),read:()=>{reads++;return reading.promise}})
 await stop.request('a');const one=stop.check('a'),two=stop.check('a');assert.equal(one,two)
 await Promise.resolve();assert.equal(reads,1);reading.reject(Error('temporary read error'));await one
 assert.equal(stop.snapshot('a').phase,'waiting');assert.equal(stop.snapshot('a').checking,false);assert.match(stop.snapshot('a').error,/temporary/)
})
test('a late stop response cannot overwrite a Stopped state observed from session polling',async()=>{
 const sent=deferred();const stop=createStopSessionController({post:()=>sent.promise,read:async id=>({session:{id,state:'Working'}})})
 const request=stop.request('a');stop.observe({id:'a',state:'Stopped'});sent.reject(Error('lost receipt'));await request
 assert.equal(stop.snapshot('a').phase,'stopped');assert.equal(stop.snapshot('b').phase,'idle')
})
test('confirmation polling gets its full window after a slow POST, and a mismatched read cannot confirm it',async()=>{
 let now=1000
 const stop=createStopSessionController({now:()=>now,post:async id=>{now+=180000;return {accepted:true,sessionId:id}},read:async()=>({session:{id:'wrong',state:'Stopped'}})})
 await stop.request('a');assert.equal(stop.snapshot('a').pollUntil,now+120000)
 await stop.check('a');assert.equal(stop.snapshot('a').phase,'waiting');assert.match(stop.snapshot('a').error,/does not match/)
})
test('active and sentinel end dates remain blank, while duration uses the running clock',()=>{
 const started='2026-11-20T19:00:00Z',sentinel='9999-12-31T23:59:59Z',end='2026-11-20T19:05:00Z'
 assert.equal(recoveryEndTime({state:'Working',endTime:sentinel}),undefined)
 assert.equal(recoveryEndTime({state:'Stopped',endTime:sentinel}),undefined)
 assert.equal(recoveryEndTime({state:'Stopped',endTime:'0001-01-01T00:00:00Z'}),undefined)
 assert.equal(recoveryEndTime({state:'Stopped',endTime:end}),end)
 assert.equal(recoveryDurationSeconds({state:'Working',creationTime:started,endTime:sentinel},Date.parse(end)),300)
 assert.equal(recoveryDurationSeconds({state:'Stopped',creationTime:started,endTime:sentinel}),undefined)
 assert.equal(recoveryDurationSeconds({state:'Stopped',creationTime:started,endTime:end}),300)
})
