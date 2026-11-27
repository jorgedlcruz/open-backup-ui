// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {randomUUID}=require('node:crypto')
const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
// Scope test receipts to this process's temporary directory. Never monitor fixtures or write into runtime data/.
const auditModule=require('../lib/vbm-recovery/restore-audit.ts'),os=require('node:os'),auditPath=require('node:path')
const auditPrefix=auditPath.join(os.tmpdir(),'open-backup-vbm-restore-test-'),auditRoot=fs.mkdtempSync(auditPrefix)
const testStore=auditModule.createRestoreAudit(auditRoot),{createHash}=require('node:crypto')
auditModule.restoreAudit=Object.fromEntries(Object.entries(testStore).map(([key,method])=>[key,key==='watch'?()=>true:
  (scope,...args)=>method(createHash('sha256').update(scope).digest('hex'),...args)]))
require('node:test').after(()=>{if(!auditPath.resolve(auditRoot).startsWith(auditPath.resolve(auditPrefix)))throw Error('Invalid audit fixture directory');fs.rmSync(auditRoot,{recursive:true,force:true})})
const m=require('../lib/vbm-recovery/model.ts')
const {browsePath,searchPath,entityPath,restoreGroups}=require('../lib/vbm-recovery/paths.ts')
const {recoveryTransport,assertRecoveryOrigin}=require('../lib/vbm-recovery/transport.ts')
const {beginBrowseSession,recoveryGet,recoveryPost,suggestedOwner}=require('../lib/vbm-recovery/load.ts')
const {once,requestReceipt}=require('../lib/vbm-recovery/store.ts')
const client=require('../components/vbm-recovery/client.ts')
const sid='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',repo='33333333-3333-4333-8333-333333333333',op='44444444-4444-4444-8444-444444444444'
const browse=(overrides={})=>m.browseSchema.parse({sessionId:sid,workload:'Exchange',kind:'items',ownerId:'owner',...overrides})
const input=(overrides={})=>m.restoreSchema.parse({action:'restore',requestId:randomUUID(),sessionId:sid,workload:'Exchange',items:[{id:'item',ownerId:'owner',kind:'item'}],auth:{mode:'deviceCode',userCode:'temporary-code'},options:{destination:'original'},...overrides})
const document=id=>({id,name:'report.docx',sizeBytes:1024,createdBy:'Jorge',creationTime:'2026-11-01T10:00:00Z',modifiedBy:'Jorge',modificationTime:'2026-11-01T10:00:00Z',_links:{danger:{href:'https://other.invalid'}}})

test('session status is one lightweight read; browsing logs skip item-restore statistics',async()=>{
  const paths=[],context={scope:randomUUID(),sourceName:'test',execute:async path=>{paths.push(path);return path.endsWith('/'+sid)?{id:sid,name:'Backup',type:'Vesp',state:'Working'}:path.includes('/Statistics')?{totalItemsCount:3}:{results:[]}}}
  const state=await recoveryGet(context,{action:'sessionState',sessionId:sid})
  assert.equal(state.session.state,'Working');assert.deepEqual(paths,[`/v8/RestoreSessions/${sid}`]);paths.length=0
  const browsing=await recoveryGet(context,{action:'session',sessionId:sid})
  assert.equal(browsing.statistics,null);assert.deepEqual(browsing.warnings,[]);assert.equal(paths.length,2);assert.ok(paths.every(path=>!path.includes('Statistics')))
  const operation=await recoveryGet(context,{action:'session',sessionId:sid,includeStatistics:'true'})
  assert.equal(operation.statistics.totalItemsCount,3)
})

test('working sessions report final-only statistics as capability, preserve events, and never imply success',async()=>{
  const {RestoreStatisticsPendingError}=require('../lib/vbm-recovery/transport.ts')
  const execute=async path=>{if(path.endsWith('/'+sid))return {id:sid,type:'Vex',state:'Working',result:'Success'};if(path.endsWith('/Statistics'))throw new RestoreStatisticsPendingError();return {results:[{id:'event',type:'None',message:'Restore session started'}]}}
  const result=await recoveryGet({scope:randomUUID(),sourceName:'test',execute},{action:'session',sessionId:sid,includeStatistics:'true'})
  assert.equal(result.statisticsAvailability,'afterCompletion');assert.equal(result.statistics,null);assert.deepEqual(result.warnings,[]);assert.equal(result.events.length,1);assert.equal(result.session.state,'Working')
})

test('statistics errors on stopped sessions and unrelated conflicts remain visible',async()=>{
  const {RestoreStatisticsPendingError}=require('../lib/vbm-recovery/transport.ts')
  for(const [state,error] of [['Stopped',new RestoreStatisticsPendingError()],['Working',new m.RecoveryError('Other conflict',409)]]){
    const execute=async path=>{if(path.endsWith('/'+sid))return {id:sid,type:'Vex',state};if(path.endsWith('/Statistics'))throw error;return {results:[]}}
    const result=await recoveryGet({scope:randomUUID(),sourceName:'test',execute},{action:'session',sessionId:sid,includeStatistics:'true'})
    assert.equal(result.statisticsAvailability,'unavailable');assert.deepEqual(result.warnings,['Restore statistics could not be loaded.'])
  }
})

test('unavailable and timed-out Explorer reads cannot be mistaken for empty SharePoint folders',async()=>{
  for(const status of [404,504]) {
    const context={scope:randomUUID(),sourceName:'test',execute:async path=>{if(path.endsWith('/'+sid))return {id:sid,type:'Vesp',state:'Working'};throw new m.RecoveryError('upstream',status)}}
    await assert.rejects(()=>recoveryGet(context,{action:'browse',sessionId:sid,workload:'SharePoint',kind:'owners'}),error=>error.status===status && /explorer|60 seconds/.test(error.message))
  }
})

test('only an initial missing owners collection receives the browser retry diagnostic',async()=>{
  const {browseCollectionNotFound}=require('../lib/vbm-recovery/read-retry.ts')
  for(const [metadata,code,query,expected] of [
    [true,'ResourceNotFound',{},browseCollectionNotFound],
    [false,'ResourceNotFound',{},'ResourceNotFound'],
    [true,'HttpError',{},undefined],
    [true,'ResourceNotFound',{offset:100},undefined],
    [true,'ResourceNotFound',{kind:'folders',ownerId:'test'},undefined],
    [true,'ResourceNotFound',{workload:'SharePoint',parentId:'subsite'},undefined],
  ]) {
    const execute=recoveryTransport({baseUrl:'https://vbm.test',token:'test',refresh:async()=>null,fetcher:async url=>{
      if(metadata && url.pathname.endsWith('/'+sid))return Response.json({id:sid,type:query.workload==='SharePoint'?'Vesp':'Vex',state:'Working'})
      return Response.json({errorCode:code},{status:404})
    }})
    await assert.rejects(()=>recoveryGet({execute,scope:randomUUID(),sourceName:'test'},{action:'browse',sessionId:sid,workload:'Exchange',kind:'owners',...query}),err=>err.status===404 && err.code===expected)
  }
})

