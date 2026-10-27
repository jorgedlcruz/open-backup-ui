/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test')
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText
require.extensions['.ts']=(mod,file)=>mod._compile(compile(file),file)
const navigation=require('../lib/lens/navigation.ts'),{lensPreviews}=require('../lib/lens/previews.ts')
const collection=data=>({data,available:true,complete:true})
const snapshot=patch=>({sourceName:'VBR',range:'24h',from:'2026-10-24T00:00:00Z',fetchedAt:'2026-10-25T00:00:00Z',warnings:[],jobs:collection([]),sessions:collection([]),repositories:collection([]),security:collection([]),...patch})
const session=(id,result,extra={})=>({id,name:id,sessionType:'BackupJob',state:'Stopped',creationTime:'2026-10-24T12:00:00Z',result:{result},...extra})

test('only registered Lens IDs can select a starting route; malformed cookies fall back to Overview',()=>{
 for(const value of [undefined,null,'','dashboard','https://other.test','//other.test','../capacity','CAPACITY',{},['capacity']]){assert.equal(navigation.defaultLens(value),'overview');assert.equal(navigation.lensHref(value),'/vbr/lens/overview')}
 for(const lens of navigation.lenses){assert.equal(navigation.defaultLens(lens.id),lens.id);assert.equal(navigation.lensHref(lens.id),lens.href);assert.equal(navigation.lensForPath(lens.href),lens.id)}
 assert.equal(navigation.lensForPath('/vbr/lens/capacity/other'),null)
})
test('old dashboard, queue and capacity links preserve encoded queries without changing the target view',()=>{
 const target=navigation.legacyLensTarget('operations',{filter:'failed',name:'VM & database',tag:['a','b'],ignored:undefined}),url=new URL(target,'http://local')
 assert.equal(url.pathname,'/vbr/lens/operations');assert.equal(url.searchParams.get('filter'),'failed');assert.equal(url.searchParams.get('name'),'VM & database');assert.deepEqual(url.searchParams.getAll('tag'),['a','b']);assert.equal(url.searchParams.has('ignored'),false)
})
test('unavailable preview evidence never becomes a healthy zero',()=>{
 assert.equal(lensPreviews(null),null)
 const unavailable={data:[],available:false,complete:false},p=lensPreviews(snapshot({jobs:unavailable,sessions:unavailable,repositories:unavailable}))
 assert.equal(p.overview.summary,null);assert.equal(p.operations.attention,null);assert.equal(p.operations.active,null);assert.equal(p.capacity.atRisk,null);assert.equal(p.capacity.total,null)
})
test('genuine empty collections retain zero counts and an undefined success rate',()=>{
 const p=lensPreviews(snapshot());assert.equal(p.overview.summary.completed,0);assert.equal(p.overview.summary.percent,null);assert.equal(p.operations.attention,0);assert.equal(p.capacity.total,0)
})
test('mini activity charts fold the whole selected window and preserve protection-session totals',()=>{
 for(const [range,days] of [['24h',1],['7d',7],['30d',30]]){
  const end=Date.parse('2026-10-25T00:00:00Z'),from=new Date(end-days*86400000).toISOString(),sessions=Array.from({length:100},(_,i)=>session(String(i),['Success','Warning','Failed'][i%3],{creationTime:new Date(end-1-i/100*days*86400000).toISOString()}))
  sessions.push(session('restore','Success',{sessionType:'RestoreVm'}),session('active','Failed',{state:'Working'}))
  const p=lensPreviews(snapshot({range,from,sessions:collection(sessions)}));assert.ok(p.overview.activity.length<=12);assert.equal(p.overview.activity.reduce((n,b)=>n+b.Success+b.Warning+b.Failed,0),100);assert.equal(p.overview.summary.completed,100)
 }
})
test('job previews keep running retries separate from unresolved failed or warning jobs',()=>{
 const p=lensPreviews(snapshot({jobs:collection([{id:'retry',status:'Running',lastResult:'Failed'},{id:'fail',lastResult:'Failed'},{id:'warning',lastResult:'Warning'},{id:'unknown'}])}))
 assert.equal(p.operations.attention,2);assert.equal(p.operations.failed,1);assert.equal(p.operations.warning,1);assert.equal(p.operations.active,1)
})
test('capacity previews prioritize risk while keeping unknown utilization explicit',()=>{
 const repos=[{id:'unknown',name:'Unknown',capacityGB:-1,freeGB:-1},{id:'low',name:'Low',capacityGB:100,freeGB:15,isOnline:true},{id:'healthy',name:'Healthy',capacityGB:100,freeGB:100,isOnline:true},{id:'offline',name:'Offline',capacityGB:100,freeGB:80,isOnline:false},{id:'critical',name:'Critical',capacityGB:100,freeGB:1,isOnline:true}]
 const p=lensPreviews(snapshot({repositories:collection(repos)}));assert.equal(p.capacity.atRisk,3);assert.deepEqual(p.capacity.rows.map(r=>r.id),['offline','critical','low']);assert.equal(p.capacity.total,5);assert.equal(repos[0].id,'unknown')
 assert.equal(lensPreviews(snapshot({repositories:collection([repos[0]])})).capacity.rows[0].used,null)
})
test('preview evidence retains each collection completeness independently and avoids double-counting SOBR capacity',()=>{
 const p=lensPreviews(snapshot({jobs:{...collection([]),complete:false},repositories:collection([{id:'parent',name:'SOBR',capacityGB:100,freeGB:10},{id:'extent',name:'Extent',capacityGB:100,freeGB:10,scaleOutRepositoryDetails:{scaleOutRepositoryId:'parent'}}])}))
 assert.equal(p.operations.partial,true);assert.equal(p.capacity.partial,false);assert.equal(p.capacity.summary.total,100)
})
function preferenceHarness(value,protocol='http:'){
 const exports={},saved=[]
 class Response{static json(body,init={}){return {body,status:init.status||200,headers:init.headers,cookies:{set:(...args)=>saved.push(args)}}}}
 vm.runInNewContext(compile('app/api/settings/protection-lens/route.ts'),{exports,require:name=>({'next/server':{NextResponse:Response},'next/headers':{cookies:async()=>({get:()=>value===undefined?undefined:{value}})},'@/lib/lens/navigation':navigation}[name]),JSON,Error,Object,Array})
 const request=(body,headers={})=>({nextUrl:new URL(`${protocol}//local/api/settings/protection-lens`),headers:new Headers({origin:`${protocol}//local`,...headers}),text:async()=>typeof body==='string'?body:JSON.stringify(body)})
 return {exports,saved,request}
}
test('preference writes persist a browser cookie that survives sessions, without changing shared server settings',async()=>{
 const h=preferenceHarness('overview','https:'),result=await h.exports.PUT(h.request({defaultView:'capacity'}));assert.equal(result.status,200);assert.equal(result.body.defaultView,'capacity');const [name,value,options]=h.saved[0];assert.equal(name,navigation.lensCookie);assert.equal(value,'capacity');assert.equal(options.httpOnly,true);assert.equal(options.path,'/');assert.equal(options.sameSite,'lax');assert.equal(options.secure,true);assert.equal(options.maxAge,31536000);assert.equal(result.headers['Cache-Control'],'private, no-store')
 const next=preferenceHarness(value);assert.equal((await next.exports.GET()).body.defaultView,'capacity')
})
test('malformed and foreign-origin preference changes do not set cookies',async()=>{
 for(const body of [{defaultView:'https://other.test'},{defaultView:'capacity',extra:true},[],null,'invalid JSON','x'.repeat(1001)]){const h=preferenceHarness();assert.equal((await h.exports.PUT(h.request(body))).status,400);assert.equal(h.saved.length,0)}
 for(const headers of [{origin:'https://foreign.test'},{'sec-fetch-site':'cross-site'}]){const h=preferenceHarness();assert.equal((await h.exports.PUT(h.request({defaultView:'capacity'},headers))).status,403);assert.equal(h.saved.length,0)}
})
test('missing or invalid saved preferences read as Overview',async()=>{for(const value of [undefined,'invalid']){const h=preferenceHarness(value);assert.equal((await h.exports.GET()).body.defaultView,'overview')}})
async function redirectFrom(file,values={},env={},args){
 const exports={};let target
 const deps={'next/headers':{cookies:async()=>({get:name=>values[name]?{value:values[name]}:undefined})},'next/navigation':{redirect:url=>{target=url;throw Error('redirect')}},'@/lib/lens/navigation':navigation,'@/lib/utils/cookie-manager':{getChunkedCookie:(jar,name)=>jar.get(name)?.value}}
 vm.runInNewContext(compile(file),{exports,require:name=>deps[name],process:{env}})
 await exports.default(args).catch(e=>{if(e.message!=='redirect')throw e});return target
}
test('sign-in landing enters Lens for VBR and preserves other platform fallbacks',async()=>{
 assert.equal(await redirectFrom('app/(app)/dashboard/page.tsx',{veeam_source_id:'source'}),'/vbr/lens')
 assert.equal(await redirectFrom('app/(app)/dashboard/page.tsx',{veeam_vb365_token:'token'}),'/vbm/dashboard')
 assert.equal(await redirectFrom('app/(app)/dashboard/page.tsx',{}),'/connect')
 assert.equal(await redirectFrom('app/page.tsx',{veeam_source_id:'source'}),'/dashboard')
 assert.equal(await redirectFrom('app/(app)/vbr/lens/page.tsx',{[navigation.lensCookie]:'capacity'}),'/vbr/lens/capacity')
 assert.equal(await redirectFrom('app/(app)/vbr/lens/page.tsx',{[navigation.lensCookie]:'https://other.test'}),'/vbr/lens/overview')
})
test('legacy route redirects retain their explicit view instead of following the default',async()=>{
 assert.equal(await redirectFrom('app/(app)/vbr/dashboard/page.tsx',{}, {},{searchParams:Promise.resolve({})}),'/vbr/lens/overview')
 assert.equal(await redirectFrom('app/(app)/vbr/operations/page.tsx',{}, {},{searchParams:Promise.resolve({filter:'failed'})}),'/vbr/lens/operations?filter=failed')
 assert.equal(await redirectFrom('app/(app)/vbr/capacity/page.tsx',{}, {},{searchParams:Promise.resolve({})}),'/vbr/lens/capacity')
})
