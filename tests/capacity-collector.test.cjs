/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test'),{createRequire}=require('node:module')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file)
const base=Date.parse('2026-10-24T12:00:00Z'),source=()=>({id:'vbr',platform:'vbr',protocol:'https',host:'backup.test',port:9419,username:'admin',password:'fixture-password'}),repo={id:'00000000-0000-4000-8000-000000000001',name:'Repo',type:'LinuxLocal',capacityGB:100,freeGB:50}
const reply=(status=200,data={data:[repo],pagination:{total:1}})=>({status,ok:status>=200&&status<300,json:async()=>data})
function harness(options={}) {
 let time=base,interval;const files=new Map(),calls=[],saved=[],refreshes=[],records=new Map([[source().id,source()]]),leases=new Set()
 class Clock extends Date {constructor(...args){super(...(args.length?args:[time]))}static now(){return time}}
 const fakeFs={mkdir:async()=>{},readFile:async f=>{if(!files.has(f))throw Object.assign(new Error('missing'),{code:'ENOENT'});return files.get(f)},writeFile:async(f,data)=>{if(options.statusWriteError)throw Error('private filesystem detail');files.set(f,data)},rename:async(a,b)=>{files.set(b,files.get(a));files.delete(a)},unlink:async f=>{files.delete(f)}}
 const file=require.resolve('../lib/server/capacity-collector.ts'),realRequire=createRequire(file),exports={}
 const dependencies={
  'node:fs':{promises:fakeFs},
  './config-store':{configStore:{getAll:()=>[...records.values()],getById:id=>records.get(id)}},
  './token-manager':{tokenManager:{getToken:async()=>{options.onAuth?.(records);return options.noToken?null:'fixture-token'},refreshToken:async id=>{refreshes.push(id);return 'refreshed-fixture-token'}}},
  './capacity-history':{recordCapacity:async(scope,data)=>{if(options.writeError)throw new Error('private file path');saved.push({scope,data})}},
  './file-lease':{withFileLease:async(file,ms,work)=>{if(leases.has(file))return null;leases.add(file);try{return await work()}finally{leases.delete(file)}}},
 }
 const context={exports,require:key=>dependencies[key]||realRequire(key),process:{cwd:()=>path.join(os.tmpdir(),'capacity-collector-fixture'),env:options.env||{}},Date:Clock,URL,AbortController,setTimeout,clearTimeout,setInterval:fn=>{interval=fn;return {unref(){}}},fetch:async(url,init)=>{calls.push({url:String(url),init});return options.fetch?options.fetch(url,init,records):reply()}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,context)
 return {exports,files,calls,saved,refreshes,records,context,advance:ms=>time+=ms,tick:()=>interval?.(),status:async()=>exports.getCollectorStatus(exports.configuredScope(source()).scope,true),settled:async()=>{for(let i=0;i<100&&context.capacityCollectorRuntime?.busy;i++)await new Promise(setImmediate);assert.equal(context.capacityCollectorRuntime?.busy,false)}}
}