test('vendor diagnostic codes identify busy or timed-out APIs without leaking payloads',async()=>{
  for(const code of ['OperationConflict','ProxyOffline','Timeout','not-allowlisted-secret']) {
    const execute=recoveryTransport({baseUrl:'https://vbm.test',token:'secret',refresh:async()=>null,fetcher:async()=>new Response(JSON.stringify({errorCode:code,message:'password secret',stackTrace:'secret stack'}),{status:500})})
    await assert.rejects(()=>execute(`/v8/RestoreSessions/${sid}/Stop`,'POST'),error=>error.outcomeUnknown && !error.message.includes('secret') && !error.message.includes('stack') && (code.startsWith('not-') || error.message.includes(code)))
  }
})

test('browse paths preserve opaque IDs, constrain lazy root paging and do not follow source links',()=>{
  const value=browse({ownerId:'owner/with?special',parentId:'folder/&x=2'})
  const url=new URL(browsePath(value),'https://source.test')
  assert.equal(url.pathname,`/v8/RestoreSessions/${sid}/organization/mailboxes/owner%2Fwith%3Fspecial/items`)
  assert.equal(url.searchParams.get('parentId'),'folder/&x=2')
  assert.equal(new URL(browsePath(browse()),'https://source.test').searchParams.get('parentId'),'root')
  const page=m.normalizeItems({results:[{id:'x',subject:'Message'}],_links:{next:{href:'https://evil.invalid'}}},browse())
  assert.equal(page.hasMore,true);assert.equal(page.nextOffset,1);assert.equal(page.items[0].name,'Message')
})
test('Teams file and post listing and search are scoped to the chosen channel',()=>{
  for(const kind of ['files','posts']) {
    const args=browse({workload:'Teams',kind,channelId:'channel-id'})
    const path=new URL(browsePath(args),'https://source.test'),search=new URL(searchPath(args),'https://source.test')
    assert.equal(path.searchParams.get('channelId'),'channel-id');assert.equal(search.searchParams.get('channelId'),'channel-id')
    assert.equal(path.searchParams.get('parentId'),kind==='posts' ? '-1':'root')
  }
  assert.throws(()=>browsePath(browse({workload:'Teams',kind:'files'})),/channel/)
  assert.throws(()=>entityPath(sid,'Teams',{id:'post',ownerId:'team',kind:'item',channelId:'channel'}),/individually/)
})
test('documents, SharePoint libraries and Teams tabs use exact v8 resource casing',()=>{
  assert.match(browsePath(browse({workload:'OneDrive',kind:'documents'})),/\/Organization\/OneDrives\/owner\/Documents\?/)
  assert.match(browsePath(browse({workload:'SharePoint',kind:'libraries'})),/\/Organization\/Sites\/owner\/Libraries\?/)
  assert.match(browsePath(browse({workload:'Teams',kind:'tabs',channelId:'c'})),/\/organization\/teams\/owner\/channels\/c\/tabs\?/)
  assert.throws(()=>browsePath(browse({workload:'OneDrive',kind:'items'})),/Unsupported/)
})
test('Exchange selected-item payload deduplicates and never expands into a whole mailbox',()=>{
  const request=input({items:[{id:'item',ownerId:'owner',kind:'item'},{id:'item',ownerId:'owner',kind:'item'}]})
  const [group]=restoreGroups(request,[{id:'item'},{id:'item'}])
  assert.match(group.path,/\/items\/restore$/);assert.deepEqual(group.body,{userCode:'temporary-code',items:[{id:'item'}]})
  assert.throws(()=>input({items:[]}))
  assert.throws(()=>restoreGroups(request,[]),/verified/)
})
test('Exchange alternate restore maps destination options and certificate impersonation explicitly',()=>{
  const req=input({options:{destination:'alternate',mailbox:'target@tenant.test',folder:'Recovered',changedItems:true,organizationName:'tenant.onmicrosoft.com'}})
  const [group]=restoreGroups(req,[{id:'item'}])
  assert.match(group.path,/\/items\/restoreTo$/);assert.equal(group.body.mailbox,'target@tenant.test');assert.equal(group.body.officeOrganizationName,'tenant.onmicrosoft.com');assert.equal(group.body.changedItems,true)
  assert.throws(()=>restoreGroups(input({options:{destination:'alternate'}}),[{id:'item'}]),/mailbox/)
  const certificate={mode:'certificate',applicationId:org,applicationCertificate:'base64',applicationCertificatePassword:''}
  for(const options of [{destination:'original'},req.options]) {
    for(const name of [undefined,' ',' public@tenant.test ']) {
      const [restore]=restoreGroups(input({options,auth:{...certificate,impersonationAccountName:name}}),[{id:'item'}])
      if(name?.trim())assert.equal(restore.body.impersonationAccountName,name.trim())
      else assert.equal(Object.hasOwn(restore.body,'impersonationAccountName'),false)
    }
  }
})
test('Exchange alternate restore requires a selected category and defaults only to missing items',()=>{
  const options={destination:'alternate',mailbox:'user@tenant.test',folder:'Recovered'}
  for(const [supplied,expected] of [[{},{changedItems:false,deletedItems:true}],[{changedItems:true},{changedItems:true,deletedItems:false}],[{deletedItems:true},{changedItems:false,deletedItems:true}],[{changedItems:true,deletedItems:true},{changedItems:true,deletedItems:true}]]) {
    const [group]=restoreGroups(input({options:{...options,...supplied}}),[{id:'item'}])
    assert.deepEqual({changedItems:group.body.changedItems,deletedItems:group.body.deletedItems},expected)
  }
  for(const supplied of [{changedItems:false,deletedItems:false},{changedItems:false},{deletedItems:false}])assert.throws(()=>restoreGroups(input({options:{...options,...supplied}}),[{id:'item'}]),/Choose missing items/)
})

test('Exchange alternate restore always sends the required unread option while original restore keeps its documented body',()=>{
  for(const kind of ['item','folder'])for(const markRestoredAsUnread of [undefined,false,true]) {
    const item={id:'selected',ownerId:'owner',kind},auth={mode:'deviceCode',userCode:'temporary-code'}
    const options={destination:'alternate',mailbox:'user@tenant.test',folder:'Recovered',...(markRestoredAsUnread===undefined?{}:{markRestoredAsUnread})}
    const [alternate]=restoreGroups(input({items:[item],auth,options}),[{id:'selected'}])
    assert.equal(alternate.body.markRestoredAsUnread,markRestoredAsUnread??false)
    const [original]=restoreGroups(input({items:[item],auth,options:{...options,destination:'original'}}),[{id:'selected'}])
    assert.deepEqual(original.body,{userCode:'temporary-code',...(kind==='item'?{items:[{id:'selected'}]}:{})})
  }
})

test('Exchange alternate destinations trim account identifiers without changing folder names',()=>{
  const req=input({options:{destination:'alternate',mailbox:' target@tenant.test ',organizationName:' tenant.onmicrosoft.com ',folder:' Recovered items '}})
  const [group]=restoreGroups(req,[{id:'item'}])
  assert.equal(group.body.mailbox,'target@tenant.test')
  assert.equal(group.body.officeOrganizationName,'tenant.onmicrosoft.com')
  assert.equal(group.body.folder,' Recovered items ')
  assert.throws(()=>restoreGroups(input({options:{destination:'alternate',mailbox:'   ',folder:'Recovered'}}),[{id:'item'}]),/mailbox/)
})

