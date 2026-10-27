const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const {test}=require('node:test'),assert=require('node:assert/strict')
const m=require('../lib/vbm-repositories/model.ts'),{loadRepositories}=require('../lib/vbm-repositories/load.ts'),base=require('../lib/vbm-dashboard/model.ts'),{VbmRequestError}=require('../lib/vbm-dashboard/load.ts')
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`,now=new Date('2026-10-22T12:00:00Z')
const repo=(patch={})=>m.repositorySchema.parse({id:id(1),name:'Repository',path:'C:\\Backups',description:'Production backups',capacityBytes:1000,freeSpaceBytes:600,isOutdated:false,isOutOfOrder:false,isOutOfSync:false,retentionType:'SnapshotBased',retentionPeriodType:'Yearly',yearlyRetentionPeriod:'Years3',retentionFrequencyType:'Daily',...patch})
const objectRepo=(patch={})=>repo({objectStorageEncryptionEnabled:true,objectStorage:{id:id(9),type:'AmazonS3Compatible',sizeLimitEnabled:true,sizeLimitGB:1024,usedSpaceBytes:10,freeSpaceBytes:990,enableImmutability:true,enableImmutabilityGovernanceMode:false,immutabilityPeriodDays:0,...patch}})
const org=(patch={})=>base.organizationSchema.parse({id:id(2),name:'Tenant',...patch})
const job=(patch={})=>base.jobSchema.parse({id:id(3),repositoryId:id(1),organizationId:id(2),name:'Exchange',lastStatus:'Success',isEnabled:true,schedulePolicy:{scheduleEnabled:true},...patch})
const usage=(patch={})=>base.usageSchema.parse({repositoryId:id(1),usedSpaceBytes:900,localCacheUsedSpaceBytes:100,objectStorageUsedSpaceBytes:800,isAvailable:true,protectedObjectsCount:3,...patch})
const ev=(data,patch={})=>({data,available:true,complete:true,...patch}),page=data=>({results:data,limit:500})
const snapshot=(patch={})=>({sourceName:'source',fetchedAt:now.toISOString(),warnings:[],repositories:ev([repo()]),jobs:ev([job()]),organizations:ev([org()]),proxies:ev([]),usage:[{organizationId:id(2),evidence:ev([usage()])}],backedOrganizations:null,...patch})
const read=async path=>{const url=new URL(path,'https://source.test');return url.pathname==='/v8/BackupRepositories' ? page([repo()]):url.pathname===`/v8/BackupRepositories/${id(1)}` ? repo():url.pathname==='/v8/Jobs' ? page([job()]):url.pathname==='/v8/Organizations' ? page([org()]):url.pathname.endsWith('/usedRepositories') ? page([usage()]):url.pathname.endsWith('/backedupOrganizations') ? page([{id:'Tenant:Opaque:ID',name:'Tenant',usedSpaceBytes:'900'}]):page([])}

test('repository schema preserves previous fields, encryption and policy metadata without secrets',()=>{
  const value=m.repositorySchema.parse({...objectRepo(),proxyId:id(4),proxyPoolId:id(5),isIndexed:true,isLongTerm:false,encryptionKeyId:'secret',credentials:{password:'secret'},_links:{}})
  for(const field of ['path','description','retentionFrequencyType','objectStorageEncryptionEnabled','proxyId','proxyPoolId','isIndexed','isLongTerm'])assert.notEqual(value[field],undefined)
  assert.equal(value.encryptionKeyId,undefined);assert.equal(value.credentials,undefined);assert.equal(value._links,undefined)
})
test('numeric strings normalize, invalid bytes and opaque IDs stay safe',()=>{
  const value=m.backedOrganizationSchema.parse({id:'Tenant:CaseSensitive',usedSpaceBytes:'900'});assert.equal(value.usedSpaceBytes,900);assert.equal(value.id,'Tenant:CaseSensitive')
  for(const value of ['-1','oops',1.5,Number.MAX_SAFE_INTEGER+1])assert.equal(m.backedOrganizationSchema.parse({id:'tenant',usedSpaceBytes:value}).usedSpaceBytes,null)
})
test('retention handles singular, plural, numeric and forever periods',()=>{
  for(const [patch,expected] of [[{yearlyRetentionPeriod:'Year1'},'1 year'],[{yearlyRetentionPeriod:'Years3'},'3 years'],[{yearlyRetentionPeriod:'KeepForever'},'Keep forever'],[{retentionPeriodType:'Monthly',monthlyRetentionPeriod:'Months6'},'6 months'],[{retentionPeriodType:'Daily',dailyRetentionPeriod:'14'},'14 days']])assert.equal(m.retention(repo(patch)),expected)
  assert.match(m.retention(repo({yearlyRetentionPeriod:null})),/not reported/)
})
test('zero-day immutability follows retention rather than claiming a zero-day lock',()=>{const lock=m.immutability(objectRepo());assert.equal(lock.state,'enabled');assert.equal(lock.period,'Retention-based · 3 years');assert.equal(lock.mode,'Compliance')})
test('immutability disabled, unknown, local, explicit days and governance remain distinct',()=>{
  assert.equal(m.immutability(repo()).state,'na');assert.equal(m.immutability(objectRepo({enableImmutability:false})).state,'disabled');assert.equal(m.immutability(objectRepo({enableImmutability:null})).state,'unknown')
  assert.equal(m.immutability(objectRepo({immutabilityPeriodDays:30})).period,'30 days');assert.equal(m.immutability(objectRepo({enableImmutabilityGovernanceMode:true})).mode,'Governance')
  assert.equal(m.immutability(objectRepo({immutabilityPeriodDays:null})).period,'Period not reported')
})
test('unknown immutability or encryption does not claim disabled protection',()=>{
  const row=m.repositoryRow(snapshot(),repo({objectStorageEncryptionEnabled:null,objectStorage:{usedSpaceBytes:5}}))
  assert.equal(row.unknown,true);assert.equal(m.matches(row,'immutability'),false);assert.equal(m.matches(row,'encryption'),false)
})
test('disabled protection is actionable only for object repositories',()=>{
  const row=m.repositoryRow(snapshot(),repo({objectStorageEncryptionEnabled:false,objectStorage:{enableImmutability:false}}));assert.equal(m.matches(row,'immutability'),true);assert.equal(m.matches(row,'encryption'),true)
  assert.equal(m.matches(m.repositoryRow(snapshot(),repo({objectStorageEncryptionEnabled:false})),'encryption'),false)
})
test('disk and object quota capacity have independent low and critical thresholds',()=>{
  const row=m.repositoryRow(snapshot(),m.repositorySchema.parse({...objectRepo({usedSpaceBytes:950,freeSpaceBytes:50}),freeSpaceBytes:200}))
  assert.equal(row.capacityIssues.length,2);assert.match(row.capacityIssues[0],/Disk: low space/);assert.match(row.capacityIssues[1],/Object quota: critical/)
})
test('unlimited object storage does not become a full quota or borrow disk capacity',()=>{
  const row=m.repositoryRow(snapshot(),objectRepo({sizeLimitEnabled:false,usedSpaceBytes:2000,freeSpaceBytes:0}))
  assert.equal(row.cap.primary,null);assert.equal(row.cap.objectUsed,2000);assert.equal(row.capacityIssues.length,0)
})
test('missing or invalid disk measurements never become full, empty or healthy evidence',()=>{
  for(const patch of [{capacityBytes:null},{freeSpaceBytes:null},{freeSpaceBytes:2000},{capacityBytes:0}]){const row=m.repositoryRow(snapshot(),repo(patch));assert.equal(row.cap.disk,null);assert.equal(row.unknown,true)}
})
test('job and availability issues are joined by repository ID, never by name',()=>{
  const data=snapshot({jobs:ev([job({repositoryId:id(4),lastStatus:'Failed'})]),usage:[{organizationId:id(2),evidence:ev([usage({repositoryId:id(4),isAvailable:false})])}]})
  const row=m.repositoryRow(data,repo());assert.equal(row.attention.length,0);assert.equal(row.unavailable.length,0);assert.equal(row.noJobs,true)
})
test('out of order reason, sync, updates, maintenance and unavailable tenant are retained',()=>{
  const row=m.repositoryRow(snapshot({usage:[{organizationId:id(2),evidence:ev([usage({isAvailable:false})])}]}),repo({isOutdated:true,isOutOfSync:true,isOutOfOrder:true,outOfOrderReason:'Disk unavailable',maintenanceMode:'Enabled'}))
  assert.equal(row.healthIssues.length,5);assert.match(row.healthIssues.join(' '),/Disk unavailable/);assert.equal(m.matches(row,'health'),true)
})
test('configured used space, cache and object measurements are never added together',()=>{
  const row=m.repositoryRow(snapshot(),repo());assert.equal(row.reported.value,900);assert.equal(row.cache.value,100);assert.equal(row.object.value,800)
  const zero=m.repositoryRow(snapshot({usage:[{organizationId:id(2),evidence:ev([usage({usedSpaceBytes:0,localCacheUsedSpaceBytes:0,objectStorageUsedSpaceBytes:0})])}]}),repo());assert.equal(zero.reported.value,0)
})
test('missing usage remains unknown, partial measurements retain subtotal completeness',()=>{
  const missing=m.repositoryRow(snapshot({usage:[]}),repo());assert.equal(missing.cache.value,null);assert.equal(missing.usageComplete,false);assert.equal(missing.unknown,true)
  const partial=m.repositoryRow(snapshot({usage:[{organizationId:id(2),evidence:ev([usage()],{complete:false})}]}),repo());assert.equal(partial.cache.value,100);assert.equal(partial.cache.complete,false)
})
test('empty or incomplete jobs cannot both assert no configured target jobs',()=>{
  assert.equal(m.repositoryRow(snapshot({jobs:ev([])}),repo()).noJobs,true)
  assert.equal(m.repositoryRow(snapshot({jobs:ev([],{complete:false,available:false})}),repo()).noJobs,false)
})
test('local repositories without reported data usage remain discoverable as unknown evidence',()=>{
  const row=m.repositoryRow(snapshot({usage:[{organizationId:id(2),evidence:ev([])}]}),repo())
  assert.equal(row.reported.value,null);assert.equal(m.matches(row,'unknown'),true)
})
test('object totals deduplicate storage IDs and exclude conflicting shared measurements',()=>{
  const a=m.repositoryRow(snapshot(),objectRepo()),b=m.repositoryRow(snapshot(),m.repositorySchema.parse({...objectRepo(),id:id(8)}))
  assert.deepEqual(m.objectTotals([a,b]),{value:10,complete:true,stores:1})
  b.cap.objectUsed=20;assert.deepEqual(m.objectTotals([a,b]),{value:null,complete:false,stores:1})
})
test('sum rejects unsafe totals and retains missing measurements as partial',()=>{assert.deepEqual(m.sum([1,null]),{value:1,complete:false});assert.equal(m.sum([Number.MAX_SAFE_INTEGER,1]).value,null);assert.equal(m.sum([]).value,null)})
test('issue, search, storage, retention and immutability filters compose',()=>{
  const row=m.repositoryRow(snapshot({jobs:ev([job({lastStatus:'Warning'})])}),objectRepo())
  assert.equal(m.filterRows([row],{...m.emptyFilters,query:'Exchange',issue:'jobs',types:['AmazonS3Compatible'],immutability:'enabled',retention:'SnapshotBased'}).length,1)
  assert.equal(m.filterRows([row],{...m.emptyFilters,issue:'capacity'}).length,0)
})
test('jobs links use repository identifiers',()=>assert.equal(m.jobsHref(id(1)),`/vbm/jobs?repositoryId=${id(1)}`))
test('loader retrieves real configured usage and repository-side organization records separately',async()=>{
  const data=await loadRepositories(read,'source',id(1),now);assert.equal(data.repositories.data.length,1);assert.equal(data.backedOrganizations.data[0].id,'Tenant:Opaque:ID');assert.equal(data.usage[0].evidence.data[0].localCacheUsedSpaceBytes,100);assert.equal(data.warnings.length,0)
})
test('invalid detail IDs fail before reading and mismatched detail identities fail closed',async()=>{
  let calls=0;await assert.rejects(loadRepositories(async()=>{calls++;return {}},'source','../outside'),error=>error.status===400);assert.equal(calls,0)
  await assert.rejects(loadRepositories(async()=>repo({id:id(5)}),'source',id(1)),error=>error.status===502)
})
test('partial optional reads preserve repositories without fabricating zeros',async()=>{
  const data=await loadRepositories(async path=>{if(path.includes('/Jobs') || path.includes('/usedRepositories'))throw new VbmRequestError('denied',403);return read(path)},'source')
  assert.equal(data.repositories.available,true);assert.equal(data.jobs.available,false);assert.equal(data.usage[0].evidence.available,false);assert.equal(data.warnings.length,2)
})
test('authentication failure propagates and unavailable repositories fail explicitly',async()=>{
  await assert.rejects(loadRepositories(async()=>{throw new VbmRequestError('expired',401)},'source'),error=>error.status===401)
  await assert.rejects(loadRepositories(async()=>{throw new VbmRequestError('denied',403)},'source'),error=>error.status===502)
})
test('jobs lacking target IDs mark associations incomplete',async()=>{
  const data=await loadRepositories(async path=>path.startsWith('/v8/Jobs?') ? page([job({repositoryId:null})]):read(path),'source');assert.equal(data.jobs.complete,false);assert.match(data.warnings.join(' '),/no repository ID/)
})
test('repository inventory paginates beyond the previous hundred-row limit',async()=>{
  const data=await loadRepositories(async path=>{const url=new URL(path,'https://source.test');if(url.pathname==='/v8/BackupRepositories'){const offset=Number(url.searchParams.get('offset'));return {results:Array.from({length:offset===0 ? 500:1},(_,index)=>repo({id:id(offset+index+100)})),offset,limit:500,totalCount:501}}return read(path)},'source')
  assert.equal(data.repositories.data.length,501);assert.equal(data.repositories.complete,true)
})
test('organization fan-out is capped and concurrent reads are bounded',async()=>{
  let active=0,peak=0,usageCalls=0
  const data=await loadRepositories(async path=>{active++;peak=Math.max(peak,active);try{await new Promise(resolve=>setTimeout(resolve,1));if(path.startsWith('/v8/Organizations?'))return page(Array.from({length:52},(_,index)=>org({id:id(index+100)})));if(path.includes('/usedRepositories'))usageCalls++;return await read(path)}finally{active--}},'source')
  assert.ok(peak<=4);assert.equal(usageCalls,50);assert.equal(data.usage.length,50);assert.equal(m.repositoryRow(data,repo()).usageComplete,false);assert.match(data.warnings.join(' '),/50 configured/)
})
