// Open Backup UI v1.0.2
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), ts=require('typescript')
const {test}=require('node:test'), assert=require('node:assert/strict')
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,
}}).outputText,file)
const {runSqlExplorer,sqlAfterClose,sqlExplorerSchema,sqlRequestSession}=require('../lib/recovery/sql-explorer.ts')
const {browsePage}=require('../lib/recovery/sql-protocol.ts')
const {requiredSqlChecks}=require('../lib/recovery/sql-actions.ts')
const {SqlWorkflows}=require('../lib/server/sql-workflows.ts')
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0')
const sourceKey='a'.repeat(64), ctx={sourceKey,principalKey:'b'.repeat(64),secret:'test deployment key'}
const base='/private-api/v1/backupBrowser/applicationItems/vesql', sessionId=id(5), workflowId=id(6), jobId=id(7)
const database={sourceServer:'sql.example',instanceName:'PROD',sourceDatabase:'Reports'}
const db={type:'SQLDatabase',id:'8',name:'Reports',instanceId:'1',sqlServerName:{machineName:'sql.example',instanceName:'PROD'},
  timeRange:{from:'2026-11-09T01:00:00Z',to:'2026-11-09T01:00:00Z'},allowedOperations:[]}
const common={sessionId,sourceKey}
const dbHandle=()=>browsePage(ctx,{sessionId,view:'databases',parent:{sessionId,type:'SQLInstance',id:'1'},skip:0,limit:100},
  {data:[db]}).items[0].key
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'openbackup-sql-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const store=new SqlWorkflows(dir),calls=[],responses=new Map()
  const send=async(p,options={})=>{
    calls.push({p,options})
    assert.ok(responses.has(p),'unexpected native request '+p)
    const response=responses.get(p)
    return typeof response==='function'?response():response
  }
  const run=(input,identity=ctx)=>runSqlExplorer(send,sqlExplorerSchema.parse(input),identity,store)
  const task=(taskId,result='Success')=>({id:taskId,type:'Common',state:'Stopped',result})
  const validation='/private-api/v1/validations/applicationItems/vesql/'+workflowId+'/'
  const check=async(workflow,step,data={},extra={})=>{
    const taskId=id(200+calls.length),taskPath='/private-api/v1/validations/applicationItems/tasks/'+taskId
    responses.set(validation+step,{id:taskId})
    const {pending}=await run({...common,action:'check',workflow,step,data,...extra})
    responses.set(taskPath,task(taskId))
    responses.set(validation+step+'/'+taskId+'/result',step==='sqlDatabasesDoNotExist'?{results:[{exists:true,targetDatabase:'Reports'}]}:{results:[]})
    return run({action:'poll',sourceKey,pending})
  }
  const prepare=async(intent='publish')=>{
    responses.set('/private-api/v1/'+intent+'/applicationItems/vesql/'+sessionId+'/init',{id:workflowId})
    return (await run({...common,action:'prepare',intent,databases:[dbHandle()]})).workflow
  }
  return {dir,store,calls,responses,run,task,prepare,check}
}

test('SQL startup and polling stay embedded and bind the exact point, source and principal',async t=>{
  const f=fixture(t),start={sourceKey,action:'start',backupId:id(1),objectId:id(2),restorePointId:id(3)}, taskId=id(4)
  f.responses.set(base,{id:taskId})
  const {pending}=await f.run(start),poll={sourceKey,action:'poll',pending}
  assert.deepEqual(f.calls[0].options,{method:'POST',mutation:true,body:{restorePointId:id(3)}})
  await assert.rejects(f.run(poll,{...ctx,principalKey:'c'.repeat(64)}))
  await assert.rejects(f.run({...poll,pending:pending+'x'}))
  await assert.rejects(f.run({...poll,sourceKey:'d'.repeat(64)}))
  assert.equal(f.calls.length,1)
  f.responses.set('/private-api/v1/tasks/'+taskId,{...f.task(taskId),state:'Working'})
  assert.deepEqual(await f.run(poll),{pending})
  f.responses.set('/private-api/v1/tasks/'+taskId,f.task(taskId,'Failed'))
  await assert.rejects(f.run(poll))
  f.responses.set('/private-api/v1/tasks/'+taskId,f.task(taskId,'Warning'))
  f.responses.set(base+'/'+taskId+'/result',{id:sessionId})
  assert.deepEqual(await f.run(poll),{application:'SQL',sourceKey,restorePointId:id(3),sessionId})
  assert.equal(f.calls.filter(c=>c.p===base).length,1)
  for(const add of [{url:'https://other/'},{sessionId},{taskId}])assert.equal(sqlExplorerSchema.safeParse({...start,...add}).success,false)
})