test('Exchange selected email restore to a new folder preserves device-code authentication and the child receipt',async()=>{
  const mailboxId='55555555-5555-4555-8555-555555555555',applicationId='66666666-6666-4666-8666-666666666666',itemId='AAMk+selected/email=='
  const request={action:'restore',requestId:randomUUID(),sessionId:sid,workload:'Exchange',items:[{id:itemId,ownerId:mailboxId,kind:'item'}],auth:{mode:'deviceCode',userCode:'temporary-code',applicationId},options:{destination:'alternate',mailbox:' user@tenant.test ',folder:'Open Backup UI restore test',organizationName:' tenant.onmicrosoft.com ',officeRegion:'Worldwide'}}
  const base=`/v8/RestoreSessions/${sid}/organization/mailboxes/${mailboxId}`,calls=[]
  const context={scope:randomUUID(),sourceName:'source',execute:async(path,method='GET',body)=>{
    calls.push({path,method,body})
    if(path===`/v8/RestoreSessions/${sid}`)return {id:sid,type:'Vex',state:'Working'}
    if(path===`${base}/items/${encodeURIComponent(itemId)}`&&method==='GET')return {id:itemId}
    if(path===`${base}/items/restoreTo`&&method==='POST')return {sessionId:op}
    if(path===`/v8/RestoreSessions/${op}`)return {id:op,type:'Vex',state:'Working'}
    throw Error(`Unexpected request: ${method} ${path}`)
  }}
  const result=await recoveryPost(context,request)
  assert.deepEqual(calls,[
    {path:`/v8/RestoreSessions/${sid}`,method:'GET',body:undefined},
    {path:`${base}/items/${encodeURIComponent(itemId)}`,method:'GET',body:undefined},
    {path:`${base}/items/restoreTo`,method:'POST',body:{userCode:'temporary-code',items:[{id:itemId}],mailbox:'user@tenant.test',folder:'Open Backup UI restore test',officeRegion:'Worldwide',changedItems:false,deletedItems:true,markRestoredAsUnread:false,officeOrganizationName:'tenant.onmicrosoft.com'}},
  ])
  assert.equal(result.sessionId,sid)
  assert.deepEqual(result.operations,[{group:JSON.stringify([mailboxId,'','item','']),itemIds:[itemId],itemKeys:[JSON.stringify([mailboxId,undefined,'item',itemId])],itemCount:1,status:'accepted',sessionId:op}])
  const state=await recoveryGet(context,{action:'sessionState',sessionId:op})
  assert.equal(state.session.parentSessionId,sid)
})

test('OneDrive restore keeps verified document metadata and only supports a resolved alternate target',()=>{
  const req=input({workload:'OneDrive',items:[{id:'doc',ownerId:'drive',kind:'document'}]})
  const [group]=restoreGroups(req,[document('doc')])
  assert.equal(group.body.documentAction,'Keep');assert.equal(group.body.documents[0].createdBy,'Jorge');assert.equal(group.body.documents[0]._links,undefined)
  const alternate={...req,options:{...req.options,destination:'alternate',folder:'Recovered',targetOneDriveId:'target'}}
  assert.throws(()=>restoreGroups(alternate,[document('doc')]),/target OneDrive/)
  const [copy]=restoreGroups(alternate,[document('doc')],{id:'target',name:'Target'})
  assert.match(copy.path,/\/Documents\/copyTo$/);assert.deepEqual(copy.body.onedrive,{id:'target',name:'Target'});assert.equal(copy.body.documentLastVersionAction,'Merge')
})
test('SharePoint folders and items use their own selected arrays and documented alternate options',()=>{
  for(const kind of ['folder','item','document']) {
    const req=input({workload:'SharePoint',items:[{id:'selected',ownerId:'site',kind}],options:{destination:'alternate',siteURL:'https://tenant.sharepoint.com/sites/recovered',restorePermissions:true}})
    const [group]=restoreGroups(req,[{...document('selected'),isFolder:kind==='folder'}])
    const collection=kind==='folder'?'folders':kind==='item'?'items':'documents'
    assert.equal(group.body[collection].length,1);assert.match(group.path,/restoreTo$/);assert.equal(group.body.restorePermissions,undefined);assert.equal(group.body.siteURL,req.options.siteURL)
  }
})
test('Teams selected-file payload never sends the channel-wide restore alternative',()=>{
  const request=input({workload:'Teams',items:[{id:'f1',ownerId:'team',channelId:'c1',kind:'file'},{id:'f2',ownerId:'team',channelId:'c2',kind:'file'}]})
  const groups=restoreGroups(request,[{id:'f1',channelId:'c1'},{id:'f2',channelId:'c2'}])
  assert.equal(groups.length,2)
  for(const group of groups) {assert.equal(group.body.channelId,undefined);assert.equal(group.body.files.length,1);assert.ok(group.body.files[0].channelId);assert.equal(group.body.restoreMissingItems,true)}
  assert.throws(()=>restoreGroups(request,[{id:'f1',channelId:'wrong'},{id:'f2',channelId:'c2'}]),/channel/)
  assert.throws(()=>restoreGroups({...request,options:{...request.options,destination:'alternate'}},[{id:'f1',channelId:'c1'},{id:'f2',channelId:'c2'}]),/original/)
})
test('owner suggestions use unambiguous identifiers and never guess from a display name',()=>{
  const context={workload:'Exchange',object:{id:'protected-user',mailboxes:[{id:'mailbox-id',email:'User@tenant.test'}]},point:{},sourceName:'source'}
  assert.equal(suggestedOwner(context,[{id:'mailbox-id'},{id:'other'}]),'mailbox-id')
  assert.equal(suggestedOwner(context,[{id:'wrong',name:'User'}]),undefined)
  assert.equal(suggestedOwner(context,[{id:'mailbox-id'},{id:'other',email:'user@tenant.test'}]),undefined)
})
test('transport preserves write session receipt, rejects arbitrary hosts and never retries an ambiguous POST',async()=>{
  let calls=0
  const execute=recoveryTransport({baseUrl:'https://vbm.test:4443',token:'secret',refresh:async()=>null,fetcher:async(url,init)=>{calls++;assert.equal(url.origin,'https://vbm.test:4443');assert.equal(init.redirect,'error');return new Response(JSON.stringify({sessionId:op}),{status:200})}})
  assert.deepEqual(await execute(`/v8/RestoreSessions/${sid}/Stop`,'POST'),{sessionId:op});assert.equal(calls,1)
  await assert.rejects(()=>execute('https://evil.invalid/v8/RestoreSessions'),/Unsupported/)
  const failing=recoveryTransport({baseUrl:'https://vbm.test',token:'secret',refresh:async()=>null,fetcher:async()=>{calls++;throw new Error('network with sensitive secret')}})
  await assert.rejects(()=>failing(`/v8/RestoreSessions/${sid}/Stop`,'POST'),e=>e.outcomeUnknown && !e.message.includes('sensitive'))
  assert.equal(calls,2)
})
test('recovery writes require the application origin and reject cross-site browser requests',()=>{
  assert.doesNotThrow(()=>assertRecoveryOrigin('http://preview.test:3124','http://preview.test:3124','same-origin'))
  for(const origin of [null,'https://other.test','http://preview.test:3000'])assert.throws(()=>assertRecoveryOrigin(origin,'http://preview.test:3124',null),e=>e.status===403)
  assert.throws(()=>assertRecoveryOrigin('http://preview.test:3124','http://preview.test:3124','cross-site'),e=>e.status===403)
})

