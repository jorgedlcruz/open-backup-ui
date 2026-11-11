// Open Backup UI v1.2.0
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)
const {unstructuredTargetBrowse,targetBrowsePermissions}=require('../lib/recovery/unstructured-target-browser.ts')
const {unstructuredAction,unstructuredCommand}=require('../lib/recovery/unstructured.ts')
const {targetPathWithin,targetFolderPath}=require('../lib/restore-points/target-folders.ts')
const {VbrRecoveryError}=require('../lib/recovery/error.ts')
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0')
const sourceKey='a'.repeat(64),cacheKey='b'.repeat(64),sessionId=id(1),destinationId=id(2),browseSessionId=id(3)
const rights=new Set(targetBrowsePermissions),base='/api/v1/inventory/unstructuredDataServers'
function fixture(overrides={}){
  const requests=[]
  const native={sessionId:browseSessionId,serverId:destinationId,serverName:'192.168.1.3',timeout:10,pathSeparator:'/',rootPath:'/',...overrides}
  const ctx={sourceKey,cacheKey,secret:'fixture-secret',send:async(url,o={})=>{
    requests.push([url,o])
    if(url.split('?')[0]===base)return {data:[{id:destinationId,type:'FileServer',name:'192.168.1.3'}],pagination:{total:1}}
    if(url===base+'/'+destinationId+'/startBrowse?timeout=10'||url===base+'/sessions/'+browseSessionId)return native
    if(url===base+'/sessions/'+browseSessionId+'/stop')return native
    if(url===base+'/sessions/'+browseSessionId+'/browse')return {path:o.body.path,items:[
      {name:'mnt',itemType:'Folder',fullName:'/mnt',isSymbolicLink:false},
      {name:'bin',itemType:'Folder',fullName:'/bin',isSymbolicLink:true},
      {name:'file',itemType:'File',fullName:'/file'},
    ],pagination:{total:203,count:3,skip:o.body.pagination.skip}}
    throw new Error('Unexpected route '+url)
  }}
  return {ctx,requests,native}
}
async function start(ctx){return unstructuredTargetBrowse(ctx,{action:'startTargetBrowse',sessionId,destinationId},rights)}
const command=(lease,action='browseTarget',extra={})=>({action,sessionId,destinationId,browseSessionId:lease.browseSessionId,browseKey:lease.browseKey,path:'/',skip:0,limit:200,...extra})

test('destination browsing follows native start, folder paging and stop without a restore request',async()=>{
  const {ctx,requests}=fixture(),lease=await start(ctx)
  assert.equal(lease.rootPath,'/');assert.equal(lease.pathSeparator,'/');assert.equal(lease.serverId,destinationId)
  const page=await unstructuredTargetBrowse(ctx,command(lease,'browseTarget',{skip:200}),rights)
  assert.deepEqual(page,{path:'/',items:[{name:'mnt',path:'/mnt',type:'Folder',isSymbolicLink:false},{name:'bin',path:'/bin',type:'Folder',isSymbolicLink:true}],total:203,count:3,skip:200})
  assert.deepEqual(requests.at(-1),[base+'/sessions/'+browseSessionId+'/browse',{method:'POST',body:{path:'/',order:{orderColumn:'Type',orderAsc:true},filter:{itemTypes:['Drive','Folder']},pagination:{skip:200,limit:200}}}])
  assert.deepEqual(await unstructuredTargetBrowse(ctx,command(lease,'stopTargetBrowse'),rights),{closed:true})
  assert.equal(requests.at(-1)[0],base+'/sessions/'+browseSessionId+'/stop')
  assert.ok(requests.every(([url])=>!url.includes('/copyTo')&&!url.includes('/restore')&&!url.includes('/backupBrowser')))
})

test('browse keys bind source, principal, parent restore, target and native browsing session',async()=>{
  const {ctx,requests}=fixture(),lease=await start(ctx),original=requests.length
  for(const changed of [{sourceKey:'c'.repeat(64)},{cacheKey:'d'.repeat(64)},{secret:'other'}]){
    await assert.rejects(unstructuredTargetBrowse({...ctx,...changed},command(lease),rights),/unavailable/)
  }
  for(const changed of [{sessionId:id(8)},{destinationId:id(8)},{browseSessionId:id(8)},{browseKey:'x'.repeat(50)}]){
    await assert.rejects(unstructuredTargetBrowse(ctx,command(lease,'browseTarget',changed),rights),/unavailable/)
  }
  assert.equal(requests.length,original)
  const send=ctx.send
  ctx.send=async(url,o)=>url===base+'/sessions/'+browseSessionId?{...(await send(url,o)),serverId:id(9)}:send(url,o)
  await assert.rejects(unstructuredTargetBrowse(ctx,command(lease),rights),/unavailable/)
  await assert.rejects(unstructuredTargetBrowse(ctx,command(lease,'stopTargetBrowse'),rights),/unavailable/)
  assert.ok(requests.every(([url])=>!url.endsWith('/browse')&&!url.endsWith('/stop')))
})