test('native browse honors pagination, instance/server identity, database identity and signed parent scope',async t=>{
  const f=fixture(t),taskId=id(10)
  const page=async(view,parent,data,skip=0,total=data.length)=>{
    const p=base+'/'+sessionId+'?skip='+skip+'&limit=25'
    f.responses.set(p,{id:taskId})
    const {pending}=await f.run({...common,action:'browse',view,parent,skip,limit:25})
    assert.equal(sqlRequestSession({sourceKey,action:'poll',pending},ctx),sessionId)
    f.responses.set('/private-api/v1/tasks/'+taskId,f.task(taskId))
    f.responses.set(base+'/'+sessionId+'/'+taskId+'/result',{data,pagination:{skip,total}})
    const result=await f.run({sourceKey,action:'poll',pending})
    return [result,f.calls.filter(c=>c.p===p).at(-1).options.body]
  }
  const [hosts]=await page('servers',undefined,[{type:'SQLServer',name:'sql.example',allNames:['sql']}])
  const [instances]=await page('instances',hosts.items[0].key,[
    {type:'SQLInstance',id:'1',name:'PROD',serverName:'sql.example'},
    {type:'SQLInstance',id:'2',name:'PROD',serverName:'other.example'},
  ])
  assert.deepEqual(instances.items.map(row=>row.id),['1'])
  const [databases,request]=await page('databases',instances.items[0].key,[db,{...db,id:'9',instanceId:'99'}],0,3)
  assert.equal(databases.items.length,1);assert.equal(databases.nextSkip,2)
  assert.deepEqual(request,{searchObjectType:'SQLDatabase',databaseSearchFilter:{instanceId:'1'}})
  const [files,filter]=await page('files',databases.items[0].key,[{type:'SQLDatabaseFile',primaryFile:'D:/reports.mdf',secondaryFiles:[]}])
  assert.equal(files.items[0].primaryFile,'D:/reports.mdf')
  assert.deepEqual(filter,{searchObjectType:'SQLDatabaseFile',databaseFileSearchFilter:{databaseId:'8'}})
  const count=f.calls.length
  for(const [sid,parent] of [[id(90),instances.items[0].key],[sessionId,hosts.items[0].key]])await assert.rejects(
    f.run({...common,sessionId:sid,action:'browse',view:'databases',parent}))
  assert.equal(f.calls.length,count)
})

test('submitted work is scoped, durable and never repeats the native write; published jobs remain usable after browsing ends',async t=>{
  const f=fixture(t),workflow=await f.prepare()
  const submit=proofs=>({...common,action:'submit',workflow,proofs,settings:{overwrite:true}})
  await assert.rejects(f.run(submit([])),/Complete VBR validation/)
  const proofs=[]
  for(const step of requiredSqlChecks('publish',{})) {
    const result=await f.check(workflow,step,step==='sqlCredentials'?{auth:'sql',username:'operator',password:'sensitive-test-value'}:{})
    assert.equal(result.ok,true);proofs.push(result.proof)
  }
  const file=fs.readFileSync(path.join(f.dir,sourceKey,ctx.principalKey,sessionId,workflowId+'.json'),'utf8')
  assert.ok(!file.includes('sensitive-test-value'));assert.ok(!file.includes('operator'))
  await assert.rejects(f.run({...submit(proofs),settings:{}}),/overwritten/)
  await assert.rejects(f.run(submit([...proofs.slice(0,-1),proofs.at(-1)+'x'])))
  const start='/private-api/v1/publish/applicationItems/vesql/'+workflowId+'/start'
  f.responses.set(start,{sourceDatabaseToJobs:[{database,jobId}]})
  const {jobs}=await f.run(submit(proofs))
  assert.equal(jobs[0].jobId,jobId)
  assert.deepEqual((await f.run(submit(proofs))).jobs.map(j=>j.jobId),[jobId])
  assert.equal(f.calls.filter(c=>c.p===start).length,1)
  const ops='/private-api/v1/applicationItems/operations',row={id:jobId,permanentSessionId:workflowId,explorerKind:'Sql',operationKind:'Publish',operationStatus:'Published'}
  f.responses.set(ops,{data:[{...row,permanentSessionId:id(99)}]})
  assert.deepEqual((await f.run({...common,action:'operations'})).jobs[0].allowedOperations,[])
  f.responses.set(ops,{data:[row]})
  const [owned]=(await f.run({...common,action:'operations'})).jobs
  assert.equal(owned.permanentSessionId,workflowId)
  assert.deepEqual(owned.allowedOperations,['stop','exportPublished'])
  const mounted={...common,action:'mounted',job:owned.key,command:'stop'}
  await assert.rejects(f.run({...mounted,command:'switchover'}))
  assert.equal(await sqlAfterClose(mounted,ctx,f.store),true)
  assert.equal(await sqlAfterClose({...common,action:'browse',view:'servers'},ctx,f.store),false)
  f.responses.set(ops+'/stop',{})
  await f.run(mounted)
  assert.deepEqual(f.calls.at(-1).options.body,{sessions:[{permanentSessionId:workflowId,jobIds:[jobId]}]})
  assert.deepEqual(await f.run({...common,action:'operations'},{...ctx,principalKey:'c'.repeat(64)}),{jobs:[]})
})

