// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file)
const {queueStorageOperation,readStorageOperations,updateStorageOperation,acceptedStorageOperation,observedStorageOperation,storageOperationSummary,
  importLegacyStorageRequests,importLegacyStorageTransfer,storageOperationProgress}=require('../lib/restore-points/storage-operations.ts')
const {writeStorageValue,readStorageValue}=require('../lib/restore-points/unstructured-workspace.ts')
const values=new Map()
global.sessionStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
const scope=name=>({sourceKey:'source-'+name,sessionId:'parent-'+name,view:'browse'})
const operation=(id,extra={})=>({requestId:id,action:'copy',createdAt:1000,updatedAt:1000,fingerprint:'files-'+id,items:[{path:'/backup/'+id,type:'File'}],
  destination:{id:'target',name:'Fileserver',path:'/restored'},phase:'submitting',...extra})
const task=id=>({taskId:'task-'+id,taskKey:'signed-'+id})

test('multiple copy and restore operations persist independently within the exact source, parent and view',()=>{
  const s=scope('isolation')
  queueStorageOperation(s,operation('copy'));queueStorageOperation(s,operation('restore',{action:'restore',destination:undefined}))
  acceptedStorageOperation(s,'copy',task('copy'));acceptedStorageOperation(s,'restore',task('restore'))
  observedStorageOperation(s,'copy',{state:'Working',result:'None',progressPercent:38,logs:{records:[{id:1,title:'Copying file',additionalInfo:[{field:'path',data:'/restored/copy'}]}]}})
  observedStorageOperation(s,'restore',{state:'Stopped',result:'Success',progressPercent:100})
  const rows=readStorageOperations(s)
  assert.equal(rows.length,2);assert.equal(rows[0].snapshot.progressPercent,38);assert.equal(rows[1].phase,'finished')
  assert.deepEqual(rows[0].snapshot.logs.records[0].additionalInfo,[{field:'path',data:'/restored/copy'}])
  const saved=JSON.parse(values.get('open-backup-ui.storage-operations.'+[s.sourceKey,s.sessionId,s.view].join('.')))
  assert.deepEqual(saved,JSON.parse(JSON.stringify(rows)))
  assert.deepEqual(readStorageOperations({...s,sourceKey:'another'}),[])
  assert.deepEqual(readStorageOperations({...s,sessionId:'another'}),[])
  assert.deepEqual(readStorageOperations({...s,view:'instant'}),[])
})

test('unknown outcomes block only the identical intent and never discard an unrelated new operation',()=>{
  const s=scope('uncertain')
  queueStorageOperation(s,operation('uncertain',{phase:'unknown'}))
  assert.throws(()=>queueStorageOperation(s,operation('duplicate',{fingerprint:'files-uncertain'})),/already being checked/)
  queueStorageOperation(s,operation('unrelated'))
  assert.deepEqual(readStorageOperations(s).map(row=>row.requestId),['uncertain','unrelated'])
  acceptedStorageOperation(s,'uncertain',task('recovered'))
  updateStorageOperation(s,'uncertain',{phase:'unknown',error:'late POST failed'})
  assert.equal(readStorageOperations(s)[0].phase,'tracking')
  observedStorageOperation(s,'uncertain',{state:'Stopped',result:'Success',progressPercent:100})
  acceptedStorageOperation(s,'uncertain',task('recovered'))
  observedStorageOperation(s,'uncertain',{state:'Working',result:'None',progressPercent:20})
  assert.equal(readStorageOperations(s)[0].phase,'finished');assert.equal(readStorageOperations(s)[0].snapshot.progressPercent,100)
})

