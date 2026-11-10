// Open Backup UI v1.2.0
const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript')
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,
}}).outputText,file)
const {runSqlStaging,stagingInput}=require('../lib/recovery/sql-staging.ts')
const {sqlExplorerSchema,sqlRequestSession,sqlAfterClose}=require('../lib/recovery/sql-explorer.ts')
const {SqlStagingReceipts}=require('../lib/server/sql-staging-receipts.ts')
const {VbrRecoveryError}=require('../lib/recovery/error.ts')
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0')
const ctx={sourceKey:'a'.repeat(64),principalKey:'b'.repeat(64),secret:'fixture-key',stagingGateway:'https://vbr.example'},other={...ctx,principalKey:'c'.repeat(64)}
const sessionId=id(1),taskId=id(2),choiceId=id(3)
const root='/private-api/v1/settings/applicationItems/vesql/stagingServer',validation='/private-api/v1/validations/applicationItems'
const choose=validation+'/vesql/'+sessionId+'/targetInstances',set=root+'?sessionId='+sessionId
const user=(username,password)=>({username,password,type:'Standard'})
const windows=(username,password)=>({credentials:user(username,password),credentialsKind:'UserAccount'})
const winAccount='EXAMPLE\\staging',sqlAccount='sql-editor',sensitive='hidden-fixture'
const installed=(enabled=false)=>({enabled,machineConnectionConfig:{machineName:'original',windowsCredentials:windows(winAccount,sensitive)},
  sqlConnectionConfig:{sqlServer:{machineName:'original',instanceName:'LAB'},sqlAuthCredentials:user(sqlAccount,sensitive)}})
const ui=(extra={})=>({enabled:true,serverName:'replacement\\LAB',windowsUsername:winAccount,sqlAuth:'sql',sqlUsername:sqlAccount,...extra})
const common=(action,fields={})=>({sourceKey:ctx.sourceKey,sessionId,action,...fields})
function fixture(t,initial=installed()){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'openbackup-staging-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const repo=new SqlStagingReceipts(dir),calls=[],reply=new Map(),native={current:initial}
  reply.set(root,()=>native.current)
  reply.set('/private-api/v1/permissions',{permissions:['ViewBackupObjects','ViewRestorePoints','ViewTasks','StartExplorerForMsSql']})
  reply.set('/private-api/v1/restore/applicationItems/vesql/'+sessionId+'/keepAlive',null)
  reply.set(set,{id:taskId});reply.set(choose,{id:choiceId})
  for(const id of [choiceId,taskId])reply.set(validation+'/tasks/'+id,{type:'Common',id,state:'Working',result:'None'})
  for(const suffix of ['enable','disable'])reply.set(root+'/'+suffix,()=>{native.current.enabled=suffix==='enable';return null})
  const send=async(p,o={})=>{
    calls.push([p,o])
    assert.ok(reply.has(p),'unmocked '+p)
    const value=reply.get(p)
    return typeof value==='function'?await value(o):value
  }
  const run=(input,identity=ctx)=>runSqlStaging(send,stagingInput.parse(input),identity,repo)
  const read=(identity=ctx)=>run(common('stagingRead'),identity)
  const save=(revision,settings=ui(),identity=ctx)=>run(common('stagingSave',{settings,revision}),identity)
  const poll=(pending,identity=ctx)=>run(common('stagingPoll',{pending}),identity)
  const stopped=(id,result='Success')=>reply.set(validation+'/tasks/'+id,{id,type:'Common',state:'Stopped',result})
  const paths=p=>calls.filter(([url])=>p===url)
  return {dir,repo,reply,calls,native,run,read,save,poll,stopped,paths}
}

