// Open Backup UI v1.3.0
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript'), Module = require('node:module')

require.extensions['.ts'] = (mod,file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true },
}).outputText,file)

test('configured job states use the selected source revision and preserve state filters', async () => {
  const calls=[]
  let revision
  const original=Module._load
  let GET
  try {
    Module._load=function(name,parent,...args) {
      if(parent?.filename.endsWith('route.ts')){
        if(name==='next/headers')return {cookies:async()=>({get:key=>key==='veeam_source_id'?{value:'source'}:undefined})}
        if(name==='next/server')return {NextResponse:Response}
        if(name==='@/lib/server/token-manager')return {}
        if(name==='@/lib/investigation/model')return {validId:id=>/^[0-9a-f-]{36}$/.test(id)}
        if(name==='@/lib/server/vbr-read')return {withVbrRead:async(_request,callback)=>Response.json(await callback(
          async(path,actual)=>{calls.push({path,actual});return {data:[]}},'VBR',null,{getRevision:async()=>revision}
        ))}
      }
      return original.call(this,name,parent,...args)
    }
    ;({GET}=require('../app/api/veeam/jobs/[id]/route.ts'))
  }finally{Module._load=original}
  for(revision of ['1.3-rev0','1.3-rev1','1.3-rev2','1.3-rev3']){
    const nextUrl=new URL('https://ui.example/api/veeam/jobs/states?skip=100&limit=100&typeFilter=StorageCopy')
    const result=await GET({nextUrl},{params:Promise.resolve({id:'states'})})
    assert.equal(result.status,200)
    assert.deepEqual(calls.at(-1),{path:'/api/v1/jobs/states'+nextUrl.search,actual:revision})
  }
})
