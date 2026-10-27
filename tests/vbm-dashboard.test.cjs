/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const {test}=require('node:test'),assert=require('node:assert/strict')
const m=require('../lib/vbm-dashboard/model.ts'),{collection,loadDashboard,VbmRequestError}=require('../lib/vbm-dashboard/load.ts')
const id=n=>`00000001-0000-4000-8000-${String(n).padStart(12,'0')}`
const now=new Date('2026-10-22T12:00:00Z'),ev=(data=[],complete=true)=>({data,available:true,complete})
const job=patch=>m.jobSchema.parse({id:id(1),name:'Backup',lastStatus:'Success',isEnabled:true,schedulePolicy:{scheduleEnabled:true},...patch})
const session=patch=>m.sessionSchema.parse({id:id(2),jobId:id(1),status:'Success',jobType:'Backup',creationTime:'2026-10-22T10:00:00Z',...patch})
const repo=patch=>m.repositorySchema.parse({id:id(3),name:'Repository',...patch})
const page=(rows,limit=500,extra={})=>({results:rows,limit,...extra})
const baseRead=async path=>{
  const url=new URL(path,'https://source.test')
  if(url.pathname==='/v8/License')return {usedNumber:3,totalNumber:10000,type:'Subscription'}
  if(url.pathname==='/v8/Health')return {status:'Healthy',entries:{configurationDb:{status:'Healthy'},nats:{status:'Healthy'}}}
  if(url.pathname==='/v8/ServiceInstance')return {version:'8.5.0.1014'}
  if(url.pathname==='/v8/Jobs')return page([job()])
  if(url.pathname==='/v8/Organizations')return page([{id:id(4),name:'Tenant'}])
  if(url.pathname==='/v8/BackupRepositories')return page([repo()])
  return page([])
}