test('staging read projects only editable public fields, including initial unconfigured settings',async t=>{
  const f=fixture(t,null)
  const initial=await f.read()
  assert.deepEqual(initial.settings,{enabled:false,serverName:'',windowsUsername:'',sqlUsername:'',sqlAuth:'machine',hasWindowsPassword:false,hasSqlPassword:false})
  f.native.current=installed()
  const result=await f.read()
  assert.deepEqual(result.settings,{enabled:false,serverName:'original\\LAB',windowsUsername:winAccount,sqlUsername:sqlAccount,sqlAuth:'sql',hasWindowsPassword:true,hasSqlPassword:true})
  assert.ok(!JSON.stringify(result).includes(sensitive));assert.ok(!Buffer.from(result.revision.split('.')[0],'base64url').toString().includes(sensitive))
  for(const [p,o] of f.calls)assert.ok(!o.mutation&&p!==choose)
  f.native.current={enabled:false,machineConnectionConfig:{machineName:'host'},sqlConnectionConfig:{}}
  assert.equal((await f.read()).settings.serverName,'host')
  f.native.current={enabled:true,malformed:sensitive}
  await assert.rejects(f.read(),e=>!e.message.includes(sensitive)&&e.status===502)
})

test('native host-only validation reuses saved credentials across host changes and resumes the exact accepted native task',async t=>{
  const f=fixture(t),{revision}=await f.read()
  const started=await f.save(revision)
  assert.deepEqual(f.paths(set)[0][1],{method:'POST',mutation:true,body:{
    machineConnectionConfig:{machineName:'replacement'},sqlConnectionConfig:{sqlServer:{machineName:'replacement',instanceName:'LAB'},encryptionType:'Optional'}}})
  assert.equal(started.status,'pending');assert.equal((await f.save(revision)).status,'pending')
  assert.equal(f.paths(set).length,1);assert.equal((await f.poll(started.pending)).status,'pending')
  const resumed=await f.read();assert.ok(resumed.pending)
  assert.equal(f.paths(root+'/enable').length,0)
  f.stopped(taskId);f.reply.set(root+'/'+taskId+'/result',()=>{
    f.native.current.machineConnectionConfig.machineName='replacement'
    f.native.current.sqlConnectionConfig.sqlServer.machineName='replacement'
    return {error:null}
  })
  assert.deepEqual(await f.poll(resumed.pending),{status:'saved'})
  assert.equal(f.paths(root+'/enable').length,1)
  f.reply.delete(validation+'/tasks/'+taskId)
  assert.deepEqual(await f.poll(started.pending),{status:'saved'})
  assert.equal((await f.read()).pending,undefined)
  const persisted=fs.readFileSync(path.join(f.dir,fs.readdirSync(f.dir)[0]),'utf8')
  for(const str of [sensitive,sqlAccount,winAccount,'replacement'])assert.ok(!persisted.includes(str))
})

test('staging credentials are typed natively, validated on change and never sent through a discovery request',async t=>{
  const f=fixture(t),read=await f.read()
  await assert.rejects(f.save(read.revision,ui({windowsUsername:'different'})),/Enter a password/)
  await assert.rejects(f.save(read.revision,ui({sqlUsername:'different'})),/Enter a password/)
  await assert.rejects(f.save(read.revision,ui({sqlAuth:'machine',sqlUsername:''})),/Enter a password/)
  await assert.rejects(f.save(read.revision,ui({serverName:'bad\\path\\parts'})),/required account/)
  assert.equal(f.paths(set).length,0)
  const updated=ui({sqlAuth:'machine',sqlUsername:'',windowsPassword:' retain-spaces '})
  await f.save(read.revision,updated)
  const body=f.paths(set)[0][1].body
  assert.deepEqual(body.machineConnectionConfig.windowsCredentials,windows(winAccount,updated.windowsPassword))
  assert.deepEqual(body.sqlConnectionConfig.windowsCredentials,body.machineConnectionConfig.windowsCredentials)
  assert.equal(body.sqlConnectionConfig.sqlAuthCredentials,undefined)
  const f2=fixture(t,null),r2=await f2.read()
  await f2.save(r2.revision,ui({windowsPassword:'windows-fixture',sqlPassword:'sql-fixture'}))
  const o=f2.paths(set)[0][1].body
  assert.deepEqual(o.machineConnectionConfig.windowsCredentials,windows(winAccount,'windows-fixture'))
  assert.deepEqual(o.sqlConnectionConfig.sqlAuthCredentials,user(sqlAccount,'sql-fixture'))
  const f3=fixture(t),r3=await f3.read()
  await f3.save(r3.revision,ui({sqlAuth:'windows',sqlUsername:'EXAMPLE\\sql',sqlPassword:'separate-fixture'}))
  assert.deepEqual(f3.paths(set)[0][1].body.sqlConnectionConfig.windowsCredentials,windows('EXAMPLE\\sql','separate-fixture'))
})

