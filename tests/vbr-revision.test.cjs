// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},
}).outputText,file)
const {detectVbrRevision,sourceRevision,UnsupportedVbrRevision} = require('../lib/vbr/revision.ts')
const {fetchVbrCompatible} = require('../lib/vbr/compatible-fetch.ts')
const builds = ['13.0.0.4967','13.0.1.180','13.1.0.411','13.2.0.2411']
const info = buildVersion => ({buildVersion,vbrId:'96e536d4-c850-4346-91b7-892d4399922c',name:'fixture'})
const rejected = () => Response.json({errorCode:'NotImplemented',message:'Unsupported RESTAPI version.'},{status:501})
for (const [maximum,build] of builds.entries()) {
  test('negotiates the highest implemented revision for '+build,async()=>{
    const wanted='1.3-rev'+maximum
    const calls=[]
    const revision=await detectVbrRevision(async(path,version)=>{
      assert.equal(path,'/api/v1/serverInfo')
      calls.push(version)
      if(version>wanted)throw new UnsupportedVbrRevision()
      return info(build)
    })
    assert.equal(revision,wanted)
    assert.equal(calls.length,4-maximum)
    assert.equal(await detectVbrRevision(async()=>info(build)),wanted,'old build ignoring the header')
  })
}

test('caches only confirmed results per source, with bounded refresh',async t=>{
  let now=1000
  t.mock.method(Date,'now',()=>now)
  let attempts=0
  const read=async()=>{attempts++;return info('13.2.0.2411')}
  assert.equal(await sourceRevision('fixture-new',read),'1.3-rev3')
  assert.equal(await sourceRevision('fixture-new',read),'1.3-rev3')
  assert.equal(attempts,1)
  assert.equal(await sourceRevision('fixture-old',async()=>info(builds[0])),'1.3-rev0')
  now+=6*60_000
  await assert.rejects(sourceRevision('fixture-new',async()=>({version:'13.2'})),/server information/)
  assert.equal(await sourceRevision('fixture-new',read),'1.3-rev3')
  assert.equal(attempts,2)
})

test('auth, transport and unexpected errors stop exact negotiation',async()=>{
  for(const error of [new Error('403'),new Error('502'),new Error('aborted')]) {
    let attempts=0
    await assert.rejects(detectVbrRevision(async()=>{attempts++;throw error}),e=>e===error)
    assert.equal(attempts,1)
  }
  assert.equal(await detectVbrRevision(async()=>info('14.0.0.1000')),'1.3-rev3')
})

test('legacy reads can use rev0 and mutations are issued once at their supported revision',async t=>{
  const calls=[]
  const headers={Authorization:'Bearer fixture','x-api-version':'1.3-rev1'}
  t.mock.method(global,'fetch',async(url,init)=>{
    const path=new URL(url).pathname, rev=new Headers(init.headers).get('x-api-version')
    const method=init.method||'GET'
    calls.push([method,path,rev])
    if(path.endsWith('/serverInfo'))return rev==='1.3-rev0'?Response.json(info(builds[0])):rejected()
    if(method==='POST')throw Error('connection lost')
    return rev==='1.3-rev0'?Response.json({data:[]}):rejected()
  })
  const url='https://legacy.invalid/api/v1/jobs'
  assert.deepEqual(await (await fetchVbrCompatible(url,{headers})).json(),{data:[]})
  await assert.rejects(fetchVbrCompatible(url,{method:'POST',headers,body:'{}'}),/connection lost/)
  assert.deepEqual(calls.filter(([verb])=>verb==='POST'),[['POST','/api/v1/jobs','1.3-rev0']])
})

test('a normal validation failure on an old read is returned without probing or changing revision',async t=>{
  let count=0
  t.mock.method(global,'fetch',async()=>{count++;return Response.json({message:'Invalid object ID'},{status:400})})
  const response=await fetchVbrCompatible('https://bad-id.invalid/api/v1/jobs',{headers:{Authorization:'Bearer fixture','x-api-version':'1.3-rev2'}})
  assert.equal(response.status,400)
  assert.equal(count,1)
})
