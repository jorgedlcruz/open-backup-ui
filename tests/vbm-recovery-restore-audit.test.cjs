// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const {randomUUID} = require('node:crypto'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2020, esModuleInterop:true},
}).outputText, filename)
const {auditSettings, auditSelection, createRestoreAudit} = require('../lib/vbm-recovery/restore-audit.ts')
const scope = 'a'.repeat(64), parent = randomUUID(), child = randomUUID(), fsp = fs.promises
const example = () => ({
  requestId:randomUUID(), browseSessionId:parent, workload:'Exchange', source:'private-source', authMode:'certificate',
  settings:auditSettings('alternate', {mailbox:'alex@example.org', folder:'Restore test', changedItems:false, deletedItems:true, markRestoredAsUnread:true}),
  selection:auditSelection([{id:'mail-id', subject:'Newsletter'}]),
})
async function temporary(t) {
  const prefix=path.join(os.tmpdir(),'open-backup-vbm-restore-audit-')
  const base=await fsp.mkdtemp(prefix)
  t.after(async()=>{if(!path.resolve(base).startsWith(path.resolve(prefix)))throw Error('Invalid temporary path');await fsp.rm(base,{recursive:true,force:true})})
  return base
}

test('audit records only allowed settings and verified item labels, with URL query values removed', () => {
  const id = randomUUID(), credentials={applicationCertificate:'pfx', applicationCertificatePassword:'pfx-password', userPassword:'private', userCode:'private', items:[{body:'secret'}]}
  const settings = auditSettings('alternate',{...credentials,folder:'Nested\\Restore',changedItems:false,deletedItems:true,markRestoredAsUnread:true,siteURL:'https://user:secret@sharepoint.example/sites/Test?token=secret#token'},id)
  assert.deepEqual(settings,{destination:'alternate',folder:'Nested\\Restore',siteURL:'https://sharepoint.example/sites/Test',changedItems:false,deletedItems:true,markRestoredAsUnread:true,applicationId:id})
  assert.deepEqual(auditSelection([{id:'x',subject:'Selected item',body:'secret',content:'secret',folderPath:'Inbox'}]),[{id:'x',name:'Selected item',path:'Inbox'}])
})

test('a reloaded route uses its current audit schema while sharing in-flight requests with older bundles',async t=>{
  const base=await temporary(t),runtime={},filename=require.resolve('../lib/vbm-recovery/restore-audit.ts')
  const source=fs.readFileSync(filename,'utf8'),localRequire=require('node:module').createRequire(filename)
  function loadBundle(code) {
    const compiled=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText
    const exports={}
    require('node:vm').runInNewContext(compiled,{exports,require:localRequire,globalThis:runtime,process:{cwd:()=>base},Buffer,URL,setTimeout})
    return exports.restoreAudit
  }
  const old=loadBundle(source.replace("'targetOneDriveId', 'originalMailboxFolder'","'targetOneDriveId'")),input=example()
  const first=await old.reserve(scope,input.requestId,parent),ref=await old.begin(scope,input,'first',first)
  const next={...input,requestId:randomUUID(),settings:{...input.settings,originalMailboxFolder:true}}
  const time=await old.reserve(scope,next.requestId,parent)
  await assert.rejects(old.begin(scope,next,'updated-option',time),/audit settings could not be validated/)
  const fresh=loadBundle(source)
  await fresh.begin(scope,next,'updated-option',time)
  assert.equal((await fresh.read(scope,parent)).entries.find(row=>row.id===ref.id).status,'requested')
  assert.equal((await fresh.read(scope,parent)).entries.find(row=>row.requestId===next.requestId).settings.originalMailboxFolder,true)
})