function isolatedRecoveryHandler(dependencies) {
  const vm=require('node:vm'),handlerModule={exports:{}}
  const unexpectedContent=()=>{throw Error('This request must not access exported item content')}
  dependencies={'../vbm-recovery/content':{viewContent:unexpectedContent},'../utils/cookie-manager':{getChunkedCookie:unexpectedContent},...dependencies}
  const code=ts.transpileModule(fs.readFileSync(require.resolve('../lib/server/vbm-recovery.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText
  vm.runInNewContext(code,{exports:handlerModule.exports,require:name=>{assert.ok(name in dependencies,`Unexpected dependency ${name}`);return dependencies[name]},URL,URLSearchParams})
  return handlerModule.exports.handleVbmRecovery
}
test('recovery handler validates the browser Host despite NextURL loopback normalization before accessing credentials',async()=>{
  const nextServer=require('next/server')
  let accessedSource=0
  const unexpected=()=>{accessedSource++;throw new Error('Origin and JSON validation must precede source access')}
  const dependencies={
    'next/server':nextServer,'next/headers':{cookies:unexpected},zod:require('zod'),
    './config-store':{configStore:{getAll:unexpected,getById:unexpected}},
    './token-manager':{tokenManager:{getToken:unexpected,refreshToken:unexpected}},
    './vb365-helper':{getVB365Config:unexpected,refreshVB365Token:unexpected},
    './read-cache-scope':{readCacheScope:unexpected},
    './request-origin':require('../lib/server/request-origin.ts'),
    '../vbm-recovery/transport':{recoveryTransport:unexpected,assertRecoveryOrigin},
    '../vbm-recovery/load':{recoveryGet:unexpected,recoveryPost:unexpected},
    '../vbm-recovery/model':m,
    '../vbm-recovery/read-retry':require('../lib/vbm-recovery/read-retry.ts'),
  }
  const handle=isolatedRecoveryHandler(dependencies)
  const cases=[
    {url:'http://127.0.0.1:3124',host:'127.0.0.1:3124',origin:'http://127.0.0.1:3124',status:400},
    {url:'http://[::1]:3124',host:'[::1]:3124',origin:'http://[::1]:3124',status:400},
    {url:'http://localhost:3124',host:'localhost:3124',origin:'http://localhost:3124',status:400},
    {url:'http://localhost:3124',host:'backup.example:8443',origin:'https://backup.example:8443',proto:'https',status:400},
    {url:'http://127.0.0.1:3124',host:'127.0.0.1:3124',origin:'http://localhost:3124',status:403},
    {url:'http://127.0.0.1:3124',host:'127.0.0.1:3124',origin:'http://127.0.0.1:3000',status:403},
    {url:'http://127.0.0.1:3124',host:'127.0.0.1:3124',status:403},
    {url:'http://127.0.0.1:3124',host:'127.0.0.1:3124',origin:'null',status:403},
    {url:'http://127.0.0.1:3124',host:'127.0.0.1:3124',origin:'http://127.0.0.1:3124',site:'cross-site',status:403},
    {url:'http://127.0.0.1:3124',host:'127.0.0.1:3124',origin:'https://foreign.example',forwardedHost:'foreign.example',status:403},
    {url:'http://127.0.0.1:3124',host:'invalid host',origin:'http://127.0.0.1:3124',status:403},
  ]
  for(const fixture of cases) {
    const headers=new Headers({'content-type':'application/json',host:fixture.host,'sec-fetch-site':fixture.site||'same-origin'})
    if(fixture.origin!==undefined)headers.set('origin',fixture.origin)
    if(fixture.proto)headers.set('x-forwarded-proto',fixture.proto)
    if(fixture.forwardedHost)headers.set('x-forwarded-host',fixture.forwardedHost)
    const request=new nextServer.NextRequest(fixture.url+'/api/vbm/recovery',{method:'POST',headers,body:'{'})
    if(fixture.url.includes('127.0.0.1'))assert.equal(request.nextUrl.hostname,'localhost')
    const response=await handle(request),body=await response.json()
    assert.equal(response.status,fixture.status,JSON.stringify(fixture))
    assert.equal(body.outcomeUnknown,false)
    assert.equal(body.error,fixture.status===400?'Recovery options are invalid JSON.':'Recovery actions must originate from this application.')
  }
  assert.equal(accessedSource,0)
})
test('preview and download require a browser-bound VB365 source before using saved credentials',async()=>{
  const nextServer=require('next/server')
  let sourceReads=0
  const privateSource=()=>{sourceReads++;throw Error('A private request used another source')}
  const handle=isolatedRecoveryHandler({
    'next/server':nextServer,'next/headers':{cookies:async()=>({get:()=>undefined})},zod:require('zod'),
    './config-store':{configStore:{getById:privateSource,getAll:privateSource}},
    './token-manager':{tokenManager:{getToken:privateSource}},'./vb365-helper':{getVB365Config:privateSource},'./read-cache-scope':{},
    './request-origin':require('../lib/server/request-origin.ts'),'../vbm-recovery/read-retry':{},'../vbm-recovery/model':m,
    '../vbm-recovery/load':{},'../vbm-recovery/transport':{assertRecoveryOrigin},'../utils/cookie-manager':{getChunkedCookie:()=>undefined},
  })
  for(const [type,body,status] of [
    ['application/json',JSON.stringify({action:'viewContent'}),401],
    ['application/x-www-form-urlencoded','action=downloadOriginal',401],
    ['application/x-www-form-urlencoded','action=restore',400],
  ]){
    const req=new nextServer.NextRequest('http://app.test/api/vbm/recovery',{method:'POST',headers:{origin:'http://app.test',host:'app.test','content-type':type},body})
    const res=await handle(req)
    assert.equal(res.status,status)
    assert.equal(res.headers.get('cache-control'),'private, no-store')
  }
  assert.equal(sourceReads,0)
})
test('only opt-in administrator starts receive 202 and register the background lifetime with Next',async()=>{
  const nextServer=require('next/server'),id=randomUUID(),source={id:'vb365',host:'backup.test',port:4443,protocol:'https',platform:'vb365'}
  const background=[],blocking=[]
  let finish
  const result=new Promise(resolve=>{finish=resolve})
  const handle=isolatedRecoveryHandler({
    'next/server':{...nextServer,after:promise=>background.push(promise)},'next/headers':{cookies:async()=>({get:()=>({value:source.id})})},zod:require('zod'),
    './config-store':{configStore:{getById:()=>source}},'./token-manager':{tokenManager:{getToken:async()=>'test'}},
    './vb365-helper':{},'./read-cache-scope':{readCacheScope:()=>'scope'},'./request-origin':require('../lib/server/request-origin.ts'),
    '../vbm-recovery/transport':{recoveryTransport:()=>()=>{},assertRecoveryOrigin},
    '../vbm-recovery/load':{beginBrowseSession:(_context,input)=>{assert.equal(input.requestId,id);return {requestId:id,result}},recoveryPost:async(_context,input)=>{blocking.push(input.action);return {legacy:true}}},
    '../vbm-recovery/model':m,
    '../vbm-recovery/read-retry':require('../lib/vbm-recovery/read-retry.ts'),
  })
  const post=(action,optIn)=>handle(new nextServer.NextRequest('http://app.test/api/vbm/recovery',{method:'POST',headers:{origin:'http://app.test',host:'app.test','content-type':'application/json',...(optIn?{Prefer:'respond-async'}:{})},body:JSON.stringify({action,requestId:id})}))
  const accepted=await post('start',true)
  assert.equal(accepted.status,202);assert.equal(accepted.headers.get('Preference-Applied'),'respond-async')
  assert.deepEqual(await accepted.json(),{requestId:id,status:'pending'})
  assert.equal(background.length,1)
  finish();await background[0]
  for(const [action,optIn] of [['start',false],['restore',true]])assert.deepEqual(await (await post(action,optIn)).json(),{legacy:true})
  assert.deepEqual(blocking,['start','restore']);assert.equal(background.length,1)
})

test('transport retries explicit 401 once but does not replay rejected or ambiguous writes',async()=>{
  let calls=0,refreshed=0
  const execute=recoveryTransport({baseUrl:'https://vbm.test',token:'old',refresh:async()=>{refreshed++;return 'fresh'},fetcher:async()=>{calls++;return calls===1 ? new Response('',{status:401}):new Response(JSON.stringify({sessionId:op}))}})
  assert.deepEqual(await execute(`/v8/RestoreSessions/${sid}/Stop`,'POST'),{sessionId:op});assert.equal(refreshed,1);assert.equal(calls,2)
  const rejected=recoveryTransport({baseUrl:'https://vbm.test',token:'x',refresh:async()=>null,fetcher:async()=>new Response('userPassword=never-leak',{status:400})})
  await assert.rejects(()=>rejected(`/v8/RestoreSessions/${sid}/Stop`,'POST'),e=>e.status===400 && !e.outcomeUnknown && !e.message.includes('never-leak'))
})
test('a lost receipt body after HTTP 200 is still an unknown write outcome',async()=>{
  const execute=recoveryTransport({baseUrl:'https://vbm.test',token:'x',refresh:async()=>null,fetcher:async()=>({ok:true,status:200,text:async()=>{throw Error('connection closed')}})})
  await assert.rejects(()=>execute(`/v8/RestoreSessions/${sid}/Stop`,'POST'),e=>e.outcomeUnknown===true)
})
test('request receipts prevent duplicate writes and isolate selected data sources',async()=>{
  const request=randomUUID(),scope=randomUUID();let resolve,calls=0
  const work=()=>{calls++;return new Promise(r=>resolve=r)}
  const a=once(scope,request,{action:'start'},work),b=once(scope,request,{action:'start'},work)
  await Promise.resolve();assert.equal(calls,1);assert.equal(requestReceipt(scope,request).status,'pending')
  assert.throws(()=>requestReceipt('different-source',request),/unavailable/)
  await assert.rejects(()=>once(scope,request,{action:'other'},work),/different recovery/)
  resolve({sessionId:sid});assert.deepEqual(await a,await b);assert.equal(requestReceipt(scope,request).status,'completed')
})
test('a pending browse start registers before preflight and retains the exact returned session across duplicate requests',async()=>{
  const start={action:'start',requestId:randomUUID(),workload:'Exchange',objectType:'User',objectId:'user',restorePointId:'point'},scope=randomUUID()
  let finish,posts=0
  const upstream=new Promise(resolve=>{finish=resolve})
  const context={scope,sourceName:'VB365',execute:async(path,method)=>{
    if(path.startsWith('/v8/ProtectedUsers'))return {id:'user',organizationId:org}
    if(path==='/v8/RestorePoints/point')return {id:'point',organizationId:org,backupTime:'2026-11-01T10:00:00Z',isExchange:true,isDeleted:false}
    if(path.startsWith('/v8/RestorePoints?'))return {results:[{id:'point'}]}
    assert.equal(method,'POST');assert.equal(path,'/v8/Organizations/'+org+'/explore');posts++
    return upstream
  }}
  const handle=beginBrowseSession(context,start),duplicate=beginBrowseSession(context,start)
  assert.equal(handle.requestId,start.requestId)
  assert.equal(requestReceipt(scope,start.requestId).status,'pending')
  assert.throws(()=>beginBrowseSession(context,{...start,showDeleted:true}),/different recovery options/)
  assert.throws(()=>beginBrowseSession(context,{...start,unexpected:true}))
  finish({id:sid,type:'Vex',state:'Working'})
  await Promise.all([handle.result,duplicate.result])
  assert.equal(posts,1)
  assert.equal(requestReceipt(scope,start.requestId).result.session.id,sid)
})

test('the picker follows its scoped receipt through pending and transient reads with a single POST',async t=>{
  const requestId=randomUUID(),session={id:sid,name:'Jorge',workload:'Exchange',type:'Vex',state:'Working'},createdAt=new Date().toISOString()
  const responses=[Response.json({status:'pending',requestId},{status:202}),
    ...Array.from({length:5},()=>Response.json({status:'pending',createdAt})),
    Response.json({error:'temporary'},{status:503}),Response.json({status:'completed',createdAt,result:{session}})]
  const calls=[]
  t.mock.method(global,'fetch',async(url,init)=>{calls.push({url,init});return responses.shift()})
  const timer=setTimeout,delays=[]
  t.mock.method(global,'setTimeout',(fn,ms,...args)=>{delays.push(ms);return timer(fn,0,...args)})
  assert.deepEqual(await client.openBrowseSession({action:'start',requestId},new AbortController().signal),{session})
  assert.deepEqual(delays,[1000,2000,4000,5000,5000,3000])
  assert.equal(calls.length,8)
  assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.headers.Prefer,'respond-async')
  for(const {url,init} of calls.slice(1)){assert.equal(init.method,undefined);assert.equal(url,'/api/vbm/recovery?action=request&requestId='+requestId)}
})

test('an offline proxy can recover at minute 29 with only one browse start',async t=>{
  const requestId=randomUUID(),createdAt=new Date().toISOString()
  const session={id:sid,name:'Jorge',workload:'Exchange',type:'Vex',state:'Working'}
  let now=Date.now()
  t.mock.method(Date,'now',()=>now)
  const timer=setTimeout
  t.mock.method(global,'setTimeout',(fn,ms,...args)=>timer(fn,0,...args))
  const responses=[
    {status:'pending',createdAt,phase:'waitingForProxy'},
    {status:'pending',createdAt},
    {status:'completed',createdAt,result:{session}},
  ]
  let posts=0
  t.mock.method(global,'fetch',async(url,init)=>{
    if(init.method==='POST'){
      posts++
      return Response.json({status:'pending',requestId},{status:202})
    }
    assert.equal(url,'/api/vbm/recovery?action=request&requestId='+requestId)
    if(responses.length===3)now+=29*60_000
    return Response.json(responses.shift())
  })
  const phases=[]
  const result=await client.openBrowseSession({action:'start',requestId},new AbortController().signal,waiting=>phases.push(waiting))
  assert.deepEqual(result,{session})
  assert.deepEqual(phases,[true,false])
  assert.equal(posts,1)
  assert.equal(responses.length,0)
})

test('browse preflight overlaps independent reads and waits for verified membership before opening the Explorer',async()=>{
  const calls=[],pending=new Map()
  const object='/v8/ProtectedUsers/user',point='/v8/RestorePoints/point'
  const execute=async(path,method='GET')=>{
    calls.push({path,method})
    if(method==='POST')return {id:sid,type:'Vex',state:'Working'}
    return new Promise(resolve=>pending.set(path,resolve))
  }
  const {result}=beginBrowseSession({execute,scope:randomUUID(),sourceName:'VB365'},{
    action:'start',requestId:randomUUID(),workload:'Exchange',objectType:'User',objectId:'user',restorePointId:'point',
  })
  await new Promise(resolve=>setImmediate(resolve))
  assert.deepEqual([...pending.keys()],[object,point])
  pending.get(point)({id:'point',organizationId:org,backupTime:'2026-11-01T10:00:00Z',isExchange:true})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,2)
  pending.get(object)({id:'user',organizationId:org})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,3);assert.equal(calls[2].method,'GET');assert.match(calls[2].path,/^\/v8\/RestorePoints\?/)
  pending.get(calls[2].path)({results:[{id:'point'}]})
  assert.equal((await result).session.id,sid)
  assert.deepEqual(calls.filter(call=>call.method==='POST'),[{path:'/v8/Organizations/'+org+'/explore',method:'POST'}])
})

