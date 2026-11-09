// Open Backup UI v1.0.2
const fs = require('node:fs')
const ts = require('typescript')
const test = require('node:test')
const assert = require('node:assert/strict')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText, file)
const {canStopPublishing, migrationForMount, recoveryMapMounts} = require('../components/activity/session-commands.ts')

const mount = {id:'mount-1', sessionId:'session-1', kind:'vSphere', state:'Mounted'}
const detail = {id:'session-1', session:{state:'Working'}, mounts:[mount], mountWarnings:[]}

test('Stop publishing appears only for a verified and actionable VM publication on this session', () => {
  assert.equal(canStopPublishing(mount,detail,''),true)
  assert.equal(canStopPublishing(mount,{...detail,session:null},''),true)
  for (const session of [{state:'Stopping'},{state:'Stopped'},{endTime:'2026-11-09T00:00:00Z'}]) {
    assert.equal(canStopPublishing(mount,{...detail,session},''),false)
  }
  for (const state of ['Migrating','Unmounting','Unmounted','Mounting']) {
    assert.equal(canStopPublishing(mount,{...detail,mounts:[{...mount,state}]},''),false)
  }
  assert.equal(canStopPublishing(mount,{...detail,mounts:[]},''),false)
  assert.equal(canStopPublishing(mount,{...detail,mounts:[{...mount,sessionId:'another'}]},''),false)
  assert.equal(canStopPublishing(mount,{...detail,mountWarnings:['vSphere']},''),false)
  assert.equal(canStopPublishing(mount,detail,'unavailable'),false)
  const hyperV = {...mount,kind:'hyperV',state:'UnmountFailed'}
  assert.equal(canStopPublishing(hyperV,{...detail,mounts:[hyperV]},''),true)
  for (const kind of ['fcd','flr','other','publish']) {
    const nonVm = {...mount,kind}
    assert.equal(canStopPublishing(nonVm,{...detail,mounts:[nonVm]},''),false)
  }
})

test('recovery map preserves a missing source mount for progress display, scopes hints and prefers current evidence', () => {
  const old = {...mount,state:'Mounting',instantVm:{repository:'Original repository',powerState:'PoweredOn'}}
  const second = {...mount,kind:'hyperV',id:'mount-2'}
  const snapshots = [old, second, {...mount,sessionId:'another',id:'mount-3'}, {...mount,kind:'flr'}]
  assert.deepEqual(recoveryMapMounts(detail,snapshots,''),[mount,{...second,state:'Not reported',instantVm:undefined}])
  assert.deepEqual(recoveryMapMounts({...detail,mounts:[]},snapshots,'mount=mount-1&kind=vSphere'),
    [{...old,state:'Not reported',instantVm:{repository:'Original repository',powerState:undefined}}])
  assert.deepEqual(recoveryMapMounts(detail,snapshots,'mount=mount-2&kind=vSphere'),[])
  assert.equal(canStopPublishing(old,{...detail,mounts:[]},''),false)
})

test('related migration evidence is never attributed to several VM mounts', () => {
  const second = {...mount,id:'mount-2'}, child = {id:'quick-migration'}
  assert.equal(migrationForMount(mount,[mount],child),child)
  assert.equal(migrationForMount(mount,[mount,second],child),undefined)
  const verified = {...child,resourceId:second.id}
  assert.equal(migrationForMount(mount,[mount,second],verified),undefined)
  assert.equal(migrationForMount(second,[mount,second],verified),verified)
  const scoped = [{mountId:second.id,session:child}]
  assert.equal(migrationForMount(mount,[mount],child,scoped),undefined)
  assert.equal(migrationForMount(second,[mount,second],null,scoped),child)
})
