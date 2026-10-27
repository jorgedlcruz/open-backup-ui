/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file)
const {projectBackup,uniqueFiles,capacityTrend,repositoryBackups,policySchema,DAY}=require('../lib/forecast/model.ts')
const {mergeObservations}=require('../lib/forecast/history.ts')
const now=Date.parse('2026-10-24T12:00:00Z')
const config=()=>({id:'repo',type:'LinuxLocal',repository:{enableGovernanceMode:false,useFastCloningOnXFSVolumes:false}})
const policy=()=>({id:'job',type:'VSphereBackup',isDisabled:false,schedule:{runAutomatically:true,daily:{isEnabled:true,dailyKind:'Everyday'}},storage:{retentionPolicy:{type:'RestorePoints',quantity:3},gfsPolicy:{isEnabled:false},advancedSettings:{backupModeType:'Incremental',syntheticFulls:{isEnabled:true,weekly:{isEnabled:true,days:['Sunday']}},activeFulls:{isEnabled:false}}}})
const backup=()=>({id:'backup',repositoryId:'repo',complete:true,files:Array.from({length:5},(_,i)=>({id:'file'+i,backupId:'backup',objectIds:['vm'],name:`vm.${i?'vib':'vbk'}`,creationTime:new Date(now-(4-i)*DAY-3600000).toISOString(),backupSize:i?10:100,gfsPeriods:['None']}))})
const project=(b=backup(),p=policy(),c=config(),days=10,change=0,retention)=>projectBackup(b,p,c,now,days,change,retention)

