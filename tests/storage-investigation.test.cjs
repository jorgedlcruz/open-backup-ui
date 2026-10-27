/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file)
const {retentionAnalysis,hygieneAnalysis,immutabilityPolicy}=require('../lib/forecast/investigation.ts')
const {loadLatestPoint}=require('../lib/forecast/load.ts'),{TopologyRequestError}=require('../lib/topology/load.ts')
const {collectorDue,presentCollector,COLLECTION_INTERVAL}=require('../lib/forecast/collector.ts')
const now=Date.parse('2026-10-24T12:00:00Z'),DAY=86400000,at=d=>new Date(now-d*DAY).toISOString(),collection=data=>({data,complete:true,available:true})
const policy=()=>({id:'job',type:'VSphereBackup',storage:{retentionPolicy:{type:'Days',quantity:7},advancedSettings:{backupModeType:'Incremental'}}})
const config=()=>({id:'repo',type:'LinuxLocal',repository:{enableGovernanceMode:false}})
const file=(id,age,isFull=false)=>({id,backupId:'backup',name:`${id}.${isFull?'vbk':'vib'}`,objectIds:['vm'],restorePointIds:[id+'-point'],backupSize:isFull?100:10,creationTime:at(age),gfsPeriods:['None']})
const backup=()=>({id:'backup',jobId:'job',repositoryId:'repo',complete:true,files:[file('old-full',20,true),file('old-inc',19),file('full',10,true),file('inc',2)],latestPoint:{state:'verified',at:at(2)}})
const snapshot=(b=backup(),p=policy(),c=config())=>({fetchedAt:new Date(now).toISOString(),backups:collection([b]),policies:collection([p]),configs:collection([c]),scaleOut:collection([])})

