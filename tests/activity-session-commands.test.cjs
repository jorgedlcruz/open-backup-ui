// Open Backup UI v1.0.2
const fs = require('node:fs')
const ts = require('typescript')
const test = require('node:test')
const assert = require('node:assert/strict')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText, file)
const {canStopPublishing, migrationDestination, migrationForMount, recoveryMapMounts} = require('../components/activity/session-commands.ts')

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

test('a fresh browser uses the target verified for the exact mount and migration, with scoped receipt fallback', () => {
  const child = 'migration-1', saved = {mountId:mount.id,session:{id:child},destination:{host:'esx-prod',datastore:'prod-ds'}}
  const local = {mount,childId:child,destination:{host:'draft-host',datastore:'draft-ds'}}
  assert.deepEqual(migrationDestination(mount.id,child,saved),saved.destination)
  assert.deepEqual(migrationDestination(mount.id,child,saved,local),saved.destination)
  assert.deepEqual(migrationDestination(mount.id,child,{...saved,destination:{host:'esx-prod'}},local),
    {host:'esx-prod',datastore:'draft-ds'})
  assert.deepEqual(migrationDestination(mount.id,undefined,undefined,{...local,childId:undefined}),local.destination)
  assert.equal(migrationDestination('different-mount',child,saved,local),undefined)
  assert.equal(migrationDestination(mount.id,'different-child',saved,local),undefined)
  assert.equal(migrationDestination(mount.id,child,undefined,{...local,childId:undefined,previousChildId:child}),undefined)
})

test('recovery map uses phase-specific production icons and renders known placement without empty field placeholders', () => {
  const React = require('react'), {renderToStaticMarkup} = require('react-dom/server')
  const Module = require('node:module')
  const file = require.resolve('../components/activity/instant-recovery-workspace.tsx')
  const component = new Module(file,module), localRequire = Module.createRequire(file)
  component.require = key => {
    if (key === '@/components/investigation/shared') return {useInvestigationPresentation:() => ({t:key=>key,date:String,bytes:String,formatNumber:String})}
    if (key.endsWith('.module.css')) return {default:new Proxy({}, {get:(_,key)=>key}),__esModule:true}
    return localRequire(key)
  }
  component._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
    jsx:ts.JsxEmit.ReactJSX, module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true,
  }}).outputText,file)
  const render = (phase,destination) => {
    const html=renderToStaticMarkup(React.createElement(component.exports.InstantRecoveryWorkspace,{
      mount, canConfigure:!phase,onConfigure:()=>{},destination,transfer:phase && {phase},
    }))
    return html.split('class="destination"')[1].split('class="transfer"')[0]
  }
  assert.match(render(undefined),/lucide-plus/)
  for (const [phase,icon] of Object.entries({checking:'clock',accepted:'clock',active:'arrow-down-to-line',completed:'check',warning:'triangle-alert',failed:'lucide-x',canceled:'ban',unknown:'circle-question-mark'})) {
    const output=render(phase,{host:'esx-prod',datastore:'prod-ds'})
    assert.ok(output.includes(icon),phase);assert.match(output,/esx-prod/);assert.match(output,/prod-ds/);assert.doesNotMatch(output,/lucide-plus|Not reported/)
  }
  assert.doesNotMatch(render('active',{datastore:'prod-ds'}),/Not reported/)
})
