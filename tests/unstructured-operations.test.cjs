// Open Backup UI v1.2.0
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)
const {UnstructuredReceipts}=require('../lib/server/unstructured-receipts.ts')
const {unstructuredAction,unstructuredCommand}=require('../lib/recovery/unstructured.ts')
const {readUnstructuredTask}=require('../lib/recovery/unstructured-task.ts')
const {VbrRecoveryError}=require('../lib/recovery/error.ts')
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0')
const sourceKey='a'.repeat(64),cacheKey='b'.repeat(64),sessionId=id(1),taskId=id(2),secret='fixtures'
const sign=(type='FlrRestore')=>crypto.createHmac('sha256',secret).update(JSON.stringify(['unstructured-task',sourceKey,cacheKey,sessionId,taskId,type])).digest('base64url')
const taskKey=sign(),receipt={id:taskId,taskId,taskKey},operation={sessionId,view:'browse',action:'copy'}
const command=(requestId)=>({...operation,sourceKey,requestId,sourcePaths:['mnt|backup|file.json'],destinationId:id(3),targetPath:'/srv/ reports '})
const pause=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve}}
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nas-operations-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
 return {directory,receipts:new UnstructuredReceipts(directory)}
}

test('task status preserves native per-operation logs, failure detail and times after the parent mount ends',async()=>{
 const requests=[],native={id:taskId,type:'FlrRestore',state:'Stopped',result:'Failed',progressPercent:12,name:'NAS restore',creationTime:'2026-11-11T09:19:18Z',endTime:'2026-11-11T09:22:10Z',
  additionalInfo:{message:'Permission denied',resourceId:id(8),resourceReference:'/api/v1/sessions/'+id(8)},
  logs:{totalRecords:2,records:[{id:1,status:'Succeeded',title:'Starting file restore'},{id:2,status:'Failed',title:'Destination could not be opened',description:'Permission denied'}]}}
 const ctx={sourceKey,cacheKey,secret,privateSend:async()=>({permissions:['ViewTasks']}),send:async(url)=>{requests.push(url);assert.equal(url,'/api/v1/tasks/'+taskId);return native}}
 const input=unstructuredCommand.parse({sourceKey,sessionId,action:'task',taskId,taskKey})
 const actual=await unstructuredAction(ctx,input)
 assert.deepEqual(actual.logs,native.logs);assert.equal(actual.additionalInfo.message,'Permission denied');assert.equal(actual.relatedSessionId,id(8));assert.equal(actual.endTime,native.endTime)
 assert.equal(requests.length,1)
 for(const changed of [{sourceKey:'c'.repeat(64)},{cacheKey:'c'.repeat(64)},{secret:'other'}])await assert.rejects(unstructuredAction({...ctx,...changed},input))
 await assert.rejects(unstructuredAction(ctx,{...input,sessionId:id(9)}));assert.equal(requests.length,1)
 await assert.rejects(unstructuredAction({...ctx,privateSend:async()=>({permissions:[]})},input));assert.equal(requests.length,1)
 await assert.rejects(unstructuredAction({...ctx,send:async()=>({...native,type:'FlrSearch'})},input))
 const legacy=readUnstructuredTask({...native,additionalInfo:{resourceId:id(8),resourceReference:'/api/v1/elsewhere/'+id(8)},logs:{data:native.logs.records,pagination:{total:2}}})
 assert.deepEqual(legacy.logs,native.logs);assert.equal(legacy.relatedSessionId,undefined)
})

test('independent copy requests run concurrently and their accepted receipts survive reload without replay',async t=>{
 const {receipts,directory}=fixture(t),first=pause(),second=pause(),entered1=pause(),entered2=pause(),a=id(10),b=id(11)
 const run1=receipts.submit(sourceKey,cacheKey,a,command(a),async()=>{entered1.resolve();await first.promise;return receipt})
 const run2=receipts.submit(sourceKey,cacheKey,b,command(b),async()=>{entered2.resolve();await second.promise;return {...receipt,id:id(4),taskId:id(4)}})
 await Promise.all([entered1.promise,entered2.promise])
 assert.deepEqual(await receipts.operationStatus(sourceKey,cacheKey,a,operation),{phase:'pending'})
 assert.deepEqual(await receipts.operationStatus(sourceKey,cacheKey,b,operation),{phase:'pending'})
 const restarted=new UnstructuredReceipts(directory)
 assert.deepEqual(await restarted.operationStatus(sourceKey,cacheKey,a,operation),{phase:'unknown'},'A new process must not claim a vanished request is still running')
 first.resolve();await run1
 assert.deepEqual(await restarted.operationStatus(sourceKey,cacheKey,a,operation),{phase:'accepted',...receipt})
 assert.deepEqual(await receipts.operationStatus(sourceKey,cacheKey,b,operation),{phase:'pending'})
 second.resolve();await run2
 let replay=0;assert.deepEqual(await receipts.submit(sourceKey,cacheKey,a,command(a),async()=>{replay++;return receipt}),receipt);assert.equal(replay,0)
 for(const [source,principal,expected] of [['x',cacheKey,operation],[sourceKey,'x',operation],[sourceKey,cacheKey,{...operation,sessionId:id(9)}],[sourceKey,cacheKey,{...operation,view:'instant'}],[sourceKey,cacheKey,{...operation,action:'restore'}]]){
  assert.deepEqual(await restarted.operationStatus(source,principal,a,expected),{phase:'missing'})
 }
})

test('read-only receipt action returns only a signed task for the original parent and action after unmount',async t=>{
 const {receipts}=fixture(t),requestId=id(20)
 await receipts.submit(sourceKey,cacheKey,requestId,command(requestId),async()=>receipt)
 const ctx={sourceKey,cacheKey,secret,receipts,privateSend:async()=>({permissions:['ViewTasks']}),send:async()=>assert.fail('Receipt recovery must not issue any VBR mutation or mount read')}
 const input=unstructuredCommand.parse({sourceKey,sessionId,view:'browse',action:'operationReceipt',operation:'copy',requestId})
 assert.deepEqual(await unstructuredAction(ctx,input),{phase:'accepted',...receipt})
 assert.deepEqual(await unstructuredAction(ctx,{...input,operation:'restore'}),{phase:'missing'})
 await assert.rejects(unstructuredAction({...ctx,secret:'changed'},input))
 await assert.rejects(unstructuredAction({...ctx,privateSend:async()=>({permissions:[]})},input))
})

test('unknown mutations remain unconfirmed and definite rejection permits an explicit corrected request',async t=>{
 const {receipts}=fixture(t),uncertainId=id(30),rejectedId=id(31)
 await assert.rejects(receipts.submit(sourceKey,cacheKey,uncertainId,command(uncertainId),async()=>{throw new VbrRecoveryError('Connection lost',502,true)}))
 assert.deepEqual(await receipts.operationStatus(sourceKey,cacheKey,uncertainId,operation),{phase:'unknown'})
 let calls=0
 await assert.rejects(receipts.submit(sourceKey,cacheKey,uncertainId,command(uncertainId),async()=>{calls++;return receipt}));assert.equal(calls,0)
 await assert.rejects(receipts.submit(sourceKey,cacheKey,rejectedId,command(rejectedId),async()=>{throw new VbrRecoveryError('Invalid destination',400)}))
 assert.deepEqual(await receipts.operationStatus(sourceKey,cacheKey,rejectedId,operation),{phase:'missing'})
 assert.deepEqual(await receipts.submit(sourceKey,cacheKey,rejectedId,{...command(rejectedId),targetPath:'/corrected'},async()=>receipt),receipt)
})
