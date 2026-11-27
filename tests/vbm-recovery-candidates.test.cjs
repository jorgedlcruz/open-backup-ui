// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const {test}=require('node:test'),assert=require('node:assert/strict')
const {loadRecoveryCandidates,recoveryCandidates}=require('../lib/vbm-recovery/candidates.ts')
const {VbmRequestError}=require('../lib/vbm-dashboard/load.ts')
const page=results=>({results,limit:500})
test('recovery candidates do not fan out restore points or request storage for a large tenant',async()=>{
  const calls=[]
  const data=await loadRecoveryCandidates(async path=>{calls.push(path);const url=new URL(path,'https://test.invalid');assert.match(url.pathname,/^\/v8\/Protected(?:Users|Groups|Sites|Teams)$/);return page(url.pathname==='/v8/ProtectedUsers'?Array.from({length:300},(_,i)=>({id:`Tenant:user:${i}`,displayName:`User ${i}`,mailboxes:[{id:`mail:${i}`,email:`u${i}@example.test`}]})):[])},'source')
  assert.equal(calls.length,4);assert.equal(data.objects.data.length,300);assert.equal(data.objects.complete,true)
  assert.equal(data.objects.data[299].mailboxes[0].email,'u299@example.test')
  assert.equal(data.objects.data[299].summary.available,false);assert.equal(data.objects.data[299].summary.complete,false);assert.equal(data.objects.data[299].summary.count,null)
})
test('candidate cache is scoped, coalesces concurrent reads, expires and honors manual refresh',async()=>{
  let calls=0
  const read=async()=>{calls++;await new Promise(resolve=>setImmediate(resolve));return page([])}
  await Promise.all([recoveryCandidates(read,'a','test-scope-a',false,1000),recoveryCandidates(read,'a','test-scope-a',false,1000)])
  assert.equal(calls,4)
  await recoveryCandidates(read,'a','test-scope-a',false,2000);assert.equal(calls,4)
  await recoveryCandidates(read,'b','test-scope-b',false,2000);assert.equal(calls,8)
  await recoveryCandidates(read,'a','test-scope-a',true,2000);assert.equal(calls,12)
  await recoveryCandidates(read,'a','test-scope-a',false,1802001);assert.equal(calls,16)
})
test('partial categories remain explicit and authentication failures do not become empty inventory',async()=>{
  const data=await loadRecoveryCandidates(async path=>{if(path.includes('ProtectedSites'))throw new VbmRequestError('denied',403);return page([{id:path.split('?')[0]}])},'source')
  assert.equal(data.objects.complete,false);assert.equal(data.objects.data.length,3);assert.match(data.warnings.join(' '),/Read access denied/)
  await assert.rejects(()=>loadRecoveryCandidates(async()=>{throw new VbmRequestError('expired',401)},'source'),error=>error.status===401)
})