test('original mailbox folder certificate requests preserve optional fields and Unicode labels before writing to Veeam',async t=>{
  const audit=require('../lib/vbm-recovery/restore-audit.ts'),original=audit.restoreAudit,store=createRestoreAudit(await temporary(t))
  const {recoveryPost}=require('../lib/vbm-recovery/load.ts')
  const mailbox='user@example.org',id='backed-up-item',subject='Boletín — actualización 📨'
  const request={action:'restore',sessionId:parent,requestId:randomUUID(),workload:'Exchange',items:[{kind:'item',id,ownerId:'owner'}],
    auth:{mode:'certificate',applicationCertificate:'placeholder',applicationCertificatePassword:'placeholder',applicationId:randomUUID()},
    options:{destination:'alternate',originalMailboxFolder:true,mailbox,folder:'ADOBE',changedItems:false,deletedItems:true,markRestoredAsUnread:false}}
  const context={scope,sourceName:'source',execute:async(resource,method='GET')=>{
    if(method==='POST'){
      const entry=(await store.read(scope,parent)).entries[0]
      assert.equal(entry.status,'requested');assert.equal(entry.authMode,'certificate')
      assert.equal(entry.settings.originalMailboxFolder,true);assert.equal(entry.settings.folder,'ADOBE')
      assert.equal(entry.settings.deletedItems,true);assert.equal(entry.settings.changedItems,false);assert.equal(entry.settings.markRestoredAsUnread,false)
      assert.equal(entry.settings.impersonationAccountName,undefined)
      assert.deepEqual(entry.selection,[{id,name:subject}])
      return {sessionId:child}
    }
    if(resource.endsWith('/'+parent))return {id:parent,type:'Vex',state:'Working'}
    if(resource.endsWith('/mailboxes/owner'))return {id:'owner',email:mailbox}
    return {id,subject,folderPath:null}
  }}
  try {
    audit.restoreAudit={...store,watch:()=>true}
    const receipt=await recoveryPost(context,request)
    assert.equal(receipt.operations[0].status,'accepted')
    assert.equal(receipt.notice,undefined)
  }finally{audit.restoreAudit=original}
})

test('a pre-submit audit failure never reaches the write or directs the operator to Veeam for a missing session',async t=>{
  const audit=require('../lib/vbm-recovery/restore-audit.ts'),original=audit.restoreAudit,store=createRestoreAudit(await temporary(t))
  const {recoveryPost}=require('../lib/vbm-recovery/load.ts')
  const request={action:'restore',sessionId:parent,requestId:randomUUID(),workload:'Exchange',items:[{kind:'item',id:'item',ownerId:'owner'}],
    auth:{mode:'deviceCode',userCode:'placeholder'},options:{destination:'original'}}
  let writes=0
  const context={scope,sourceName:'source',execute:async(resource,method='GET')=>{
    if(method==='POST')writes++
    return resource.endsWith('/'+parent)?{id:parent,type:'Vex',state:'Working'}:{id:'item'}
  }}
  const writeFile=fsp.writeFile.bind(fsp)
  t.mock.method(fsp,'writeFile',(file,...args)=>path.basename(file).length===69?
    Promise.reject(Object.assign(new Error('example private path'),{code:'ENOSPC'})):writeFile(file,...args))
  try {
    audit.restoreAudit={...store,watch:()=>true}
    const receipt=await recoveryPost(context,request)
    assert.equal(writes,0);assert.equal(receipt.notice,undefined)
    assert.equal(receipt.operations[0].status,'notSubmitted')
    assert.equal(receipt.operations[0].sessionId,undefined)
    assert.equal(receipt.operations[0].error,'The restore audit storage is full.')
    assert.ok(!JSON.stringify(receipt).includes('private path'))
  }finally{audit.restoreAudit=original}
})

