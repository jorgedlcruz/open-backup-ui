/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { eventSchema, settingsSchema, analyzeTasks, activityRows, affectedWorkloads, defaults, matches, issueMatch, summary, needsReview, sortActivity, restoreHref } = require('../lib/ransomware/model.ts')
const { loadRansomware } = require('../lib/ransomware/load.ts')
const { TopologyRequestError } = require('../lib/topology/load.ts')
const id = n => `00000001-0000-4000-8000-${String(n).padStart(12, '0')}`
const now = new Date('2026-10-22T12:00:00Z')
const session = { id: id(1), name: 'Backup session', jobId: id(8), creationTime: '2026-10-22T10:00:00Z' }
const event = (patch={}) => ({ id: id(2), type:'EncryptedData', state:'Created', severity:'Infected', detectionTimeUtc:'2026-10-22T11:00:00Z', creationTimeUtc:'2026-10-22T10:00:00Z', machine:{displayName:'Same name',backupObjectId:id(3),uuid:'bios-id'}, source:'InternalVeeamDetector', engine:'Veeam Threat Hunter', details:'File change detected', ...patch })
const task = (patch={}) => ({id:id(4),sessionId:session.id,name:'Same name',creationTime:'2026-10-22T10:00:00Z',progress:{readSize:2*1024**3,transferredSize:2*1024**3},...patch})
const snapshot = (events=[], anomalies=[]) => ({events:{data:events,available:true,complete:true},anomalies})

test('native event fields are retained and unrelated sensitive fields are stripped', () => {
  const parsed=eventSchema.parse({...event(),secret:'do-not-expose',machine:{...event().machine,credentials:'secret'}})
  assert.equal(parsed.engine,'Veeam Threat Hunter')
  assert.equal(parsed.machine.backupObjectId,id(3))
  assert.equal(parsed.secret,undefined)
  assert.equal(parsed.machine.credentials,undefined)
  const settings=settingsSchema.parse({encryptionDetectionSettings:{inlineMalwareScanEnabled:false,sensitivity:'Normal'},notificationSettings:{password:'secret'},signatureDetectionSettings:{autoSignatureBasedScanEnabled:true}})
  assert.equal(settings.encryptionDetectionSettings.inlineMalwareScanEnabled,false)
  assert.equal(settings.notificationSettings,undefined)
})

test('heuristic thresholds preserve strict 1 GiB, 85%, and 95% boundaries', () => {
  const read=2*1024**3
  assert.equal(analyzeTasks(session,[task({progress:{readSize:1024**3,transferredSize:1024**3}})]).length,0)
  assert.equal(analyzeTasks(session,[task({progress:{readSize:2000000000,transferredSize:1700000000}})]).length,0)
  assert.equal(analyzeTasks(session,[task({progress:{readSize:2000000000,transferredSize:1900000000}})])[0].severity,'warning')
  const flagged=analyzeTasks(session,[task({progress:{readSize:read,transferredSize:read}})])[0]
  assert.equal(flagged.severity,'critical'); assert.equal(flagged.score,100); assert.equal(flagged.dedupeRatio,1)
  assert.equal(flagged.readSize,read); assert.equal(flagged.sessionName,session.name)
  assert.ok(!/entropy|confirmed|highly indicative/i.test(flagged.reason))
})

test('missing, negative, zero, and unsafe measurements never fabricate indicators', () => {
  for(const progress of [null,{}, {readSize:2e9}, {readSize:2e9,transferredSize:-1},{readSize:0,transferredSize:2e9},{readSize:Number.MAX_SAFE_INTEGER+1,transferredSize:2e9}])
    assert.equal(analyzeTasks(session,[task({progress})]).length,0)
})

test('false positives, Clean and Informative events remain visible without needing review', () => {
  const rows=activityRows(snapshot([event(),event({id:id(5),state:'FalsePositive'}),event({id:id(6),severity:'Clean'}),event({id:id(7),severity:'Informative'})]))
  assert.equal(rows.length,4)
  assert.equal(rows.filter(needsReview).length,1)
  assert.equal(rows.filter(row=>issueMatch(row,'falsePositive')).length,1)
  assert.equal(summary(rows).affected,1)
})

test('later Clean evidence does not silently supersede a separate Created event', () => {
  const rows=activityRows(snapshot([event(),event({id:id(5),severity:'Clean',detectionTimeUtc:'2026-10-22T11:30:00Z'})]))
  assert.equal(summary(rows).review,1)
  assert.equal(affectedWorkloads(rows)[0].rows.length,2)
})

