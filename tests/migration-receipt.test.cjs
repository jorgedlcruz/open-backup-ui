const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText, file)

test('a page reload follows the exact accepted operation and never treats an interrupted submission as retryable', () => {
  const values = new Map()
  global.window = new EventTarget()
  global.sessionStorage = {getItem:key => values.get(key),setItem:(key,value) => values.set(key,value),removeItem:key => values.delete(key)}
  const modulePath = require.resolve('../lib/activity/migration-receipt.ts')
  const reload = () => { delete require.cache[modulePath]; return require(modulePath) }
  const source = 'a'.repeat(64)
  const mount = {id:'f6ea1d7a-a201-407f-9982-0f97e2c8e913',sessionId:'fc4be488-9141-45b3-9d58-fa60e5b04107',kind:'vSphere',state:'Mounted',name:'guest-restored'}
  const pending = {mount,destination:{datastore:'production'},status:'submitting'}
  const childId = '9b93cf01-0387-47d6-b1e8-e0f67d44b0ff'
  try {
    const live = reload()
    live.storeMigration(source, mount, pending)
    assert.equal(live.migrationReceipts(source,mount.sessionId)[0].status,'submitting')
    const reopened = reload()
    assert.equal(reopened.migrationReceipts(source,mount.sessionId)[0].status,'unknown')
    assert.equal(reopened.readPendingMigrationMounts(source,mount.sessionId)[0].state,'Not reported')
    reopened.storeMigration(source,mount,{...pending,status:'accepted',childId})
    const completedRequest = reload()
    assert.equal(completedRequest.migrationReceipts(source,mount.sessionId)[0].childId,childId)
    assert.deepEqual(completedRequest.readPendingMigrationMounts('b'.repeat(64),mount.sessionId),[])
    assert.deepEqual(completedRequest.readPendingMigrationMounts(source,childId),[])
    completedRequest.storeMigration(source,mount,undefined)
    assert.deepEqual(reload().readPendingMigrationMounts(source,mount.sessionId),[])
  } finally {delete global.window; delete global.sessionStorage; delete require.cache[modulePath]}
})