test('accepted requests and terminal item evidence persist on both sessions; repeated polling and later pages merge',async t=>{
  const base=await temporary(t), store=createRestoreAudit(base), input=example()
  const time=await store.reserve(scope,input.requestId,parent),ref=await store.begin(scope,input,'group',time)
  assert.deepEqual(await store.read('b'.repeat(64),parent),{entries:[],availability:'available'})
  assert.equal((await store.read(scope,parent)).entries[0].status,'requested')
  assert.equal((await createRestoreAudit(base).read(scope,parent)).entries[0].status,'unknown')
  assert.equal(await store.finish(scope,ref,{status:'accepted',sessionId:child}),'available')
  const stopped={id:child,state:'Stopped',result:'Success'}, stats={totalItemsCount:1,restoredItemsCount:1,skippedItemsCount:0,failedItemsCount:0,items:[{id:'mail-id',name:'Newsletter',status:'Success',path:'Inbox'}],warnings:['secret']}
  const event={id:randomUUID(),type:'Restore',itemName:'Newsletter',status:'Success',source:'Inbox',target:'alex@example.org\\Restore test',message:'secret'}
  await store.observe(scope,{...stopped,state:'Working'},null,[])
  assert.equal((await store.read(scope,child)).entries[0].outcome,undefined)
  await store.observe(scope,stopped,stats,[])
  await Promise.all([store.observe(scope,stopped,stats,[event]),store.observe(scope,stopped,null,[event]),store.observe(scope,stopped,stats,[])])
  const fresh=createRestoreAudit(base), history=await fresh.read(scope,child)
  assert.deepEqual(history,await fresh.read(scope,parent))
  const entry=history.entries[0]
  assert.equal(entry.status,'accepted')
  assert.deepEqual(entry.outcome.counts,{total:1,restored:1,failed:0,skipped:0})
  assert.equal(entry.outcome.items.length,1)
  assert.equal(entry.outcome.items[0].name,'Newsletter')
  assert.equal(entry.outcome.items[0].target,event.target)
  assert.equal(entry.outcome.items[0].source,event.source)
  assert.equal(JSON.stringify(history).includes('secret'),false)
  await assert.rejects(fresh.reserve(scope,input.requestId,randomUUID()),/already recorded/)
  await assert.rejects(fresh.begin(scope,input,'group',time),/already recorded/)
  assert.equal((await fresh.read(scope,parent)).entries.length,1)
})

test('an unknown operation never manufactures a child receipt, success counts or item results',async t=>{
  const dir=await temporary(t),store=createRestoreAudit(dir), input=example()
  const ref=await store.begin(scope,input,'group',await store.reserve(scope,input.requestId,parent))
  await store.finish(scope,ref,{status:'unknown'})
  const entry=(await store.read(scope,parent)).entries[0]
  assert.equal(entry.status,'unknown'); assert.equal(entry.outcome,undefined); assert.equal(entry.sessionId,undefined)
  assert.equal((await store.read('../escape',parent)).availability,'unavailable')
  const file=path.join(dir,scope,parent,ref.id+'.json')
  await fsp.writeFile(file,JSON.stringify({...entry,settings:{...entry.settings,userCode:'unexpected secret'}}))
  assert.deepEqual(await store.read(scope,parent),{entries:[],availability:'unavailable'})
})

test('a closed browser still records final item results using only the accepted session and read operations', async t=>{
  const base=await temporary(t), delays=[], calls=[], store=createRestoreAudit(base,async delay=>{delays.push(delay)})
  const input=example(),ref=await store.begin(scope,input,'group',await store.reserve(scope,input.requestId,parent))
  await store.finish(scope,ref,{status:'accepted',sessionId:child})
  let checks=0
  const path='/v8/RestoreSessions/'+child
  const execute=async(resource,method='GET')=>{
    assert.equal(method,'GET'); calls.push(resource)
    if(resource===path)return {id:child,type:'Vex',state:++checks===1?'Working':'Stopped',result:'Success'}
    if(resource===path+'/Statistics')return {restoredItemsCount:1}
    if(resource===path+'/Events?offset=0&limit=200')return {results:[{type:'Restore',status:'Success',itemName:'Newsletter',source:'Inbox',target:'Restore test'}]}
    assert.fail('Unexpected source request')
  }
  await store.watch(scope,child,execute)
  assert.deepEqual(delays,[15000,30000])
  assert.deepEqual(calls,[path,path,path+'/Statistics',path+'/Events?offset=0&limit=200'])
  const {outcome}=(await store.read(scope,parent)).entries[0]
  assert.equal(outcome.counts.restored,1);assert.equal(outcome.items[0].target,'Restore test')
})

