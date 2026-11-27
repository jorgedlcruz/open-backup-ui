// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const zod = require('zod')
const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
require.extensions['.ts'] = (module, name) => module._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:options}).outputText,name)
const registration = require('../lib/entra-inventory/registration.ts')
const origin = require('../lib/server/request-origin.ts')
const response = { NextResponse: Response }
const errors = require('../lib/topology/load.ts')
const collections = require('../lib/operations/load.ts')
const binding = require('../lib/server/vbr-browser-token.ts')
const uid = n => '87654321-4321-4123-8123-' + String(n).padStart(12, '0')
const resource = 'https://vbr-fixture.invalid:9419/'
const sourceId = 'source-1'
const key = (url, id) => crypto.createHash('sha256').update(JSON.stringify([url,id])).digest('hex')
const sourceKey = key(resource,sourceId)
const pfx = Buffer.from('synthetic certificate').toString('base64')
const form = {
  sourceKey, azureTenantId: uid(1), applicationId: uid(2), description: 'Tenant', cacheRepositoryId: uid(3),
  credential: {kind:'secret',secret:'synthetic-secret'},
}
const app = 'https://preview.invalid'

function mocked(file, imports, extra = {}) {
  const exported = {}
  const source = fs.readFileSync(require.resolve(file),'utf8')
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:options}).outputText,{
    exports:exported, require:name => {
      if (!Object.hasOwn(imports,name)) throw new Error('Unexpected dependency '+name)
      return imports[name]
    }, URL, Buffer, AbortSignal, process:{env:{}}, ...extra,
  })
  return exported
}
class ShareError extends Error {
  constructor(message,status = 400) { super(message); this.status = status }
}
const bodyReader = mocked('../lib/server/kiosk-http.ts', {
  'next/server':response,'./config-store':{},'./request-origin':origin,
  '../labs/sharing':{},'./kiosk-shares':{ShareError},
})
function request(opts = {}) {
  const url = new URL('/api/vbr/entra-inventory/add',app)
  const req = new Request(url, {method:'POST',headers:{origin:app,'content-type':'application/json',...opts.headers},
    body:opts.raw ?? JSON.stringify(opts.form ?? form)})
  req.nextUrl = url
  return req
}
function fixture(opts = {}) {
  const calls = [], revisions = [], preflight = []
  const cookieValues = {veeam_source_id: sourceId,...opts.cookies}
  const cookies = {get:name => cookieValues[name] ? {value:cookieValues[name]} : undefined}
  const writer = mocked('../lib/server/vbr-write-source.ts',{
    'node:crypto':crypto,'next/headers':{cookies:async()=>cookies},'../topology/load':errors,
    './config-store':{configStore:{getById:id => ({ id, platform:opts.platform ?? 'vbr', protocol:'https',
      host:id===sourceId?'vbr-fixture.invalid':'second-fixture.invalid',port:9419 })}},
    './token-manager':{tokenManager:{getToken:async()=>opts.withoutManagedToken ? null : 'synthetic-token'}},
    './vbr-browser-token':binding,
  },{process:{env:opts.env??{}}})
  const handler = mocked('../app/api/vbr/entra-inventory/add/route.ts',{
    'next/server':response,'zod':zod,'@/lib/entra-inventory/registration':registration,
    '@/lib/operations/load':collections,'@/lib/server/request-origin':origin,'@/lib/server/kiosk-http':bodyReader,
    '@/lib/server/vbr-write-source':writer,'@/lib/topology/load':errors,
    '@/lib/server/vbr-read':{withVbrRead:async(_req,load)=>{
      preflight.push('checked')
      try {
        const value=await load(opts.read, 'VBR', null, {sourceKey:opts.preflightKey ?? sourceKey, getRevision:async()=>{
          if (opts.switchAfterRead) cookieValues.veeam_source_id='source-2'
          if (opts.negotiationError) throw opts.negotiationError
          const rev=opts.rev ?? '1.3-rev0'
          revisions.push(rev)
          return rev
        }})
        return Response.json(value)
      } catch (e) { return Response.json({error:e.message},{status:e.status || 502}) }
    }},
  },{fetch:async(url,init)=>{
    calls.push({url:new URL(url),init})
    return opts.upstream ? opts.upstream() : Response.json({id:uid(8),sessionType:'Infrastructure',state:'Working'},{status:201})
  }})
  return {handler, preflight, revisions, calls}
}

