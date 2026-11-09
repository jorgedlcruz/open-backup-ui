// Open Backup UI v1.0.2
const fs = require('node:fs'), ts = require('typescript')
const test = require('node:test'), assert = require('node:assert/strict')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText, file)
const {currentRestoreTask, diskPathActive, isTransferring, latestRestoreEvent, restoreDiskPaths, restoreProgress} = require('../lib/activity/entire-restore-progress.ts')

test('a completed, failed, or stopped restore keeps exactly the measurements VBR reports', () => {
  for (const [result, phase] of [['Success','completed'], ['Warning','warning'], ['Failed','failed'], ['None','unknown']]) {
    const measured = restoreProgress({state:'Stopped',result:{result},progress:{transferredSize:0,progressPercent:7}})
    assert.equal(measured.phase,phase)
    assert.equal(measured.percent,7)
    assert.equal(measured.transferred,0)
  }
  assert.equal(restoreProgress({state:'Stopped',result:{result:'Success'}}).percent,undefined)
  assert.equal(restoreProgress({state:'Working',result:{result:'Success'}}).phase,'accepted')
  assert.equal(restoreProgress({state:'Stopping',result:{isCanceled:true}}).phase,'canceled')
  assert.equal(restoreProgress({state:'Stopping',progressPercent:200,progress:{transferredSize:-1}}).transferred,undefined)
  assert.equal(restoreProgress({progressPercent:200}).percent,undefined)
})

test('per-VM transfer is independent of a session total or a task with a matching name', () => {
  const task = {id:'task1',sessionId:'A',name:'VM'}
  assert.equal(currentRestoreTask('task1','A',[task]),task)
  assert.equal(currentRestoreTask('task1','B',[task]),undefined)
  assert.equal(currentRestoreTask('VM','A',[task]),undefined)
  const record = {state:'Working', progress:{transferredSize:4e9}}
  const log = {status:'InProgress',title:'Restoring Hard disk 1 (60 GB)'}
  assert.equal(isTransferring(record,log),true)
  assert.equal(isTransferring(record,{...log,status:'Succeeded'}),false)
  assert.equal(isTransferring(record,{...log,title:'Registering restored VM on host: host1'}),false)
  assert.equal(isTransferring({...record,state:'Stopping'},log),false)
  assert.equal(isTransferring(record),false)
})

test('the latest session event uses the reported timestamp and log sequence', () => {
  const at = '2026-11-09T20:42:11Z', previous = {id:1,title:'Starting',startTime:at}
  const latest = {id:2,title:'Registering',startTime:at}
  assert.equal(latestRestoreEvent([latest,previous,{id:3,title:'  '}]),latest)
  assert.equal(latestRestoreEvent([]),undefined)
})

test('a measured native restore animates with None, null or omitted severity while its session and task are working', () => {
  const session={state:'Working',result:{result:'None'}}, task={state:'Working'}
  const title='Restoring Hard disk 1 (60 GB) : 12.4 GB restored at 141 MB/s  [hotadd]'
  for (const status of [null, undefined, 'None', 'InProgress']) {
    const event={title,status}
    assert.equal(diskPathActive(session,task,event,event),true)
    assert.equal(diskPathActive({...session,state:'Stopping'},task,event,event),false)
    assert.equal(diskPathActive({...session,state:'Stopped'},task,event,event),false)
    assert.equal(diskPathActive(session,{...task,endTime:'2026-11-09T20:00:00Z'},event,event),false)
    assert.equal(diskPathActive(session,task,event,{title:'Registering restored VM on host: target'}),false)
  }
  for(const status of ['Succeeded','Warning','Failed'])assert.equal(isTransferring(session,{title,status}),false)
  assert.equal(isTransferring(session,{status:'None',title:'Restoring Hard disk 1 (60 GB)'}),false)
  assert.equal(isTransferring(session,{status:'None',title:title.replace('141 MB/s','0 MB/s')}),false)
})

test('two disk assignments, reordered native rows and a replacement proxy remain on the right disk', () => {
  const proxy=(id,host,disk,status='Succeeded')=>({id,status,title:'Using proxy '+host+' for restoring disk '+disk})
  const read=(id,disk)=>({id,title:'Restoring '+disk+' (60 GB) : 12 GB restored at 141 MB/s  [hotadd]'})
  const a=read(11,'Hard disk 1'), b=read(15,'Hard disk 2')
  const logs=[b,proxy(14,'new.host','Hard disk 2'),a,proxy(10,'one.host','Hard disk 1'),proxy(12,'previous.host','Hard disk 2')]
  assert.deepEqual(restoreDiskPaths(logs),[{disk:'Hard disk 1',proxy:'one.host',event:a},{disk:'Hard disk 2',proxy:'new.host',event:b}])
  assert.equal(restoreDiskPaths([...logs,proxy(16,'retry.host','Hard disk 2')])[1].event,undefined)
  assert.equal(restoreDiskPaths([...logs,proxy(16,'failed.host','Hard disk 2','Failed')])[1].proxy,undefined)
  assert.equal(restoreDiskPaths([a])[0].proxy,undefined)
})
