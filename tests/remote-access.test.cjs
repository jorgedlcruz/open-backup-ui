const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),path=require('node:path')
function load(file,extras={}) {
  const exports={}
  const context={exports,URL,Headers,Error,Set,process:{env:{}},...extras}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context)
  return exports
}
const requestModule=fetch=>load('lib/api/application-request.ts',{fetch})
const origin=load('lib/server/request-origin.ts')
const req=(headers={},url='http://localhost:3000/api/test')=>({headers:new Headers(headers),nextUrl:new URL(url)})

test('same-origin HTTPS through a tunnel passes the origin check and sets Secure cookies',()=>{
  const r=req({host:'backup.trycloudflare.com',origin:'https://backup.trycloudflare.com','x-forwarded-proto':'https'})
  assert.equal(origin.applicationOrigin(r),'https://backup.trycloudflare.com')
  assert.equal(origin.isSameApplicationOrigin(r),true)
  assert.equal(origin.isSecureApplicationRequest(r),true)
})
test('foreign origins remain blocked, even with a matching spoofed forwarded host',()=>{
  const r=req({host:'backup.trycloudflare.com',origin:'https://attacker.test','x-forwarded-proto':'https','x-forwarded-host':'attacker.test'})
  assert.equal(origin.isSameApplicationOrigin(r),false)
})
test('localhost HTTP and direct HTTPS retain their original cookie behavior',()=>{
  const local=req({origin:'http://localhost:3000'}),secure=req({origin:'https://backup.test'},'https://backup.test/api/test')
  assert.equal(origin.isSameApplicationOrigin(local),true);assert.equal(origin.isSecureApplicationRequest(local),false)
  assert.equal(origin.isSameApplicationOrigin(secure),true);assert.equal(origin.isSecureApplicationRequest(secure),true)
})
test('invalid host, null origin, HTTP downgrade and alternate ports are rejected',()=>{
  for(const [host,from] of [['backup.test','null'],['backup.test','http://backup.test'],['backup.test','https://backup.test:8443'],['backup.test@attacker.test','https://attacker.test'],['backup.test,attacker.test','https://backup.test']]) {
    assert.equal(origin.isSameApplicationOrigin(req({host,origin:from,'x-forwarded-proto':'https'})),false)
  }
})
test('application POST uses same-origin cookies and cannot follow access redirects with credentials',async()=>{
  let captured
  const m=requestModule(async(url,init)=>{captured={url,...init};return Response.json({success:true})})
  assert.deepEqual(JSON.parse(JSON.stringify(await m.applicationRequest('/api/config/sources',{method:'POST',body:'private',redirect:'follow',credentials:'omit'}))),{success:true})
  assert.equal(captured.redirect,'manual');assert.equal(captured.credentials,'same-origin');assert.equal(captured.cache,'no-store')
})
test('Cloudflare plain-text Unauthorized is an access error, not a JSON or Veeam credential error',async()=>{
  const m=requestModule(async()=>new Response('Unauthorized',{status:401}))
  await assert.rejects(m.applicationRequest('/api/auth/vbr'),e=>e.kind==='access' && e.status===401 && /HTTPS/.test(e.message) && !/Unexpected token/.test(e.message))
})
test('opaque and ordinary redirects are detected without reading the login response',async()=>{
  for(const response of [{type:'opaqueredirect',status:0},{type:'basic',status:302}]) {
    const m=requestModule(async()=>response)
    await assert.rejects(m.applicationRequest('/api/config/sources'),e=>e.kind==='access')
  }
})
test('HTML sign-in pages are never rendered as errors or parsed as source inventory',async()=>{
  const m=requestModule(async()=>new Response('<html>private details</html>',{headers:{'content-type':'text/html'}}))
  await assert.rejects(m.applicationRequest('/api/config/sources'),e=>e.kind==='access' && !e.message.includes('private details'))
})
test('a genuine JSON credential rejection remains distinguishable from the access gate',async()=>{
  const m=requestModule(async()=>Response.json({error:'Authentication was not accepted.'},{status:401}))
  await assert.rejects(m.applicationRequest('/api/auth/vbr'),e=>e.kind==='response' && e.status===401 && e.message==='Authentication was not accepted.')
})
test('non-JSON upstream errors and malformed JSON return readable errors without response bodies',async()=>{
  for(const response of [new Response('private stack',{status:502}),new Response('{private stack',{headers:{'content-type':'application/json'}})]) {
    const m=requestModule(async()=>response)
    await assert.rejects(m.applicationRequest('/api/config/sources'),e=>e.kind==='response' && !/private stack|Unexpected token/.test(e.message))
  }
})
test('network failures are recoverable and aborts remain aborts',async()=>{
  const failure=new TypeError('Failed to fetch'),m=requestModule(async()=>{throw failure})
  await assert.rejects(m.applicationRequest('/api/config/sources'),e=>e.kind==='network' && /Saved connections have not been changed/.test(e.message))
  const c=new AbortController();c.abort()
  await assert.rejects(m.applicationRequest('/api/config/sources',{signal:c.signal}),e=>e===failure)
})
test('external targets are rejected before any credentials or request are sent',async()=>{
  let count=0;const m=requestModule(async()=>{count++;return Response.json({})})
  for(const url of ['https://external.test/api/test','//external.test/api/test','/connect'])await assert.rejects(m.applicationRequest(url))
  assert.equal(count,0)
})
test('source inventory uses server authentication for each source, with no second session round trip',async()=>{
  const calls=[],sources=[{id:'a',name:'A',url:'https://private.test',type:'vbr',isAuthenticated:true,managed:'saved',hasCredentials:true},{id:'b',name:'B',url:'https://other.test',type:'vbr',isAuthenticated:false}]
  const m=load('lib/data-sources/client.ts',{require:()=>({applicationRequest:async(...args)=>{calls.push(args);return sources}})})
  const rows=await m.loadClientSources()
  assert.equal(calls.length,1);assert.equal(calls[0][0],'/api/config/sources')
  assert.equal(rows[0].isAuthenticated,true);assert.equal(rows[1].isAuthenticated,false)
  assert.equal(rows[0].managed,'saved');assert.equal(rows[0].hasCredentials,true)
})
test('cached metadata never restores authentication, credentials or injected fields',()=>{
  const m=load('lib/data-sources/client.ts',{require:()=>({})})
  const [row]=m.clientSources([{id:'a',name:'A',url:'https://private.test',type:'vbr',isAuthenticated:true,hasCredentials:true,managed:'saved',password:'not-for-clients'}],true)
  assert.equal(row.isAuthenticated,false);assert.equal(row.hasCredentials,false);assert.equal(row.managed,undefined);assert.equal(row.password,undefined)
  assert.throws(()=>m.clientSources({error:'Unauthorized'}));assert.throws(()=>m.clientSources([{type:'bad'}]))
})
test('server API calls use loopback even when a public app URL is configured',()=>{
  const m=load('lib/api/application-url.ts',{process:{env:{NEXT_PUBLIC_APP_URL:'https://backup.trycloudflare.com'}}})
  assert.equal(m.applicationApiUrl('/api/veeam/jobs'),'http://127.0.0.1:3000/api/veeam/jobs')
})
test('server API calls support a configured internal port or origin; browser calls stay relative',()=>{
  assert.equal(load('lib/api/application-url.ts',{process:{env:{PORT:'3100'}}}).applicationApiUrl('/api/veeam/jobs'),'http://127.0.0.1:3100/api/veeam/jobs')
  assert.equal(load('lib/api/application-url.ts',{process:{env:{INTERNAL_APP_URL:'http://app:3000'}}}).applicationApiUrl('/api/veeam/jobs'),'http://app:3000/api/veeam/jobs')
  assert.equal(load('lib/api/application-url.ts',{window:{}}).applicationApiUrl('/api/veeam/jobs'),'/api/veeam/jobs')
})
test('invalid internal origins and external API paths fail closed',()=>{
  for(const url of ['file:///tmp/x','https://user:secret@example.com','http://app:3000/elsewhere','http://app:3000/?token=x']) {
    const m=load('lib/api/application-url.ts',{process:{env:{INTERNAL_APP_URL:url}}})
    assert.throws(()=>m.applicationApiUrl('/api/veeam/auth'))
  }
  const m=load('lib/api/application-url.ts');assert.throws(()=>m.applicationApiUrl('//attacker.test/api/veeam/auth'))
})