test('native failed and warning outcomes remain distinct and multiple percentages are never averaged',()=>{
  const a=operation('a',{phase:'tracking',snapshot:{state:'Working',result:'None',progressPercent:20}})
  const b=operation('b',{phase:'tracking',snapshot:{state:'Working',result:'None',progressPercent:80}})
  assert.equal(storageOperationSummary([a]).progress,20)
  assert.equal(storageOperationSummary([a,b]).progress,undefined)
  assert.equal(storageOperationProgress({...a,snapshot:{state:'Working',progressPercent:101}}),undefined)
  assert.equal(storageOperationProgress({...a,snapshot:{state:'Working',progressPercent:NaN}}),undefined)
  const s=scope('outcomes');queueStorageOperation(s,operation('failed'));queueStorageOperation(s,operation('warning'))
  observedStorageOperation(s,'failed',{state:'Stopped',result:'Failed',progressPercent:33})
  observedStorageOperation(s,'warning',{state:'Stopped',result:'Warning',progressPercent:100})
  const rows=readStorageOperations(s)
  assert.equal(rows[0].snapshot.result,'Failed');assert.equal(rows[1].snapshot.result,'Warning')
  assert.equal(storageOperationSummary(rows).active,0);assert.equal(storageOperationSummary(rows).attention,1)
})

test('storage failure prevents a new mutation intent while later write failures preserve known progress in memory',()=>{
  const s=scope('storage-error'),original=sessionStorage.setItem
  sessionStorage.setItem=()=>{throw new Error('quota')}
  assert.throws(()=>queueStorageOperation(s,operation('never-started')),/could not be saved/)
  assert.deepEqual(readStorageOperations(s),[])
  sessionStorage.setItem=original;queueStorageOperation(s,operation('started'))
  sessionStorage.setItem=()=>{throw new Error('quota')}
  acceptedStorageOperation(s,'started',task('started'))
  assert.equal(readStorageOperations(s)[0].task.taskId,'task-started');assert.equal(readStorageOperations(s)[0].persistError,true)
  sessionStorage.setItem=original
})

test('legacy single transfers migrate without mutation replay and malformed stored records cannot break operation rendering',()=>{
  const s=scope('legacy')
  writeStorageValue(s,'transfer',{...task('legacy'),action:'copy'})
  importLegacyStorageTransfer(s);importLegacyStorageTransfer(s)
  assert.equal(readStorageOperations(s).length,1);assert.equal(readStorageOperations(s)[0].task.taskId,'task-legacy')
  assert.equal(readStorageValue(s,'transfer'),undefined)
  const prior={requestId:'old-request',fingerprint:JSON.stringify({action:'copy',sourcePaths:['/documents/file'],destinationId:'target',targetPath:'/restored'})}
  writeStorageValue(s,'request-copy',prior);importLegacyStorageRequests(s);importLegacyStorageRequests(s)
  assert.equal(readStorageOperations(s).length,2);assert.equal(readStorageOperations(s)[1].phase,'unknown')
  assert.equal(readStorageValue(s,'request-copy'),undefined)
  queueStorageOperation(s,operation('different-selection'))
  const bad=scope('malformed'),key='open-backup-ui.storage-operations.'+[bad.sourceKey,bad.sessionId,bad.view].join('.')
  values.set(key,JSON.stringify([operation('null-item',{items:[null]}),operation('bad-log',{snapshot:{state:'Working',logs:{records:[{id:1,additionalInfo:{bad:true}}]}}}),operation('valid')]))
  assert.deepEqual(readStorageOperations(bad).map(row=>row.requestId),['valid'])
})

test('history cap removes terminal records only and never evicts an unresolved write',()=>{
  const s=scope('retention')
  queueStorageOperation(s,operation('unknown',{phase:'unknown'}))
  for(let index=0;index<100;index++)queueStorageOperation(s,operation('done-'+index,{phase:'finished',snapshot:{state:'Stopped',result:'Success'}}))
  assert.equal(readStorageOperations(s).length,100);assert.equal(readStorageOperations(s)[0].requestId,'unknown')
  assert.equal(readStorageOperations(s).some(row=>row.requestId==='done-0'),false)
})
