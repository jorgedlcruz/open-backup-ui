const fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const {test}=require('node:test'),assert=require('node:assert/strict');
const {objectSchema,backupKey,rowsFrom,summary,restoreHref,matches,issueMatch,sorted,rpoStatus,defaults}=require('../lib/protected-data/model.ts');
const {loadProtectedData,loadProtectedRecoveryTimes}=require('../lib/protected-data/load.ts');
const {ProtectedDataCache,PROTECTED_DATA_TTL}=require('../lib/protected-data/cache.ts');
const {normalizeThreshold,stepThreshold,thresholdHours,workloadLabel}=require('../lib/protected-data/rpo.ts');
const {isProtectedDataPath}=require('../lib/protected-data/navigation.ts');
const {readCacheScope}=require('../lib/server/read-cache-scope.ts');
const {TopologyRequestError}=require('../lib/topology/load.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=new Date('2026-10-20T12:00:00Z');
const object=(extra={})=>({id:id(1),backupId:id(2),name:'VM A',platformName:'VMware',type:'VM',restorePointsCount:5,lastRunFailed:false,size:2048,...extra});
const backup=(extra={})=>({id:id(2),name:'Daily backup',repositoryId:id(9),repositoryName:'Main repository',jobId:id(8),...extra});
const file=(extra={})=>({id:id(6),backupId:id(2),backupSize:100,dataSize:200,objectIds:[id(1),id(10)],...extra});
const snap=(extra={})=>({data:[object()],objectsComplete:true,backups:{data:[backup()],available:true,complete:true},latest:{},...extra});
const row=(extra={})=>rowsFrom(snap(extra))[0];
const reader=(overrides={})=>async path=>{
 const url=new URL(path,'https://vbr.invalid'),p=url.pathname;
 if(overrides[p])return overrides[p](url);
 if(p==='/api/v1/serverInfo')return {buildVersion:'13.1.0.411'};
 if(p==='/api/v1/backupObjects')return {data:[object()],pagination:{total:1}};
 if(p==='/api/v1/backups')return {data:[backup()],pagination:{total:1}};
 if(p===`/api/v1/backups/${id(2)}/backupFiles`)return {data:[file()],pagination:{total:1}};
 if(p===`/api/v1/backupObjects/${id(1)}/restorePoints`)return {data:[{id:id(4),backupId:id(2),platformName:'VMware',creationTime:'2026-10-20T06:00:00Z'}],pagination:{total:5}};
 throw new Error(`Unexpected path ${p}`);
};
test('Protected Data remains active on recovery and workload inspection routes only',()=>{
 for(const path of ['/vbr/protected-data','/vbr/protected-data/restore-points','/vbr/workloads/'+id(1)])assert.equal(isProtectedDataPath(path),true);
 for(const path of ['/vbr/jobs','/vbr/protected-database','/vbr/workloads-other/'+id(1),'/vbr/topology','/vbm/protected-items'])assert.equal(isProtectedDataPath(path),false);
});
test('configured-source cache survives token renewal while credentials and legacy sessions remain isolated',()=>{
 const source={id:'configured',username:'account-a',password:'test-secret'},origin='https://vbr.invalid/';
 const key=readCacheScope(origin,'token-one',source);
 assert.equal(readCacheScope(origin,'token-two',source),key);
 assert.notEqual(readCacheScope(origin,'token-one',{...source,username:'account-b'}),key);
 assert.notEqual(readCacheScope(origin,'token-one',{...source,password:'changed'}),key);
 assert.notEqual(readCacheScope('https://another.invalid/','token-one',source),key);
 assert.notEqual(readCacheScope(origin,'token-one'),readCacheScope(origin,'token-two'));
 assert.notEqual(readCacheScope(origin,'token-one'),key);
 assert.equal(key.includes('test-secret'),false);
});
test('RPO steps promote and demote units without changing the intended duration',()=>{
 assert.deepEqual(stepThreshold({value:59,unit:'minutes'},1),{value:1,unit:'hours'});
 assert.deepEqual(stepThreshold({value:23,unit:'hours'},1),{value:1,unit:'days'});
 assert.deepEqual(stepThreshold({value:1,unit:'hours'},-1),{value:59,unit:'minutes'});
 assert.deepEqual(stepThreshold({value:1,unit:'days'},-1),{value:23,unit:'hours'});
 assert.deepEqual(stepThreshold({value:1,unit:'minutes'},-1),{value:1,unit:'minutes'});
 assert.deepEqual(normalizeThreshold(90,'minutes'),{value:1.5,unit:'hours'});
 assert.equal(thresholdHours(normalizeThreshold(1500,'minutes')),25);
 assert.deepEqual(normalizeThreshold(NaN,'hours'),{value:1,unit:'minutes'});
});
test('HexMap names stay readable while full names remain available to the caller',()=>{
 assert.deepEqual(workloadLabel('AD-DNS-001'),['AD-DNS-001']);
 const name='production-database-server-with-a-very-long-name',lines=workloadLabel(name);
 assert.equal(lines.length,3);assert.ok(lines.every(line=>Array.from(line).length<=14));assert.ok(lines[2].endsWith('…'));
 assert.equal(workloadLabel('🗄'.repeat(15)).join(''),'🗄'.repeat(15));
});
test('recovery enrichment reads only recovery times and retains inventory/file accounting',async()=>{
 const base=await loadProtectedData(reader(),'VBR',false,now),calls=[];
 const enriched=await loadProtectedRecoveryTimes(async path=>{calls.push(path);return reader()(path)},base,now);
 assert.ok(calls.length>0 && calls.every(path=>path.includes('/restorePoints?')));
 assert.equal(enriched.data,base.data);assert.equal(enriched.consumption,base.consumption);assert.equal(base.recoveryTimesRequested,false);
 assert.equal(enriched.recoveryTimesRequested,true);assert.equal(enriched.recoveryTimesFetchedAt,now.toISOString());
});
test('warm grid and HexMap reads reuse one snapshot and one recovery enrichment',async()=>{
 let clock=now.getTime(),loads=0,times=0;
 const cache=new ProtectedDataCache(()=>clock),load=async()=>{loads++;return {...snap(),fetchedAt:now.toISOString(),recoveryTimesRequested:false}},enrich=async base=>{times++;return {...base,recoveryTimesRequested:true,latest:{ready:{state:'empty',creationTime:null}}}};
 const first=await cache.read('source/account-a',load,enrich,{recovery:false});
 const map=await cache.read('source/account-a',load,enrich,{recovery:true});
 assert.equal(loads,1);assert.equal(times,1);assert.notEqual(first,map);
 for(let n=0;n<4;n++)assert.equal(await cache.read('source/account-a',load,enrich,{recovery:!!(n%2)}),map);
 assert.equal(loads,1);assert.equal(times,1);
 clock+=PROTECTED_DATA_TTL;
 await cache.read('source/account-a',load,enrich,{recovery:true});assert.equal(loads,2);assert.equal(times,2);
});
test('cache isolates authenticated scopes, deduplicates requests and force-refreshes both layers',async()=>{
 const cache=new ProtectedDataCache();let loads=0,times=0,release;
 const load=()=>{loads++;return new Promise(resolve=>{release=()=>resolve({...snap(),recoveryTimesRequested:false})})},enrich=async base=>{times++;return {...base,recoveryTimesRequested:true}};
 const first=cache.read('source/user-a',load,enrich,{recovery:true}),second=cache.read('source/user-a',load,enrich,{recovery:true});
 release();assert.equal(await first,await second);assert.equal(loads,1);assert.equal(times,1);
 const other=cache.read('source/user-b',load,enrich,{recovery:false});release();await other;assert.equal(loads,2);
 const force=cache.read('source/user-a',load,enrich,{recovery:true,force:true});release();await force;assert.equal(loads,3);assert.equal(times,2);
});
test('failed cache loads and recovery reads can retry without poisoning inventory',async()=>{
 const cache=new ProtectedDataCache(),load=async()=>({...snap(),recoveryTimesRequested:false}),enrich=async base=>({...base,recoveryTimesRequested:true});
 await assert.rejects(cache.read('a',async()=>{throw Error('denied')},enrich,{recovery:false}));
 const base=await cache.read('a',load,enrich,{recovery:false});
 await assert.rejects(cache.read('a',load,async()=>{throw Error('expired')},{recovery:true}));
 assert.equal(await cache.read('a',load,enrich,{recovery:false}),base);
 assert.equal((await cache.read('a',load,enrich,{recovery:true})).recoveryTimesRequested,true);
});
test('obsolete in-flight enrichment cannot overwrite a forced replacement snapshot',async()=>{
 const cache=new ProtectedDataCache();let finish;
 const load=async()=>({...snap(),recoveryTimesRequested:false});
 await cache.read('a',load,async x=>x,{recovery:false});
 const old=cache.read('a',load,base=>new Promise(resolve=>{finish=()=>resolve({...base,sourceName:'old',recoveryTimesRequested:true})}),{recovery:true});
 const fresh=await cache.read('a',async()=>({...await load(),sourceName:'fresh'}),async x=>x,{recovery:false,force:true});
 finish();await old;
 assert.equal(await cache.read('a',load,async x=>x,{recovery:false}),fresh);
});
test('preserves original fields and each copy while separating unique workload totals',()=>{
 const data=snap({data:[object({path:'vcenter/datacenter',objectId:'vm-123'}),object({backupId:id(3),restorePointsCount:9,lastRunFailed:true})]});
 const rows=rowsFrom(data),s=summary(rows);
 assert.equal(rows.length,2);assert.equal(rows[0].object.objectId,'vm-123');assert.equal(rows[0].copies,2);
 assert.equal(s.workloads,1);assert.equal(s.records,2);assert.equal(s.points.value,14);assert.equal(s.failed,1);assert.equal(s.withPoints,1);
});
test('counts do not become zero and lastRunFailed false does not imply protected',()=>{
 const r=row({data:[object({restorePointsCount:null,lastRunFailed:null,size:null})]});
 assert.equal(r.coverage,'Count not reported');assert.equal(r.run,'Not reported');assert.equal(r.size,null);
 const empty=row({data:[object({restorePointsCount:0,lastRunFailed:false,size:0})]});
 assert.equal(empty.coverage,'No restore points');assert.equal(empty.run,'Not failed');assert.equal(empty.size,0);
});
test('invalid sizes and counts remain unknown without discarding other fields',()=>{
 for(const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1]) {
  const parsed=objectSchema.parse(object({size:value,restorePointsCount:value}));
  const r=row({data:[parsed]});assert.equal(r.points,null);assert.equal(r.size,null);assert.equal(r.name,'VM A');
 }
});
test('display schemas strip undeclared sensitive fields',()=>{
 const parsed=objectSchema.parse(object({password:'secret',credentials:{token:'secret'}}));
 assert.equal(JSON.stringify(parsed).includes('secret'),false);
});
test('restore links retain both object and backup scope and escape names',()=>{
 const href=restoreHref(row({data:[object({name:'A & B/VM'})]})),url=new URL(href,'https://app.invalid');
 assert.equal(url.searchParams.get('objectId'),id(1));assert.equal(url.searchParams.get('backupId'),id(2));assert.equal(url.searchParams.get('name'),'A & B/VM');
 assert.equal(new URL(restoreHref(row({data:[object({backupId:'00000000-0000-0000-0000-000000000000'})]})),'https://app.invalid').searchParams.has('backupId'),false);
});
test('RPO uses real timestamps with explicit missing, invalid and future states',()=>{
 const key=backupKey(object());
 const r=date=>row({latest:{[key]:{state:'verified',creationTime:date}}});
 assert.equal(rpoStatus(r('2026-10-19T12:00:00Z'),24,now.getTime()),'Within threshold');
 assert.equal(rpoStatus(r('2026-10-19T11:59:00Z'),24,now.getTime()),'Outside threshold');
 assert.equal(rpoStatus(r('2026-10-21T12:00:00Z'),24,now.getTime()),'Unknown');
 assert.equal(rpoStatus(r('invalid'),24,now.getTime()),'Unknown');
 assert.equal(rpoStatus(row(),24,now.getTime()),'Unknown');
 assert.equal(rpoStatus(row({data:[object({restorePointsCount:0})]}),24,now.getTime()),'No restore points');
});
test('RPO and failed last-run flags remain independent for each copy',()=>{
 const objects=[object(),object({backupId:id(3),lastRunFailed:true})];
 const rows=rowsFrom(snap({data:objects,latest:{[backupKey(objects[0])]:{state:'verified',creationTime:'2026-10-20T06:00:00Z'},[backupKey(objects[1])]:{state:'verified',creationTime:'2026-10-10T06:00:00Z'}}}));
 assert.equal(rpoStatus(rows[0],24,now.getTime()),'Within threshold');assert.equal(rpoStatus(rows[1],24,now.getTime()),'Outside threshold');assert.equal(rows[1].run,'Failed');
});
test('filters combine OR within platform/type selections and AND across facets',()=>{
 const r=row();
 assert.equal(matches(r,{...defaults,platforms:['VMware','HyperV'],types:['VM'],repository:id(9),coverage:'Restore points available',query:'main repository'}),true);
 assert.equal(matches(r,{...defaults,platforms:['HyperV']}),false);
 assert.equal(matches(r,{...defaults,run:'Failed'}),false);
 assert.equal(matches(r,{...defaults,rpo:['Unknown']},24,now.getTime()),true);
 assert.equal(issueMatch(r,'noPoints'),false);
});
test('sorts numeric sizes and counts with unknowns last',()=>{
 const rows=rowsFrom(snap({data:[object({name:'Z',size:2}),object({id:id(10),name:'A',size:2048,restorePointsCount:1}),object({id:id(11),name:'B',size:null,restorePointsCount:null})]}));
 assert.deepEqual(sorted(rows,'size').map(r=>r.name),['A','Z','B']);
 assert.deepEqual(sorted(rows,'pointsAsc').map(r=>r.name),['A','Z','B']);
 assert.deepEqual(sorted(rows,'nameDesc').map(r=>r.name),['Z','B','A']);
});
test('partial numeric summaries disclose unknown counts and reject overflow',()=>{
 const s=summary(rowsFrom(snap({data:[object(),object({id:id(10),restorePointsCount:null,size:null})]})));
 assert.equal(s.points.value,5);assert.equal(s.points.unknown,1);assert.equal(s.size.unknown,1);
 assert.equal(summary(rowsFrom(snap({data:[object({size:Number.MAX_SAFE_INTEGER}),object({id:id(11),size:2})]}))).size.value,null);
});
test('loader paginates object copies with identical object IDs',async()=>{
 const calls=[],get=reader({'/api/v1/backupObjects':url=>({data:[object({backupId:id(Number(url.searchParams.get('skip'))+2)})],pagination:{total:2}})});
 const data=await loadProtectedData(async(path,revision)=>{calls.push({path,revision});return get(path)},'VBR',false,now);
 assert.equal(data.data.length,2);assert.equal(data.objectsComplete,true);assert.equal(summary(rowsFrom(data)).workloads,1);
 assert.ok(calls.filter(c=>c.path!=='/api/v1/serverInfo').every(c=>c.revision==='1.3-rev2'));
 assert.equal(calls.some(c=>c.path.includes('/restorePoints')),false);
});
test('physical accounting counts shared files once, separate from approximate object size',async()=>{
 const data=await loadProtectedData(reader(), 'VBR',false,now);
 assert.equal(data.consumption.physical,100);assert.equal(data.consumption.shared,1);assert.equal(data.consumption.files,1);
 assert.equal(summary(rowsFrom(data)).size.value,2048);
});
test('conflicting repeated file identities cannot inflate a complete storage total',async()=>{
 const data=await loadProtectedData(reader({[`/api/v1/backups/${id(2)}/backupFiles`]:()=>({data:[file(),file({backupSize:999})],pagination:{total:2}})}),'VBR',false,now);
 assert.equal(data.consumption.physical,null);assert.equal(data.consumption.conflicts,1);assert.equal(data.consumption.complete,false);
});
test('empty or foreign file inventories remain unmeasured',async()=>{
 for(const files of [[],[file({backupId:id(99)})]]) {
  const data=await loadProtectedData(reader({[`/api/v1/backups/${id(2)}/backupFiles`]:()=>({data:files,pagination:{total:files.length}})}),'VBR',false,now);
  assert.equal(data.consumption.physical,null);assert.equal(data.consumption.complete,false);assert.ok(data.warnings.some(w=>w.includes('subtotal')));
 }
});
test('latest time reads use documented ordering and exact backup filters',async()=>{
 const calls=[],get=reader();
 const data=await loadProtectedData(async path=>{calls.push(path);return get(path)},'VBR',true,now);
 const query=new URL(calls.find(p=>p.includes('/restorePoints')),'https://vbr.invalid').searchParams;
 assert.equal(query.get('orderColumn'),'CreationTime');assert.equal(query.get('orderAsc'),'false');assert.equal(query.get('limit'),'1');assert.equal(query.get('backupIdFilter'),id(2));
 assert.equal(data.latest[backupKey(object())].creationTime,'2026-10-20T06:00:00Z');
});
test('latest time rejects foreign backup, foreign platform, invalid or future dates',async()=>{
 for(const extra of [{backupId:id(99)},{platformName:'HyperV'},{creationTime:'not-a-date'},{creationTime:'2026-10-21T12:00:00Z'}]) {
  const data=await loadProtectedData(reader({[`/api/v1/backupObjects/${id(1)}/restorePoints`]:()=>({data:[{id:id(4),backupId:id(2),platformName:'VMware',creationTime:'2026-10-20T06:00:00Z',...extra}]})}),'VBR',true,now);
  assert.equal(data.latest[backupKey(object())].state,'unavailable');assert.equal(rpoStatus(rowsFrom(data)[0],24,now.getTime()),'Unknown');
 }
});
test('failed optional reads retain object records and disclose incomplete evidence',async()=>{
 const data=await loadProtectedData(reader({'/api/v1/backups':()=>{throw new TopologyRequestError('Denied',403)}}),'VBR',false,now);
 assert.equal(data.data.length,1);assert.equal(data.backups.available,false);assert.equal(data.consumption.complete,false);assert.ok(data.warnings.some(w=>w.includes('permission')));
 const times=await loadProtectedData(reader({'/api/v1/backups':()=>{throw new TopologyRequestError('Denied',403)}}),'VBR',true,now);
 assert.equal(times.latest[backupKey(object())].state,'verified');
 await assert.rejects(()=>loadProtectedData(reader({'/api/v1/backupObjects':()=>{throw new Error('down')}}),'VBR'));
});
test('authentication failures propagate from optional file and time reads',async()=>{
 for(const path of [`/api/v1/backups/${id(2)}/backupFiles`,`/api/v1/backupObjects/${id(1)}/restorePoints`]) {
  await assert.rejects(()=>loadProtectedData(reader({[path]:()=>{throw new TopologyRequestError('Expired',401)}}),'VBR',true,now),e=>e.status===401);
 }
});
test('lightweight legacy/global-search reads do not load accounting or recovery times',async()=>{
 const calls=[],get=reader();
 const data=await loadProtectedData(async path=>{calls.push(path);return get(path)},'VBR',false,now,false);
 assert.equal(data.data.length,1);assert.equal(calls.some(p=>p.startsWith('/api/v1/backups')),false);assert.equal(data.warnings.length,0);
});
test('lookup limits preserve all records and expose unknown recovery ages',async()=>{
 const objects=Array.from({length:101},(_,i)=>object({id:id(i+20)}));
 const get=reader({'/api/v1/backupObjects':()=>({data:objects,pagination:{total:101}})});
 let times=0;
 const data=await loadProtectedData(async path=>path.includes('/restorePoints') ? (++times,{data:[]}):get(path),'VBR',true,now);
 assert.equal(data.data.length,101);assert.equal(times,100);assert.equal(Object.keys(data.latest).length,100);assert.ok(data.warnings.some(w=>w.includes('100 backup-object')));
 assert.equal(rpoStatus(rowsFrom(data)[100],24,now.getTime()),'Unknown');
});
test('per-object backup references resolve to explicit parent membership and scope restore links',async()=>{
 const data=await loadProtectedData(reader({
  '/api/v1/backupObjects':()=>({data:[object({backupId:id(3)})],pagination:{total:1}}),
  '/api/v1/backups':()=>({data:[backup({platformName:'VMware'})],pagination:{total:1}}),
  [`/api/v1/backups/${id(2)}/objects`]:()=>({data:[object({backupId:id(3)})],pagination:{total:1}}),
 }),'VBR',true,now);
 const r=rowsFrom(data)[0];
 assert.equal(r.object.backupId,id(3));assert.equal(r.backup.id,id(2));assert.equal(data.latest[r.key].state,'verified');
 assert.equal(new URL(restoreHref(r),'https://app.invalid').searchParams.get('backupId'),id(2));
});
test('ambiguous or partial parent memberships never assign a copy to a guessed backup',async()=>{
 for(const partial of [false,true]) {
  const data=await loadProtectedData(reader({
   '/api/v1/backupObjects':()=>({data:[object({backupId:id(3)})],pagination:{total:1}}),
   '/api/v1/backups':()=>({data:[backup({platformName:'VMware'}),backup({id:id(4),platformName:'VMware'})],pagination:{total:2}}),
   [`/api/v1/backups/${id(2)}/objects`]:()=>({data:[object({backupId:id(3)})],pagination:{total:partial ? 5:1}}),
   [`/api/v1/backups/${id(4)}/objects`]:()=>({data:partial ? []:[object({backupId:id(3)})],pagination:{total:partial ? 0:1}}),
   [`/api/v1/backups/${id(4)}/backupFiles`]:()=>({data:[]}),
  }),'VBR',true,now);
  const r=rowsFrom(data)[0];assert.equal(r.backup,null);assert.equal(data.latest[r.key].state,'unavailable');
  assert.equal(new URL(restoreHref(r),'https://app.invalid').searchParams.has('backupId'),false);
 }
});
test('parent memberships require the complete object and backup identity, never the name alone',async()=>{
 const data=await loadProtectedData(reader({
  '/api/v1/backupObjects':()=>({data:[object({backupId:id(3)})],pagination:{total:1}}),
  '/api/v1/backups':()=>({data:[backup({platformName:'VMware'})],pagination:{total:1}}),
  [`/api/v1/backups/${id(2)}/objects`]:()=>({data:[object({id:id(55),backupId:id(3)})],pagination:{total:1}}),
 }),'VBR',true,now);
 assert.equal(rowsFrom(data)[0].backup,null);assert.deepEqual(data.backupLinks,{});
});
