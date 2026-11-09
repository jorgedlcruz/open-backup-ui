// Open Backup UI v1.0.2
const fs = require('node:fs')
const ts = require('typescript')
const assert = require('node:assert/strict')
const test = require('node:test')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText, file)
const {readMigrationPlan} = require('../lib/activity/migration-plan.ts')
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