test('native folder paths retain spaces and case while rejecting traversal and cross-root entries',async()=>{
  const {ctx,requests}=fixture({rootPath:'/srv/data'}),lease=await start(ctx),send=ctx.send
  for(const path of ['/srv/database','/srv/data/../secret','/srv/data/./secret','//remote/share','/srv/data\u0000']){
    await assert.rejects(unstructuredTargetBrowse(ctx,command(lease,'browseTarget',{path}),rights),/within/)
  }
  ctx.send=async(url,o)=>url.endsWith('/browse')?{path:o.body.path,items:[
    {name:' reports ',itemType:'Folder',fullName:'/srv/data/ reports '},
    {name:'foreign',itemType:'Folder',fullName:'/srv/database'},
    {name:'parent',itemType:'Folder',fullName:'/srv/data/..'},
  ],pagination:{total:3,skip:0}}:send(url,o)
  const page=await unstructuredTargetBrowse(ctx,command(lease,'browseTarget',{path:'/srv/data'}),rights)
  assert.deepEqual(page.items.map(item=>item.path),['/srv/data/ reports '])
  assert.ok(requests.every(([url])=>!url.endsWith('/browse')))
  assert.equal(targetPathWithin('C:\\Files\\A','c:\\files','\\'),true)
  assert.equal(targetPathWithin('C:\\FilesOther','C:\\Files','\\'),false)
  assert.equal(targetPathWithin('\\\\host\\share\\folder','\\\\host\\share','\\'),true)
  assert.equal(targetPathWithin('\\\\other\\share','\\\\host\\share','\\'),false)
  assert.equal(targetPathWithin('C:\\','', '\\'),true)
  assert.equal(targetPathWithin('\\\\host\\share','', '\\'),false)
  assert.equal(targetFolderPath({itemType:'Drive',name:'C:'},'\\'),'C:\\')
  assert.equal(targetFolderPath({itemType:'Folder',name:'ignored',fullName:'/ actual '},'/'),'/ actual ')
})

test('mismatched native page paths or offsets never supply a destination',async()=>{
  const {ctx}=fixture(),lease=await start(ctx),send=ctx.send
  for(const result of [{path:'/elsewhere',items:[]},{path:'/',items:[],pagination:{total:0,skip:200}}]){
    ctx.send=async(url,o)=>url.endsWith('/browse')?result:send(url,o)
    await assert.rejects(unstructuredTargetBrowse(ctx,command(lease),rights),/unavailable/)
  }
})

test('closing a destination browser works after its source restore ends, and expiry cleanup is idempotent',async()=>{
  const {ctx,requests}=fixture(),lease=await start(ctx)
  ctx.privateSend=async()=>({permissions:[...rights]})
  const input=unstructuredCommand.parse({sourceKey,sessionId,view:'browse',action:'stopTargetBrowse',destinationId,browseSessionId,browseKey:lease.browseKey})
  assert.deepEqual(await unstructuredAction(ctx,input),{closed:true})
  assert.ok(requests.every(([url])=>!url.includes('/backupBrowser')))
  const send=ctx.send
  ctx.send=async(url,o)=>{if(url===base+'/sessions/'+browseSessionId)throw new VbrRecoveryError('Expired',404);return send(url,o)}
  assert.deepEqual(await unstructuredTargetBrowse(ctx,command(lease,'stopTargetBrowse'),new Set(['StopBrowseUnstructuredDataServer'])),{closed:true})
})

test('folder browsing requires native permissions and cannot start an object storage browser',async()=>{
  const {ctx,requests}=fixture()
  await assert.rejects(unstructuredTargetBrowse(ctx,{action:'startTargetBrowse',sessionId,destinationId},new Set(['CopyUnstructuredDataFlrItem'])),/unavailable/)
  assert.equal(requests.length,0)
  const send=ctx.send
  ctx.send=async(url,o)=>url.split('?')[0]===base?{data:[{id:destinationId,type:'AmazonS3',name:'bucket'}],pagination:{total:1}}:send(url,o)
  await assert.rejects(start(ctx),/Select a destination/)
  assert.equal(requests.length,0)
  assert.equal(unstructuredCommand.safeParse({action:'browseTarget',sourceKey,sessionId,view:'browse',destinationId,browseSessionId,browseKey:'x',path:'/',skip:0,limit:201}).success,false)
})
