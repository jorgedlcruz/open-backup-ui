const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const {test}=require('node:test'),assert=require('node:assert/strict')
const m=require('../lib/vbm-organizations/model.ts'),{loadOrganizations}=require('../lib/vbm-organizations/load.ts'),base=require('../lib/vbm-dashboard/model.ts'),{VbmRequestError}=require('../lib/vbm-dashboard/load.ts')
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`,now=new Date('2026-10-22T12:00:00Z')
const org=(patch={})=>m.organizationSchema.parse({id:id(1),name:'Tenant A',officeName:'tenant-a.example',region:'Worldwide',type:'Office365',isExchangeOnline:true,isSharePointOnline:true,isTeamsOnline:false,backedUpOrganizationId:'tenant-a:backup',...patch})
const job=(patch={})=>base.jobSchema.parse({id:id(2),organizationId:id(1),name:'Exchange',lastStatus:'Success',lastBackup:'2026-10-22T10:00:00Z',isEnabled:true,schedulePolicy:{scheduleEnabled:true},...patch})
const user=(patch={})=>m.userSchema.parse({id:'Tenant:CaseSensitive:User',organizationId:id(1),name:'User A',isBackedUp:true,lastBackupDate:'2026-10-22T10:00:00Z',licenseState:'Licensed',...patch})
const protectedObject=(patch={})=>m.protectedSchema.parse({id:'protected:User',organizationId:id(1),displayName:'Protected user',...patch})
const usage=(patch={})=>base.usageSchema.parse({repositoryId:id(3),usedSpaceBytes:1000,localCacheUsedSpaceBytes:100,objectStorageUsedSpaceBytes:900,isAvailable:true,protectedObjectsCount:5,...patch})
const repo=(patch={})=>base.repositorySchema.parse({id:id(3),name:'Repo',capacityBytes:10000,freeSpaceBytes:6000,isOutOfOrder:false,isOutOfSync:false,isOutdated:false,...patch})
const page=data=>({results:data,limit:500}),ev=(data,patch={})=>({data,available:true,complete:true,...patch})
const snapshot=(patch={})=>({sourceName:'source',fetchedAt:now.toISOString(),warnings:[],organizations:ev([org()]),jobs:ev([job()]),repositories:ev([repo()]),licensed:ev([user()]),protected:Object.fromEntries(base.kinds.map(kind=>[kind,ev(kind==='Users' ? [protectedObject()]:[])])),usage:[{organizationId:id(1),evidence:ev([usage()])}],...patch})
const read=async path=>{const url=new URL(path,'https://source.test');if(url.pathname==='/v8/Organizations')return page([org()]);if(url.pathname==='/v8/Jobs')return page([job()]);if(url.pathname==='/v8/LicensedUsers')return page([user()]);if(url.pathname==='/v8/BackupRepositories')return page([repo()]);if(url.pathname==='/v8/ProtectedUsers')return page([protectedObject()]);if(url.pathname.endsWith('/usedRepositories'))return page([usage()]);return page([])}
test('organization schema preserves every existing field and service tri-state without secrets',()=>{
  const value=m.organizationSchema.parse({...org(),isTeamsOnline:null,applicationSecret:'secret',_links:{self:{href:'elsewhere'}}})
  assert.equal(value.region,'Worldwide');assert.equal(value.officeName,'tenant-a.example');assert.equal(value.type,'Office365');assert.equal(value.isTeamsOnline,null);assert.equal(value.isSharePointOnline,true);assert.equal(value.applicationSecret,undefined);assert.equal(value._links,undefined)
})
test('tenant joins use configured IDs, never display names, and conflicting IDs cannot fall back',()=>{
  const a=org(),b=org({id:id(9),name:a.name})
  assert.equal(m.belongs({organizationId:id(9),backedUpOrganizationId:a.backedUpOrganizationId},a,[a,b]),false)
  assert.equal(m.belongs({organizationId:id(1).toUpperCase()},a,[a,b]),true)
  assert.equal(m.belongs({organizationName:a.name},a,[a,b]),false)
})
test('backed-up organization fallback requires a unique explicit mapping',()=>{
  const a=org(),b=org({id:id(9)})
  assert.equal(m.belongs({backedUpOrganizationId:a.backedUpOrganizationId},a,[a]),true)
  assert.equal(m.belongs({backedUpOrganizationId:a.backedUpOrganizationId},a,[a,b]),false)
})
test('licensed coverage denominator is licensed users, not protected records or repository counts',()=>{
  const data=snapshot({licensed:ev([user(),user({id:'u2',isBackedUp:false})])}),row=m.organizationRow(data,org())
  assert.equal(row.rate,50);assert.equal(row.backed,1);assert.equal(row.missing.length,1);assert.equal(row.protected.Users.length,1)
})
test('unknown or partial licensed evidence cannot create a coverage percentage',()=>{
  for(const evidence of [ev([]),ev([user()],{complete:false}),ev([user({isBackedUp:null})])])assert.equal(m.organizationRow(snapshot({licensed:evidence}),org()).rate,null)
})
test('freshness threshold and invalid future timestamps stay distinct from missing backup flags',()=>{
  const data=snapshot({licensed:ev([user({id:'old',lastBackupDate:'2026-10-20T12:00:00Z'}),user({id:'future',lastBackupDate:'2026-10-23T12:00:00Z'}),user({id:'none',isBackedUp:false})])})
  const row=m.organizationRow(data,org(),24);assert.equal(row.stale.length,1);assert.equal(row.missing.length,1);assert.equal(row.unknownUsers.length,1)
  assert.equal(m.organizationRow(data,org(),48).stale.length,0)
})
test('no jobs or protected objects is only confirmed for complete evidence',()=>{
  const complete=snapshot({jobs:ev([]),protected:Object.fromEntries(base.kinds.map(kind=>[kind,ev([])]))})
  assert.equal(m.organizationRow(complete,org()).noJobs,true);assert.equal(m.organizationRow(complete,org()).noProtected,true)
  complete.jobs=ev([],{available:false,complete:false});complete.protected.Users=ev([],{available:false,complete:false})
  const row=m.organizationRow(complete,org());assert.equal(row.noJobs,false);assert.equal(row.noProtected,false);assert.equal(row.unknown,true)
})
test('failed, warning, disabled and unscheduled job states remain independent',()=>{
  const jobs=[job({id:id(4),lastStatus:'Failed'}),job({id:id(5),lastStatus:'Warning'}),job({id:id(6),isEnabled:false}),job({id:id(7),schedulePolicy:{scheduleEnabled:false}}),job({id:id(8),lastStatus:'Running'})]
  const row=m.organizationRow(snapshot({jobs:ev(jobs)}),org());assert.equal(row.attention.length,4);assert.equal(row.running,1)
})
test('storage does not double count reported used space and preserves real zero measurements',()=>{
  const row=m.organizationRow(snapshot(),org());assert.equal(row.storage.value,1000);assert.equal(row.local.value,1000);assert.equal(row.storage.complete,true)
  const zero=m.organizationRow(snapshot({usage:[{organizationId:id(1),evidence:ev([usage({localCacheUsedSpaceBytes:0,objectStorageUsedSpaceBytes:0})])}]}),org());assert.equal(zero.storage.value,0)
})
test('missing usage never becomes zero and partial usage is labeled as a subtotal',()=>{
  const row=m.organizationRow(snapshot({usage:[]}),org());assert.equal(row.storage.value,null);assert.equal(row.unknown,true)
  const partial=m.organizationRow(snapshot({usage:[{organizationId:id(1),evidence:ev([usage({objectStorageUsedSpaceBytes:null})])}]}),org());assert.equal(partial.storage.value,100);assert.equal(partial.storage.complete,false)
})
test('storage issues are scoped by repository usage or job targets, not every repository',()=>{
  const data=snapshot({repositories:ev([repo(),repo({id:id(8),isOutOfOrder:true})])});assert.equal(m.organizationRow(data,org()).repositoryProblems.length,0)
  data.jobs.data[0].repositoryId=id(8);assert.equal(m.organizationRow(data,org()).repositoryProblems[0].reason,'Out of order')
  data.usage[0].evidence.data[0].isAvailable=false;assert.ok(m.organizationRow(data,org()).repositoryProblems.some(row=>row.reason==='Unavailable to organization'))
})
test('capacity concerns use real capacity and do not invent unlimited object quotas',()=>{
  const data=snapshot({repositories:ev([repo({freeSpaceBytes:500})])});assert.ok(m.organizationRow(data,org()).repositoryProblems.some(row=>row.reason==='Low disk space'))
  data.repositories.data=[repo({objectStorage:{sizeLimitEnabled:false,usedSpaceBytes:999999,freeSpaceBytes:0}})];assert.ok(!m.organizationRow(data,org()).repositoryProblems.some(row=>row.reason==='Low object quota headroom'))
})
test('issue, region, type, enabled-service and text filters combine',()=>{
  const rows=[m.organizationRow(snapshot({jobs:ev([job({lastStatus:'Warning'})])}),org())],filters={...m.emptyFilters,query:'tenant-a',regions:['Worldwide'],types:['Office365'],services:['Exchange'],issue:'jobs'}
  assert.equal(m.filterRows(rows,filters).length,1);assert.equal(m.filterRows(rows,{...filters,services:['Teams']}).length,0);assert.equal(m.filterRows(rows,{...filters,issue:'storage'}).length,0)
})
test('existing actions use organization ID and legacy names only resolve uniquely',()=>{
  assert.equal(new URL(m.protectedHref(org()),'http://localhost').searchParams.get('organizationId'),id(1));assert.equal(new URL(m.jobsHref(org()),'http://localhost').searchParams.get('organizationId'),id(1))
  assert.deepEqual(m.legacyOrganizationIds([org()],'tenant a'),[id(1)]);assert.deepEqual(m.legacyOrganizationIds([org(),org({id:id(2)})],'Tenant A'),['__unresolved_organization__']);assert.deepEqual(m.legacyOrganizationIds([org()],'unknown'),['__unresolved_organization__'])
})
test('loader returns original organization fields and complete related evidence',async()=>{
  const data=await loadOrganizations(read,'source',undefined,now);assert.equal(data.organizations.data[0].officeName,'tenant-a.example');assert.equal(data.jobs.data.length,1);assert.equal(data.protected.Users.data[0].id,'protected:User');assert.equal(data.warnings.length,0)
})
test('loader scopes detail queries to the selected ID and flags foreign responses',async()=>{
  const paths=[],data=await loadOrganizations(async path=>{paths.push(path);return path.startsWith('/v8/Jobs?') ? page([job(),job({id:id(9),organizationId:id(9)})]):read(path)},'source',id(1),now)
  for(const resource of ['Jobs','LicensedUsers','ProtectedUsers','ProtectedGroups','ProtectedSites','ProtectedTeams'])assert.equal(new URL(paths.find(path=>path.startsWith(`/v8/${resource}?`)),'http://source').searchParams.get('organizationId'),id(1))
  const row=m.organizationRow(data,org());assert.equal(row.jobs.length,1);assert.equal(data.jobs.complete,false);assert.match(data.warnings.join(' '),/excluded/)
})
test('unattributed global records mark the collection incomplete so no-job claims are avoided',async()=>{
  const data=await loadOrganizations(async path=>path.startsWith('/v8/Jobs?') ? page([job({organizationId:null})]):read(path),'source',undefined,now)
  assert.equal(data.jobs.complete,false);assert.equal(m.organizationRow(data,org()).noJobs,false)
})
test('paginated organizations and partial storage retain loaded rows',async()=>{
  const data=await loadOrganizations(async path=>{const url=new URL(path,'http://source');if(url.pathname==='/v8/Organizations')return url.searchParams.get('offset')==='0' ? {results:[org()],limit:1,_links:{next:{href:'https://untrusted.test'}}}:{results:[org({id:id(9),name:'B'})],limit:500};if(url.pathname.includes(id(9)) && url.pathname.endsWith('/usedRepositories'))throw new VbmRequestError('denied',403);return read(path)},'source',undefined,now)
  assert.equal(data.organizations.data.length,2);assert.equal(data.usage.length,2);assert.equal(data.usage[1].evidence.available,false);assert.ok(data.warnings.length)
})
test('authentication failures and missing organization are explicit errors',async()=>{
  await assert.rejects(()=>loadOrganizations(async()=>{throw new VbmRequestError('expired',401)},'source'),error=>error.status===401)
  await assert.rejects(()=>loadOrganizations(read,'source',id(99),now),error=>error.status===404)
  await assert.rejects(()=>loadOrganizations(async()=>{throw new VbmRequestError('denied',403)},'source'),error=>error.status===502)
})
test('invalid detail IDs fail before any source read',async()=>{
  let calls=0;await assert.rejects(()=>loadOrganizations(async()=>{calls++;return {}},'source','../bad',now),error=>error.status===400);assert.equal(calls,0)
})
test('list usage fan-out is bounded while any organization can load detail',async()=>{
  let usageReads=0,active=0,peak=0;const organizations=Array.from({length:52},(_,index)=>org({id:id(index+1),name:`Tenant ${index}`}))
  const reader=async path=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));try{if(path.startsWith('/v8/Organizations?'))return page(organizations);if(path.includes('/usedRepositories')){usageReads++;return page([])}return page([])}finally{active--}}
  const data=await loadOrganizations(reader,'source',undefined,now);assert.equal(data.organizations.data.length,52);assert.equal(usageReads,50);assert.ok(peak<=4)
  usageReads=0;const detail=await loadOrganizations(reader,'source',id(52),now);assert.equal(usageReads,1);assert.equal(detail.usage[0].organizationId,id(52))
})

test('legacy name links cannot resolve against a partial organization inventory',()=>{
  assert.deepEqual(m.legacyOrganizationIds([org()],'Tenant A',false),['__unresolved_organization__'])
})