test('inactive old chains are review candidates while an in-window increment retains its baseline',()=>{
 const r=retentionAnalysis(snapshot(),'repo');assert.deepEqual(r.rows.map(f=>f.category),['review','review','dependency','within']);assert.equal(r.knownBytes,220);assert.equal(r.rows[0].outside,true)
})
test('hardened hold estimates extend from the latest file in each chain, not full creation',()=>{
 const c=config();c.type='LinuxHardened';c.repository={makeRecentBackupsImmutableDays:14}
 const r=retentionAnalysis(snapshot(backup(),policy(),c),'repo'),f=r.rows.find(f=>f.id==='full')
 assert.equal(f.category,'hold');assert.equal(f.holdUntil,now+12*DAY);assert.equal(r.policyGaps[0].gapDays,7);assert.match(f.reason,/planning estimate/)
})
test('GFS None is ordinary evidence while archival flags stay explicit with unknown expiry',()=>{
 const b=backup();b.files[0].gfsPeriods=['Weekly'];const r=retentionAnalysis(snapshot(b),'repo');assert.equal(r.rows[0].category,'gfs');assert.equal(r.rows[1].category,'review');assert.match(r.rows[0].reason,/expiry date is not reported/)
})
test('count retention requires explicit distinct point references for every member',()=>{
 const p=policy();p.storage.retentionPolicy={type:'RestorePoints',quantity:1};let r=retentionAnalysis(snapshot(backup(),p),'repo');assert.equal(r.rows.at(-1).category,'within');assert.equal(r.rows.at(-2).category,'dependency')
 const b=backup();delete b.files[0].restorePointIds;r=retentionAnalysis(snapshot(b,p),'repo');assert.ok(r.rows.every(r=>r.category==='unknown'))
})
test('missing or overlapping memberships, partial inventory and unsupported modes stay unresolved',()=>{
 for(const mutate of [b=>b.complete=false,b=>b.files[0].objectIds=[],b=>b.files[0].objectIds=['vm','other'],b=>b.files[0].creationTime='bad',b=>b.files[0].creationTime=at(-2)]){
  const b=backup();mutate(b);const r=retentionAnalysis(snapshot(b),'repo');assert.ok(r.rows.some(r=>r.category==='unknown'))
 }
 for(const mutate of [p=>p.type='BackupCopy',p=>p.storage.advancedSettings.backupModeType='ReverseIncremental',p=>p.storage.retentionPolicy.quantity=0]){const p=policy();mutate(p);assert.ok(retentionAnalysis(snapshot(backup(),p),'repo').rows.every(r=>r.category==='unknown'))}
})
test('shared files count once; conflicting sizes are excluded and do not become cleanup savings',()=>{
 const b=backup();b.files.forEach(f=>f.objectIds=['vm','vm2']);b.files.push({...b.files[0]});let r=retentionAnalysis(snapshot(b),'repo');assert.equal(r.knownBytes,220);assert.equal(r.rows.length,4)
 b.files.push({...b.files[0],backupSize:500});r=retentionAnalysis(snapshot(b),'repo');assert.equal(r.knownBytes,120);assert.equal(r.conflicts,1);assert.ok(r.rows.every(r=>r.category==='unknown'))
})
test('unknown sizes stay separate from zero-byte files',()=>{
 const b=backup();b.files.forEach(f=>f.backupSize=null);let r=retentionAnalysis(snapshot(b),'repo');assert.equal(r.knownBytes,null);assert.equal(r.unknownSizes,4);assert.equal(r.categories.find(c=>c.key==='review').known,0)
 b.files[0].backupSize=0;r=retentionAnalysis(snapshot(b),'repo');assert.equal(r.knownBytes,0);assert.equal(r.unknownSizes,3)
})
test('object lock generation rules never claim an actual per-file unlock date',()=>{
 const c={id:'repo',type:'AmazonS3',bucket:{immutability:{isEnabled:true,immutabilityMode:'RepositorySettings',daysCount:14}}};assert.equal(immutabilityPolicy(c).chainEstimate,false);assert.ok(retentionAnalysis(snapshot(backup(),policy(),c),'repo').rows.every(r=>r.holdUntil===null))
})
test('hygiene uses latest recovery points rather than the ages of old merged files',()=>{
 const b=backup();b.files.forEach(f=>f.creationTime=at(60));const r=hygieneAnalysis(snapshot(b),'repo')[0];assert.equal(r.flags.some(f=>f.key==='stale'),false);assert.equal(r.latestPoint,now-2*DAY);assert.equal(r.latestFile,now-60*DAY)
 b.latestPoint.at=at(30);assert.equal(hygieneAnalysis(snapshot(b),'repo')[0].flags[0].key,'stale');assert.equal(hygieneAnalysis(snapshot(b),'repo',60)[0].flags.some(f=>f.key==='stale'),false)
})
test('missing jobs are candidates only with complete available job evidence',()=>{
 const s=snapshot();s.policies=collection([]);assert.equal(hygieneAnalysis(s,'repo')[0].flags[0].key,'missing-job')
 s.policies.complete=false;assert.equal(hygieneAnalysis(s,'repo')[0].flags[0].key,'job-unknown');assert.equal(hygieneAnalysis(s,'repo')[0].attention,false)
 s.policies.complete=true;s.policies.available=false;assert.equal(hygieneAnalysis(s,'repo')[0].flags[0].key,'job-unknown')
})
test('unlinked and disabled backups preserve distinct investigation reasons',()=>{
 const b=backup();delete b.jobId;assert.equal(hygieneAnalysis(snapshot(b),'repo')[0].flags[0].key,'unlinked')
 const p=policy();p.isDisabled=true;assert.equal(hygieneAnalysis(snapshot(backup(),p),'repo')[0].flags[0].key,'disabled');assert.equal(hygieneAnalysis(snapshot(backup(),p),'repo')[0].attention,false)
})
test('missing baseline is flagged only on a complete file listing',()=>{
 const b=backup();b.files=b.files.filter(f=>f.name.endsWith('.vib'));assert.equal(hygieneAnalysis(snapshot(b),'repo')[0].flags[0].key,'chain');b.complete=false;assert.equal(hygieneAnalysis(snapshot(b),'repo')[0].flags.some(f=>f.key==='chain'),false)
})
test('no recovery evidence is unknown while a verified empty query is explicit',()=>{
 const b=backup();delete b.latestPoint;let r=hygieneAnalysis(snapshot(b),'repo')[0];assert.equal(r.latestPoint,null);assert.equal(r.flags[0].key,'evidence');assert.equal(r.attention,false)
 b.latestPoint={state:'empty',at:null};assert.equal(hygieneAnalysis(snapshot(b),'repo')[0].flags[0].key,'empty')
})
test('latest point query scopes by backup and requests newest first with one item',async()=>{
 let request;const result=await loadLatestPoint(async path=>{request=new URL(path,'https://test');return {data:[{backupId:'BACKUP',creationTime:at(1)}],pagination:{total:40}}},'backup')
 assert.equal(result.state,'verified');assert.equal(request.searchParams.get('backupIdFilter'),'backup');assert.equal(request.searchParams.get('orderAsc'),'false');assert.equal(request.searchParams.get('limit'),'1')
})
test('latest point query rejects wrong scope, ignored limit, inconsistent totals and future dates',async()=>{
 for(const response of [{data:[{backupId:'other',creationTime:at(1)}]},{data:[{backupId:'backup'},{backupId:'backup'}]},{data:[],pagination:{total:4}},{data:[{backupId:'backup',creationTime:'bad'}]},{data:[{backupId:'backup',creationTime:'2999-01-01'}]}])assert.equal((await loadLatestPoint(async()=>response,'backup')).state,'unavailable')
 assert.equal((await loadLatestPoint(async()=>({data:[],pagination:{total:0}}),'backup')).state,'empty')
})
test('latest point permission failure stays unknown; expired authentication propagates',async()=>{
 assert.equal((await loadLatestPoint(async()=>{throw new TopologyRequestError('Denied',403)},'backup')).state,'unavailable')
 await assert.rejects(()=>loadLatestPoint(async()=>{throw new TopologyRequestError('Expired',401)},'backup'),e=>e.status===401)
})
test('collector scheduling uses persisted attempts and exposes overdue, disabled and browser-only states',()=>{
 const state={...presentCollector(null,now,true,true),nextAttempt:at(-1)};assert.equal(collectorDue(null,now),true);assert.equal(collectorDue(state,now),false);state.nextAttempt=new Date(now+COLLECTION_INTERVAL).toISOString()
 assert.equal(presentCollector(state,now+COLLECTION_INTERVAL+120001,true,true).state,'stale');assert.equal(presentCollector(state,now,false,true).state,'disabled');assert.equal(presentCollector(state,now,true,false).state,'unsupported')
})
