// Open Backup UI v1.2.0
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), ts=require('typescript')
const {test}=require('node:test'), assert=require('node:assert/strict')
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,
}}).outputText,file)
const {runSqlExplorer,sqlAfterClose,sqlExplorerSchema,sqlRequestSession}=require('../lib/recovery/sql-explorer.ts')
const {browsePage}=require('../lib/recovery/sql-protocol.ts')
const {requiredSqlChecks}=require('../lib/recovery/sql-actions.ts')
const {SqlWorkflows}=require('../lib/server/sql-workflows.ts')
const {SqlBrowseCursor}=require('../lib/server/sql-browse-cursor.ts')
const {sqlActionGroups,sqlWizardDefaults,sqlRecoverySelection,sqlTimeWindow}=require('../lib/restore-points/sql-action-presets.ts')
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
  const cursor=new SqlBrowseCursor(path.join(dir,'cursor'))
  const run=(input,identity=ctx)=>runSqlExplorer(send,sqlExplorerSchema.parse(input),identity,store,cursor)
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
  await assert.rejects(page('databases',instances.items[0].key,[db,{...db,id:'9',instanceId:'99'}],0,3),/different SQL instance/)
  const [databases,request]=await page('databases',instances.items[0].key,[db,{...db,id:'9',name:'Archive'}],0,3)
  assert.equal(databases.items.length,2);assert.equal(databases.nextSkip,2)
  assert.deepEqual(request,{searchObjectType:'SQLDatabase',databaseSearchFilter:{instanceId:'1'}})
  const [files,filter]=await page('files',databases.items[0].key,[{type:'SQLDatabaseFile',primaryFile:'D:/reports.mdf',secondaryFiles:[]}])
  assert.equal(files.items[0].primaryFile,'D:/reports.mdf')
  assert.deepEqual(filter,{searchObjectType:'SQLDatabaseFile',databaseFileSearchFilter:{databaseId:'8'}})
  await assert.rejects(page('files',databases.items[0].key,[{type:'SQLDatabaseFile',primaryFile:'other.mdf',databaseId:'99'}]),/different database/)
  const count=f.calls.length
  for(const [sid,parent] of [[id(90),instances.items[0].key],[sessionId,hosts.items[0].key]])await assert.rejects(
    f.run({...common,sessionId:sid,action:'browse',view:'databases',parent}))
  assert.equal(f.calls.length,count)
})

test('the installed VESQL database envelope retains every database and its exact LSN value',()=>{
  const instanceId='SQL01\\REPORTING', stamp='2026-11-09T23:02:36Z', lsn={value:'298095 0000001284 00001'}
  const parent={sessionId,type:'SQLInstance',id:instanceId,sourceServer:'sql01.example',instanceName:'REPORTING'}
  const input={sessionId,view:'databases',parent,skip:0,limit:40}
  const data=['Warehouse','Reports','ReportTemp'].map((name,i)=>({
    recoveryModel:'Simple',id:id(50+i),name,timeZone:'"0s"',lastLsn:lsn,isSystem:false,guestBackupStartTime:stamp,guestBackupEndTime:stamp,
    previousBackupCreated:stamp,version:869,isReadOnly:false,timeRange:{from:stamp,to:stamp},lsnRange:{from:lsn,to:lsn},
    isBackedUp:true,isAlwaysOn:false,isClustered:false,isPrimary:true,isXtpRequired:false,isHeuristic:false,
    sqlServerName:{machineName:'sql01.example',instanceName:'REPORTING'},instanceId,isSuitableForAlwaysOn:false,type:'SQLDatabase',allowedOperations:[],
  }))
  const result=browsePage(ctx,input,{data,pagination:{total:3,count:3,skip:0,limit:40}})
  assert.equal(result.items.length,3);assert.ok(result.items.every(item=>item.key))
  assert.equal(result.items[0].lsnRange.from,lsn.value)
  assert.equal(browsePage(ctx,input,{data:[{...data[0],lsnRange:{from:{unknown:'unused'}}}]}).items.length,1)
  assert.throws(()=>browsePage(ctx,input,{data:[{...data[0],id:{invalid:true}}]}),/unreadable/)
  assert.throws(()=>browsePage(ctx,input,{data:[{type:'SQLServer',name:'Other'}]}),/different SQL browse view/)
})