test('stale native revisions and simultaneous admins cannot submit overlapping global staging changes or poll a foreign task',async t=>{
  const f=fixture(t),alice=await f.read(),bob=await f.read(other)
  f.native.current.machineConnectionConfig.windowsCredentials.credentials.password='external-change'
  await assert.rejects(f.save(alice.revision),/changed/);assert.equal(f.paths(set).length,0)
  const fresh=await f.read()
  let release,announce
  const entered=new Promise(resolve=>{announce=resolve})
  f.reply.set(set,()=>new Promise(resolve=>{release=()=>resolve({id:taskId});announce()}))
  const first=f.save(fresh.revision)
  await entered
  try{await assert.rejects(f.save(bob.revision,ui(),other),/being updated/)}finally{release()}
  const {pending}=await first
  await assert.rejects(f.save(bob.revision,ui(),other),/changed/)
  const after=await f.read(other);assert.equal(after.pending,undefined)
  await assert.rejects(f.save(after.revision,ui(),other),/being updated/)
  await assert.rejects(f.poll(pending,other),/expired or belongs/)
  assert.equal(f.paths(set).length,1);assert.equal(f.paths(root+'/enable').length,0)
})

test('native validation errors are sanitized; unknown acknowledgements cannot be replayed; changing native target never toggles it',async t=>{
  const f=fixture(t),{revision}=await f.read(),{pending}=await f.save(revision)
  f.stopped(taskId);f.reply.set(root+'/'+taskId+'/result',{error:sensitive})
  await assert.rejects(f.poll(pending),e=>e.message.includes('could not validate')&&!e.message.includes(sensitive))
  await assert.rejects(f.poll(pending),/could not validate/);assert.equal(f.paths(root+'/enable').length,0)
  const g=fixture(t),r=await g.read()
  g.reply.set(set,()=>{throw new VbrRecoveryError(sensitive,502,true)})
  await assert.rejects(g.save(r.revision),e=>e.uncertain&&!e.message.includes(sensitive))
  await assert.rejects(g.save(r.revision),e=>e.uncertain)
  await assert.rejects(g.save((await g.read()).revision),e=>e.uncertain)
  assert.equal(g.paths(set).length,1)
  const h=fixture(t),u=await h.read(),a=await h.save(u.revision)
  h.stopped(taskId);h.reply.set(root+'/'+taskId+'/result',{})
  await assert.rejects(h.poll(a.pending),/changed/);assert.equal(h.paths(root+'/enable').length,0)
})

