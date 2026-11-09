const fs = require('node:fs'), ts = require('typescript')
const test = require('node:test'), assert = require('node:assert/strict')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText, file)
const {loadActivitySession} = require('../lib/activity/session.ts')
const {stopEntireVm} = require('../lib/activity/stop-session.ts')
const {canUnmountGuestFiles, mountPaths, sessionProgress} = require('../lib/activity/model.ts')
const {breadcrumbsForPath} = require('../lib/navigation/breadcrumbs.ts')
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0')
const sid = id(1), source = 'a'.repeat(64), path = '/api/v1/sessions/' + sid
const page = data => ({data, pagination:{total:data.length}})
const session = (type, props) => ({id:sid, sessionType:type, state:'Working', ...props})
function provider(rows) {
  return async (url, revision) => {
    const pathname = url.split('?')[0]
    const row = rows[pathname]
    if (row instanceof Error) throw row
    if (typeof row === 'function') return row(revision)
    return row ?? (pathname === '/api/v1/serverInfo' ? {buildVersion:'13.1.0.411'} : page([]))
  }
}
test('a successful file restore can still have a mounted filesystem; evidence and actions refer to the exact session', async () => {
  const read = provider({[path]: session('FileLevelRestore',{state:'Stopped',result:{result:'Success'}}),
    [path + '/logs']:{records:[{title:'Mounting restore point'},{title:'Mounted the drive'}],totalRecords:2},
    [mountPaths.flr]:page([{sessionId:sid,sourceProperties:{machineName:'A'}},{sessionId:id(2),sourceProperties:{machineName:'A'}}]),
    [path + '/taskSessions']:page([{id:id(4),sessionId:sid},{id:id(5),sessionId:id(2)}])})
  const data = await loadActivitySession(read,'vbr',source,sid)
  assert.deepEqual(data.mounts.map(m=>m.sessionId),[sid])
  assert.equal(data.mounts[0].state,'Mounted'); assert.equal(data.logs.data.length,2)
  assert.equal(canUnmountGuestFiles(data.mounts[0],data.session),false)
  assert.deepEqual(data.tasks.data.map(t=>t.id),[id(4)]); assert.equal(data.tasks.complete,false)
  const wrong = await loadActivitySession(read,'vbr',source,sid,{kind:'flr',id:id(2)})
  assert.deepEqual(wrong.mounts,[]); assert.equal(wrong.logs.data.length,2)
})
test('guest unmount is offered for a current mount before the session finishes, including mount-only sessions', () => {
  const mounted = {kind:'flr',state:'Mounted'}
  assert.equal(canUnmountGuestFiles(mounted,null),true)
  assert.equal(canUnmountGuestFiles(mounted,session('FileLevelRestore')),true)
  assert.equal(canUnmountGuestFiles(mounted,session('FileLevelRestore',{endTime:'2026-11-09T00:00:00Z'})),false)
  assert.equal(canUnmountGuestFiles(undefined,session('FileLevelRestore')),false)
  assert.equal(canUnmountGuestFiles({kind:'vSphere',state:'Mounted'},null),false)
})
test('mounted recoveries omit idle progress while ordinary sessions and migration use the reported percentage', () => {
  const record = session('FileLevelRestore',{progressPercent:0})
  assert.equal(sessionProgress(record,{kind:'flr',state:'Mounted'}),undefined)
  assert.equal(sessionProgress(record),0)
  assert.equal(sessionProgress(session('InstantRecovery',{progress:{progressPercent:53}}),{state:'Migrating',kind:'vSphere'}),53)
})
test('direct links keep mount-only records when VBR has no session log; a foreign mount hint cannot substitute for the session', async () => {
  const read = provider({[path]:new Error('history unavailable'),[mountPaths.publish]:page([{id:sid,mountState:'Mounted'}])})
  const data = await loadActivitySession(read,'vbr',source,sid,{kind:'publish',id:sid})
  assert.equal(data.session,null); assert.equal(data.logs.available,false); assert.equal(data.mounts[0].id,sid)
  await assert.rejects(loadActivitySession(read,'vbr',source,sid,{kind:'publish',id:id(2)}))
})
test('application restore child links exclude the parent and unrelated records', async () => {
  const data = await loadActivitySession(provider({[path]:session('ApplicationLevelRestore'),['/api/v1/restore/applicationItems/'+sid+'/childSessions']:page([
    {id:id(2),parentSessionId:sid},{id:id(3),parentSessionId:id(4)},{id:sid},
  ])}),'vbr',source,sid)
  assert.deepEqual(data.children.data.map(s=>s.id),[id(2)]); assert.equal(data.children.complete,false)
})
test('regular sessions use the supported API revision and stay in Sessions', async () => {
  let logRevision
  const data = await loadActivitySession(provider({'/api/v1/serverInfo':{buildVersion:'13.0.0.123'},[path]:session('BackupJob'),
    [path+'/logs']:revision=>{logRevision=revision;return {records:[],totalRecords:0}}}),'vbr',source,sid)
  assert.equal(logRevision,'1.3-rev1'); assert.equal(data.canStop,false); assert.equal(data.children,null)
  assert.deepEqual(breadcrumbsForPath('/vbr/activity/'+sid).slice(1),[{href:'/vbr/activity',label:'Sessions'},{label:'Session Investigation'}])
})
test('stop verifies the selected source, exact running session and type immediately before sending', async () => {
  const calls = []
  let record = session('RestoreVm')
  const send = async (url,opts) => { calls.push([url,opts]); return record }
  await assert.rejects(stopEntireVm(send,source,'b'.repeat(64),sid)); assert.equal(calls.length,0)
  for (const invalid of [session('BackupJob'),session('RestoreVm',{id:id(3)}),session('RestoreVm',{state:'Stopped'})]) {
    record = invalid; await assert.rejects(stopEntireVm(send,source,source,sid))
  }
  assert.equal(calls.filter(c=>c[1]?.mutation).length,0)
  record = session('RestoreVm'); await stopEntireVm(send,source,source,sid)
  assert.deepEqual(calls.at(-1),[path+'/stop',{method:'POST',mutation:true}])
})
