const fs=require('node:fs'),ts=require('typescript'),Module=require('node:module'),{createHash}=require('node:crypto');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const {test}=require('node:test'),assert=require('node:assert/strict');
const source={id:'test-source',platform:'vbr',protocol:'https',host:'vbr.example',port:9419};
const originalLoad=Module._load;
let refreshes=0;
Module._load=function(request,parent,isMain){
  if(parent?.filename.endsWith('vbr-job-create.ts')){
    if(request==='next/headers')return {cookies:async()=>({get:name=>name==='veeam_source_id'?{value:source.id}:undefined})};
    if(request==='next/server')return {NextResponse:{json:(value,init)=>Response.json(value,init)}};
    if(request==='./config-store')return {configStore:{getById:()=>source}};
    if(request==='./token-manager')return {tokenManager:{getToken:async()=>'test-token',refreshToken:async()=>{refreshes++;return 'refreshed-test-token'}}};
  }
  return originalLoad.call(this,request,parent,isMain);
};
const {createVbrJob}=require('../lib/server/vbr-job-create.ts');
Module._load=originalLoad;
const {newDraft}=require('../lib/job-builder/model.ts');
const id='00000000-0000-4000-8000-000000000001',scope=createHash('sha256').update(JSON.stringify(['https://vbr.example:9419/',source.id])).digest('hex');
const draft=()=>({...newDraft('VSphere',scope),name:'Test',repositoryId:id,includes:[{platform:'VSphere',type:'VirtualMachine',hostName:'vc.example',name:'VM',objectId:'vm-1'}]});
test('creation transport: single POST, no start call, no retry of ambiguous outcomes',async t=>{
  const originalFetch=global.fetch;
  try {
    await t.test('confirmed creation returns identity and only posts the native payload',async()=>{
      const calls=[];global.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json({id,name:'Test'},{status:201})};
      const response=await createVbrJob({signal:new AbortController().signal},draft(),'1.3-rev2');assert.equal(response.status,201);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://vbr.example:9419/api/v1/jobs');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.headers['x-api-version'],'1.3-rev2');assert.ok(!calls[0].init.body.includes('sourceKey'));
    });
    await t.test('server error and dropped connection never trigger a second POST',async()=>{
      for(const result of [()=>Response.json({message:'Server error'},{status:503}),()=>{throw new TypeError('connection lost')}]){let calls=0;global.fetch=async()=>{calls++;return result()};const response=await createVbrJob({signal:new AbortController().signal},draft(),'1.3-rev2');assert.equal(response.status,502);assert.equal((await response.json()).uncertain,true);assert.equal(calls,1);}
    });
    await t.test('accepted response without identity is uncertain',async()=>{global.fetch=async()=>Response.json({}, {status:201});const response=await createVbrJob({signal:new AbortController().signal},draft(),'1.3-rev2');assert.equal((await response.json()).uncertain,true)});
    await t.test('authentication rejection can refresh once; a validation rejection cannot',async()=>{
      refreshes=0;let calls=0;global.fetch=async()=>++calls===1?Response.json({}, {status:401}):Response.json({id,name:'Test'},{status:201});const response=await createVbrJob({signal:new AbortController().signal},draft(),'1.3-rev2');assert.equal(response.status,201);assert.equal(calls,2);assert.equal(refreshes,1);
      calls=0;global.fetch=async()=>{calls++;return Response.json({message:'Invalid job'}, {status:400})};const rejected=await createVbrJob({signal:new AbortController().signal},draft(),'1.3-rev2');assert.equal(rejected.status,400);assert.equal((await rejected.json()).uncertain,false);assert.equal(calls,1);
    });
    await t.test('source mismatch is rejected before any mutation',async()=>{let calls=0;global.fetch=async()=>{calls++;throw new Error('must not call')};const response=await createVbrJob({signal:new AbortController().signal},{...draft(),sourceKey:'b'.repeat(64)},'1.3-rev2');assert.equal(response.status,409);assert.equal(calls,0)});
  }finally{global.fetch=originalFetch}
});