test('concurrent instance and database searches consume the shared provider cursor before another search starts',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sql-mutable-cursor-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const a=new SqlBrowseCursor(dir),b=new SqlBrowseCursor(dir),input={view:'servers',sessionId,skip:0,limit:10}
  let active,calls=0,release,notify
  const started=new Promise(resolve=>{notify=resolve}),gate=new Promise(resolve=>{release=resolve})
  const send=async(p,options)=>{
    if(options?.method==='POST'){active=options.body.searchObjectType;calls++;return {id:id(40+calls)}}
    if(p.includes('/tasks/')){if(calls===1){notify();await gate}return {id:p.split('/').at(-1),state:'Stopped',result:'Success',type:'Common'}}
    return {data:[{type:active,name:'SQL01',...(active==='SQLInstance'&&{id:'01',serverName:'SQL01'})}],pagination:{total:1,skip:0}}
  }
  const at=Date.now(),first=a.read(send,ctx,input,id(90),at);await started
  const instances={...input,view:'instances',parent:{sessionId,type:'SQLServer',serverNames:['SQL01'],sole:true}}
  assert.equal(await b.read(send,ctx,instances,id(91),at),null);assert.equal(calls,1)
  release();assert.equal((await first).items[0].type,'SQLServer')
  assert.equal((await b.read(send,ctx,instances,id(91),at)).items[0].type,'SQLInstance')
  await assert.rejects(new SqlBrowseCursor(dir).read(send,ctx,input,id(90),at),/expired/)
  assert.equal(calls,2)
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
  let validationPolls=0
  f.responses.set('/private-api/v1/validations/applicationItems/tasks/'+taskId,()=>++validationPolls===1?{...f.task(taskId),state:'Working'}:f.task(taskId))
  f.responses.set(validation+'/'+taskId+'/result',{results:[]})
  const result=await sqlRequest({...common,action:'check',workflow,step:'sqlCredentials',data:{auth:'sql',username:'operator',password:'fixture-only'}},signal)
  assert.equal(result.ok,true);assert.ok(result.proof)
  const checked=calls.findIndex(c=>c.action==='check')
  assert.equal(calls[0].action,'browse');assert.ok(checked>1)
  assert.ok(calls.slice(1,checked).every(c=>c.action==='poll'))
  assert.deepEqual(calls.slice(checked).map(c=>c.action),['check','poll','poll'])
  for(const poll of calls.filter(c=>c.action==='poll'))assert.deepEqual(Object.keys(poll).sort(),['action','pending','sourceKey'])
})

test('contextual instance and database menus use verified database scope and the native transaction log threshold',()=>{
  const rows=[{...db,key:dbHandle()}]
  const databaseMenus=sqlActionGroups('databases',rows)
  assert.deepEqual(databaseMenus.map(g=>g.label),['Instant database recovery','Restore databases','Export','Publish to another server'])
  const labels=databaseMenus[0].choices.map(c=>c.label)
  assert.deepEqual(labels,['Latest state at original location','Another server'])
  assert.deepEqual(databaseMenus[2].choices.map(c=>c.intent),['export','exportFiles'])
  assert.deepEqual(databaseMenus[3].choices[0].preset,{destination:'another',time:'latest'})
  for(const scope of ['server','instance']){
    const groups=sqlActionGroups(scope,rows)
    assert.equal(groups.length,3)
    assert.ok(groups[0].choices.find(c=>c.preset.time==='pointInTime').disabledReason)
    assert.ok(!groups[0].choices[0].disabledReason)
  }
  for(const invalid of [[],[{...db,key:''}],Array(129).fill(rows[0]),[{...rows[0],type:'SQLInstance'}]])assert.deepEqual(sqlActionGroups('instance',invalid),[])
  const row=(start,end)=>({...rows[0],timeRange:{from:new Date(start).toISOString(),to:new Date(end).toISOString()}})
  assert.equal(sqlTimeWindow([row(0,60000)]),undefined)
  assert.equal(sqlTimeWindow([row(0,120000),row(70000,190000)]),undefined)
  assert.deepEqual(sqlTimeWindow([row(0,122000),row(61000,240000)]),{from:61000,to:122000})
  const [instant]=sqlActionGroups('instance',[row(0,60001)])
  assert.equal(instant.choices.find(c=>c.preset.time==='pointInTime').disabledReason,undefined)
})

