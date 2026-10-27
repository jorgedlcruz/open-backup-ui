const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { test } = require('node:test'), assert = require('node:assert/strict');
const { groupSchema, entitySchema, discoverySchema, buildGroups, discoveryGroup, entityIssues, groupIssues, matchesEntity, matchesGroup, groupPage, scheduleText, defaultGroupFilters: defaults } = require('../lib/protection-groups/model.ts');
const { loadProtectionInventory } = require('../lib/protection-groups/load.ts');
const { TopologyRequestError } = require('../lib/topology/load.ts');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const gid = uid(1);
const group = (extra={}) => ({ id:gid, name:'Windows group', type:'IndividualComputers', isDisabled:false, ...extra });
const computer = (extra={}) => ({id:uid(2),protectionGroupId:gid,type:'Computer',name:'host.example',state:'Online',agentStatus:'Installed',driverStatus:'Installed',isTrusted:true,rebootRequired:false,plugins:[],...extra});
const session = (extra={}) => ({id:uid(3),jobId:gid,sessionType:'AgentDiscovery',state:'Stopped',creationTime:'2026-10-19T10:00:00Z',result:{result:'Success'},...extra});
const evidence = (data,extra={}) => ({data,available:true,complete:true,...extra});
const inventory = (extra={}) => ({sourceName:'Source',fetchedAt:'2026-10-20T10:00:00Z',from:'2026-09-20T10:00:00Z',apiRevision:'1.3-rev2',warnings:[],groups:evidence([group()]),entities:evidence([computer()]),sessions:evidence([session()]),...extra});
const row = extra => buildGroups(inventory(extra))[0];