test('an unwritable audit denies a new request before Veeam receives a POST',async t=>{
  const audit=require('../lib/vbm-recovery/restore-audit.ts'),original=audit.restoreAudit
  const blocked=path.join(await temporary(t),'blocked')
  await fsp.writeFile(blocked,'normal file')
  audit.restoreAudit=createRestoreAudit(blocked)
  const {recoveryPost}=require('../lib/vbm-recovery/load.ts')
  let posts=0
  const context={scope,sourceName:'source',execute:async(resource,method='GET')=>{
    if(method==='POST'){posts++;return {sessionId:child}}
    if(resource.endsWith('/'+parent))return {id:parent,type:'Vex',state:'Working'}
    return {id:'item'}
  }}
  const request={action:'restore',sessionId:parent,requestId:randomUUID(),workload:'Exchange',items:[{kind:'item',id:'item',ownerId:'owner'}],auth:{mode:'deviceCode',userCode:'example'},options:{destination:'original'}}
  try {await assert.rejects(recoveryPost(context,request),error=>error.status===503 && error.outcomeUnknown===false); assert.equal(posts,0)}
  finally {audit.restoreAudit=original}
})

test('a failed receipt save leaves an unconfirmed durable intent and blocks replay after restart',async t=>{
  const base=await temporary(t),store=createRestoreAudit(base),input=example()
  const time=await store.reserve(scope,input.requestId,parent),ref=await store.begin(scope,input,'mail',time)
  const filename=path.join(base,scope,parent,ref.id+'.json'),snapshot=await fsp.readFile(filename,'utf8')
  await fsp.writeFile(filename,'damaged')
  assert.equal(await store.finish(scope,ref,{status:'accepted',sessionId:child}),'unavailable')
  await fsp.writeFile(filename,snapshot)
  assert.equal((await store.read(scope,parent)).entries[0].status,'unknown')
  const fresh=createRestoreAudit(base)
  await assert.rejects(fresh.reserve(scope,input.requestId,randomUUID()),error=>error.status===409&&error.outcomeUnknown===true)
})

test('a busy browse session returns a bounded recent audit page and keeps older submitted records on disk',async t=>{
  const base=await temporary(t),store=createRestoreAudit(base),time=Date.now(),ids=[]
  for(let offset=0;offset<101;offset++){
    const entry=example()
    const ref=await store.begin(scope,entry,'group',time+offset,'notSubmitted')
    ids.push(ref.id)
  }
  const result=await store.read(scope,parent)
  assert.equal(result.entries.length,100);assert.equal(result.availability,'unavailable')
  assert.equal(result.entries[0].id,ids.at(-1));assert.equal(result.entries.at(-1).id,ids[1])
  assert.equal(JSON.parse(await fsp.readFile(path.join(base,scope,parent,ids[0]+'.json'),'utf8')).id,ids[0])
})

test('a disk failure after partial acceptance delivers the known child receipt and never resubmits another group',async t=>{
  const audit=require('../lib/vbm-recovery/restore-audit.ts'),original=audit.restoreAudit,store=createRestoreAudit(await temporary(t))
  const {recoveryPost}=require('../lib/vbm-recovery/load.ts')
  let groups=0,posts=0
  audit.restoreAudit={...store,begin:(...args)=>{if(++groups===2)throw Error('Disk full');return store.begin(...args)},watch:()=>true}
  const context={scope,sourceName:'source',execute:async(resource,method='GET')=>{
    if(method==='POST'){posts++;return {sessionId:child}}
    if(resource.endsWith('/'+parent))return {id:parent,type:'Vex',state:'Working'}
    return {id:resource.split('/').at(-1)}
  }}
  const request={action:'restore',sessionId:parent,requestId:randomUUID(),workload:'Exchange',items:['a','b','c'].map(id=>({kind:'item',id,ownerId:id})),auth:{mode:'deviceCode',userCode:'example'},options:{destination:'original'}}
  try {
    const receipt=await recoveryPost(context,request)
    assert.deepEqual(receipt.operations.map(row=>row.status),['accepted','notSubmitted','notSubmitted'])
    assert.equal(receipt.operations[1].error,'The restore audit could not be saved.')
    assert.equal(receipt.operations[2].error,'An earlier group stopped this restore request.')
    assert.equal((await store.read(scope,parent)).entries.find(row=>row.status==='notSubmitted').error,receipt.operations[2].error)
    assert.equal(receipt.operations[0].sessionId,child); assert.match(receipt.notice,/audit/)
    assert.deepEqual(await recoveryPost(context,request),receipt);assert.equal(posts,1)
    assert.equal((await store.read(scope,child)).entries[0].sessionId,child)
  } finally {audit.restoreAudit=original}
})