test('latest, selected time and alternate destination seed distinct native fields without executing a restore',()=>{
  const rows=[{...db,key:dbHandle(),timeRange:{from:'2026-11-09T00:00:00Z',to:'2026-11-09T01:00:00Z'}}]
  const [instant,,exports,publish]=sqlActionGroups('databases',rows)
  const selection=choice=>{
    const defaults=sqlWizardDefaults(choice.intent,rows,choice.preset)
    return sqlRecoverySelection(defaults.custom,' target.example ',' DB2022 ',defaults.pointInTime,defaults.range.to,'')
  }
  assert.deepEqual(selection(instant.choices[0]),{target:{},when:{}})
  assert.deepEqual(selection(instant.choices[1]),{target:{},when:{restoreToDate:'2026-11-09T01:00:00.000Z'}})
  assert.deepEqual(selection(instant.choices[2]),{target:{machineName:'target.example',instanceName:'DB2022'},when:{}})
  assert.deepEqual(selection(publish.choices[0]),selection(instant.choices[2]))
  assert.equal(sqlWizardDefaults('instant',rows,instant.choices[1].preset).initialStage,'options')
  assert.equal(sqlWizardDefaults('restore',rows,instant.choices[2].preset).initialStage,'destination')
  assert.equal(sqlWizardDefaults('export',rows,exports.choices[0].preset).fileExport,false)
  assert.equal(sqlWizardDefaults('exportFiles',rows,exports.choices[1].preset).fileExport,true)
  assert.equal(sqlWizardDefaults('instant',[{...db,key:dbHandle()}],instant.choices[1].preset).pointInTime,false)
})

test('server-scope original restore and Instant Recovery preserve identically named databases from distinct source instances',async t=>{
  const sourceRows=['PROD','QA'].map((instance,i)=>({...db,id:'database-'+i,instanceId:'instance-'+i,
    sqlServerName:{machineName:database.sourceServer,instanceName:instance}}))
  const tuples=sourceRows.map(row=>({...database,instanceName:row.sqlServerName.instanceName}))
  const selected=sourceRows.map(row=>browsePage(ctx,{sessionId,view:'databases',skip:0,limit:10,
    parent:{type:'SQLInstance',sessionId,id:row.instanceId}},{data:[row]}).items[0])
  for(const intent of ['instant','restore']){
    const f=fixture(t),group=sqlActionGroups('server',selected).find(g=>g.choices[0].intent===intent)
    const defaults=sqlWizardDefaults(intent,selected,group.choices[0].preset)
    const {target,when}=sqlRecoverySelection(defaults.custom,'ignored.example','IGNORED',defaults.pointInTime,NaN,'')
    const native=intent==='instant'?'instantRecovery':'restore',action='/private-api/v1/'+native+'/applicationItems/vesql/'
    f.responses.set(action+sessionId+'/init',{id:workflowId})
    const {workflow}=await f.run({...common,action:'prepare',intent,databases:selected.map(row=>row.key)})
    assert.deepEqual(f.calls.at(-1).options.body,intent==='instant'?{databases:tuples}:{databasesToRestore:tuples})
    const proofs=[]
    for(const step of requiredSqlChecks(intent,{})){
      const input=step==='sqlCredentials'||step==='guestCredentials'?target:step==='windowsLogBackups'?when:
        step==='targetInstance'?{targetNames:tuples.map(row=>row.sourceDatabase)}:{}
      proofs.push((await f.check(workflow,step,input)).proof)
    }
    const payload=step=>f.calls.find(c=>c.p.endsWith('/'+workflowId+'/'+step)).options.body
    assert.deepEqual(payload('sqlCredentials'),{encryptionType:'Optional'})
    assert.deepEqual(payload('guestCredentials'),{machineName:database.sourceServer})
    assert.deepEqual(payload('targetInstance').targetDatabases,tuples.map(d=>({sourceDatabaseIdentifier:d,targetDatabaseName:d.sourceDatabase})))
    assert.deepEqual(payload('files').targetDatabaseFiles.map(f=>f.sourceDatabaseIdentifier),tuples)
    const final=action+workflowId+'/start'
    f.responses.set(final,{sourceDatabaseToJobs:tuples.map((database,i)=>({database,jobId:id(90+i)}))})
    await f.run({...common,action:'submit',workflow,proofs,settings:{overwrite:true}})
    const submitted=f.calls.at(-1).options.body
    assert.deepEqual((submitted.settings||submitted.restoreSettings).map(i=>i.database),tuples)
  }
})