test('computer connectivity is independent of installed agent status',()=>{
  const i=entityIssues(computer({state:'Offline'})); assert.equal(i.offline,true);assert.equal(i.agent,false);assert.equal(i.attention,true);
});
test('missing agent or optional driver does not claim deployment failed',()=>{
  const i=entityIssues(computer({agentStatus:'NotInstalled',driverStatus:'NotInstalled'}));
  assert.equal(i.missingAgent,true);assert.equal(i.agent,false);assert.equal(i.driver,false);assert.equal(i.attention,false);
});
test('agent failures, unsupported systems and uninitialized agents need investigation',()=>{
  for(const status of ['Failed','UnsupportedOperatingSystem','NotInitialized']) assert.equal(entityIssues(computer({agentStatus:status})).agent,true);
});
test('agent, driver and plugin updates count each computer only once',()=>{
  for(const extra of [{agentStatus:'UpgradeRequired'},{driverStatus:'UpgradeAvailable'},{plugins:[{type:'MSSQL',status:'UpgradeRequired'}]}]) assert.equal(entityIssues(computer(extra)).updates,true);
  const r=row({entities:evidence([computer({agentStatus:'UpgradeRequired',driverStatus:'UpgradeAvailable',plugins:[{status:'UpgradeRequired'}]})])});
  assert.equal(r.entities.filter(e=>entityIssues(e).updates).length,1);
});
test('driver failure, stopped driver and explicit reboot variants remain distinct',()=>{
  for(const driverStatus of ['Stopped','Failed']) assert.equal(entityIssues(computer({driverStatus})).driver,true);
  for(const driverStatus of ['InstalledRebootRequired','NotInstalledRebootRequired']) {
    const i=entityIssues(computer({driverStatus}));assert.equal(i.reboot,true);assert.equal(i.updates,false);
  }
  assert.equal(entityIssues(computer({rebootRequired:true})).reboot,true);
});
test('missing booleans and unknown enums do not become trust or reboot failures',()=>{
  const i=entityIssues(computer({state:'FutureState',isTrusted:null,rebootRequired:null,agentStatus:null,driverStatus:'Unknown',plugins:null}));
  assert.equal(i.unknown,true);assert.equal(i.offline,false);assert.equal(i.reboot,false);assert.equal(i.trust,false);
  assert.equal(entityIssues(computer({isTrusted:false})).trust,true);
});
test('AD and cluster containers are excluded from computer health even with stray fields',()=>{
  for(const type of ['Cluster','ActiveDirectory']) assert.ok(Object.values(entityIssues(computer({type,state:'Offline',agentStatus:'Failed',isTrusted:false}))).every(v=>v===false));
  assert.equal(entityIssues({id:uid(4),type:'FutureContainer'}).unknown,true);
});
test('schemas strip credentials, accounts and notification destinations recursively',()=>{
  const g=groupSchema.parse({...group(),credentialsId:uid(9),computers:[{password:'secret'}],account:{accessKey:'secret'},options:{installBackupAgent:true,advancedSettings:{notifications:{email:'private'}}}});
  const e=entitySchema.parse({...computer(),password:'secret',biosUuid:uid(8),plugins:[{type:'MSSQL',status:'Installed',credentials:'secret'}]});
  assert.ok(!JSON.stringify([g,e]).includes('secret'));assert.equal(g.options.advancedSettings,undefined);assert.equal(e.biosUuid,undefined);
});
test('IDs normalize before exact membership joins; names do not establish membership',()=>{
  const mixed='abcdefab-abcd-4000-8000-abcdefabcdef';
  const g=groupSchema.parse(group({id:mixed.toUpperCase()})), e=entitySchema.parse(computer({protectionGroupId:mixed.toUpperCase()}));
  assert.equal(buildGroups(inventory({groups:evidence([g]),entities:evidence([e])}))[0].entities.length,1);
  assert.equal(row({entities:evidence([computer({protectionGroupId:uid(9),name:'Windows group'})])}).entities.length,0);
});
test('discovery sessions require AgentDiscovery and explicit group IDs',()=>{
  const ids=new Set([gid]);
  assert.equal(discoveryGroup(session(),ids),gid);
  assert.equal(discoveryGroup(session({jobId:null,resourceId:gid}),ids),gid);
  assert.equal(discoveryGroup(session({jobId:null,resourceReference:`https://source/api/v1/agents/protectionGroups/${gid}`}),ids),gid);
  assert.equal(discoveryGroup(session({jobId:null,name:'Windows group'}),ids),null);
  assert.equal(discoveryGroup(session({sessionType:'AgentBackup'}),ids),null);
});
test('conflicting resource/activity references remain unlinked in list and detail',()=>{
  for(const ids of [new Set([gid]),new Set([gid,uid(9)])]) assert.equal(discoveryGroup(session({resourceId:uid(9)}),ids),null);
  assert.equal(discoveryGroup(session({resourceId:gid}),new Set([gid])),gid);
  assert.equal(discoveryGroup(session({jobId:null,resourceReference:`/api/v1/agents/protectionGroups/${gid}/extra`}),new Set([gid])),null);
});
test('latest discovery wins and active state is not an old failed result',()=>{
  const r=row({sessions:evidence([session({creationTime:'2026-10-01T00:00:00Z',result:{result:'Failed'}}),session({id:uid(8),state:'Working',result:{result:'Failed'}})])});
  assert.equal(r.sessions[0].id,uid(8));assert.equal(groupIssues(r).discovery,false);
  assert.equal(groupIssues(row({sessions:evidence([session({result:{result:'Warning'}})])})).discovery,true);
});
test('missing discovery history and incomplete entities are not an empty healthy group',()=>{
  const r=row({sessions:evidence([]),entities:evidence([],{complete:false})});
  assert.equal(groupIssues(r).unknown,true);assert.equal(groupIssues(r).empty,false);assert.equal(groupIssues(r).attention,false);
  assert.equal(groupIssues(row({entities:evidence([])})).empty,true);
  assert.equal(groupIssues(row({groups:evidence([group({isDisabled:true})])})).attention,true);
});
test('group query, type and issue filters compose across member names and IPs',()=>{
  const r=row({entities:evidence([computer({state:'Offline',ipAddresses:['10.1.2.3']})])});
  assert.equal(matchesGroup(r,{...defaults,query:'10.1.2',type:'IndividualComputers',issue:'offline'}),true);
  assert.equal(matchesGroup(r,{...defaults,query:'10.1.2',type:'ADObjects',issue:'offline'}),false);
  assert.equal(matchesGroup(r,{...defaults,query:'absent'}),false);
});
test('entity search and type/agent/issue filters compose without coercing missing statuses',()=>{
  const e=computer({state:'Offline',agentVersion:'13.1.2',ipAddresses:['10.1.2.3']});
  assert.equal(matchesEntity(e,'13.1','offline','Computer','Installed'),true);
  assert.equal(matchesEntity(e,'13.1','updates','Computer','Installed'),false);
  assert.equal(matchesEntity(e,'','all','Cluster','Installed'),false);
  assert.equal(matchesEntity({...e,type:null},'','all','Unknown','all'),true);
});
test('group pagination clamps after filters and sorts issues before normal rows',()=>{
  const rows=buildGroups(inventory({groups:evidence(Array.from({length:19},(_,i)=>group({id:uid(i+20),name:`Group ${String(i).padStart(2,'0')}`,isDisabled:i===18})))}));
  const p=groupPage(rows,defaults,'risk',0);assert.equal(p.rows[0].group.id,uid(38));assert.equal(p.rows.length,15);
  assert.equal(groupPage(rows,defaults,'name',99).rows.length,4);
  assert.equal(groupPage(rows,{...defaults,query:'Group 00'},'name',1).current,0);
});
test('schedules preserve enabled modes and never infer disabled from missing configuration',()=>{
  assert.equal(scheduleText(group()),'Not reported');
  assert.equal(scheduleText(group({options:{rescanSchedule:{daily:{isEnabled:false}}}})),'Schedule mode not reported');
  assert.equal(scheduleText(group({options:{rescanSchedule:{daily:{isEnabled:true,localTime:'21:00',days:['Monday']}}}})),'At 21:00 · Monday');
  assert.equal(scheduleText(group({options:{rescanSchedule:{daily:{isEnabled:false},periodically:{isEnabled:false},continuously:{isEnabled:false}}}})),'All schedule modes disabled');
});
const now=new Date('2026-10-20T10:00:00Z');
function reader(override) {
  const calls=[];
  const read=async(path,revision)=>{
    calls.push({path,revision});const u=new URL(path,'https://vbr.invalid');
    if(override){const v=await override(u);if(v!==undefined)return v;}
    if(u.pathname==='/api/v1/serverInfo')return {buildVersion:'13.1.0.411'};
    if(u.pathname==='/api/v1/agents/protectionGroups')return {data:[group()]};
    if(u.pathname===`/api/v1/agents/protectionGroups/${gid}`)return group();
    if(u.pathname.endsWith('/discoveredEntities'))return {data:[computer()]};
    if(u.pathname==='/api/v1/sessions')return {data:[session()]};
    throw new Error('Unexpected read '+path);
  };
  return {read,calls};
}
test('loader uses four bounded collection reads, revision, permissions and discovery window',async()=>{
  const {read,calls}=reader();const data=await loadProtectionInventory(read,'Source',undefined,now);
  assert.equal(calls.length,4);assert.equal(data.apiRevision,'1.3-rev2');
  const s=new URL(calls.find(c=>c.path.startsWith('/api/v1/sessions')).path,'https://vbr.invalid');
  assert.equal(s.searchParams.get('typeFilter'),'AgentDiscovery');assert.equal(s.searchParams.get('createdAfterFilter'),'2026-09-20T10:00:00.000Z');
  assert.ok(calls.slice(1).every(c=>c.revision==='1.3-rev2'));
  assert.ok(calls.find(c=>c.path.includes('protectionGroups?')).path.includes('permissionScope=Any'));
});
test('group detail uses scoped entity inventory and validates returned group identity',async()=>{
  const {read,calls}=reader();const data=await loadProtectionInventory(read,'Source',gid,now);
  assert.equal(data.groups.data[0].id,gid);assert.ok(calls.some(c=>c.path.includes(`${gid}/discoveredEntities`)));
  const wrong=reader(u=>u.pathname===`/api/v1/agents/protectionGroups/${gid}` ? group({id:uid(99)}):undefined);
  await assert.rejects(loadProtectionInventory(wrong.read,'Source',gid,now),/different protection group/);
});
test('invalid group IDs reject before reading upstream',async()=>{
  const {read,calls}=reader();await assert.rejects(loadProtectionInventory(read,'Source','invalid',now));assert.equal(calls.length,0);
});
test('core failures propagate while optional failures preserve visible groups',async()=>{
  const optional=reader(u=>{if(u.pathname.endsWith('/discoveredEntities'))throw new TopologyRequestError('Denied',403)});
  const data=await loadProtectionInventory(optional.read,'Source',undefined,now);
  assert.equal(data.groups.data.length,1);assert.equal(data.entities.complete,false);assert.match(data.warnings.join(' '),/account cannot read/);
  const core=reader(u=>{if(u.pathname==='/api/v1/agents/protectionGroups')throw new TopologyRequestError('Core failed',502)});
  await assert.rejects(loadProtectionInventory(core.read,'Source',undefined,now),/Core failed/);
});
test('authentication expiry propagates from version and optional reads',async()=>{
  for(const path of ['/api/v1/serverInfo','/api/v1/sessions']) {
    const {read}=reader(u=>{if(u.pathname===path)throw new TopologyRequestError('Expired',401)});
    await assert.rejects(loadProtectionInventory(read,'Source',undefined,now),e=>e.status===401);
  }
});
test('malformed optional data is visible and version failure falls back to rev1',async()=>{
  const {read}=reader(u=>{
    if(u.pathname==='/api/v1/serverInfo')return {bad:true};
    if(u.pathname==='/api/v1/sessions')return {data:[{id:'bad'}]};
  });
  const data=await loadProtectionInventory(read,'Source',undefined,now);
  assert.equal(data.apiRevision,'1.3-rev1');assert.equal(data.sessions.available,false);assert.equal(data.warnings.length,2);
});
test('membership mismatches stay excluded and detail coverage is partial',async()=>{
  const {read}=reader(u=>u.pathname.endsWith('/discoveredEntities') ? {data:[computer({protectionGroupId:uid(77)})]}:undefined);
  const data=await loadProtectionInventory(read,'Source',gid,now);
  assert.equal(buildGroups(data)[0].entities.length,0);assert.equal(data.entities.complete,false);assert.match(data.warnings[0],/excluded/);
});
test('pagination preserves permission filters and marks repeated pages partial',async()=>{
  const entities=Array.from({length:201},(_,i)=>computer({id:uid(100+i)}));
  const {read,calls}=reader(u=>u.pathname.endsWith('/discoveredEntities') ? {data:entities.slice(Number(u.searchParams.get('skip')),Number(u.searchParams.get('skip'))+200),pagination:{total:201}}:undefined);
  const data=await loadProtectionInventory(read,'Source',undefined,now);
  assert.equal(data.entities.data.length,201);assert.equal(data.entities.complete,true);
  assert.ok(calls.filter(c=>c.path.includes('/discoveredEntities')).every(c=>c.path.includes('permissionScope=Any')));
  const repeated=reader(u=>u.pathname.endsWith('/discoveredEntities') ? {data:entities.slice(0,200),pagination:{total:500}}:undefined);
  assert.equal((await loadProtectionInventory(repeated.read,'Source',undefined,now)).entities.complete,false);
});
