// Open Backup UI v1.0.2
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), ts = require('typescript')
const test = require('node:test'), assert = require('node:assert/strict')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText,file)
const {saveMigrationLink,readMigrationLink,readMigrationLinks} = require('../lib/server/migration-links.ts')
const {sessionMigrations} = require('../lib/activity/instant-vm-evidence.ts')
const {TopologyRequestError} = require('../lib/topology/load.ts')
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0')
const source = 'a'.repeat(64), parent = {id:id(1),sessionType:'InstantRecovery'}
const child = {id:id(4),sessionType:'QuickMigration',state:'Working',progressPercent:0}
const link = {sourceKey:source,parentSessionId:parent.id,mountId:id(2),childSessionId:child.id}
const destination = {host:'Production Cluster',datastore:'Production Datastore'}

test('receipts persist across reads, isolate VBR sources and mounts, and validate disk contents', async () => {
  const cwd = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(),'open-backup-migration-'))
  try {
    process.chdir(dir)
    await Promise.all([saveMigrationLink(source,id(1),id(2),id(4)),saveMigrationLink(source,id(1),id(3),id(5),destination)])
    assert.deepEqual(await readMigrationLink(source,id(1),id(2)),link)
    assert.deepEqual((await readMigrationLink(source,id(1),id(3))).destination,destination)
    assert.equal(await readMigrationLink(source,id(1)),null)
    assert.equal(await readMigrationLink('b'.repeat(64),id(1),id(2)),null)
    assert.equal(await readMigrationLink(source,id(6),id(2)),null)
    assert.equal((await readMigrationLinks(source,id(1))).length,2)
    for (const args of [['../',id(1),id(2),id(4)],[source,'../',id(2),id(4)],[source,id(1),'../',id(4)],[source,id(1),id(2),id(1)]]) {
      await assert.rejects(saveMigrationLink(...args))
    }
    const target = path.join(dir,'data','migration-links',source,id(1),id(2)+'.json')
    fs.writeFileSync(target,JSON.stringify({...link,destination:{host:24,datastore:'bad\nname',token:'ignored'}}))
    assert.deepEqual(await readMigrationLink(source,id(1),id(2)),link)
    for (const contents of ['{',JSON.stringify({...link,parentSessionId:id(7)}),JSON.stringify({...link,mountId:id(9)}),JSON.stringify({...link,sourceKey:'b'.repeat(64)})]) {
      fs.writeFileSync(target,contents)
      assert.equal(await readMigrationLink(source,id(1),id(2)),null)
    }
  } finally { process.chdir(cwd); fs.rmSync(dir,{recursive:true,force:true}) }
})

test('a verified action receipt resolves a removed mount and reads only the authorized child and its unique task', async () => {
  const paths = []
  const read = async path => {
    paths.push(path)
    if (path.endsWith(child.id)) return child
    return {data:[{id:id(8),sessionId:child.id,progress:{transferredSize:1234}}],pagination:{skip:0,count:1,total:1}}
  }
  const found = await sessionMigrations(read,source,parent,undefined,async()=>[link])
  assert.equal(found.instantMigration.progressPercent,0)
  assert.equal(found.instantMigration.progress.transferredSize,1234)
  assert.deepEqual(found.instantMigrations,[{mountId:id(2),session:found.instantMigration}])
  assert.deepEqual(paths,['/api/v1/sessions/'+child.id,'/api/v1/sessions/'+child.id+'/taskSessions?skip=0&limit=2'])
  const hinted = await sessionMigrations(read,source,parent,{kind:'vSphere',id:id(9)},async()=>[link])
  assert.equal(hinted.instantMigration,null)
})

test('conflicting native links, a different VBR source, and inaccessible children never expose a receipt', async () => {
  for (const [subject,record,receipt] of [
    [parent,{...child,parentSessionId:id(7)},link], [parent,{...child,resourceId:id(7)},link],
    [parent,{...child,sessionType:'BackupJob'},link], [parent,{...child,id:id(7)},link],
    [parent,child,{...link,sourceKey:'b'.repeat(64)}], [parent,child,{...link,parentSessionId:id(7)}],
    [{...parent,relatedSessionId:id(7)},child,link], [{...parent,resourceReference:'/api/v1/restore/instantRecovery/vSphere/vm/'+id(7)},child,link],
  ]) {
    const found = await sessionMigrations(async()=>record,source,subject,undefined,async()=>[receipt])
    assert.deepEqual(found,{instantMigration:null,instantMigrations:[]})
  }
  const denied = await sessionMigrations(async()=>{throw new TopologyRequestError('forbidden',403)},source,parent,undefined,async()=>[{...link,destination}])
  assert.deepEqual(denied,{instantMigration:null,instantMigrations:[]})
  await assert.rejects(sessionMigrations(async()=>{throw new TopologyRequestError('expired',401)},source,parent,undefined,async()=>[link]))
  const unavailableParent = await sessionMigrations(()=>assert.fail(),source,null,undefined,()=>assert.fail())
  assert.deepEqual(unavailableParent,{instantMigration:null,instantMigrations:[]})
})

test('multiple receipts stay attributed to their individual mounts and an incomplete task collection has no byte estimate', async () => {
  const other = {...link,mountId:id(3),childSessionId:id(5),destination}
  for (const [total,taskParent] of [[2,child.id],[1,id(8)]]) {
    const found = await sessionMigrations(async path => {
      if (path.includes('taskSessions')) return {data:[{id:id(9),sessionId:taskParent,progress:{transferredSize:100}}],pagination:{skip:0,count:1,total}}
      return {...child,id:path.split('/').at(-1)}
    },source,parent,undefined,async()=>[link,other])
    assert.equal(found.instantMigration,null)
    assert.deepEqual(found.instantMigrations.map(row=>row.destination),[undefined,destination])
    assert.deepEqual(found.instantMigrations.map(row=>[row.mountId,row.session.id,row.session.progress]),[[id(2),id(4),undefined],[id(3),id(5),undefined]])
  }
})