test('export requires the configured recovery date and LSN to match the log validation before starting',async t=>{
  const before={restoreToDate:'2026-11-09T00:05:00Z',restoreBeforeLsn:'0001 0002 0003'}
  const after={...before,restoreToDate:'2026-11-09T00:06:00Z'}
  const selected=browsePage(ctx,{sessionId,view:'databases',skip:0,limit:10,parent:{type:'SQLInstance',sessionId,id:'1'}},
    {data:[{...db,timeRange:{from:'2026-11-09T00:00:00Z',to:'2026-11-09T01:00:00Z'}}]}).items
  const cases=[
    ['export',{},before,true,false],
    ['exportFiles',before,{},true,false],
    ['exportFiles',before,after,true,false],
    ['export',before,{...before,restoreBeforeLsn:'0001 0002 0004'},true,false],
    ['exportFiles',before,{restoreToDate:before.restoreToDate},true,false],
    ['exportFiles',before,undefined,false,false],
    ['export',{}, {},false,true],
    ['exportFiles',{},undefined,false,true],
    ['export',before,before,true,true],
    ['exportFiles',before,before,true,true],
  ]
  for(const [intent,configured,logged,pointInTime,permitted] of cases) {
    const f=fixture(t),url='/private-api/v1/export/applicationItems/vesql/',validator='/private-api/v1/validations/applicationItems/vesql/'+workflowId+'/'
    f.responses.set(url+sessionId+'/init',{id:workflowId})
    const {workflow}=await f.run({...common,action:'prepare',intent,databases:selected.map(d=>d.key)})
    const proofs=[],settings={pointInTime}
    for(const step of requiredSqlChecks(intent,settings)) {
      const data=step==='exportPointInTime'?configured:step==='windowsLogBackups'?logged:
        step==='exportTargetWindowsServer'?{machineName:'export.test',username:'operator',password:'fixture'}:step==='exportTargetPath'?{targetPath:'D:/Export'}:{}
      if(step==='exportPointInTime') {
        f.responses.set(url+workflowId+'/pointInTime',{})
        proofs.push((await f.run({...common,action:'check',workflow,step,data})).proof)
      } else {
        const taskId=id(800+proofs.length)
        f.responses.set(validator+step,{id:taskId})
        const {pending}=await f.run({...common,action:'check',workflow,step,data})
        f.responses.set('/private-api/v1/validations/applicationItems/tasks/'+taskId,f.task(taskId))
        const segment={stagingServerSqlCredentials:'sqlCredentials',stagingServerGuestCredentials:'guestCredentials'}[step]||step
        f.responses.set(validator+segment+'/'+taskId+'/result',{validationResults:[]})
        proofs.push((await f.run({sourceKey,action:'poll',pending})).proof)
      }
    }
    const request={...common,action:'submit',workflow,settings,proofs},start=url+workflowId+'/start'
    f.responses.set(start,{sourceDatabaseToJobs:[{jobId,database}]})
    if(permitted)assert.equal((await f.run(request)).jobs[0].jobId,jobId)
    else await assert.rejects(f.run(request),/validated SQL recovery time/)
    assert.equal(f.calls.filter(c=>c.p===start).length,Number(permitted))
  }
})
