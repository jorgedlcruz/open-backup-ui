// Open Backup UI v1.2.0
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)
const {adExplorerSchema,runAdExplorer}=require('../lib/recovery/ad-explorer.ts')
const {AdSubmissions}=require('../lib/server/ad-submissions.ts')
const {VbrRecoveryError}=require('../lib/recovery/error.ts')
const path=require('node:path'),os=require('node:os'),{after}=require('node:test')
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'vead-fixture-'));after(()=>fs.rmSync(scratch,{recursive:true,force:true}))
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const ctx={sourceKey:'a'.repeat(64),principalKey:'operator A',secret:'fixture-only-secret'}
const point={restorePointId:id(1),backupId:id(2),backupObjectId:id(3)},sessionId=id(5)
const base='/private-api/v1',b=base+'/backupBrowser/applicationItems/vead',r=base+'/restore/applicationItems/vead',e=base+'/export/applicationItems/vead',v=base+'/validations/applicationItems/vead'
function setup() {
  const calls=[],data=new Map()
  const send=async (path,options)=>{calls.push([path,options]);if(!data.has(path))throw Error('unexpected endpoint: '+path);return data.get(path)}
  const submissions=new AdSubmissions(fs.mkdtempSync(path.join(scratch,'test-')))
  return {calls,data,run:async(action,other=ctx)=>runAdExplorer(send,adExplorerSchema.parse({sourceKey:ctx.sourceKey,...action}),other,submissions)}
}

test('removed production comparison actions are rejected before any VBR request',async()=>{
  const h=setup()
  for(const action of ['comparisonSource','compareProduction']){
    const input={action,sessionId,dnt:29,reference:'old-reference',username:'reader',password:'secret'}
    assert.equal(adExplorerSchema.safeParse({...input,sourceKey:ctx.sourceKey}).success,false)
    await assert.rejects(h.run(input))
  }
  assert.equal(h.calls.length,0)
})

test('obsolete signed comparison polls fail without querying VBR',async()=>{
  const h=setup(),{createHmac}=require('node:crypto')
  const payload=Buffer.from(JSON.stringify({purpose:'pending',operation:'comparisonSource',sessionId,taskId:id(141),dnt:29,submittedAt:Date.now()})).toString('base64url')
  const signature=createHmac('sha256',ctx.secret).update(JSON.stringify(['vead',ctx.sourceKey,ctx.principalKey,payload])).digest('base64url')
  await assert.rejects(h.run({action:'poll',pending:payload+'.'+signature}),/expired/)
  assert.equal(h.calls.length,0)
})

test('directory cart deduplicates DNTs across pages, rejects invalid objects and isolates session storage',()=>{
  const {mergeDirectoryItems,saveDirectoryCart,readDirectoryCart,clearDirectoryCart}=require('../lib/restore-points/ad-cart.ts')
  const data=new Map();global.sessionStorage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}
  const first={id:'a',dnt:9,type:'item',name:'Alpha'},second={id:'b',dnt:10,type:'container',name:'Beta'}
  const cart=mergeDirectoryItems([first],[{...first,name:'duplicate'},second,{...first,dnt:-1},{...first,type:'domain'}])
  assert.deepEqual(cart,[first,second]);saveDirectoryCart(ctx.sourceKey,sessionId,cart)
  assert.deepEqual(readDirectoryCart(ctx.sourceKey,sessionId),cart);assert.deepEqual(readDirectoryCart('other',sessionId),[])
  assert.deepEqual(readDirectoryCart(ctx.sourceKey,id(100)),[]);clearDirectoryCart(ctx.sourceKey,sessionId);assert.deepEqual(readDirectoryCart(ctx.sourceKey,sessionId),[])
  delete global.sessionStorage
})
async function prepare(h,intent='restore') {
  const path=(intent==='restore'?r:e)+'/'+sessionId+'/init'
  h.data.set(path,{id:id(20)})
  const result=await h.run({action:'prepare',sessionId,intent,dntIds:[352,420]})
  assert.deepEqual(h.calls.at(-1)[1].body,{dntIds:[352,420]});return result.workflow
}
async function check(h,workflow,step,suffix,body,data={result:'Success'}) {
  const endpoint=v+'/'+workflow.id+'/'+suffix
  const taskId=id(22), resultSuffix=step==='catalogCertificate'?'certificate':suffix
  h.data.set(endpoint,{id:taskId})
  h.data.set(base+'/validations/applicationItems/tasks/'+taskId,{id:taskId,state:'Stopped',type:'Common',result:'Success'})
  h.data.set(v+'/'+workflow.id+'/'+resultSuffix+'/'+taskId+'/result',data)
  const reply=await h.run({action:'check',workflow,step,sessionId,...body})
  return h.run({action:'poll',pending:reply.pending})
}

