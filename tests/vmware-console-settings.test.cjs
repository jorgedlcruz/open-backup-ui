const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const Module = require('node:module'), ts = require('typescript')
const originalCwd = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(),'obui-vmware-test-'))
const sourceKey = 'a'.repeat(64), token = 'local-admin-test-token'.repeat(2)
const manager = {id:'00000000-0000-4000-8000-000000000001', type:'ViHost', viHostType:'ESXi', name:'ESX.EXAMPLE.TEST.', port:8443}
const managerModel = {id:manager.id, hostname:'esx.example.test', port:8443}
const password = 'unit-fixture-password', realm = 'https://console.example.test'
let signins = 0, allowSignIn = true
process.chdir(temp)
process.env.ENCRYPTION_KEY = 'dedicated-test-application-key'
process.env.HTTPS_ADMIN_TOKEN = token
require.extensions['.ts'] = (mod,file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file)
const originalLoad = Module._load
Module._load = function(name, parent, isMain) {
  if (name === '@/lib/server/vmware-ticket') return { verifyVmwareConsoleConnection: async c => {
    assert.equal(c.hostname,managerModel.hostname); signins++
    if (!allowSignIn) throw new Error('upstream details')
  }}
  if (name === '@/lib/server/vbr-read') return {withVbrRead:async (_request,run) => {
    try {
      const read = async url => url.includes('?') ? {data:[manager],pagination:{total:1}} : url.endsWith('/'+manager.id) ? manager : null
      return Response.json(await run(read,'test-vbr',null,{sourceKey}))
    } catch(e) {return Response.json({error:e.message},{status:e.status || 500})}
  }}
  if (name.startsWith('@/')) return originalLoad.call(this,path.join(originalCwd,name.slice(2)+'.ts'),parent,isMain)
  return originalLoad.call(this,name,parent,isMain)
}
const api = require('../app/api/administration/vmware-consoles/route.ts')
const vault = require('../lib/server/vmware-console-connections.ts')
Module._load = originalLoad
test.after(() => {process.chdir(originalCwd); fs.rmSync(temp,{recursive:true,force:true})})

function request(method,body,headers={},origin=realm) {
  const url=origin+'/api/administration/vmware-consoles'
  return Object.assign(new Request(url,{method,headers:{'content-type':'application/json',origin,'x-https-admin-token':token,...headers},body:body ? JSON.stringify(body):undefined}),{nextUrl:new URL(url)})
}
const draft = {action:'save', sourceKey, ...managerModel, username:'svc-test', password, trust:'system', revision:null}

test('VMware configuration requires the administrative proof, same origin and secure transport',async()=>{
  assert.equal((await api.GET(request('GET',undefined,{'x-https-admin-token':'invalid'}))).status,403)
  assert.equal((await api.GET(request('GET',undefined,{origin:'https://other.test'}))).status,403)
  assert.equal((await api.POST(request('POST',draft,{},'http://lan.example.test'))).status,403)
  assert.equal((await api.GET(request('GET',undefined,{},'http://127.0.0.2'))).status,200)
  assert.equal(signins,0)
})
test('configuration validates the live VBR-selected authority and credentials; storage and listings isolate secrets',async()=>{
  for (const patch of [{sourceKey:'b'.repeat(64)},{hostname:'wrong.example.test'},{port:443},{id:'00000000-0000-4000-8000-000000000002'}])
    assert.equal((await api.POST(request('POST',{...draft,...patch}))).status,409)
  assert.equal((await api.POST(request('POST',{...draft,trust:'custom',caPem:'not a certificate'}))).status,400)
  assert.equal(signins,0)
  assert.equal((await api.POST(request('POST',draft))).status,200)
  assert.equal(signins,1)
  const inventory=await(await api.GET(request('GET'))).json(), saved=inventory.connections[0]
  assert.deepEqual(inventory.managers,[managerModel])
  assert.equal(saved.customTrust,false)
  assert.deepEqual(Object.keys(saved).sort(),['id','hostname','port','username','customTrust','revision'].sort())
  const directory=path.join(temp,'data','vmware-console-connections',sourceKey)
  const file=path.join(directory,fs.readdirSync(directory)[0]), raw=fs.readFileSync(file,'utf8')
  assert.ok(!raw.includes(password))
  assert.equal(vault.getVmwareConsoleConnection(sourceKey,'ESX.EXAMPLE.TEST.',8443).password,password)
  assert.equal(vault.getVmwareConsoleConnection(sourceKey,managerModel.hostname,443),null)
  assert.equal(vault.getVmwareConsoleConnection('b'.repeat(64),managerModel.hostname,8443),null)
  assert.equal((await api.POST(request('POST',draft))).status,409)
  const update={...draft,revision:saved.revision,trust:'keep',password:''}
  assert.equal((await api.POST(request('POST',{...update,username:'different'}))).status,400)
  allowSignIn=false
  assert.equal((await api.POST(request('POST',update))).status,502)
  assert.equal(fs.readFileSync(file,'utf8'),raw)
  allowSignIn=true
  assert.equal((await api.POST(request('POST',update))).status,200)
  const revision=vault.listVmwareConsoleConnections(sourceKey)[0].revision
  assert.notEqual(revision,saved.revision)
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('svc-test','changed-identity'))
  assert.throws(()=>vault.getVmwareConsoleConnection(sourceKey,managerModel.hostname,8443))
  assert.equal((await api.POST(request('POST',{action:'remove',...managerModel,sourceKey,revision}))).status,200)
  assert.equal(vault.getVmwareConsoleConnection(sourceKey,managerModel.hostname,8443),null)
})
test('manager names are canonical hosts without paths, redirects, userinfo or numeric shortcuts',()=>{
  for(const host of ['https://other.test','user@other.test','other.test:9443','other.test/redirect','127.1','0x000001','fe80::1%eth0']) assert.equal(vault.vmwareManagerHostname(host),null,host)
  assert.equal(vault.vmwareManagerHostname('[2001:db8::1]'),'2001:db8::1')
})
