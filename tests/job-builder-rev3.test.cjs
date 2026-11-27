// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const {validateNativeJob,normalizedEstimate}=require('../lib/job-builder/rev3-validation')
const {supportedJob,nativeJobNames}=require('../lib/job-builder/native-job-types')
const {requireRev3,checkNativeRequest,readNativeJob}=require('../lib/job-builder/rev3-requests')
const {pluginObjects}=require('../lib/job-builder/platform-job-options')
const examples=require('./fixtures/rev3-jobs.json')
const {initialField,jobDefinition}=require('../lib/job-builder/rev3-form')
const id='88888888-8888-4888-8888-888888888888'
for(const [type,example] of Object.entries(examples))test('VBR rev3 contract for '+type,()=>{
  assert.ok(supportedJob(type));assert.ok(nativeJobNames[type])
  assert.equal(initialField(jobDefinition(type,false)).type,type)
  assert.equal(validateNativeJob(type,false,example),null)
  const editing={...example,id}
  assert.equal(validateNativeJob(type,true,editing),null)
  assert.ok(validateNativeJob(type,false,editing))
  assert.ok(validateNativeJob(type,false,{...example,unsupportedField:true}))
})
test('only the selected source can submit native jobs, and an unconfirmed create is never repeated', async t=>{
  const Module=require('node:module')
  const {createHash}=require('node:crypto')
  const source={id:'vbr-example',platform:'vbr',protocol:'https',host:'vbr.example',port:9419}
  const origin='https://vbr.example:9419/'
  const scope=createHash('sha256').update(JSON.stringify([origin,source.id])).digest('hex')
  const original=Module._load
  let sendRev3Job
  try {
    Module._load=function(name,parent,...rest){
      if(parent?.filename.endsWith('vbr-rev3-jobs.ts') || parent?.filename.endsWith('vbr-write-source.ts')){
        if(name==='next/headers')return {cookies:async()=>({get:key=>key==='veeam_source_id'?{value:source.id}:undefined})}
        if(name==='next/server')return {NextResponse:Response}
        if(name==='./config-store')return {configStore:{getById:()=>source}}
        if(name==='./token-manager')return {tokenManager:{getToken:async()=>'mock'}}
      }
      return original.call(this,name,parent,...rest)
    }
    ;({sendRev3Job}=require('../lib/server/vbr-rev3-jobs'))
  }finally{Module._load=original}
  const request=new Request('https://ui.example/')
  const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json({id,name:'Example'}))
  assert.equal((await sendRev3Job(request,'different','create',examples.StorageCopy)).status,409)
  assert.equal(fetch.mock.callCount(),0)
  assert.equal((await sendRev3Job(request,scope,'edit',{...examples.StorageCopy,id},id)).status,200)
  const [target,options]=fetch.mock.calls[0].arguments
  assert.equal(String(target),origin+'api/v1/jobs/'+id)
  assert.equal(options.method,'PUT')
  assert.equal(options.headers['x-api-version'],'1.3-rev3')
  fetch.mock.mockImplementation(async()=>{throw new TypeError('Connection lost')})
  const response=await sendRev3Job(request,scope,'create',examples.StorageCopy)
  assert.equal(response.status,502)
  assert.equal((await response.json()).uncertain,true)
  assert.equal(fetch.mock.callCount(),2)
})
test('native job revision, source and platform gates',()=>{
  for(const rev of ['1.3-rev0','1.3-rev1','1.3-rev2','garbage'])assert.throws(()=>requireRev3(rev,'a','a'),/requires VBR/)
  assert.throws(()=>requireRev3('1.3-rev3','a','b'),/source changed/)
  assert.doesNotThrow(()=>requireRev3('1.3-rev3','a','a'))
  for(const type of ['XenBackupJob','__proto__','constructor'])assert.equal(supportedJob(type),false)
  const original=structuredClone(examples.RedHatOpenStackBackupJob)
  original.objects.includes[0].platform='Virtuozzo'
  assert.ok(validateNativeJob(original.type,false,original));original.objects.includes=[];assert.ok(validateNativeJob(original.type,false,original))
})
test('edits refuse stale snapshots or a different job identity',async()=>{
  const type='VirtuozzoBackupJob',job={...examples[type],id}
  const read=async(path,revision)=>{assert.equal(path,'/api/v1/jobs/'+id);assert.equal(revision,'1.3-rev3');return job}
  const {version}=await readNativeJob(read,type,id)
  const input={type,id,version,job:{...job,name:'Updated VM policy'}}
  await checkNativeRequest(input,read)
  await assert.rejects(checkNativeRequest({...input,version:'wrong'},read),/changed/)
  await assert.rejects(checkNativeRequest({...input,job:{...job,id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'}},read),/Reload/)
})
test('protected size uses the task aggregate and preserves partial, warning and stopped states',()=>{
  const task={id,state:'Working',result:'None',progressPercent:50,type:'JobSourcesSizeCalculation',totalSize:40,items:[{state:'Calculated',size:35},{state:'Calculated',size:35},{state:'Pending'}]}
  assert.deepEqual(normalizedEstimate(task),{id,state:'Working',result:'None',progressPercent:50,totalSize:40,calculated:2,total:3})
  assert.equal(normalizedEstimate({...task,state:'Stopped',result:'Warning'}).result,'Warning')
  assert.throws(()=>normalizedEstimate({...task,type:'AnotherTask'}))
})
test('a provider object picker retains tenant identity, rejects foreign hosts and pages without including display secrets',async()=>{
  const browse=async(host,skip,limit,revision)=>{
    assert.equal(revision,'1.3-rev3')
    if(!host)return {data:[{platform:'Virtuozzo',hostName:'mgr'}],pagination:{total:1}}
    assert.equal(host,'mgr');assert.equal(limit,100)
    return {data:[{name:'vm',objectId:'vm1',type:'VirtualMachine',platform:'Virtuozzo',domainId:'dom',projectId:'proj',clusterId:'cl',extra:'private',regionId:null}],pagination:{total:2}}
  }
  const result=await pluginObjects(browse,'Virtuozzo','mgr',0)
  assert.equal(result.nextOffset,1);assert.deepEqual(result.data[0],{name:'vm',objectId:'vm1',type:'VirtualMachine',platform:'Virtuozzo',domainId:'dom',projectId:'proj',clusterId:'cl'})
  await assert.rejects(pluginObjects(browse,'Virtuozzo','other',0),/Choose an inventory server/)
})
