// Open Backup UI v1.0.2
const fs = require('node:fs'), ts = require('typescript')
const test = require('node:test'), assert = require('node:assert/strict')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText, file)
const {currentRestoreTask, isTransferring, latestRestoreEvent, restoreProgress} = require('../lib/activity/entire-restore-progress.ts')

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