test('duplicate profiles on one verified gateway share the write guard; separate gateways and signed profile task access stay isolated',async t=>{
  const f=fixture(t),duplicate={...other,sourceKey:'d'.repeat(64)},another={...duplicate,stagingGateway:'https://other.example'}
  const profileRead=identity=>f.run({...common('stagingRead'),sourceKey:identity.sourceKey},identity)
  const profileSave=(identity,revision)=>f.run({...common('stagingSave',{settings:ui(),revision}),sourceKey:identity.sourceKey},identity)
  const [first,second]=await Promise.all([f.read(),profileRead(duplicate)])
  const started=await f.save(first.revision)
  await assert.rejects(profileSave(duplicate,second.revision),/changed/)
  const refreshed=await profileRead(duplicate);assert.equal(refreshed.pending,undefined)
  await assert.rejects(profileSave(duplicate,refreshed.revision),/being updated/)
  await assert.rejects(f.run({...common('stagingPoll',{pending:started.pending}),sourceKey:duplicate.sourceKey},duplicate),/expired or belongs/)
  assert.equal(f.paths(set).length,1)
  const separate=await profileRead(another);assert.equal(separate.pending,undefined)
  assert.equal((await profileSave(another,separate.revision)).status,'pending')
  assert.equal(f.paths(set).length,2);assert.equal(fs.readdirSync(f.dir).filter(p=>p.endsWith('.json')).length,2)
  await assert.rejects(profileRead({...duplicate,stagingGateway:'http://vbr.example'}),/web console configuration/)
  assert.equal(stagingInput.safeParse({...common('stagingRead'),stagingGateway:'https://other.example'}).success,false)
})

test('enable/disable alone keep existing configuration; discovery is mount-scoped and consumes the correct Common task',async t=>{
  const f=fixture(t),{revision}=await f.read()
  assert.deepEqual(await f.save(revision,ui({serverName:'original\\LAB'})),{status:'saved'})
  assert.equal(f.paths(set).length,0);assert.deepEqual(f.paths(root+'/enable')[0][1],{method:'POST',mutation:true})
  await f.save((await f.read()).revision,ui({enabled:false,windowsUsername:'',sqlUsername:''}))
  assert.equal(f.paths(root+'/disable').length,1);assert.equal(f.paths(set).length,0)
  const {pending}=await f.run(common('stagingChoose'))
  assert.deepEqual(f.paths(choose)[0][1],{method:'POST'})
  f.reply.set(validation+'/tasks/'+choiceId,{id:taskId,type:'Common',state:'Stopped',result:'Success'})
  await assert.rejects(f.poll(pending),/different Explorer task/)
  f.reply.set(validation+'/tasks/'+choiceId,{id:choiceId,type:'FlrRestore',state:'Stopped',result:'Success'})
  await assert.rejects(f.poll(pending),/different Explorer task/)
  f.stopped(choiceId,'Warning');f.reply.set(choose+'/'+choiceId+'/result',{instances:[{serverName:'host',instanceName:null},{serverName:'host',instanceName:'LAB'},{serverName:'host',instanceName:'LAB'}]})
  assert.deepEqual(await f.poll(pending),{status:'choices',servers:['host','host\\LAB']})
  f.stopped(choiceId,'Failed');await assert.rejects(f.poll(pending),/could not list/)
})

test('only the current source and a live SQL mount with the Explorer rights may enter settings',async t=>{
  const f=fixture(t),input=common('stagingRead')
  const parsed=sqlExplorerSchema.parse(input)
  assert.equal(sqlRequestSession(parsed,ctx),sessionId);assert.equal(await sqlAfterClose(parsed,ctx),false)
  assert.equal(sqlExplorerSchema.safeParse({...input,sessionId:undefined}).success,false)
  await assert.rejects(f.run({...input,sourceKey:'f'.repeat(64)}),/source changed/)
  assert.equal(f.calls.length,0)
  f.reply.set('/private-api/v1/permissions',{permissions:['StartExplorerForMsSql']})
  await assert.rejects(f.read(),e=>e.status===403);assert.equal(f.paths(root).length,0)
  const g=fixture(t)
  g.reply.set('/private-api/v1/restore/applicationItems/vesql/'+sessionId+'/keepAlive',()=>{throw new VbrRecoveryError(sensitive,404)})
  await assert.rejects(g.read(),e=>e.status===404&&!e.message.includes(sensitive))
  assert.equal(g.paths(root).length,0)
})