for (const [n, creationMode, formatType] of [
  [0,'existingAccount','pfx'], [1,'ExistingAccount','Pfx'], [2,'ExistingAccount','Pfx'], [3,'ExistingAccount','Pfx'],
]) {
  test('rev'+n+' registration sends the selected application credential exactly once and returns an async session receipt', async()=>{
    for (const credential of [form.credential,{kind:'certificate',certificate:pfx,password:'synthetic-passphrase'}]) {
      const rev='1.3-rev'+n
      const { handler,calls,revisions }=fixture({rev})
      const result=await handler.POST(request({form:{...form,credential}}))
      assert.equal(result.status,202)
      assert.deepEqual(await result.json(),{sessionId:uid(8)})
      assert.match(result.headers.get('cache-control'),/no-store/)
      assert.deepEqual(revisions,[rev])
      assert.equal(calls.length,1)
      const { url,init }=calls[0]
      assert.equal(url.href,resource+'api/v1/inventory/entraId/tenants')
      assert.equal(init.method,'POST')
      assert.equal(init.headers.Authorization,'Bearer synthetic-token')
      assert.equal(init.headers['x-api-version'],rev)
      assert.equal(init.redirect,'error')
      assert.deepEqual(JSON.parse(init.body), {azureTenantId:uid(1),creationMode,description:'Tenant',cacheRepositoryId:uid(3),region:'Global',
        existingAccount:{authentication: credential.kind==='secret'?{applicationId:uid(2),secret:'synthetic-secret'}:
          {applicationId:uid(2),certificate:{formatType,certificate:pfx,password:'synthetic-passphrase'}}}})
    }
  })
}

test('no repeated submission or sensitive response on rejected and uncertain registration',async()=>{
  const secret=form.credential.secret
  for(const [upstream,status,uncertain] of [
    [()=>Response.json({secret},{status:403}),403,false],
    [()=>Response.json({secret},{status:500}),502,true],
    [()=>Response.json({secret},{status:200}),502,true],
    [()=>Response.json({id:'other-record',secret},{status:201}),502,true],
    [()=>new Response(secret,{status:201}),502,true],
    [()=>{throw new Error(secret)},502,true],
  ]) {
    const {handler,calls}=fixture({upstream})
    const result=await handler.POST(request())
    assert.equal(result.status,status)
    const output=await result.json()
    assert.equal(output.uncertain,uncertain)
    assert.doesNotMatch(JSON.stringify(output),/synthetic-secret|synthetic-token/)
    assert.equal(calls.length,1)
  }
})

test('source changes, stale credentials and failed negotiation never submit registration',async()=>{
  for(const [opts,status] of [[{preflightKey:'b'.repeat(64)},409],[{switchAfterRead:true},409],
    [{negotiationError:new errors.TopologyRequestError('Unauthorized',401)},401],
    [{platform:'vbm'},400],[{withoutManagedToken:true,cookies:{veeam_vbr_token:'stale',veeam_vbr_token_url:'https://other-fixture.invalid'}},401]]) {
    const {handler,calls}=fixture(opts)
    const result=await handler.POST(request({headers:{authorization:'Bearer wrong-source-token'}}))
    assert.equal(result.status,status)
    assert.equal(calls.length,0)
  }
})