test('display schemas retain original metrics and remove accounts and credentials',()=>{
  const r=repo({capacityBytes:'100',freeSpaceBytes:20,account:{password:'secret'},objectStorage:{id:id(8),accountId:'secret',usedSpaceBytes:50,freeSpaceBytes:50,sizeLimitEnabled:true}})
  assert.equal(r.capacityBytes,100);assert.equal(r.account,undefined);assert.equal(r.objectStorage.accountId,undefined)
  const l=m.licenseSchema.parse({licensedTo:'Owner',email:'owner@example.test',supportID:'123',usedNumber:3,totalNumber:10000,password:'secret'})
  assert.equal(l.supportID,'123');assert.equal(l.email,'owner@example.test');assert.equal(l.password,undefined)
})
test('invalid, absent, unlimited and unsafe byte values stay unmeasured',()=>{
  for(const value of [null,undefined,-1,Number.MAX_SAFE_INTEGER+1,'not a number']) assert.equal(m.capacity(repo({capacityBytes:value,freeSpaceBytes:5})).disk,null)
  assert.equal(m.capacity(repo({capacityBytes:100,freeSpaceBytes:null})).disk,null)
  assert.equal(m.capacity(repo({capacityBytes:100,freeSpaceBytes:110})).disk,null)
  assert.equal(m.capacity(repo({capacityBytes:100.5,freeSpaceBytes:10})).disk,null)
})
test('object quota and local cache disk are independent measurements',()=>{
  const c=m.capacity(repo({capacityBytes:1000,freeSpaceBytes:100,objectStorage:{sizeLimitEnabled:true,usedSpaceBytes:10,freeSpaceBytes:90}}))
  assert.equal(c.disk.percent,90);assert.equal(c.quota.percent,10);assert.equal(c.primary.total,100);assert.equal(c.scope,'Object-storage quota')
})
test('unlimited object storage never inherits local disk utilization as its quota',()=>{
  const c=m.capacity(repo({capacityBytes:1000,freeSpaceBytes:10,objectStorage:{sizeLimitEnabled:false,usedSpaceBytes:50,freeSpaceBytes:500}}))
  assert.equal(c.quota,null);assert.equal(c.primary,null);assert.equal(c.objectUsed,50);assert.equal(c.disk.percent,99)
})
test('capacity thresholds and repository health flags are independent',()=>{
  const r=repo({capacityBytes:100,freeSpaceBytes:20,isOutdated:true,isOutOfSync:true,isOutOfOrder:true,maintenanceMode:'Enabled',objectStorage:{sizeLimitEnabled:true,usedSpaceBytes:90,freeSpaceBytes:10}})
  const reasons=m.repositoryIssues(r,{usage:[{evidence:ev([{repositoryId:r.id,isAvailable:false}])}]})
  assert.ok(reasons.includes('Disk: low space'));assert.ok(reasons.includes('Object quota: critical capacity'))
  assert.ok(reasons.includes('Out of sync'));assert.ok(reasons.includes('Update required'));assert.ok(reasons.includes('Unavailable to an organization'))
})
test('job issues preserve running, disabled, warning and schedule states independently',()=>{
  assert.equal(m.jobMatches(job({lastStatus:'Running'}),'running'),true)
  assert.equal(m.jobMatches(job({lastStatus:'Running'}),'attention'),false)
  assert.equal(m.jobMatches(job({lastStatus:'Warning',isEnabled:false}),'warning'),true)
  assert.equal(m.jobMatches(job({lastStatus:'Warning',isEnabled:false}),'disabled'),true)
  assert.equal(m.jobMatches(job({schedulePolicy:{scheduleEnabled:false}}),'unscheduled'),true)
  assert.equal(m.jobMatches(job({lastStatus:null}),'unknown'),true)
  assert.equal(m.jobMatches(job({lastStatus:'Unexpected'}),'unknown'),true)
})
test('latest session joins only by job ID, not names or array order',()=>{
  const rows=[session({creationTime:'2026-10-20'}),session({id:id(6),creationTime:'2026-10-21'}),session({id:id(7),jobId:id(99),creationTime:'2026-10-22'})]
  assert.equal(m.latestSession(job(),rows).id,id(6))
})
test('cache and object total retains original accounting without adding local used bytes twice',()=>{
  const s={organizations:ev([{}]),usage:[{evidence:ev([{repositoryId:id(3),localCacheUsedSpaceBytes:10,objectStorageUsedSpaceBytes:100,usedSpaceBytes:900}])}]}
  assert.deepEqual(m.cacheObjectUsage(s),{total:110,complete:true,rows:1})
})
test('missing storage measurements and failed organization reads remain explicit subtotals',()=>{
  const s={organizations:ev([{},{}]),usage:[{evidence:ev([{localCacheUsedSpaceBytes:10,objectStorageUsedSpaceBytes:null}])},{evidence:{data:[],available:false,complete:false}}]}
  assert.deepEqual(m.cacheObjectUsage(s),{total:10,complete:false,rows:1})
  assert.equal(m.cacheObjectUsage({organizations:ev([{}]),usage:[]}).total,null)
  assert.equal(m.cacheObjectUsage({organizations:ev([]),usage:[]}).total,0)
})
test('unsafe storage sums are unknown even when component readings are valid',()=>{
  const s={organizations:ev([{}]),usage:[{evidence:ev([{localCacheUsedSpaceBytes:Number.MAX_SAFE_INTEGER,objectStorageUsedSpaceBytes:1}])}]}
  assert.equal(m.cacheObjectUsage(s).total,null);assert.equal(m.cacheObjectUsage(s).complete,false)
})
test('licensed-user review separates no backup, stale, missing, and future evidence',()=>{
  assert.equal(m.licensedIssue({isBackedUp:false,lastBackupDate:'2026-10-22'},now.getTime()),'No backup reported')
  assert.equal(m.licensedIssue({isBackedUp:true,lastBackupDate:'2026-10-20'},now.getTime()),'Older than 24h')
  assert.equal(m.licensedIssue({isBackedUp:true,lastBackupDate:'2026-10-22T11:00:00Z'},now.getTime()),'Within threshold')
  for(const date of [null,'invalid','2030-01-01'])assert.equal(m.licensedIssue({isBackedUp:true,lastBackupDate:date},now.getTime()),'Unknown evidence')
})
test('multi-select session filters compose with search, type and UTC day',()=>{
  const rows=[session({details:'Special message'}),session({id:id(3),status:'Warning',jobType:'Copy'}),session({id:id(4),status:'Running'})]
  assert.equal(m.filterSessions(rows,[job()],{query:'backup',statuses:['Success','Running'],types:['Backup'],day:'2026-10-22'}).length,2)
  assert.equal(m.filterSessions(rows,[job()],{query:'special',statuses:[],types:[],day:null}).length,1)
  assert.equal(m.filterSessions(rows,[job()],{query:'',statuses:[],types:['Copy'],day:null}).length,1)
  assert.equal(m.filterSessions(rows,[job()],{query:'',statuses:[],types:[],day:'2026-10-21'}).length,0)
})
test('session outcome rates preserve all-record metric and distinguish completed denominator',()=>{
  const stats=m.sessionStats([session(),session({status:'Succeeded'}),session({status:'Running'}),session({status:'Warning'}),session({status:'Stopped'}),session({status:'Other'})])
  assert.equal(stats.success,2);assert.equal(stats.running,1);assert.ok(Math.abs(stats.recordedRate-100/3)<1e-10);assert.ok(Math.abs(stats.completedRate-200/3)<1e-10)
  assert.equal(m.sessionStats([]).recordedRate,null);assert.equal(m.sessionStats([session({status:'Running'})]).completedRate,null)
})
test('daily chart includes running and other outcomes and keeps UTC boundaries',()=>{
  const rows=[session({creationTime:'2026-10-21T23:30:00-01:00',status:'Running'}),session({creationTime:'bad',status:'Warning'}),session({status:'Stopped'})]
  const days=m.dailySessions(rows,now.toISOString(),7)
  assert.equal(days.length,7);assert.equal(days.at(-1).total,2);assert.equal(days.at(-1).running,1);assert.equal(days.at(-1).other,1)
})
test('exports preserve original columns and full messages; CSV handles quotes and formulas',()=>{
  const data=m.sessionExport([session({details:'line1\nline2'})],[job({name:'A "quoted" name'})])
  assert.equal(data[0].jobName,'A "quoted" name');assert.equal(data[0].details,'line1\nline2');assert.equal(data[0].status,'Success')
  assert.equal(m.csvCell('A "quoted" name'),'"A ""quoted"" name"')
  assert.equal(m.csvCell('=SUM(A1)'),'"\'=SUM(A1)"')
})
test('collection follows short server pages and next links without fetching arbitrary link URLs',async()=>{
  const paths=[]
  const result=await collection(async path=>{paths.push(path);const offset=Number(new URL(path,'https://x').searchParams.get('offset'));return page(offset===0 ? [{id:id(1)},{id:id(2)}]:[{id:id(3)}],2,offset===0 ? {_links:{next:{href:'https://untrusted.example/steal'}}}:{})},'/v8/Jobs',m.jobSchema,row=>row.id)
  assert.equal(result.data.length,3);assert.equal(result.complete,true);assert.equal(paths.length,2);assert.ok(paths.every(path=>path.startsWith('/v8/Jobs?')))
})
test('repeated pages, wrong offsets, empty next pages, and oversized responses stay partial',async()=>{
  const repeated=await collection(async()=>page([{id:id(1)}],1),'/v8/Jobs',m.jobSchema,row=>row.id)
  assert.equal(repeated.complete,false);assert.equal(repeated.data.length,1)
  const wrong=await collection(async()=>page([] ,500,{offset:10}),'/v8/Jobs',m.jobSchema,row=>row.id)
  assert.equal(wrong.complete,false)
  const empty=await collection(async()=>page([],500,{_links:{next:{href:'/more'}}}),'/v8/Jobs',m.jobSchema,row=>row.id)
  assert.equal(empty.complete,false)
  const huge=await collection(async()=>page(Array.from({length:20},(_,i)=>({id:id(i+1)}))),'/v8/Jobs',m.jobSchema,row=>row.id,5)
  assert.equal(huge.data.length,5);assert.equal(huge.complete,false)
})
test('failed later pages retain earlier evidence; authentication still propagates',async()=>{
  let calls=0
  const result=await collection(async()=>{if(calls++)throw new Error('offline');return page([{id:id(1)}],1)},'/v8/Jobs',m.jobSchema,row=>row.id)
  assert.equal(result.data.length,1);assert.equal(result.available,true);assert.equal(result.complete,false)
  await assert.rejects(()=>collection(async()=>{throw new VbmRequestError('expired',401)},'/v8/Jobs',m.jobSchema,row=>row.id),error=>error.status===401)
})
test('loader uses bounded concurrency, history filter and documented read endpoints',async()=>{
  let active=0,maxActive=0;const paths=[]
  const data=await loadDashboard(async path=>{paths.push(path);active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,2));try{return await baseRead(path)}finally{active--}},'source',30,now)
  assert.ok(maxActive<=4);assert.equal(data.jobs.data.length,1);assert.equal(data.days,30)
  assert.ok(paths.some(path=>path.includes('endTimeLowerBound=2026-09-22')))
  assert.ok(paths.some(path=>path.startsWith(`/v8/Organizations/${id(4)}/usedRepositories`)))
  assert.deepEqual(Object.keys(data.protected),['Users','Groups','Sites','Teams'])
})
test('loader retains protected identities from different organizations and backup namespaces',async()=>{
  const data=await loadDashboard(async path=>path.startsWith('/v8/ProtectedUsers') ? page([{id:id(1),organizationId:id(4),backedUpOrganizationId:id(8)},{id:id(1),organizationId:id(4),backedUpOrganizationId:id(9)},{id:id(1),organizationId:id(5)}]):baseRead(path),'source',7,now)
  assert.equal(data.protected.Users.data.length,3)
})
test('optional failures produce coverage notices without converting failures to empty complete results',async()=>{
  const data=await loadDashboard(async path=>{if(path.startsWith('/v8/ProtectedTeams')||path==='/v8/Health')throw new VbmRequestError('denied',403);return baseRead(path)},'source',7,now)
  assert.equal(data.protected.Teams.available,false);assert.equal(data.protected.Teams.complete,false);assert.equal(data.health,null)
  assert.ok(data.warnings.some(text=>text.includes('Protected teams')));assert.equal(data.jobs.available,true)
})
test('loader propagates authentication failures and fails when core datasets all fail',async()=>{
  await assert.rejects(()=>loadDashboard(async()=>{throw new VbmRequestError('expired',401)},'source',7,now),error=>error.status===401)
  await assert.rejects(()=>loadDashboard(async()=>{throw new VbmRequestError('offline',502)},'source',7,now),error=>error.status===502)
})
test('organization usage fan-out is limited and invalid organization paths are never requested',async()=>{
  const paths=[]
  const data=await loadDashboard(async path=>{paths.push(path);if(path.startsWith('/v8/Organizations?'))return page([{id:'..'},...Array.from({length:51},(_,i)=>({id:id(i+10)}))]);return baseRead(path)},'source',7,now)
  assert.equal(data.usage.length,50);assert.equal(paths.filter(path=>path.includes('/usedRepositories')).length,49)
  assert.ok(!paths.some(path=>path.includes('/../')));assert.ok(data.warnings.some(text=>text.includes('limited to 50')))
  assert.ok(data.warnings.some(text=>text.includes('invalid organization ID')))
})