test('workload grouping uses IDs, never duplicate display names or BIOS UUIDs', () => {
  const rows=activityRows(snapshot([event(),event({id:id(5),machine:{displayName:'Same name',backupObjectId:id(9),uuid:'bios-id'}}),event({id:id(6),machine:{displayName:'Same name',uuid:'bios-id'}})],analyzeTasks(session,[task()])))
  assert.equal(affectedWorkloads(rows).length,4)
  assert.equal(summary(rows).affected,2)
  assert.equal(summary(rows).unresolved,1)
  assert.equal(summary(rows).indicators,1)
  assert.equal(rows.find(row=>row.kind==='heuristic').objectId,undefined)
})

test('same object ID groups multiple event names; unknown identities remain separate', () => {
  const rows=activityRows(snapshot([event(),event({id:id(5),machine:{displayName:'Renamed',backupObjectId:id(3)}}),event({id:id(6),machine:null}),event({id:id(7),machine:null})]))
  assert.equal(affectedWorkloads(rows).length,3)
  assert.equal(affectedWorkloads(rows).find(group=>group.objectId===id(3)).rows.length,2)
})

test('workload groups follow severity, newest, and name sorting without losing evidence', () => {
  const rows=activityRows(snapshot([
    event({machine:{displayName:'Zebra',backupObjectId:id(3)},detectionTimeUtc:'2026-10-20T00:00:00Z'}),
    event({id:id(5),severity:'Suspicious',machine:{displayName:'Middle',backupObjectId:id(5)},detectionTimeUtc:'2026-10-22T00:00:00Z'}),
    event({id:id(6),severity:'Clean',machine:{displayName:'Alpha',backupObjectId:id(6)},detectionTimeUtc:'2026-10-21T00:00:00Z'}),
    event({id:id(7),severity:'Clean',machine:{displayName:'Zebra',backupObjectId:id(3)},detectionTimeUtc:'2026-10-19T00:00:00Z'}),
  ]))
  assert.deepEqual(affectedWorkloads(rows,'risk').map(group=>group.name),['Zebra','Middle','Alpha'])
  assert.deepEqual(affectedWorkloads(rows,'newest').map(group=>group.name),['Middle','Alpha','Zebra'])
  assert.deepEqual(affectedWorkloads(rows,'name').map(group=>group.name),['Alpha','Middle','Zebra'])
  assert.equal(affectedWorkloads(rows,'newest')[2].rows.length,2)
})

test('filters compose across query, severity, state, source, type, engine and time', () => {
  const row=activityRows(snapshot([event()]))[0]
  assert.ok(matches(row,{...defaults,query:'same name',severity:'Infected',state:'Created',source:'InternalVeeamDetector',type:'EncryptedData',engine:'Veeam Threat Hunter',range:'1'},now.getTime()))
  assert.ok(!matches(row,{...defaults,state:'FalsePositive'},now.getTime()))
  assert.ok(matches(row,{...defaults,query:id(3)},now.getTime()))
  assert.ok(!matches({...row,detected:'2030-01-01'},{...defaults,range:'1'},now.getTime()))
  assert.ok(!matches({...row,detected:'bad-date'},{...defaults,range:'1'},now.getTime()))
  assert.ok(matches({...row,detected:null},{...defaults,range:'unknown'},now.getTime()))
})

test('native severities and heuristic severity stay distinct and all raw values remain inspectable', () => {
  const rows=activityRows(snapshot([event(),event({id:id(5),severity:'Suspicious'})],analyzeTasks(session,[task()])))
  assert.equal(rows.filter(row=>issueMatch(row,'infected')).length,1)
  assert.equal(rows.filter(row=>issueMatch(row,'suspicious')).length,1)
  assert.equal(rows.filter(row=>issueMatch(row,'heuristic')).length,1)
  assert.equal(sortActivity(rows,'risk')[0].severity,'Infected')
  assert.equal(rows.find(row=>row.kind==='heuristic').indicator.severity,'critical')
})

test('recovery links require verified object IDs and encode names', () => {
  const row=activityRows(snapshot([event({machine:{displayName:'A & B / VM',backupObjectId:id(3)}})]))[0]
  const url=new URL(restoreHref(row),'https://example.test')
  assert.equal(url.searchParams.get('objectId'),id(3)); assert.equal(url.searchParams.get('name'),'A & B / VM')
  assert.equal(restoreHref({...row,objectId:'00000000-0000-0000-0000-000000000000'}),null)
  assert.equal(restoreHref({...row,objectId:null}),null)
})

function reader(overrides={}) {
  return async (path,revision) => {
    if(path==='/api/v1/serverInfo')return {buildVersion:'13.1.0.411'}
    if(path.startsWith('/api/v1/malwareDetection/events?'))return overrides.events ? overrides.events(path,revision):{data:[event()]}
    if(path==='/api/v1/malwareDetection/settings/general')return overrides.settings ? overrides.settings():{}
    if(path.startsWith('/api/v1/sessions?'))return overrides.sessions ? overrides.sessions(path):{data:[session]}
    if(path.includes('/taskSessions?'))return overrides.tasks ? overrides.tasks(path):{data:[task()]}
    throw new Error(`Unexpected read: ${path}`)
  }
}