test('same-origin JSON and bounded credential validation happen before any VBR connection',async()=>{
  const tooLarge=4*Math.ceil(registration.maxPfxBytes/3)+65536+1
  const {handler,calls,preflight}=fixture()
  for(const [opts,status] of [
    [{headers:{origin:'https://another-site.invalid'}},403],
    [{headers:{'content-type':'text/plain'}},415],
    [{headers:{'content-length':String(tooLarge)}},413],
    [{raw:' '.repeat(tooLarge)},413],
    [{raw:'{'},400],
    [{form:{...form,apiUrl:'https://client-supplied.invalid'}},400],
    [{form:{...form,credential:{kind:'certificate',certificate:'!'}}},400],
    [{form:{...form,credential:{kind:'secret',secret:'x',password:'y'}}},400],
    [{form:{...form,credential:{kind:'certificate',certificate:Buffer.alloc(registration.maxPfxBytes+1).toString('base64')}}},400],
  ]) assert.equal((await handler.POST(request(opts))).status,status)
  assert.deepEqual(preflight,[])
  assert.equal(calls.length,0)
  const max=Buffer.alloc(registration.maxPfxBytes).toString('base64')
  assert.ok(registration.tenantRegistration.safeParse({...form,credential:{kind:'certificate',certificate:max}}).success)
})

test('legacy environment source binds a bearer token to its configured origin',async()=>{
  const target='https://environment.invalid:9419/'
  const envKey=key(target,'environment')
  const {handler,calls}=fixture({env:{VBR_API_URL:target},cookies:{veeam_source_id:undefined},preflightKey:envKey})
  const result=await handler.POST(request({form:{...form,sourceKey:envKey},headers:{authorization:'Bearer environment-token'}}))
  assert.equal(result.status,202)
  assert.equal(calls.length,1)
  assert.equal(calls[0].url.origin,'https://environment.invalid:9419')
  assert.equal(calls[0].init.headers.Authorization,'Bearer environment-token')
})

test('restricted serverInfo uses a verified baseline inventory read for registration and cache repository choices',async()=>{
  const inventory='/api/v1/inventory/entraId/tenants'
  const repoStates='/api/v1/backupInfrastructure/repositories/states'
  const paths=[]
  const repos=['WinLocal','LinuxLocal','Nfs','Smb','LinuxHardened','WasabiCloud','WinLocal','Nfs']
    .map((type,n)=>({id:uid(n+1),name:'Repo '+n,type,isOnline:n!==6,...(n===7&&{scaleOutRepositoryDetails:{scaleOutRepositoryId:uid(99)}})}))
  const read=async(path,revision)=>{
    const url=new URL(path,resource)
    paths.push(url.pathname)
    assert.equal(revision,'1.3-rev0')
    if(url.pathname===inventory) {
      assert.equal(url.searchParams.get('skip'),'0')
      assert.equal(url.searchParams.get('limit'),'1')
      return {data:[],pagination:{total:0}}
    }
    assert.equal(url.pathname,repoStates)
    return {data:repos,pagination:{total:repos.length}}
  }
  const {handler,calls}=fixture({read,negotiationError:new errors.TopologyRequestError('Read restricted',403)})
  const options=await handler.GET(request())
  assert.equal(options.status,200)
  const setup=await options.json()
  assert.deepEqual(setup.repositories,repos.slice(0,4).map(({id,name})=>({id,name})))
  assert.equal(setup.repositoriesComplete,true)
  assert.equal(setup.sourceKey,sourceKey)
  assert.deepEqual(calls,[])
  assert.equal((await handler.POST(request())).status,202)
  assert.deepEqual(paths,[inventory,repoStates,inventory])
  assert.equal(calls.length,1)
  assert.equal(calls[0].init.headers['x-api-version'],'1.3-rev0')
  assert.equal(JSON.parse(calls[0].init.body).creationMode,'existingAccount')
})

test('unusable tenant baseline and network failures cannot authorize alternate-version registration',async()=>{
  for(const [code,data,expectedReads] of [[403,{data:[{id:'invalid'}]},1],[403,{},1],[502,{data:[]},0],[401,{data:[]},0]]) {
    let reads=0
    const {handler,calls}=fixture({read:async()=>{reads++;return data},negotiationError:new errors.TopologyRequestError('Cannot negotiate',code)})
    assert.ok((await handler.POST(request())).status>=400)
    assert.equal(reads,expectedReads)
    assert.equal(calls.length,0)
  }
})
