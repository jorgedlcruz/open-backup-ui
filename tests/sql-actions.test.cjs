// Open Backup UI v1.2.0
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)
const {initSqlAction,submitSqlAction,mountedSqlAction,beginSqlCheck,pollSqlCheck,requiredSqlChecks,cancelSqlAction}=require('../lib/recovery/sql-actions.ts')
const {normalizeSqlValidation}=require('../lib/recovery/sql-validation-result.ts')
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const [browse,flow,task,job]=[1,2,3,4].map(id),base='/private-api/v1'
const db={sourceServer:'sql.lab',instanceName:'',sourceDatabase:'Adventure'},db2={...db,sourceDatabase:'Reports'}
const ack={sourceDatabaseToJobs:[{database:db,jobId:job}]}
function mock() {
  const calls=[],replies=new Map()
  return {calls,replies,send:async(path,options)=>{calls.push({path,options});assert.ok(replies.has(path),'unexpected request '+path);return replies.get(path)}}
}
const root=(intent,session)=>base+'/'+intent+'/applicationItems/vesql/'+session
const validation=root('validations',flow)
test('initialization uses server-issued source identity and the exact native operation wrapper',async()=>{
  for(const [intent,group,body] of [['restore','restore',{databasesToRestore:[db]}],['instant','instantRecovery',{databases:[db]}],['publish','publish',{databases:[db]}],['export','export',{databasesToExport:[{database:db,toBakFile:true}]}]]){
    const h=mock(),url=root(group,browse)+'/init';h.replies.set(url,{id:flow})
    assert.equal(await initSqlAction(h.send,browse,intent,[db]),flow);assert.deepEqual(h.calls,[{path:url,options:{method:'POST',mutation:true,body}}])
  }
  const h=mock()
  h.replies.set(root('export',browse)+'/init',{id:flow})
  await initSqlAction(h.send,browse,'exportFiles',[db])
  assert.deepEqual(h.calls.pop().options.body,{databasesToExport:[{database:db,toBakFile:false}]})
  await assert.rejects(initSqlAction(h.send,browse,'restore',[db,db]),/once/)
  assert.equal(h.calls.length,0)
  h.replies.set(root('publish',browse)+'/initPublishedDatabaseExport',{id:flow})
  await initSqlAction(h.send,browse,'exportPublished',[],[job])
  assert.deepEqual(h.calls[0].options.body,{databasesToExport:[{publishJobId:job}]})
})
test('validators send scoped Windows and SQL credentials, per-database file/name/recovery settings and native non-FLR envelopes',async()=>{
  const h=mock(),dataFiles={primaryFile:'D:/Adventure.mdf',secondaryFiles:['D:/Adventure.ldf'],blobFolders:[]}
  async function check(step,data,dbs=[db],intent='restore'){h.replies.set(validation+'/'+step,{id:task});assert.deepEqual(await beginSqlCheck(h.send,flow,intent,step,data,dbs),{taskId:task});return h.calls.at(-1).options.body}
  assert.deepEqual(await check('guestCredentials',{username:'user',password:'fixture-password'}),{machineName:db.sourceServer,windowsCredentials:{credentials:{username:'user',password:'fixture-password',type:'Standard',uniqueId:''},credentialsKind:'UserAccount'}})
  assert.deepEqual(await check('sqlCredentials',{}),{encryptionType:'Optional'})
  assert.deepEqual(await check('sqlCredentials',{auth:'sql',machineName:'target',instanceName:'A',username:'sql',password:'fixture-pass'}),{sqlServer:{machineName:'target',instanceName:'A'},encryptionType:'Optional',sqlAuthCredentials:{username:'sql',password:'fixture-pass',type:'Standard'}})
  assert.deepEqual(await check('targetInstance',{targetNames:['New Adventure','R']},[db,db2]),{targetDatabases:[{sourceDatabaseIdentifier:db,targetDatabaseName:'New Adventure'},{sourceDatabaseIdentifier:db2,targetDatabaseName:'R'}]})
  assert.deepEqual(await check('files',{targetFiles:[dataFiles,null]},[db,db2]),{targetDatabaseFiles:[{sourceDatabaseIdentifier:db,targetFiles:dataFiles},{sourceDatabaseIdentifier:db2,targetFiles:null}]})
  assert.deepEqual(await check('standByRestoreMode',{recoveryState:'StandBy',standbyFilePath:'D:/undo.tuf'}),{validationConfigs:[{sourceDatabase:db,recoveryState:'StandBy',standbyFilePath:'D:/undo.tuf'}]})
  await assert.rejects(check('standByRestoreMode',{recoveryState:'StandBy'}))
  await assert.rejects(check('files',{targetFiles:[dataFiles,null]}))
  await assert.rejects(check('sqlCredentials',{auth:'sql'}))
  await assert.rejects(check('exportTargetPath',{targetPath:'D:/Exports'}))
  assert.deepEqual(await check('windowsLogBackups',{restoreBeforeLsn:'123456'}),{restoreToDate:'',restoreBeforeLsn:'123456'})
})
test('native transactions and export point-in-time are different requests; staging credential tasks use shared result endpoints',async()=>{
  const h=mock(),date='2026-01-20T10:45:00Z',path=validation+'/fineTuning/transactions?skip=20&limit=8'
  h.replies.set(path,{id:task});await beginSqlCheck(h.send,flow,'restore','transactions',{dateTime:date,direction:'Before',skip:20,limit:8},[db])
  assert.deepEqual(h.calls[0].options.body,{dateTime:date,direction:'Before'})
  const status=base+'/validations/applicationItems/tasks/'+task
  h.replies.set(status,{id:task,type:'Common',state:'Working'})
  assert.deepEqual(await pollSqlCheck(h.send,flow,'transactions',task),{pending:true})
  h.replies.set(status,{id:task,type:'Common',state:'Stopped',result:'Success'})
  h.replies.set(validation+'/fineTuning/transactions/'+task+'/result',{transactions:[{lsn:'700',time:date,operation:'Insert',object:'dbo.t',type:'Row',secret:'must not leak'}],paginationResult:{count:90}})
  const found=await pollSqlCheck(h.send,flow,'transactions',task)
  assert.deepEqual(found.result,{ok:true,errors:[],warnings:[],data:{count:90,transactions:[{lsn:'700',time:date,operation:'Insert',object:'dbo.t',type:'Row'}]}})
  h.replies.set(root('export',flow)+'/pointInTime',null)
  assert.equal((await beginSqlCheck(h.send,flow,'export','exportPointInTime',{restoreToDate:date,restoreBeforeLsn:'700'},[db])).result.ok,true)
  assert.deepEqual(h.calls.at(-1).options.body,{restoreToDate:date,restoreBeforeLsn:'700'})
  h.replies.set(validation+'/guestCredentials/'+task+'/result',{results:[{error:'Permission denied'}]})
  assert.equal((await pollSqlCheck(h.send,flow,'stagingServerGuestCredentials',task)).result.ok,false)
  h.replies.set(status,{id:job,type:'Common',state:'Stopped',result:'Success'})
  await assert.rejects(pollSqlCheck(h.send,flow,'stagingServerGuestCredentials',task),/different/)
})
test('validation errors, multiple target collisions and unknown envelopes cannot silently authorize overwrite',()=>{
  assert.deepEqual(normalizeSqlValidation('files',{validationResults:[{errorMessages:['Disk full'],warningMessages:['Volume thin']}]}),{ok:false,errors:['Disk full'],warnings:['Volume thin'],data:{}})
  assert.equal(normalizeSqlValidation('files',{}).ok,false)
  assert.equal(normalizeSqlValidation('files',{validationResults:[]},'Task failed').ok,false)
  assert.deepEqual(normalizeSqlValidation('sqlDatabasesDoNotExist',{results:[{targetDatabase:'Existing',exists:true},{targetDatabase:'New',exists:false}]}).data,{existingDatabases:['Existing']})
  assert.equal(normalizeSqlValidation('sqlDatabasesDoNotExist',{results:[{exists:true}]}).ok,false)
  assert.deepEqual(normalizeSqlValidation('targetInstances',{instances:[{serverName:'host',instanceName:'test',credentials:'must not leak'}]}).data,{instances:[{machineName:'host',instanceName:'test'}]})
})
test('submit is never replayed when acknowledgement is ambiguous, uses explicit overwrite and real provider job IDs',async()=>{
  for(const [intent,group,settings,body] of [
    ['restore','restore',{}, {restoreSettings:[{database:db,allowTargetDatabaseOverwrite:false}]}],
    ['publish','publish',{overwrite:true},{publishSettings:[{database:db,allowTargetDatabaseOverwrite:true}]}],
    ['instant','instantRecovery',{schedule:'ScheduledAt',scheduledAt:'2026-12-01T12:34:00Z'},{settings:[{database:db,allowTargetDatabaseOverwrite:false,scheduleSpec:{scheduleType:'ScheduledAt',switchDateTime:'2026-12-01T12:34:00Z'}}]}],
    ['export','export',{compression:'WithCompression'},{exportSettings:[{database:db,bakCompression:'WithCompression'}]}],
    ['exportFiles','export',{}, {exportSettings:[{database:db,bakCompression:'Default'}]}],
    ['exportPublished','exportPublishedDatabase',{}, {exportSettings:[{publishJobId:job,bakCompression:'Default'}]}],
  ]){
    const h=mock(),path=root(group,flow)+'/start';h.replies.set(path,ack)
    assert.deepEqual(await submitSqlAction(h.send,flow,intent,[db],settings,[job]),{jobs:ack.sourceDatabaseToJobs})
    assert.deepEqual(h.calls[0].options.body,body)
    h.replies.set(path,{sourceDatabaseToJobs:[{database:{sourceServer:db.sourceServer,sourceDatabase:db.sourceDatabase},jobId:job}]})
    assert.deepEqual(await submitSqlAction(h.send,flow,intent,[db],settings,[job]),{jobs:ack.sourceDatabaseToJobs})
    h.replies.set(path,{sourceDatabaseToJobs:[{database:db2,jobId:job}]})
    await assert.rejects(submitSqlAction(h.send,flow,intent,[db],settings,[job]),/Check Sessions/)
    assert.equal(h.calls.length,3)
  }
})
test('mounted SQL jobs target the exact permanent session and job; validation cancellation revokes only the workflow',async()=>{
  const h=mock(),stop=base+'/applicationItems/operations/stop'
  h.replies.set(stop,null);await mountedSqlAction(h.send,flow,job,'stop')
  assert.deepEqual(h.calls[0].options.body,{sessions:[{permanentSessionId:flow,jobIds:[job]}]})
  for(const action of ['edit','switchover']){
    h.replies.set(root('instantRecovery',flow)+'/'+action,null);await mountedSqlAction(h.send,flow,job,action,{schedule:'Auto'})
    assert.deepEqual(h.calls.at(-1).options.body,{settings:[{jobId:job,...(action==='edit'&&{scheduleSpec:{scheduleType:'Auto'}})}]})
  }
  await assert.rejects(mountedSqlAction(h.send,flow,job,'edit',{schedule:'ScheduledAt'}))
  h.replies.set(base+'/validations/applicationItems/'+flow+'/revoke',null);await cancelSqlAction(h.send,flow)
  assert.ok(requiredSqlChecks('export',{pointInTime:true}).includes('stagingServerFreeSpaceForExport'))
  assert.ok(!requiredSqlChecks('export',{}).includes('stagingServerFreeSpaceForExport'))
  assert.ok(!requiredSqlChecks('exportPublished',{}).includes('exportPointInTime'))
  assert.deepEqual(requiredSqlChecks('exportFiles',{}),['exportPointInTime','mountAccess','exportTargetWindowsServer','exportTargetPath'])
  assert.ok(requiredSqlChecks('exportFiles',{pointInTime:true}).includes('stagingServerFreeSpaceForExport'))
})