test('start verifies protected object membership before any Explorer POST and remembers browse receipt',async()=>{
  const start={action:'start',requestId:randomUUID(),workload:'Exchange',objectType:'User',objectId:'user',restorePointId:'point'},calls=[]
  const execute=async(path,method='GET',body)=>{calls.push({path,method,body});if(path.startsWith('/v8/ProtectedUsers'))return {id:'user',organizationId:org};if(path==='/v8/RestorePoints/point')return {id:'point',organizationId:org,repositoryId:repo,backupTime:'2026-11-01T10:00:00Z',isExchange:true,isDeleted:false};if(path.startsWith('/v8/RestorePoints?'))return {results:[{id:'point'}]};if(path.endsWith('/explore'))return {id:sid,type:'Vex',state:'Working'};throw Error(path)}
  const context={execute,scope:randomUUID(),sourceName:'VB365'},result=await recoveryPost(context,start)
  assert.equal(result.session.id,sid);assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls.at(-1).body.repositoryId,repo);assert.equal(calls.at(-1).body.type,'Vex')
  assert.equal((await recoveryGet(context,{action:'request',requestId:start.requestId})).status,'completed')
  const rejected={...context,scope:randomUUID(),execute:async(path,...rest)=>path.startsWith('/v8/RestorePoints?') ? {results:[]}:execute(path,...rest)}
  await assert.rejects(()=>recoveryPost(rejected,{...start,requestId:randomUUID()}),/verified/)
  assert.equal(calls.filter(c=>c.method==='POST').length,1)
})
test('backup-copy browse uses the repository endpoint; archive browse requires completed retrieval',async()=>{
  const calls=[],basePoint={id:'point',organizationId:org,repositoryId:repo,backupTime:'2026-11-01T10:00:00Z',isOneDrive:true,isDeleted:false,isCopy:true}
  let point=basePoint
  const context={scope:randomUUID(),sourceName:'source',execute:async(path,method='GET',body)=>{calls.push({path,method,body});if(path.startsWith('/v8/ProtectedUsers'))return {id:'user',organizationId:org};if(path==='/v8/RestorePoints/point')return point;if(path.startsWith('/v8/RestorePoints?'))return {results:[point]};return {id:sid,type:'Veod',state:'Working'}}}
  const req={action:'start',requestId:randomUUID(),workload:'OneDrive',objectType:'User',objectId:'user',restorePointId:'point'}
  await recoveryPost(context,req)
  const write=calls.find(c=>c.method==='POST');assert.match(write.path,/\/BackupRepositories\//);assert.equal(new URL(write.path,'https://source.test').searchParams.get('organizationId'),org)
  point={...basePoint,isLongTermCopy:true}
  await assert.rejects(()=>recoveryPost(context,{...req,requestId:randomUUID()}),/Retrieve this archived/)
  assert.equal(calls.filter(c=>c.method==='POST').length,1)
})
test('cross-tenant points and invalid browse receipts cannot be treated as successful recovery starts',async()=>{
  const point={id:'point',organizationId:repo,repositoryId:repo,backupTime:'2026-11-01T10:00:00Z',isExchange:true,isDeleted:false}
  const context={scope:randomUUID(),sourceName:'source',execute:async(path)=>path.startsWith('/v8/ProtectedUsers') ? {id:'user',organizationId:org}:point}
  await assert.rejects(()=>recoveryPost(context,{action:'start',requestId:randomUUID(),workload:'Exchange',objectType:'User',objectId:'user',restorePointId:'point'}),/organization/)
})
test('a partial restore preserves accepted child sessions, stops remaining submissions, and is idempotent',async()=>{
  const req=input({items:[{id:'i1',ownerId:'owner1',kind:'item'},{id:'i2',ownerId:'owner2',kind:'item'},{id:'i3',ownerId:'owner3',kind:'item'}]}),scope=randomUUID();let writes=0
  const execute=async(path,method='GET')=>{if(path===`/v8/RestoreSessions/${sid}`)return {id:sid,type:'Vex',state:'Working'};if(method==='GET')return {id:path.split('/').at(-1)};writes++;if(writes===1)return {sessionId:op};throw new m.RecoveryError('Network outcome unknown',502,true)}
  const context={execute,scope,sourceName:'source'},first=await recoveryPost(context,req),again=await recoveryPost(context,req)
  assert.deepEqual(first,again);assert.equal(writes,2);assert.deepEqual(first.operations.map(x=>x.status),['accepted','unknown','notSubmitted']);assert.equal(first.operations[0].sessionId,op)
})
test('stopped or cross-workload sessions are rejected before browsing and restoring',async()=>{
  for(const session of [{id:sid,type:'Vex',state:'Stopped'},{id:sid,type:'Veod',state:'Working'}]) {
    let calls=0;const context={scope:randomUUID(),sourceName:'source',execute:async()=>{calls++;return session}}
    await assert.rejects(()=>recoveryPost(context,input()),/session/);assert.equal(calls,1)
  }
})
test('Teams posts are visible without being added to a selected-item restore',()=>{
  const page=m.normalizeItems({results:[{postId:123,subject:'Announcement',channelId:'c'}]},browse({workload:'Teams',kind:'posts',channelId:'c'}))
  assert.equal(page.items[0].id,'123');assert.equal(page.items[0].selectable,false)
  assert.throws(()=>input({workload:'Teams',items:[{id:'123',kind:'post',ownerId:'team'}]}))
})

test('SharePoint and OneDrive search retain the selected folder, library or list scope',()=>{
  for(const [scopeKind,resource] of [['folder','Folders'],['library','Libraries'],['list','Lists']]) {
    const args=browse({workload:'SharePoint',kind:scopeKind==='list'?'items':'documents',scopeKind,parentId:'selected'})
    assert.match(searchPath(args),new RegExp(`/Sites/owner/${resource}/selected/search`))
  }
  assert.match(searchPath(browse({workload:'OneDrive',kind:'documents',scopeKind:'folder',parentId:'folder'})),/\/OneDrives\/owner\/Folders\/folder\/search/)
  assert.match(searchPath(browse({workload:'Teams',kind:'tabs',channelId:'channel'})),/\/channels\/channel\/tabs\/search/)
})

test('mixed SharePoint search preserves verified resource types and cannot guess an ambiguous selection',()=>{
  const args=browse({workload:'SharePoint',kind:'libraries',scopeKind:'owner'})
  const page=m.normalizeItems({results:[
    {id:'doc',name:'Document',_links:{self:{href:`/v8/RestoreSessions/${sid}/Organization/Sites/owner/Documents/doc`}}},
    {id:'item',name:'List item',_links:{self:{href:`/v8/RestoreSessions/${sid}/Organization/Sites/owner/Items/item`}}},
    {id:'unknown',name:'Ambiguous'},
    {id:'folder',name:'Folder',isFolder:true},
    {id:'cross',name:'Wrong owner',_links:{self:{href:`/v8/RestoreSessions/${sid}/Organization/Sites/other/Items/cross`}}},
  ]},args,true)
  assert.deepEqual(page.items.map(item=>[item.kind,item.selectable]),[['document',true],['item',true],['document',false],['folder',true],['document',false]])
  const list=m.normalizeItems({results:[{id:'i',name:'Row'}]},browse({workload:'SharePoint',kind:'items',scopeKind:'list',parentId:'l'}),true)
  assert.equal(list.items[0].kind,'item');assert.equal(list.items[0].selectable,true)
})

test('partial acceptance returns exact owner-scoped cart keys even when item IDs repeat',async()=>{
  const req=input({items:[{id:'same',ownerId:'owner1',kind:'item'},{id:'same',ownerId:'owner2',kind:'item'}]});let writes=0
  const context={scope:randomUUID(),sourceName:'source',execute:async(path,method='GET')=>{
    if(path===`/v8/RestoreSessions/${sid}`)return {id:sid,type:'Vex',state:'Working'}
    if(method==='GET')return {id:'same'}
    if(++writes===1)return {sessionId:op}
    throw new m.RecoveryError('Rejected',400,false)
  }}
  const result=await recoveryPost(context,req)
  assert.deepEqual(result.operations.map(value=>value.status),['accepted','failed'])
  assert.deepEqual(result.operations[0].itemKeys,[JSON.stringify(['owner1',undefined,'item','same'])])
  assert.notDeepEqual(result.operations[0].itemKeys,result.operations[1].itemKeys)
})

test('Teams requires at least one recoverable change category',()=>{
  const req=input({workload:'Teams',items:[{id:'f',ownerId:'t',channelId:'c',kind:'file'}],options:{restoreChangedItems:false,restoreMissingItems:false}})
  assert.throws(()=>restoreGroups(req,[{id:'f',channelId:'c'}]),/missing items/)
})

test('cross-owner entities and mismatched alternate OneDrives cannot reach a restore POST',()=>{
  const req=input({workload:'OneDrive',items:[{id:'doc',ownerId:'drive',kind:'document'}]})
  assert.throws(()=>restoreGroups(req,[{...document('doc'),oneDriveId:'other-drive'}]),/backed-up object/)
  const alternate={...req,options:{...req.options,destination:'alternate',targetOneDriveId:'target',folder:'Recovered'}}
  assert.throws(()=>restoreGroups(alternate,[document('doc')],{id:'other-target'}),/target OneDrive/)
})

test('restore entities forward only documented properties and never embedded action links',()=>{
  const req=input({workload:'SharePoint',items:[{id:'item',ownerId:'site',kind:'item'}]})
  const [group]=restoreGroups(req,[{...document('item'),siteId:'site',title:'List item',credentials:'not-forwarded',sizeBytes:123,parentId:'p'}])
  assert.equal(group.body.items[0].title,'List item')
  for(const key of ['credentials','sizeBytes','parentId','_links'])assert.equal(group.body.items[0][key],undefined)
  const nested=new URL(browsePath(browse({workload:'SharePoint',kind:'owners',parentId:'subsite'})),'https://source.test')
  assert.equal(nested.searchParams.get('parentId'),'subsite')
})

test('unreadable successful restore responses remain unconfirmed and are never resubmitted',async()=>{
  const previousFetch=global.fetch,calls=[]
  global.fetch=async(url,options)=>{calls.push({url,options});return new Response('{"operations":',{status:200})}
  try {
    await assert.rejects(()=>client.recoveryPost({action:'restore',requestId:randomUUID()}),error=>{
      assert.ok(error instanceof client.RecoveryRequestError)
      assert.equal(error.status,200);assert.equal(error.outcomeUnknown,true)
      assert.match(error.message,/Check operations/);return true
    })
    assert.equal(calls.length,1);assert.equal(calls[0].options.method,'POST')
  } finally {global.fetch=previousFetch}
})

test('unreadable successful browse responses are known read failures and preserve cancellation',async()=>{
  const previousFetch=global.fetch,signal=new AbortController().signal,calls=[]
  global.fetch=async(url,options)=>{calls.push({url,options});return new Response('<html>Unavailable</html>',{status:200})}
  try {
    await assert.rejects(()=>client.recoveryGet({action:'browse',parentId:'subsite/&?',offset:0,absent:undefined},signal),error=>{
      assert.ok(error instanceof client.RecoveryRequestError)
      assert.equal(error.status,200);assert.equal(error.outcomeUnknown,false)
      return true
    })
    assert.equal(calls.length,1);assert.equal(calls[0].options.signal,signal);assert.equal(calls[0].options.cache,'no-store')
    const url=new URL(calls[0].url,'https://ui.test')
    assert.equal(url.searchParams.get('parentId'),'subsite/&?');assert.equal(url.searchParams.has('absent'),false)
  } finally {global.fetch=previousFetch}
})

test('client receipt reconciliation distinguishes rejected restores from unknown outcomes without POST retries',async()=>{
  const previousFetch=global.fetch,calls=[]
  try {
    for(const [status,outcomeUnknown] of [['failed',false],['unknown',true]]) {
      global.fetch=async(url,options)=>{calls.push({url,options});return Response.json({status,createdAt:new Date().toISOString(),error:'Restore rejected or unconfirmed'})}
      await assert.rejects(()=>client.recoverReceipt(randomUUID()),error=>{
        assert.ok(error instanceof client.RecoveryRequestError)
        assert.equal(error.status,409);assert.equal(error.outcomeUnknown,outcomeUnknown);return true
      })
    }
    const result={sessionId:sid,operations:[{group:'selected',itemIds:['item'],itemCount:1,status:'accepted',sessionId:op}]}
    global.fetch=async(url,options)=>{calls.push({url,options});return Response.json({status:'completed',createdAt:new Date().toISOString(),result})}
    assert.deepEqual(await client.recoverReceipt(randomUUID()),result)
    assert.equal(calls.length,3)
    assert.ok(calls.every(call=>!call.options.method && new URL(call.url,'https://ui.test').searchParams.get('action')==='request'))
  } finally {global.fetch=previousFetch}
})

test('receipt polling failures cannot turn an ambiguous restore into a known rejection',async()=>{
  const previousFetch=global.fetch,calls=[]
  const responses=[
    ()=>new Response('{"status":',{status:200}),
    ()=>Response.json({error:'Sign in again',outcomeUnknown:false},{status:401}),
    ()=>Response.json({error:'Forbidden',outcomeUnknown:false},{status:403}),
    ()=>Response.json({error:'Receipt not found',outcomeUnknown:false},{status:404}),
    ()=>{throw new TypeError('Failed to fetch')},
  ]
  try {
    for(const respond of responses) {
      global.fetch=async(url,options)=>{calls.push({url,options});return respond()}
      await assert.rejects(()=>client.recoverReceipt(randomUUID()),error=>{
        assert.ok(error instanceof client.RecoveryRequestError);assert.equal(error.outcomeUnknown,true);return true
      })
    }
    assert.equal(calls.length,responses.length);assert.ok(calls.every(call=>!call.options.method))
  } finally {global.fetch=previousFetch}
})

test('malformed receipts and unrecognized completed results stay unconfirmed',async()=>{
  const previousFetch=global.fetch,createdAt=new Date().toISOString()
  const badResults=[null,[],{}, {session:{id:sid,name:'Missing type',state:'Working'}}, {sessionId:sid,operations:[]},
    {sessionId:sid,operations:[{group:'g',status:'accepted',itemIds:['i'],itemCount:1}]},
    {sessionId:sid,operations:[{group:'g',status:'accepted',sessionId:op,itemIds:['i'],itemCount:2}]},
    {sessionId:sid,operations:[{group:'g',status:'new-status',itemIds:['i'],itemCount:1}]},
  ]
  const receipts=[null,[],{status:'failed'},{status:'failed',createdAt,error:{}},{status:['failed'],createdAt},
    {status:'unexpected',createdAt},...badResults.map(result=>({status:'completed',createdAt,result}))]
  try {
    for(const receipt of receipts) {
      global.fetch=async()=>Response.json(receipt)
      await assert.rejects(()=>client.recoverReceipt(randomUUID()),error=>{
        assert.ok(error instanceof client.RecoveryRequestError);assert.equal(error.outcomeUnknown,true);return true
      })
    }
    const result={session:{id:sid,name:'Backup explorer',state:'Working',type:'Vesp',workload:'SharePoint'}}
    global.fetch=async()=>Response.json({status:'completed',createdAt,result})
    assert.deepEqual(await client.recoverReceipt(randomUUID()),result)
  } finally {global.fetch=previousFetch}
})

test('successful restore POSTs with invalid result shapes require receipt reconciliation',async()=>{
  const previousFetch=global.fetch
  try {
    for(const [action,result] of [['restore',{}],['restore',{operations:[]}],['start',{session:{id:sid}}],['start',null]]) {
      global.fetch=async()=>Response.json(result)
      await assert.rejects(()=>client.recoveryPost({action,requestId:randomUUID()}),error=>{
        assert.ok(error instanceof client.RecoveryRequestError);assert.equal(error.outcomeUnknown,true);return true
      })
    }
  } finally {global.fetch=previousFetch}
})

test('SharePoint owner browsing preserves subsite ancestry and paging through the backend',async()=>{
  for(const parentId of [undefined,'site/with?opaque&id']) {
    const calls=[],context={scope:randomUUID(),sourceName:'source',execute:async(path,method='GET')=>{
      calls.push({path,method})
      if(path===`/v8/RestoreSessions/${sid}`)return {id:sid,type:'Vesp',state:'Working'}
      return {results:[{id:'child',name:'Subsite'}]}
    }}
    const page=await recoveryGet(context,{action:'browse',sessionId:sid,workload:'SharePoint',kind:'owners',parentId,offset:100,limit:100})
    assert.equal(calls.length,2);assert.ok(calls.every(call=>call.method==='GET'))
    const url=new URL(calls[1].path,'https://source.test')
    assert.equal(url.pathname,`/v8/RestoreSessions/${sid}/Organization/Sites`)
    assert.equal(url.searchParams.get('parentId'),parentId || 'root')
    assert.equal(url.searchParams.get('offset'),'100');assert.equal(url.searchParams.get('limit'),'100')
    assert.equal(page.items[0].id,'child');assert.equal(page.items[0].kind,'owner');assert.equal(page.items[0].parentId,parentId)
    assert.equal(page.offset,100);assert.equal(page.nextOffset,101)
  }
})

test('Exchange cart presents the mailbox and count with one protected restore action', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const Module = require('node:module')
  const filename = require.resolve('../components/vbm-recovery/cart.tsx')
  const compiled = new Module(filename, module)
  compiled.require = key => {
    if (key === '@/components/providers/i18n-provider') return { useI18n: () => ({ t: text => text }) }
    if (key === '@/components/ui/button') return { Button: ({ disabled, children }) => React.createElement('button', { disabled }, children) }
    if (key === './browser') return { ItemIcon: () => null, itemKey: item => item.id }
    if (key === './microsoft-sign-in') return { MicrosoftSignInStep: () => null }
    if (key === './certificate-file') return require('../components/vbm-recovery/certificate-file.ts')
    if (key.endsWith('.css') || key === './client') return {}
    return require(key)
  }
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename)
  const html = renderToStaticMarkup(React.createElement(compiled.exports.RecoveryCart, {
    workload: 'Exchange', sessionId: sid, mailboxScoped: true, ended: false,
    entries: [{ id: 'message', ownerId: 'owner', ownerName: 'Example mailbox', name: 'Message', kind: 'item' }],
  }))
  assert.match(html, /<dt>Selected items<\/dt><dd>1<\/dd>/)
  assert.match(html, /<dt>Destination<\/dt><dd>Example mailbox<\/dd>/)
  assert.match(html, /<input type="checkbox" checked=""\/>Restore missing items/)
  assert.match(html, /<input type="checkbox"\/>Restore changed items/)
  assert.match(html, /<input type="checkbox"\/>Mark restored items as unread/)
  assert.doesNotMatch(html.slice(html.indexOf('<dt>Selected items')), /type="checkbox"/)
  const actions = [...html.matchAll(/<button([^>]*)>((?:(?!<\/button>)[\s\S])*?)<\/button>/g)].filter(match => match[2].includes('Start restore'))
  assert.equal(actions.length, 1)
  assert.doesNotMatch(html, /Restore operator|Restore Portal/)
  assert.match(html, /<option value="certificate" selected="">Application certificate/)
  assert.match(actions[0][1], /disabled/, 'A certificate and target folder are required')
})

test('restore PFX selection bounds the binary before reading and preserves the selected bytes',async()=>{
  const {certificateFileError,readRestoreCertificate}=require('../components/vbm-recovery/certificate-file.ts')
  const limit=96*1024
  for(const file of [{name:'public.cer',size:1},{name:'empty.pfx',size:0},{name:'large.p12',size:limit+1}]){
    assert.ok(certificateFileError(file))
    let reads=0
    await assert.rejects(readRestoreCertificate({...file,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0)}}))
    assert.equal(reads,0)
  }
  const data=Buffer.alloc(limit)
  for(let i=0;i<data.length;i++)data[i]=i&255
  const file=new File([data],'restore.PFX')
  assert.equal(certificateFileError(file),undefined)
  assert.equal(await readRestoreCertificate(file),data.toString('base64'))
  await assert.rejects(readRestoreCertificate({name:'changed.p12',size:10,arrayBuffer:async()=>new ArrayBuffer(11)}))
})