test('a fresh verification invalidates old proofs, permits the new complete pass, and never guesses a PIT range',async t=>{
  const f=fixture(t),workflow=await f.prepare(),steps=requiredSqlChecks('publish',{})
  const first=await f.check(workflow,steps[0])
  const second=await f.check(workflow,steps[1])
  await assert.rejects(f.run({...common,action:'check',workflow,step:'windowsLogBackups',data:{restoreBeforeLsn:'12:43'}}),/inside the database recovery range/)
  const proofs=[]
  for(const [index,step] of steps.entries()) {
    const result=await f.check(workflow,step,step==='targetInstance'?{targetNames:['Reports test']}:{},{resetValidation:index===0})
    proofs.push(result.proof)
  }
  const request={...common,action:'submit',workflow,settings:{overwrite:true},proofs}
  await assert.rejects(f.run({...request,proofs:[first.proof,second.proof,...proofs.slice(2)]}),/Complete VBR validation/)
  const start='/private-api/v1/publish/applicationItems/vesql/'+workflowId+'/start'
  f.responses.set(start,{})
  await assert.rejects(f.run(request),/Check Sessions/)
  await assert.rejects(f.run(request),/workflow is unavailable/)
  assert.equal(f.calls.filter(c=>c.p===start).length,1)
})

test('SQL cleanup confirms the session provider and uses the registered session',async t=>{
  const f=fixture(t),keepAlive='/private-api/v1/restore/applicationItems/vesql/'+sessionId+'/keepAlive'
  f.responses.set(keepAlive,{});f.responses.set('/private-api/v1/applicationItems/sessions/'+sessionId+'/close',{})
  await f.run({...common,action:'finish'})
  assert.deepEqual(f.calls.map(c=>c.p),[keepAlive,'/private-api/v1/applicationItems/sessions/'+sessionId+'/close'])
})

test('SQL client polls the strict route schema for a browse page and an asynchronous validation',async t=>{
  const Module=require('node:module'),f=fixture(t),calls=[],signal=new AbortController().signal
  const client={applicationExplorerRequest:async(provider,command,passedSignal)=>{
    assert.equal(provider,'sql-explorer');assert.equal(passedSignal,signal)
    calls.push(command)
    return f.run(command) // First parse the actual strict route schema, then execute the signed task.
  }}
  const originalLoad=Module._load
  const mockLoad=t.mock.method(Module,'_load',function(name,parent,...args){
    if(name==='../api/veeam-client' && parent.filename.endsWith('ad-client.ts'))return {veeamApi:client}
    return originalLoad.call(this,name,parent,...args)
  })
  const {sqlRequest}=require('../lib/restore-points/ad-client.ts')
  mockLoad.mock.restore()
  const timer=global.setTimeout
  t.mock.method(global,'setTimeout',(callback,ms,...args)=>timer(callback,ms===1000?0:ms,...args))
  const taskId=id(31),taskPath='/private-api/v1/tasks/'+taskId
  let polls=0
  f.responses.set(base+'/'+sessionId+'?skip=0&limit=100',{id:taskId})
  f.responses.set(taskPath,()=>++polls===1?{...f.task(taskId),state:'Working'}:f.task(taskId))
  f.responses.set(base+'/'+sessionId+'/'+taskId+'/result',{data:[{type:'SQLServer',name:'sql.example'}]})
  const page=await sqlRequest({...common,action:'browse',view:'servers'},signal)
  assert.equal(page.items[0].name,'sql.example')
  const workflow=await f.prepare()
  const validation='/private-api/v1/validations/applicationItems/vesql/'+workflow.id+'/sqlCredentials'
  f.responses.set(validation,{id:taskId})
  f.responses.set('/private-api/v1/validations/applicationItems/tasks/'+taskId,f.task(taskId))
  f.responses.set(validation+'/'+taskId+'/result',{results:[]})
  const result=await sqlRequest({...common,action:'check',workflow,step:'sqlCredentials',data:{auth:'sql',username:'operator',password:'fixture-only'}},signal)
  assert.equal(result.ok,true);assert.ok(result.proof)
  assert.deepEqual(calls.map(c=>c.action),['browse','poll','poll','check','poll'])
  for(const poll of calls.filter(c=>c.action==='poll'))assert.deepEqual(Object.keys(poll).sort(),['action','pending','sourceKey'])
})
