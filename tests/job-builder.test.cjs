const fs=require('node:fs'),ts=require('typescript'),os=require('node:os'),path=require('node:path');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const {test}=require('node:test'),assert=require('node:assert/strict');
const {newDraft,draftSchema,savedDraftSchema,compileJob,defaults,profileInput,profileEnvelope,objectKey}=require('../lib/job-builder/model.ts');
const {JobProfileStore}=require('../lib/server/job-profiles.ts');
const {browseObjects,loadOptions,loadInventory,validateEnvironment}=require('../lib/job-builder/load.ts');
const {schemas}=require('./fixtures/job-builder-contract.json');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope='a'.repeat(64),vm=(platform='VSphere',id='vm-1')=>({platform,type:'VirtualMachine',hostName:'vc.example',name:'Workload',objectId:id,size:'20 GB',parentObjectId:'parent'});
const draft=(platform='VSphere')=>({...newDraft(platform,scope),name:'Production',includes:[vm(platform)],repositoryId:uid(1)});
function flatten(schema) {
  if(schema.$ref)return flatten(schemas[schema.$ref.split('/').pop()]);
  const merged={...schema,properties:{...schema.properties},required:[...(schema.required||[])]};
  for(const part of schema.allOf||[]) {const base=flatten(part);Object.assign(merged.properties,base.properties);merged.required.push(...base.required);if(base.type)merged.type=base.type;}
  return merged;
}
// Validate every emitted field, required field, enum and bound against a checked-in
// extraction of the supplied OpenAPI. Reject unknown fields even where VBR might
// silently ignore them, so misspelled settings cannot pass these contracts.
function contract(value,schema,label='job') {
  if(schema.$ref?.endsWith('/InventoryObjectModel'))schema=schemas[value.platform==='VSphere'?'VmwareObjectModel':'HyperVObjectModel'];
  const rule=flatten(schema);
  if(value===null&&rule.nullable)return;
  if(rule.enum)assert.ok(rule.enum.includes(value),`${label}: invalid enum ${value}`);
  if(rule.type==='object') {
    assert.equal(typeof value,'object',label);assert.ok(value&&!Array.isArray(value),label);
    for(const key of rule.required)assert.ok(Object.hasOwn(value,key),`${label}: missing ${key}`);
    for(const [key,item] of Object.entries(value)){assert.ok(rule.properties[key],`${label}: unknown field ${key}`);contract(item,rule.properties[key],`${label}.${key}`);}
  } else if(rule.type==='array') {assert.ok(Array.isArray(value),label);value.forEach((item,i)=>contract(item,rule.items,`${label}[${i}]`));if(rule.minItems!==undefined)assert.ok(value.length>=rule.minItems,label);if(rule.maxItems!==undefined)assert.ok(value.length<=rule.maxItems,label);}
  else if(rule.type) {assert.equal(typeof value,rule.type==='integer'?'number':rule.type,label);if(rule.type==='integer')assert.ok(Number.isInteger(value),label);}
  if(rule.minimum!==undefined)assert.ok(value>=rule.minimum,label);
  if(rule.maximum!==undefined)assert.ok(value<=rule.maximum,label);
  if(rule.format==='uuid')assert.match(value,/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i,label);
}
for(const platform of ['VSphere','HyperV'])for(const mode of ['manual','daily','periodic'])test(`${platform} ${mode}: full payload obeys the native job contract`,()=>{
  const value=draft(platform);value.schedule.mode=mode;value.excludes=[vm(platform,'vm-2')];value.retention.active=true;value.retention.healthCheck=true;value.retention.gfsWeeks=4;value.retention.gfsMonths=12;value.retention.gfsYears=3;
  value.guest={...value.guest,applicationAware:true,indexing:true,credentialId:uid(3)};
  const payload=compileJob(value);contract(payload,schemas[platform==='VSphere'?'BackupJobSpec':'HyperVBackupJobSpec']);
  assert.equal(payload.type,platform==='VSphere'?'VSphereBackup':'HyperVBackup');assert.equal(payload.storage.advancedSettings.backupModeType,'Incremental');
  assert.equal(payload.guestProcessing.guestCredentials.credentials.credentialsId,uid(3));assert.equal(payload.guestProcessing.appAwareProcessing.appSettings[0].transactionLogs,'CopyOnly');
  assert.ok(!JSON.stringify(payload).includes('sourceKey'));assert.ok(!JSON.stringify(payload).includes('parentObjectId'));
});
test('contracts reject legacy proxy and daily schedule keys',()=>{
  const payload=compileJob(draft());payload.storage.backupProxies={automaticSelection:true};assert.throws(()=>contract(payload,schemas.BackupJobSpec),/autoSelectEnabled|automaticSelection/);
  const wrong=compileJob(draft());wrong.schedule.daily={isEnabled:true,type:'Everyday',times:['22:00']};assert.throws(()=>contract(wrong,schemas.BackupJobSpec),/unknown field/);
});
test('platform-specific selected proxies and automatic off-host proxies have valid contracts',()=>{
  for(const platform of ['VSphere','HyperV'])for(const proxyMode of ['auto','selected']){const value={...draft(platform),proxyMode,proxyIds:[uid(5)]},payload=compileJob(value);contract(payload,schemas[platform==='VSphere'?'BackupJobSpec':'HyperVBackupJobSpec']);const proxy=platform==='VSphere'?payload.storage.backupProxies:payload.storage.backupProxies.offHostSettings;assert.equal(proxy.autoSelectEnabled,proxyMode==='auto');assert.deepEqual(proxy.proxyIds,proxyMode==='auto'?[]:[uid(5)]);}
});
test('manual jobs and disabled guest processing omit credential material',()=>{
  const value=draft();value.schedule.mode='manual';value.guest.credentialId=uid(8);const payload=compileJob(value);assert.equal(payload.schedule.runAutomatically,false);assert.equal(payload.schedule.retry.isEnabled,false);assert.ok(!('guestCredentials' in payload.guestProcessing));contract(payload,schemas.BackupJobSpec);
});
test('unfinished drafts restore, but cannot compile into a job',()=>{
  const value=newDraft('VSphere',scope);assert.equal(savedDraftSchema.safeParse(value).success,true);assert.throws(()=>compileJob(value));
  assert.equal(savedDraftSchema.safeParse({...value,token:'secret'}).success,false);
});
test('reject empty selections, incompatible objects, duplicated objects and missing credentials',()=>{
  for(const patch of [{includes:[]},{includes:[vm('HyperV')]},{includes:[vm(),vm()]},{excludes:[vm()]},{proxyMode:'selected',proxyIds:[]},{proxyMode:'onHost'},{guest:{...defaults.guest,applicationAware:true}}])assert.equal(draftSchema.safeParse({...draft(),...patch}).success,false);
  assert.notEqual(objectKey(vm()),objectKey({...vm(),hostName:'second.example'}));
});
test('policy validation rejects empty enabled days, invalid times, and secret fields',()=>{
  for(const [kind,settings] of [['retention',{...defaults.retention,syntheticDays:[]}],['schedule',{...defaults.schedule,time:'25:00'}],['schedule',{...defaults.schedule,days:[]}],['guest',{...defaults.guest,password:'secret'}]])assert.equal(profileInput.safeParse({kind,name:'Policy',description:'',settings}).success,false);
  assert.equal(profileEnvelope.safeParse({schemaVersion:2,profile:{}}).success,false);
});
test('profiles persist per source; revisions prevent lost updates and settings remain snapshots',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-profiles-')),file=path.join(dir,'nested','profiles.json');
  try {
    const store=new JobProfileStore(file),input={kind:'retention',name:'Production',description:'',settings:structuredClone(defaults.retention)};
    const first=await store.save(scope,input);assert.equal(first.revision,1);assert.equal((await new JobProfileStore(file).list(scope)).length,1);assert.deepEqual(await store.list('b'.repeat(64)),[]);
    const job=draft();job.retention=structuredClone(first.settings);
    const second=await store.save(scope,{...input,settings:{...input.settings,quantity:30}},first.id,1);assert.equal(second.revision,2);assert.equal(job.retention.quantity,7);
    await assert.rejects(store.save(scope,input,first.id,1),/changed/);await assert.rejects(store.save(scope,{...input,name:'production'}),/already exists/);
    await assert.rejects(store.save('b'.repeat(64),input,first.id,2),/changed/);
    const other=await store.save('b'.repeat(64),input);assert.notEqual(other.id,first.id);
    const results=await Promise.allSettled([store.save(scope,{...input,name:'A'}),store.save(scope,{...input,name:'B'})]);assert.ok(results.some(r=>r.status==='fulfilled'));assert.ok((await store.list(scope)).some(p=>p.name==='Production'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
const root={platform:'VSphere',type:'vCenterServer',name:'vc.example',hostName:'vc.example',objectId:'root'};
const browse=async host=>({data:host?[vm()]:[root],pagination:{total:1}});
const read=async endpoint=>{
  if(endpoint==='/api/v1/serverInfo')return {buildVersion:'13.0.1.180'};
  if(endpoint.startsWith('/api/v1/backupInfrastructure/repositories/states'))return {data:[{id:uid(1),name:'Repository',isOnline:true,capacityGB:100,freeGB:60}],pagination:{total:1}};
  if(endpoint.startsWith('/api/v1/backupInfrastructure/proxies/states'))return {data:[{id:uid(2),name:'Proxy',type:'ViProxy',isOnline:true}],pagination:{total:1}};
  if(endpoint.startsWith('/api/v1/backupInfrastructure/proxies'))return {data:[{id:uid(2),name:'Proxy',type:'ViProxy'}],pagination:{total:1}};
  if(endpoint.startsWith('/api/v1/credentials'))return {data:[{id:uid(3),username:'guest',type:'Standard',password:'MUST-NOT-LEAVE-SERVER'}],pagination:{total:1}};
  if(endpoint.startsWith('/api/v1/jobs?'))return {data:[{id:uid(4),name:'Existing'}],pagination:{total:1}};
  throw new Error(endpoint);
};
test('option reads whitelist credentials and retain unknown availability',async()=>{
  const result=await loadOptions(read,browse,'Source',scope);assert.ok(!JSON.stringify(result).includes('MUST-NOT'));assert.equal(result.credentials[0].username,'guest');assert.equal(result.proxies[0].isDisabled,undefined);assert.equal(result.hosts[0].name,'vc.example');
});
test('inventory pagination uses raw offsets while deduplicating identities',async()=>{
  const calls=[];const result=await browseObjects(async(_host,skip)=>{calls.push(skip);return skip===0?{data:[vm(),vm()],pagination:{total:3}}:{data:[vm('VSphere','vm-2')],pagination:{total:3}}},'1.3-rev2','vc.example');assert.deepEqual(calls,[0,2]);assert.equal(result.data.length,2);assert.equal(result.complete,true);
});
test('inventory refuses arbitrary servers and filters unsupported types',async()=>{
  await assert.rejects(loadInventory(read,browse,'attacker.example','VSphere'),/Select an inventory server/);
  const result=await loadInventory(read,async host=>({data:host?[vm(),{...vm(),type:'Multitag'}]:[root],pagination:{total:host?2:1}}),'vc.example','VSphere');assert.equal(result.data.length,1);
});
test('preflight checks the live source, duplicate names, repository, proxies, credentials and objects',async()=>{
  const options=await loadOptions(read,browse,'Source',scope);assert.deepEqual(await validateEnvironment(draft(),read,browse,options),[]);
  assert.match((await validateEnvironment({...draft(),sourceKey:'b'.repeat(64)},read,browse,options))[0],/source changed/);
  const bad={...draft(),name:'Existing',repositoryId:uid(99),proxyMode:'selected',proxyIds:[uid(98)],guest:{...defaults.guest,indexing:true,credentialId:uid(97)},includes:[vm('VSphere','gone')]};
  const errors=await validateEnvironment(bad,read,browse,options);assert.equal(errors.length,5);
});
