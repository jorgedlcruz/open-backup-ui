// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const {createRequire} = require('node:module')
const {test} = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const primary = {id:'ds-first', platform:'vbr', protocol:'https', host:'primary.test', port:9419, username:'admin', name:'Original'}
const secondary = {...primary, id:'ds-second', host:'secondary.test', name:'Second'}
const other = {...primary, id:'ds-m365', platform:'vb365', host:'m365.test', port:4443}
const endpoint = source => `${source.protocol}://${source.host}:${source.port}`
const addBody = source => ({type:source.platform, name:source.name, url:endpoint(source)})

// Run the production store and both source registration routes against the same
// temporary configuration and simulated Veeam endpoint.
function fixture(t, stored=[], env={}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obu-single-vbr-'))
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}))
  fs.mkdirSync(path.join(dir, 'data'))
  const file = path.join(dir, 'data', 'sources.json')
  fs.writeFileSync(file, JSON.stringify(stored))
  const session = new Map(), calls = [], modules = new Map()
  const jar = {
    get:name=>session.has(name) ? {value:session.get(name)} : undefined,
    set:(name,value)=>session.set(name,value),
    delete:name=>session.delete(name),
  }
  const fakeProcess = {env:{...env, ENCRYPTION_KEY:'test-only'}, cwd:()=>dir, pid:process.pid}
  const globals = {process:fakeProcess, URL, URLSearchParams, AbortSignal, AbortController, Buffer, Headers, Response,
    console:{error(){},log(){},warn(){}},setTimeout,clearTimeout,
    fetch: async (url) => {calls.push(String(url)); return Response.json({access_token:'test-token', expires_in:900})}}
  const context = vm.createContext(globals)
  vm.runInContext('globalThis.global = globalThis', context)
  function load(filename) {
    if(modules.has(filename)) return modules.get(filename)
    const fileRequire = createRequire(filename)
    const loadDependency = spec => {
      if(spec==='next/headers') return {cookies:async()=>jar}
      if(spec==='next/server') return {NextResponse:Response}
      if(spec.startsWith('@/') || spec.startsWith('.')) {
        const target = spec.startsWith('@/') ? path.join(root,spec.slice(2)) : path.resolve(path.dirname(filename),spec)
        if(fs.existsSync(target+'.ts')) return load(target+'.ts')
      }
      return fileRequire(spec)
    }
    const {outputText} = ts.transpileModule(fs.readFileSync(filename,'utf8'), {
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
    })
    const exports = {}
    modules.set(filename,exports)
    vm.runInContext('(function(exports, require){'+outputText+'\n})',context,{filename})(exports,loadDependency)
    return exports
  }
  const read = name => load(path.join(root,...name.split('/')))
  function request(body) {
    return {headers:new Headers({origin:'https://ui.test'}),nextUrl:new URL('https://ui.test/api/config/sources'),
      signal:new AbortController().signal,json:async()=>body}
  }
  const sources = read('lib/server/data-sources.ts')
  const platform = read('app/api/auth/[platform]/route.ts')
  return {
    file, session, calls, store:read('lib/server/config-store.ts').configStore,
    tokenManager:read('lib/server/token-manager.ts').tokenManager,
    cachedSources:rows=>read('lib/data-sources/client.ts').clientSources(rows,true),
    catalog:async()=>JSON.parse(JSON.stringify(await sources.sourcesForClient())),
    mutate:(action,body,id)=>sources.mutateSource(request(body),action,id),
    signIn:body=>platform.POST(request(body),{params:Promise.resolve({platform:'vbr'})}),
    sessions:async()=>(await read('app/api/auth/session/route.ts').GET()).json(),
  }
}

test('Settings and Connect share a single VBR slot, and a reconnect preserves its saved identity',async t=>{
  const h=fixture(t)
  const added=await h.mutate('add',addBody(primary))
  assert.equal(added.status,201)
  const {id}=await added.json()
  const saved=fs.readFileSync(h.file,'utf8')
  assert.equal((await h.mutate('add',addBody(secondary))).status,409)
  assert.equal((await h.mutate('add',addBody(primary))).status,409)
  const signIn=source=>({url:endpoint(source),username:'admin',password:'example'})
  assert.equal((await h.signIn(signIn(secondary))).status,409)
  assert.equal(h.calls.length,0)
  assert.equal(h.session.size,0)
  assert.equal(fs.readFileSync(h.file,'utf8'),saved)
  assert.equal((await h.signIn(signIn(primary))).status,200)
  assert.equal(h.session.get('veeam_source_id'),id)
  assert.deepEqual(h.calls,['https://primary.test:9419/api/oauth2/token'])
  assert.equal((await h.mutate('add',addBody(other))).status,201)
  assert.deepEqual((await h.catalog()).map(row=>row.type).sort(),['vb365','vbr'])
})

