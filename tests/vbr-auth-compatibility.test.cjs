// Open Backup UI v1.3.0
const assert=require('node:assert/strict')
const fs=require('node:fs')
const {test}=require('node:test')
const vm=require('node:vm')
const ts=require('typescript')

function load(file,dependencies,globals) {
  const exports={}
  const source=fs.readFileSync(require.resolve(file),'utf8')
  const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  vm.runInNewContext(outputText,{exports,require:name=>{
    if(!(name in dependencies)) throw new Error('Unexpected test module '+name)
    return dependencies[name]
  },console:{log(){},error(){}}, URL,URLSearchParams,AbortSignal, ...globals})
  return exports
}
const revision=load('../lib/vbr/version-response.ts',{}, {})
const cookieModule=load('../lib/utils/cookie-manager.ts',{}, {})
const binding=load('../lib/server/vbr-browser-token.ts',{'../utils/cookie-manager':cookieModule},{})
const fakeResponse=()=>Response.json({access_token:'fixture',expires_in:1000})

test('saved VBR sources acquire and renew one token using the common v13 revision',async()=>{
  const source={username:'user',password:'example',port:9419,platform:'vbr',host:'fixture.invalid',protocol:'https'}
  const calls=[]
  const {tokenManager}=load('../lib/server/token-manager.ts',{
    './config-store':{configStore:{getById:()=>source}},
    '../vbr/version-response':revision,
  },{global:{},process:{env:{}},fetch:async(url,init)=>{calls.push({url,init});return fakeResponse()}})
  assert.equal(await tokenManager.getToken('a'),'fixture')
  assert.equal(await tokenManager.getToken('a'),'fixture')
  assert.equal(await tokenManager.refreshToken('a'),'fixture')
  assert.equal(calls.length,2)
  for(const {url,init} of calls){
    assert.equal(url,'https://fixture.invalid:9419/api/oauth2/token')
    assert.equal(init.headers['x-api-version'],'1.3-rev0')
    assert.equal(init.body.get('grant_type'),'password')
  }
})

test('environment refresh and password grants also use rev0; an established browser session reuses its token',async()=>{
  const calls=[]
  let legacy
  const values={}
  const jar={get:name=>name==='veeam_vbr_token' && legacy ? {value:legacy} : name in values ? {value:values[name]} : undefined}
  const env={VEEAM_API_URL:'https://fixture.invalid',VEEAM_USERNAME:'user',VEEAM_PASSWORD:'example'}
  const {POST}=load('../app/api/veeam/auth/route.ts',{
    'next/server':{NextResponse:Response},'next/headers':{cookies:async()=>jar},
    '@/lib/server/token-manager':{tokenManager:{getToken:async()=>null}},
    '@/lib/server/config-store':{configStore:{getById:()=>({platform:'vbr',protocol:'https',host:'fixture.invalid',port:9419})}},
    '@/lib/server/vbr-browser-token':binding,
    '@/lib/utils/cookie-manager':{getChunkedCookie:()=>legacy},
    '@/lib/vbr/version-response':revision,
  },{process:{env},fetch:async(url,init)=>{calls.push({url,init});return fakeResponse()}})
  for(const grant_type of ['password','refresh_token']){
    assert.equal((await POST({json:async()=>({grant_type,refresh_token:'ref'})})).status,200)
    const {url,init}=calls.at(-1)
    assert.equal(url,'https://fixture.invalid/api/oauth2/token')
    assert.equal(init.headers['x-api-version'],'1.3-rev0')
    assert.equal(new URLSearchParams(init.body).get('grant_type'),grant_type)
  }
  legacy='cookie-token'
  assert.equal((await (await POST({})).json()).access_token,'cookie-token')
  values.veeam_source_id='saved'
  values.veeam_vbr_token_url='https://other.invalid:9419'
  assert.equal((await POST({})).status,401)
  values.veeam_vbr_token_url='https://fixture.invalid:9419'
  assert.equal((await (await POST({})).json()).access_token,'cookie-token')
  legacy=undefined
  assert.equal((await POST({})).status,401)
  assert.equal(calls.length,2)
})

test('VBR browser credentials stay with their selected endpoint, including legacy chunked tokens',()=>{
  const target=new URL('https://vbr.example:9419/')
  const values={veeam_vbr_token:'legacy-', 'veeam_vbr_token.1':'session'}
  const jar={get:key=>key in values ? {value:values[key]} : undefined}
  for (const marker of ['https://other.example:9419','http://vbr.example:9419','https://vbr.example:9420','about:blank','invalid','https://user@vbr.example:9419']) {
    values.veeam_vbr_token_url=marker
    for(const id of [undefined,'selected'])assert.equal(binding.vbrBrowserToken(jar,target,id,'Bearer header'),null)
  }
  values.veeam_vbr_token_url='https://VBR.example:9419/'
  assert.equal(binding.vbrBrowserToken(jar,target,'selected'),'legacy-session')
  delete values.veeam_vbr_token_url
  assert.equal(binding.vbrBrowserToken(jar,target,'selected','Bearer header'),null)
  assert.equal(binding.vbrBrowserToken(jar,target,undefined),'legacy-session')
  delete values.veeam_vbr_token
  assert.equal(binding.vbrBrowserToken(jar,target,undefined,'Bearer header'),'header')
  values.veeam_vbr_token_url=target.origin
  assert.equal(binding.vbrBrowserToken(jar,target,'selected','Bearer header'),null)
})