test('loader uses documented endpoints, revision and task-session membership',async()=>{
  const calls=[]
  const raw=reader()
  const result=await loadRansomware(async(path,revision)=>{calls.push({path,revision});return raw(path,revision)},'source',now)
  assert.equal(result.apiRevision,'1.3-rev2'); assert.equal(result.events.data.length,1); assert.equal(result.anomalies.length,1)
  assert.equal(result.metadata.scannedTasks,1); assert.equal(result.metadata.globalDataReduction,1)
  assert.ok(calls.some(call=>call.path.includes('/malwareDetection/events?orderColumn=DetectionTimeUtc&orderAsc=false')))
  assert.ok(calls.some(call=>call.path.includes('/taskSessions?')))
  assert.ok(calls.filter(call=>call.path!='/api/v1/serverInfo').every(call=>call.revision==='1.3-rev2'))
  assert.equal(result.fetchedAt,now.toISOString())
})

test('native event pagination keeps all fields and counts across short pages with totals',async()=>{
  const skips=[]
  const result=await loadRansomware(reader({events:path=>{const skip=Number(new URL(path,'https://x.test').searchParams.get('skip'));skips.push(skip);return {data:[event({id:id(skip+100)})],pagination:{total:3}}}}),'source',now)
  assert.deepEqual(skips,[0,1,2]); assert.equal(result.events.data.length,3); assert.equal(result.events.complete,true)
})

test('repeated event pages remain explicit partial evidence',async()=>{
  const result=await loadRansomware(reader({events:()=>({data:[event()],pagination:{total:5}})}),'source',now)
  assert.equal(result.events.data.length,1); assert.equal(result.events.complete,false)
  assert.ok(result.warnings.some(w=>w.includes('Malware events: partial')))
})

test('unavailable task evidence stays unavailable, not a secure empty result',async()=>{
  const result=await loadRansomware(reader({tasks:()=>{throw new TopologyRequestError('Denied',403)}}),'source',now)
  assert.equal(result.events.available,true); assert.equal(result.anomalies.length,0)
  assert.equal(result.metadata.globalDataReduction,null); assert.equal(result.metadata.readSize,null)
  assert.equal(result.tasks[0].available,false)
  assert.ok(result.warnings.some(w=>w.includes('Read access was denied')))
})

test('unavailable malware events preserve heuristic evidence and mark event availability',async()=>{
  const result=await loadRansomware(reader({events:()=>{throw new TopologyRequestError('Denied',403)}}),'source',now)
  assert.equal(result.events.available,false); assert.equal(result.anomalies.length,1)
})

test('foreign-session tasks and incomplete measurements do not contaminate ratios',async()=>{
  const result=await loadRansomware(reader({tasks:()=>({data:[task(),task({id:id(5),sessionId:id(99)}),task({id:id(6),progress:{readSize:2e9}})]})}),'source',now)
  assert.equal(result.metadata.scannedTasks,2); assert.equal(result.metadata.measuredTasks,1)
  assert.equal(result.anomalies.length,1); assert.equal(result.tasks[0].complete,false)
  assert.equal(result.metadata.globalDataReduction,1)
})

test('expired authentication propagates from optional settings, events, and tasks',async()=>{
  for(const key of ['settings','events','tasks']) await assert.rejects(loadRansomware(reader({[key]:()=>{throw new TopologyRequestError('Expired',401)}}),'source',now),error=>error.status===401)
})

test('session task reads are bounded to four concurrent requests and the most recent 30 sessions',async()=>{
  let active=0,peak=0,count=0
  const result=await loadRansomware(reader({sessions:path=>{
    assert.equal(new URL(path,'https://x.test').searchParams.get('limit'),'30')
    return {data:Array.from({length:30},(_,index)=>({...session,id:id(index+1000)})),pagination:{total:100}}
  },tasks:async()=>{active++;peak=Math.max(active,peak);count++;await new Promise(resolve=>setTimeout(resolve,2));active--;return {data:[]}}}),'source',now)
  assert.equal(count,30);assert.equal(peak,4);assert.equal(result.sessions.complete,false)
  assert.ok(result.warnings.some(w=>w.includes('30 most recent')))
})

test('missing and zero transfer totals remain unknown instead of a fabricated 1x',async()=>{
  for(const progress of [{},{readSize:0,transferredSize:0},{readSize:2e9,transferredSize:0}]) {
    const result=await loadRansomware(reader({tasks:()=>({data:[task({progress})]})}),'source',now)
    assert.equal(result.metadata.globalDataReduction,null)
  }
})

test('failure of both evidence sources is an actionable error even when settings load',async()=>{
  await assert.rejects(loadRansomware(reader({events:()=>{throw new Error('offline')},sessions:()=>{throw new Error('offline')}}),'source',now),error=>error.status===502)
})