test('unattended collection reads only repository states, persists measurements and keeps tokens out of status',async()=>{
 const h=harness();await h.exports.collectCapacitySource(source());const s=await h.status();assert.equal(s.state,'healthy');assert.equal(s.measured,1);assert.equal(h.saved.length,1);assert.equal(h.calls.length,1)
 const call=h.calls[0];assert.equal(new URL(call.url).pathname,'/api/v1/backupInfrastructure/repositories/states');assert.equal(call.init.method,undefined);assert.equal(call.init.redirect,'error');assert.equal(call.init.cache,'no-store');assert.doesNotMatch([...h.files.values()].join(),/fixture-password|fixture-token/)
})
test('persisted next attempt and per-source lease prevent duplicate runs',async()=>{
 const h=harness();await Promise.all([h.exports.collectCapacitySource(source()),h.exports.collectCapacitySource(source())]);assert.equal(h.calls.length,1);await h.exports.collectCapacitySource(source());assert.equal(h.calls.length,1);h.advance(900000);await h.exports.collectCapacitySource(source());assert.equal(h.calls.length,2)
})
test('server startup collects without a page request and the timer picks up later intervals',async()=>{
 const h=harness();h.exports.startCapacityCollector();await h.settled();assert.equal(h.calls.length,1);h.exports.startCapacityCollector();await h.settled();assert.equal(h.calls.length,1);h.advance(900000);h.tick();await h.settled();assert.equal(h.calls.length,2)
})
test('disabled and production-build startup do not authenticate or read VBR',async()=>{
 for(const env of [{CAPACITY_COLLECTOR_ENABLED:'false'},{NEXT_PHASE:'phase-production-build'}]){const h=harness({env});h.exports.startCapacityCollector();assert.equal(h.calls.length,0);assert.equal(h.context.capacityCollectorRuntime,undefined)}
})
test('browser-only and non-VBR sources are skipped',async()=>{
 const h=harness();await h.exports.collectCapacitySource({...source(),password:undefined});await h.exports.collectCapacitySource({...source(),platform:'vb365'});assert.equal(h.calls.length,0)
})
test('401 retries once after refresh and never serializes the refreshed token',async()=>{
 let n=0;const h=harness({fetch:async()=>reply(n++?200:401)});await h.exports.collectCapacitySource(source());assert.equal(h.refreshes.length,1);assert.equal(h.calls.length,2);assert.equal((await h.status()).state,'healthy');assert.doesNotMatch([...h.files.values()].join(),/fixture-token/)
})
test('persistent authorization failure saves a safe error and no measurement',async()=>{
 const h=harness({fetch:async()=>reply(403)});await h.exports.collectCapacitySource(source());assert.equal((await h.status()).state,'error');assert.match((await h.status()).message,/cannot read/);assert.equal(h.saved.length,0)
})
test('source credentials changing during authentication prevent a request to the old destination',async()=>{
 const h=harness({onAuth:records=>records.set('vbr',{...source(),host:'changed.test'})});await h.exports.collectCapacitySource(source());assert.equal(h.calls.length,0);assert.equal(h.saved.length,0);assert.match((await h.status()).message,/configuration changed/)
})
test('source removal during a read discards the result',async()=>{
 const h=harness({fetch:async(_url,_init,records)=>{records.delete('vbr');return reply()}});await h.exports.collectCapacitySource(source());assert.equal(h.saved.length,0);assert.equal((await h.status()).state,'error')
})
test('partial pagination remains partial and only valid capacity measurements are saved',async()=>{
 const h=harness({fetch:async()=>reply(200,{data:[repo,{...repo,id:'00000000-0000-4000-8000-000000000002',type:'AmazonS3',capacityGB:-1,freeGB:-1}],pagination:{total:3}})});await h.exports.collectCapacitySource(source());const s=await h.status();assert.equal(s.state,'partial');assert.equal(s.repositories,2);assert.equal(s.measured,1)
})
test('history write failure does not advance last success',async()=>{
 const h=harness({writeError:true});await h.exports.collectCapacitySource(source());const s=await h.status();assert.equal(s.state,'error');assert.equal(s.lastSuccess,null);assert.doesNotMatch(s.message,/private file path/)
})
test('a failed first status write surfaces a scheduler error instead of waiting forever',async()=>{
 const h=harness({statusWriteError:true});h.exports.startCapacityCollector();await h.settled();const s=await h.status();assert.equal(s.state,'error');assert.match(s.message,/data-directory access/);assert.doesNotMatch(s.message,/private filesystem detail/)
})
test('source hashes separate credentials and reject arbitrary filesystem scopes',async()=>{
 const h=harness();assert.notEqual(h.exports.configuredScope(source()).scope,h.exports.configuredScope({...source(),password:'other-fixture'}).scope);assert.equal((await h.exports.getCollectorStatus('../escape',true)).state,'error')
})

test('file leases exclude overlapping work, release on failure, and recover expired owners',async()=>{
 const {withFileLease}=require('../lib/server/file-lease.ts'),dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'backup-ui-lease-')),file=path.join(dir,'test.lock')
 try {
  let release;const first=withFileLease(file,30000,async()=>{await new Promise(resolve=>release=resolve);return 1})
  for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(release)
  assert.equal(await withFileLease(file,30000,async()=>2),null);release();assert.equal(await first,1)
  await assert.rejects(()=>withFileLease(file,30000,async()=>{throw Error('test failure')}));assert.equal(fs.existsSync(file),false)
  await fs.promises.writeFile(file,JSON.stringify({owner:'old',expires:Date.now()-1000}));assert.equal(await withFileLease(file,30000,async()=>3),null);assert.equal(await withFileLease(file,30000,async()=>3),3)
  await fs.promises.writeFile(file,'{');await fs.promises.utimes(file,new Date(Date.now()-60000),new Date(Date.now()-60000));assert.equal(await withFileLease(file,30000,async()=>4),null);assert.equal(await withFileLease(file,30000,async()=>4),4)
 }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'backup-ui-lease-'));await fs.promises.rm(dir,{recursive:true,force:true})}
})

test('manual and unattended history writers preserve both repositories and keep sources isolated',async()=>{
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'backup-ui-history-')),file=require.resolve('../lib/server/capacity-history.ts'),realRequire=createRequire(file),exports={}
 try {
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:realRequire,process:{cwd:()=>dir},Date,setTimeout})
  const scope='a'.repeat(64),other='b'.repeat(64),second={...repo,id:'00000000-0000-4000-8000-000000000002'}
  await Promise.all([exports.recordCapacity(scope,[repo]),exports.recordCapacity(scope,[second])]);const rows=JSON.parse(await fs.promises.readFile(path.join(dir,'data','capacity-history',scope+'.json'),'utf8'));assert.equal(rows.length,2)
  const separate=await exports.recordCapacity(other,[repo]);assert.equal(separate.length,1)
  await assert.rejects(()=>exports.recordCapacity('../escape',[repo]),/Invalid history scope/)
 }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'backup-ui-history-'));await fs.promises.rm(dir,{recursive:true,force:true})}
})