test('opens exactly the chosen restore point, resumes native task without replay, binds source, account and result IDs',async()=>{
  const h=setup(),task=id(4)
  h.data.set(b,{id:task});h.data.set(base+'/tasks/'+task,{id:task,type:'Common',state:'Working',result:'None'})
  const pending=await h.run({action:'start',...point})
  assert.deepEqual(h.calls[0],[b,{method:'POST',mutation:true,body:{restorePointId:point.restorePointId}}])
  assert.deepEqual(await h.run({action:'poll',...pending}),pending)
  const count=h.calls.length
  await assert.rejects(h.run({action:'poll',...pending},{...ctx,principalKey:'operator B'}),/another session/)
  await assert.rejects(h.run({action:'poll',...pending},{...ctx,sourceKey:'b'.repeat(64)}))
  await assert.rejects(h.run({action:'poll',pending:pending.pending+'x'}))
  assert.equal(h.calls.length,count)
  h.data.set(base+'/tasks/'+task,{id:id(8),type:'Common',state:'Stopped',result:'Success'})
  await assert.rejects(h.run({action:'poll',...pending}),/different Explorer task/)
  h.data.set(base+'/tasks/'+task,{id:task,type:'Common',state:'Stopped',result:'Success'});h.data.set(b+'/'+task+'/result',{id:sessionId})
  assert.deepEqual(await h.run({action:'poll',...pending}),{application:'ActiveDirectory',sourceKey:ctx.sourceKey,sessionId,...point})
  assert.equal(h.calls.filter(c=>c[1]?.method==='POST').length,1)
})
test('uses provider container DNT, native name/LDAP search, bounded paging and attribute-only results',async()=>{
  const h=setup(),task=id(18),path=b+'/'+sessionId+'?skip=15&limit=20',parent={dnt:724,containerType:'IntegratedDNS',dnsZoneCategory:'ForwardLookupZone'}
  h.data.set(path,{id:task})
  const pending=await h.run({action:'browse',sessionId,view:'items',parent,query:'(cn=user*)',ldap:true,recurse:true,skip:15,limit:20})
  assert.deepEqual(h.calls.at(-1)[1].body,{searchObjectType:'ADItem',searchObjectParentFilter:{parentContainerId:724,parentContainerType:'IntegratedDNS',parentDnsZoneCategory:'ForwardLookupZone',children:[]},
    itemSearchFilter:{ldapQuery:'(cn=user*)',recurse:true,sortBy:'Name',sortDirection:'Ascending'}})
  h.data.set(base+'/tasks/'+task,{id:task,type:'Common',state:'Stopped',result:'Warning'})
  h.data.set(b+'/'+sessionId+'/'+task+'/result',{data:[{id:'x',name:'User',type:'ADItem',dnt:71,itemType:'User'}],pagination:{total:19}})
  const found=await h.run({action:'poll',...pending})
  assert.equal(found.total,19);assert.equal(found.items[0].type,'item');assert.equal(found.items[0].dnt,71)
  h.data.set(b+'/'+sessionId+'?skip=0&limit=100',{id:task})
  await h.run({action:'browse',sessionId,view:'attributes',parent:{dnt:71}})
  assert.deepEqual(h.calls.at(-1)[1].body,{searchObjectType:'ADItemAttribute',itemAttributesFilter:{itemId:71}})
  await assert.rejects(h.run({action:'browse',sessionId,view:'items'}))
  await assert.rejects(h.run({action:'browse',sessionId,view:'attributes',parent:{dnt:-1}}))
})
test('restore validation is bound to the selected workflow and principal, including explicit account and attribute choices',async()=>{
  const h=setup(),workflow=await prepare(h)
  const commit={action:'restore',workflow,sessionId,proofs:[],targetContainer:'OU=Recovered,DC=example,DC=test',fullRestore:false,skipAttributes:['photo'],
    mergeMultivalues:true,restoreChangedObjects:true,restoreDeletedObjects:false,restoreLinkExpirationTime:false,accountState:'Disable',
    passwordAction:'SetPasswordTo',newPassword:'fixture-only-reset',changePasswordAtLogon:true}
  await assert.rejects(h.run(commit),/Complete VBR validation/)
  await assert.rejects(h.run({...commit,sessionId:id(7)}),/another Explorer workflow/)
  const login=await check(h,workflow,'credentials','credentials',{server:'dc.test',useSsl:true,username:'fixture',password:'not-real',gcServer:'gc.test'})
  const wire=h.calls.find(([p])=>p.endsWith('/credentials'))[1].body
  assert.deepEqual(wire,{server:'dc.test',credentials:{username:'fixture',password:'not-real',type:'Standard'},useSsl:true,gcServer:'gc.test'})
  assert.doesNotMatch(Buffer.from(login.proof.split('.')[0],'base64url').toString(),/not-real|username/)
  const items=await check(h,workflow,'items','restoreItems',{},{hasAccountObjects:true,canRestoreDeletedObjects:false,mergeModeAllowed:true,question:'Proceed with the selected objects?'})
  const attrs=await check(h,workflow,'attributes','attributesForRestore',{},{attributes:[{name:'photo',isChangeable:true,isMandatory:false},{name:'cn',isChangeable:false,isMandatory:true}]})
  const password=await check(h,workflow,'passwordAccess','adminShareAndSam',{})
  h.data.set(r+'/'+workflow.id+'/start?force=false',{id:id(24),status:'Starting'})
  const proofs=[login.proof,items.proof,password.proof,attrs.proof]
  await assert.rejects(h.run({...commit,restoreDeletedObjects:true,proofs}),/cannot restore deleted/)
  await assert.rejects(h.run({...commit,skipAttributes:['cn'],proofs}),/required Active Directory attributes/)
  assert.deepEqual(await h.run({...commit,proofs}),{sessionId:id(24),status:'Starting'})
  assert.deepEqual(h.calls.at(-1)[1].body,{targetContainer:commit.targetContainer,skipAttributes:['photo'],mergeMultivalues:true,fullRestore:false,
    setChangePasswordAtNextLogon:true,restoreChangedObjects:true,restoreDeletedObjects:false,restoreLinkExpirationTime:false,specifiedPassword:'fixture-only-reset',
    restoreAccountToState:'Disable',passwordRestoreType:'SetPasswordTo'})
  assert.deepEqual(await h.run({...commit,proofs}),{sessionId:id(24),status:'Starting'})
  assert.equal(h.calls.filter(([p])=>p.endsWith('/start?force=false')).length,1)
  const unapproved=await check(h,workflow,'credentials','credentials',{server:'dc.test',username:'u',password:'p'},{result:'Failed',message:'Denied'})
  assert.equal(unapproved.ok,false);assert.equal(unapproved.proof,undefined)
})
test('final submission ownership survives restart, never stores credentials and permits retry only for confirmed client errors',async()=>{
  const dir=fs.mkdtempSync(path.join(scratch,'reservation-')),a=new AdSubmissions(dir),b=new AdSubmissions(dir)
  let sends=0,release,notify
  const delay=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{notify=resolve})
  const first=a.submit(ctx,sessionId,id(68),'restore',{password:'not-a-real-password'},async()=>{sends++;notify();await delay;return {sessionId:id(27)}})
  await started
  await assert.rejects(b.submit(ctx,sessionId,id(68),'restore',{password:'not-a-real-password'},async()=>{sends++}),e=>e.uncertain)
  release();await first
  assert.deepEqual(await b.submit(ctx,sessionId,id(68),'restore',{password:'not-a-real-password'},async()=>{sends++}),{sessionId:id(27)})
  assert.equal(sends,1)
  const [folder]=fs.readdirSync(dir);assert.doesNotMatch(fs.readFileSync(path.join(dir,folder,'accepted.json'),'utf8'),/not-a-real-password|operator A/)
  await assert.rejects(a.submit(ctx,sessionId,id(69),'export',{},async()=>{throw new VbrRecoveryError('Denied',403)}),/Denied/)
  assert.deepEqual(await b.submit(ctx,sessionId,id(69),'export',{},async()=>({sessionId:id(28)})),{sessionId:id(28)})
  await assert.rejects(a.submit(ctx,sessionId,id(70),'export',{},async()=>{throw new VbrRecoveryError('Timed out',502,true)}),/Timed out/)
  await assert.rejects(b.submit(ctx,sessionId,id(70),'export',{},async()=>{throw Error('replayed')}),e=>e.uncertain)
})
test('trust accepts only the exact VBR-reported certificate and export requires validated Windows server and path',async()=>{
  const h=setup(),workflow=await prepare(h),thumbprint='AB:CD',serviceUri='ldaps://dc.test'
  const cert=await check(h,workflow,'certificate','certificate',{server:'dc.test'},{error:'Untrusted issuer',certificate:{thumbprint,subject:'CN=dc.test'},serviceUri})
  assert.equal(cert.message,'Untrusted issuer')
  const trust={action:'trust',sessionId,workflow,certificateKey:cert.certificateKey,thumbprint,serviceUri}
  await assert.rejects(h.run({...trust,thumbprint:'EE:FF'}))
  const trustTask=id(32)
  h.data.set(v+'/'+workflow.id+'/trustCertificate',{id:trustTask});const waiting=await h.run(trust)
  assert.equal(h.calls.at(-1)[1].body.shouldRememberForAccount,false)
  h.data.set(base+'/validations/applicationItems/tasks/'+trustTask,{id:trustTask,type:'Common',state:'Stopped',result:'Success'})
  assert.deepEqual(await h.run({action:'poll',...waiting}),{ok:true})
  const exportFlow=await prepare(h,'export')
  const commit={action:'export',sessionId,workflow:exportFlow,proofs:[],filter:'(cn=demo)',ldap:true}
  await assert.rejects(h.run(commit),/Complete VBR validation/)
  const server=await check(h,exportFlow,'exportServer','targetWindowsServer',{server:'files.test',username:'lab',password:'not-real'},{})
  const prompt=await check(h,exportFlow,'exportPath','targetPath',{path:'D:\\Export'},{result:'InteractionRequired',interaction:[{question:'Overwrite file?'}]})
  assert.equal(prompt.proof,undefined);assert.equal(prompt.question,'Overwrite file?')
  const dest=await check(h,exportFlow,'exportPath','targetPath',{path:'D:\\Export',overwrite:true})
  h.data.set(e+'/'+exportFlow.id+'/start',{jobId:id(25),name:'Export'})
  assert.deepEqual(await h.run({...commit,proofs:[server.proof,dest.proof]}),{sessionId:id(25),name:'Export'})
  assert.deepEqual(h.calls.at(-1)[1].body,{useFilter:true,filter:'(cn=demo)',useLdapFilter:true})
})
test('failed native validators retain structured diagnostics and never grant a proof',async()=>{
  const h=setup(),workflow=await prepare(h),taskId=id(33)
  const path=v+'/'+workflow.id+'/restoreItems'
  h.data.set(path,{id:taskId})
  const poll=await h.run({action:'check',sessionId,workflow,step:'items'})
  h.data.set(base+'/validations/applicationItems/tasks/'+taskId,{id:taskId,type:'Common',state:'Stopped',result:'Failed'})
  h.data.set(path+'/'+taskId+'/result',{question:'Inspect the container?',message:'Cannot validate objects.'})
  assert.deepEqual(await h.run({action:'poll',...poll}),{ok:false,question:'Inspect the container?',message:'Cannot validate objects.'})
  const unknown=await check(h,workflow,'items','restoreItems',{},{unexpectedStatus:'Denied'})
  assert.equal(unknown.ok,false);assert.equal(unknown.proof,undefined)
})
test('closing a SQL or inaccessible session cannot reach the generic close endpoint',async()=>{
  const h=setup()
  await assert.rejects(h.run({action:'finish',sessionId}))
  assert.equal(h.calls.length,1);assert.match(h.calls[0][0],/vead.*keepAlive$/)
  h.data.set(b+'/'+sessionId+'/keepAlive',null)
  const close=base+'/applicationItems/sessions/'+sessionId+'/close'; h.data.set(close,null)
  assert.deepEqual(await h.run({action:'finish',sessionId}),{ok:true})
  assert.equal(h.calls.at(-1)[0],close)
})