test('legacy secondary VBRs disappear from the catalog and cannot be selected by ID or stale browser session',async t=>{
  const h=fixture(t,[primary,other,secondary])
  const saved=fs.readFileSync(h.file,'utf8')
  assert.deepEqual((await h.catalog()).map(row=>row.id),[primary.id,other.id])
  assert.equal(h.store.getById(secondary.id),null)
  assert.equal((await h.signIn({sourceId:secondary.id})).status,404)
  assert.equal((await h.mutate('connect',{},secondary.id)).status,404)
  assert.equal(h.calls.length,0)
  assert.equal(h.session.size,0)
  h.session.set('veeam_source_id',secondary.id)
  h.session.set('veeam_vbr_token_url',endpoint(secondary))
  h.session.set('veeam_vbr_token','old-browser-token')
  h.tokenManager.remember(secondary.id,'old-server-token',600)
  assert.equal((await h.sessions()).vbr.authenticated,false)
  assert.equal(await h.tokenManager.getToken(secondary.id),null)
  const cached=h.cachedSources([primary,secondary,other].map(s=>({...s,name:s.name,url:endpoint(s),type:s.platform,isAuthenticated:true})))
  assert.deepEqual(Array.from(cached,s=>s.id),[primary.id,other.id])
  assert(cached.every(s=>!s.isAuthenticated))
  assert.equal(fs.readFileSync(h.file,'utf8'),saved)
})

test('removing the original VBR frees the slot without promoting a retired entry',async t=>{
  const h=fixture(t,[primary,secondary,other])
  assert.equal((await h.mutate('remove',{},primary.id)).status,200)
  assert.deepEqual((await h.catalog()).map(s=>s.id),[other.id])
  assert.equal(h.store.getById(secondary.id),null)
  assert.equal((await h.mutate('add',addBody({...primary,host:'replacement.test'}))).status,201)
  assert.equal((await h.catalog()).find(s=>s.type==='vbr').url,'https://replacement.test:9419')
})

test('concurrent registrations for different VBR endpoints leave a single saved server',async t=>{
  const h=fixture(t)
  const attempts=await Promise.all([primary,secondary].map(s=>h.mutate('add',addBody(s))))
  assert.deepEqual(attempts.map(r=>r.status).sort(),[201,409])
  const [{id}]=await h.catalog()
  assert.deepEqual(JSON.parse(fs.readFileSync(h.file,'utf8')).map(s=>s.id),[id])
  assert.equal(h.calls.length,0)
})

test('Connect can register the first appliance and Settings cannot add a second one afterward',async t=>{
  const h=fixture(t)
  const signIn=await h.signIn({url:'http://primary.test:9419',username:'admin',password:'example'})
  assert.equal(signIn.status,200)
  const {sourceId}=await signIn.json()
  assert.deepEqual((await h.catalog()).map(s=>s.id),[sourceId])
  assert.equal(h.session.get('veeam_source_id'),sourceId)
  assert.equal((await h.mutate('add',addBody(secondary))).status,409)
  assert.equal(h.store.getById(sourceId).host,primary.host)
  assert.deepEqual(h.calls,['https://primary.test:9419/api/oauth2/token'])
})

test('an environment-managed VBR fills the slot even when an old saved endpoint differs',async t=>{
  const h=fixture(t,[secondary,other],{VBR_API_URL:endpoint(primary)})
  assert.deepEqual((await h.catalog()).filter(s=>s.type==='vbr').map(s=>s.id),['env-vbr'])
  assert.equal((await h.mutate('add',addBody(secondary))).status,409)
  assert.equal(h.store.getById(secondary.id),null)
  assert.equal(h.calls.length,0)
})

test('an existing saved alias of the environment endpoint retains its original source ID',async t=>{
  const h=fixture(t,[secondary,primary,other],{VEEAM_API_URL:'https://PRIMARY.test:9419/'})
  const catalog=await h.catalog()
  assert.deepEqual(catalog.filter(s=>s.type==='vbr').map(s=>s.id),[primary.id])
  assert.deepEqual(catalog.filter(s=>s.type==='vb365').map(s=>s.id),[other.id])
  assert.equal(h.store.getById(secondary.id),null)
})