test('weekly fulls create overlap and old chains expire only after all their points fall outside retention',()=>{
 const r=project();assert.equal(r.reason,undefined);assert.equal(r.values[0].bytes,140);assert.equal(r.values[1].fulls,1);assert.equal(r.values[1].bytes,240)
 assert.equal(r.values[3].bytes,120);assert.equal(r.values[3].peak,260);assert.equal(r.values[0].at,now)
})
test('forever forward merges retain a full baseline and the configured restore-point count',()=>{
 const p=policy();p.storage.advancedSettings.syntheticFulls.isEnabled=false
 const r=project(backup(),p);assert.equal(r.values[1].bytes,120);assert.equal(r.values[10].bytes,120);assert.equal(r.values[1].peak,150)
})
test('daily retention does not remove an old full while any increment in its chain is still needed',()=>{
 const p=policy();p.storage.retentionPolicy={type:'Days',quantity:7}
 const r=project(backup(),p);assert.ok(r.values[7].bytes>r.values[0].bytes);assert.ok(r.values[8].bytes<r.values[8].peak)
})
test('GFS None does not hold a chain but Weekly and unknown GFS settings do',()=>{
 const b=backup();b.files[0].gfsPeriods=['Weekly'];assert.equal(project(b).values[3].bytes,260)
 const p=policy();delete p.storage.gfsPolicy;const r=project(backup(),p);assert.equal(r.values[3].bytes,260);assert.ok(r.notes.some(n=>n.includes('GFS')))
})
test('immutability and unknown repository deletion rules prevent premature expiry credit',()=>{
 const c=config();c.type='LinuxHardened';c.repository.makeRecentBackupsImmutableDays=7
 assert.equal(project(backup(),policy(),c).values[3].bytes,260)
 const r=project(backup(),policy(),{id:'repo',type:'WinLocal'});assert.equal(r.values[3].bytes,260);assert.ok(r.notes.some(n=>n.includes('no expiry credit')))
})
test('shared files are counted once and conflicting identities never enter a modeled chain',()=>{
 const b=backup();b.files.forEach(f=>f.objectIds=['vm','vm2']);b.files.push({...b.files[0]})
 assert.equal(project(b).current,140)
 b.files.push({...b.files[0],backupSize:999});assert.match(project(b).reason,/unambiguous/);assert.equal(uniqueFiles(b.files).conflicts,1)
})
test('partial, unknown, stale and unsupported evidence produces an explicit reason, not a zero forecast',()=>{
 for(const mutate of [b=>b.complete=false,b=>b.files[0].backupSize=null,b=>b.files[0].creationTime='invalid',b=>b.files[0].creationTime=new Date(now+DAY).toISOString(),b=>b.files[0].objectIds=[],b=>b.files[0].name='data.unknown',b=>b.files=b.files.slice(1),b=>b.files=b.files.slice(0,2),b=>b.files.forEach(f=>f.creationTime=new Date(now-40*DAY).toISOString())]){
  const b=backup();mutate(b);const r=project(b);assert.ok(r.reason);assert.equal(r.values.length,0)
 }
 for(const mutate of [p=>p.type='BackupCopy',p=>p.isDisabled=true,p=>p.schedule.runAutomatically=false,p=>p.schedule.daily.isEnabled=false,p=>p.storage.advancedSettings.backupModeType='ReverseIncremental',p=>p.storage.advancedSettings.syntheticFulls.monthly={isEnabled:true}]){const p=policy();mutate(p);assert.ok(project(backup(),p).reason)}
})
test('what-if retention and incremental change alter scenarios without modifying source policies',()=>{
 const p=policy(),before=JSON.stringify(p),normal=project(backup(),p),changed=project(backup(),p,config(),10,100,14)
 assert.equal(JSON.stringify(p),before);assert.equal(changed.incremental,20);assert.ok(changed.values[3].bytes>normal.values[3].bytes)
})
test('real zero increment sizes remain valid evidence',()=>{
 const b=backup();b.files.slice(1).forEach(f=>f.backupSize=0);const r=project(b);assert.equal(r.incremental,0);assert.equal(r.reason,undefined)
})
test('unmapped and insufficient workload groups are excluded without fabricating their forecast',()=>{
 const b=backup();b.files.push({id:'unmapped',backupId:'backup',objectIds:[],name:'old.vbk',backupSize:500,creationTime:new Date(now-DAY).toISOString()})
 const r=project(b);assert.equal(r.current,640);assert.equal(r.values[0].bytes,140);assert.equal(r.excludedFiles,1);assert.equal(r.modeledFileIds.includes('unmapped'),false)
})
test('overlapping workload memberships never get two future schedules',()=>{
 const b=backup();b.files.push(...backup().files.map(f=>({...f,id:'copy'+f.id,objectIds:['vm','vm2']})))
 const r=project(b);assert.equal(r.values.length,0);assert.match(r.reason,/Overlapping/)
})
test('scale-out consumers are scoped by exact parent and extent IDs without assigning parent bytes to extents',()=>{
 const s={scaleOut:{data:[{id:'parent',performanceTier:{performanceExtents:[{id:'extent'}]}}]},backups:{data:[{id:'a',repositoryId:'parent'},{id:'b',repositoryId:'extent'},{id:'c',repositoryId:'other'}]}}
 assert.deepEqual(repositoryBackups(s,'parent').map(b=>b.id),['a','b']);assert.deepEqual(repositoryBackups(s,'extent').map(b=>b.id),['b'])
})
test('physical trend requires three daily samples over 48 hours, excludes stale observations and resets after resize',()=>{
 const observations=[3,2,1,0].map((d)=>({id:'repo',at:new Date(now-d*DAY).toISOString(),capacityGB:100,freeGB:40+d*10}))
 const r=capacityTrend(observations,'repo',now,30);assert.equal(r.slope,10);assert.equal(r.daysTo80,2)
 assert.equal(capacityTrend(observations.slice(2),'repo',now,30).slope,null)
 assert.equal(capacityTrend(observations,'repo',now+2*DAY,30).slope,null)
 observations.at(-1).capacityGB=200;assert.equal(capacityTrend(observations,'repo',now,30).slope,null)
})
test('hourly observations stay source-local, bounded, and retain unknown capacity as missing',()=>{
 const repos=[{id:'repo',name:'Repo',capacityGB:100,freeGB:50},{id:'unknown',name:'Unknown',capacityGB:-1,freeGB:-1}]
 const a=mergeObservations([],repos,now),b=mergeObservations(a,[{...repos[0],freeGB:40}],now+60000)
 assert.equal(a.length,1);assert.equal(b.length,1);assert.equal(b[0].freeGB,40)
 assert.equal(mergeObservations(b,[],now+91*DAY).length,0)
})
test('policy parser strips unrelated credentials and scripts before returning configuration',()=>{
 const p=policy();p.credentials={password:'secret'};p.storage.advancedSettings.scripts={command:'private'}
 const parsed=JSON.stringify(policySchema.parse(p));assert.equal(parsed.includes('secret'),false);assert.equal(parsed.includes('private'),false)
})
test('loader keeps explicit parent workload membership, rejects wrong file owners and surfaces partial collections',async()=>{
 const {loadForecast}=require('../lib/forecast/load.ts'),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
 const read=async path=>{
  const p=new URL(path,'https://example.test').pathname
  if(p==='/api/v1/serverInfo')return {buildVersion:'13.0.1.180'}
  const data=p==='/api/v1/backups'?[{id:id(1),repositoryId:id(2),jobId:id(3)}]:p.endsWith('/backupFiles')?[{id:id(4),backupId:id(9),name:'wrong.vbk',backupSize:100}]:p.endsWith('/objects')?[{id:id(5),name:'Production VM',backupId:id(6),restorePointsCount:7}]:p.endsWith('/repositories/states')?[{id:id(2),name:'Repo',capacityGB:100,freeGB:50}]:[]
  return {data,pagination:{total:data.length}}
 }
 const s=await loadForecast(read,'test');assert.equal(s.backups.data[0].files.length,0);assert.equal(s.backups.data[0].complete,false);assert.equal(s.backups.data[0].workloads[0].name,'Production VM')
})
test('expired authentication propagates from optional forecast collections',async()=>{
 const {loadForecast}=require('../lib/forecast/load.ts'),{TopologyRequestError}=require('../lib/topology/load.ts')
 await assert.rejects(()=>loadForecast(async path=>{if(path==='/api/v1/serverInfo')return {buildVersion:'13.0.1.180'};if(path.startsWith('/api/v1/jobs'))throw new TopologyRequestError('Expired',401);return {data:[],pagination:{total:0}}},'test'),e=>e.status===401)
})
