// Open Backup UI v1.0.2
const fs = require('node:fs')
const ts = require('typescript')
const assert = require('node:assert/strict')
const test = require('node:test')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText, file)
const {readMigrationPlan,readMigrationProxies,migrationHops,migrationSpeed} = require('../lib/activity/migration-plan.ts')
const {taskSchema, investigationSessionSchema} = require('../lib/investigation/model.ts')
const {migrationTransfer} = require('../lib/activity/instant-vm.ts')

test('migration map uses the current task plan, preserves disk placements and ignores unrelated messages', () => {
  const records = [
    {id:3, title:'Migration plan:\r\n[Mode] SmartSwitch\r\n[Host] host1 > host2\r\n[Datastore] [mount] > [fast]\r\n[Datastore] [mount] > [bulk]'},
    {id:4, title:'Processing VM Example\n[Host] wrong > different'},
    {id:1, title:'Migration plan:\n[Host] previous > other'},
  ]
  assert.deepEqual(readMigrationPlan(records), {sourceHost:'host1',targetHost:'host2',sources:['mount'],targets:['fast','bulk']})
  assert.equal(readMigrationPlan([records[1]]), undefined)
  assert.equal(readMigrationPlan([{title:'Migration plan:\n[Resource pool] cluster > compute'}]), undefined)
})

test('VBR placeholder end time keeps an active VM transfer running', () => {
  const source = {id:'f0371a0a-d2f2-442b-8aa4-00b352dd4689', state:'Working', endTime:'1900-01-01T00:00:00', progress:{progressPercent:50}}
  for (const schema of [taskSchema, investigationSessionSchema]) {
    const live = schema.parse(source)
    assert.equal(live.endTime, null)
    assert.equal(migrationTransfer(null, {...live, sessionType:'QuickMigration'}).phase, 'migrating')
    const ended = '2026-11-09T20:42:11Z'
    assert.equal(schema.parse({...source, state:'Stopped', endTime:ended}).endTime, ended)
  }
})

test('only explicit source/target assignment rows in the current VM plan become migration hops',()=>{
  const log=(id,title,status='Succeeded')=>({id,title,status})
  const plan=log(10,'Migration plan:\n[Host] A > B')
  const source=log(13,'Using source proxy veeamprx-003.example [nbd]')
  const target=log(14,'Using target proxy VEEAMPRX-003.example [nbd]')
  const rows=[plan,source,target,log(20,'Using target proxy unused [san]','Failed'), log(5,'Using target proxy previous [hotadd]')]
  assert.deepEqual(migrationHops(readMigrationProxies(rows)),[{role:'both',name:'veeamprx-003.example',read:'nbd',write:'nbd'}])
  const [read,write]=migrationHops(readMigrationProxies([...rows,log(21,'Using target proxy Alternate Proxy [hotadd]')]))
  assert.equal(read.name,'veeamprx-003.example');assert.equal(write.name,'Alternate Proxy');assert.equal(write.write,'hotadd')
  assert.deepEqual(readMigrationProxies([plan,log(5,'Using target proxy previous [hotadd]'),log(12,'Using proxy worker for restoring disk Hard disk 1')]),{})
  assert.deepEqual(readMigrationProxies([log(7,'Using source proxy No reported mode')]),{source:{name:'No reported mode'}})
})
test('migration speed uses the selected task, exact child and metric units; another VM or expired history cannot inject a rate',()=>{
  const child={id:'child',sessionType:'QuickMigration',state:'Working',progress:{processingRate:'82 MB/s'}}
  const task={id:'vmA',sessionId:'child',progress:{processingRate:'356.7 KB'}}
  assert.deepEqual(migrationSpeed(child,task,false),{basis:'processing',bytesPerSecond:356700})
  assert.equal(migrationSpeed(child,{...task,sessionId:'other'},true),undefined)
  const tasksOnly={samples:[{basis:'task',at:1,taskId:'vmB',bytesPerSecond:88888},
    {basis:'transferred',at:Date.now(),taskId:'vmA',bytesPerSecond:87654}],expiresAt:null}
  assert.deepEqual(migrationSpeed(child,{...task,progress:{}},false,tasksOnly),{basis:'transferred',bytesPerSecond:87654})
  assert.equal(migrationSpeed(child,{...task,progress:{}},false,{...tasksOnly,expiresAt:123}),undefined)
  assert.equal(migrationSpeed({...child,sessionType:'InstantRecovery'},task,false),undefined)
})
