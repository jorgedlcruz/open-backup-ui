const fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const {test}=require('node:test'),assert=require('node:assert/strict');
const {serverSchema,credentialSchema,jobSchema,buildRows,serverName,category,sourcePath,credentialRef,matches,sorted,defaults}=require('../lib/unstructured-data/model.ts');
const {loadUnstructured}=require('../lib/unstructured-data/load.ts');
const {TopologyRequestError}=require('../lib/topology/load.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const server=(extra={})=>({id:id(1),type:'SMBShare',name:'Share',description:'Existing description',path:'\\\\server\\share',accessCredentialsRequired:true,accessCredentialsId:id(7),processing:{cacheRepositoryId:id(8),backupIOControlLevel:'Medium'},...extra});
const backup=(extra={})=>({id:id(3),backupId:id(4),platformName:'UnstructuredData',fileServerId:id(1),restorePointsCount:4,lastRunFailed:false,size:1024,...extra});
const job=(extra={})=>({id:id(2),name:'File job',type:'FileBackup',objects:[{fileServerId:id(1),type:'Directory',path:'\\\\server\\share\\selected',exclusionMask:[{path:'*.tmp',type:'File'}]}],...extra});
const ev=(data,extra={})=>({data,available:true,complete:true,...extra});
const snapshot=(extra={})=>({servers:ev([server()]),backups:ev([backup()]),jobs:ev([job()]),jobStates:ev([{id:id(2),status:'Stopped',lastResult:'Success'}]),repositories:ev([{id:id(8),name:'Cache',description:'Cache metadata'}]),repositoryStates:ev([{id:id(8),name:'Cache',isOnline:true,isOutOfDate:false,capacityGB:100,freeGB:50}]),credentials:ev([{id:id(7),kind:'standard',username:'user',description:'Original description',creationTime:'2023-01-01'}]),...extra});
const row=extra=>buildRows(snapshot(extra))[0];
test('retains source and credential metadata, cache name and I/O control',()=>{
 const r=row();assert.equal(r.server.description,'Existing description');assert.equal(r.server.path,'\\\\server\\share');assert.equal(r.credential.username,'user');assert.equal(r.credential.creationTime,'2023-01-01');assert.equal(r.repository.name,'Cache');assert.equal(r.server.processing.backupIOControlLevel,'Medium');
});
test('all documented source variants receive correct categories and object display names',()=>{
 for(const type of ['SMBShare','NFSShare','SANSMBShare','SANNFSShare'])assert.equal(category(server({type})),'File shares');
 for(const type of ['FileServer','NASFiler'])assert.equal(category(server({type})),'File servers & NAS');
 for(const type of ['S3Compatible','AmazonS3','AzureBlob','AzureDataLake'])assert.equal(category(server({type})),'Object storage');
 assert.equal(category(server({type:'FutureType'})),'Other');
 const s=server({name:null,type:'S3Compatible',account:{friendlyName:'Archive store',servicePoint:'https://s3.example',credentialsId:id(9)}});
 assert.equal(serverName(s),'Archive store');assert.equal(sourcePath(s),'\\\\server\\share');assert.equal(sourcePath({...s,path:null}),'https://s3.example');assert.deepEqual(credentialRef(s),{id:id(9),kind:'cloud'});
});
test('server, credential and job display schemas strip secrets recursively',()=>{
 const s=serverSchema.parse(server({password:'secret',account:{friendlyName:'Store',credentialsId:id(9),secretKey:'secret'},processing:{cacheRepositoryId:id(8),password:'secret'}}));
 const c=credentialSchema.parse({id:id(7),username:'user',description:'description',password:'secret',secretKey:'secret',privateKey:'secret'});
 const j=jobSchema.parse({...job(),guestProcessing:{credentials:{password:'secret'}}});
 assert.equal(JSON.stringify([s,c,j]).includes('secret'),false);assert.equal(c.description,'description');
});
test('backup evidence joins explicit IDs and does not claim whole-server job coverage',()=>{
 const r=row();assert.equal(r.protection,'Backup evidence');assert.equal(r.jobs.length,1);assert.equal(r.jobs[0].scopes[0].exclusionMask[0].path,'*.tmp');assert.match(r.note,/only selected/);
 assert.equal(row({backups:ev([backup({fileServerId:id(99),name:'Share'})]),jobs:ev([])}).protection,'No protection found');
});
test('fileServerId takes precedence over a conflicting hostId',()=>{
 const rows=buildRows(snapshot({servers:ev([server(),server({id:id(9)})]),backups:ev([backup({fileServerId:id(9),hostId:id(1)})])}));
 assert.equal(rows[0].backups.length,0);assert.equal(rows[1].backups.length,1);
});
test('managed-host backup fallback only protects a unique FileServer, never sibling shares',()=>{
 const items=[server({type:'FileServer',hostId:id(20)}),server({id:id(9),hostId:id(20)})];
 const rows=buildRows(snapshot({servers:ev(items),backups:ev([backup({fileServerId:null,hostId:id(20)})])}));
 assert.equal(rows[0].backups.length,1);assert.equal(rows[1].backups.length,0);
 const ambiguous=buildRows(snapshot({servers:ev([items[0],{...items[0],id:id(9)}]),backups:ev([backup({fileServerId:null,hostId:id(20)})])}));
 assert.ok(ambiguous.every(r=>r.protection==='Unknown'));
 const partial=row({servers:ev([items[0]],{complete:false}),backups:ev([backup({fileServerId:null,hostId:id(20)})])});
 assert.equal(partial.protection,'Unknown');assert.equal(partial.backups.length,0);
});
test('backup copies sharing one object ID retain independent sizes, counts and failed results',()=>{
 const r=row({backups:ev([backup(),backup({backupId:id(5),lastRunFailed:true,size:4096,restorePointsCount:8})])});
 assert.equal(r.backups.length,2);assert.equal(r.issues.backup,true);assert.deepEqual(r.backups.map(b=>b.restorePointsCount),[4,8]);
});
test('configured-only, no-protection and unknown remain distinct',()=>{
 assert.equal(row({backups:ev([])}).protection,'Configured only');
 assert.equal(row({backups:ev([]),jobs:ev([])}).protection,'No protection found');
 assert.equal(row({backups:ev([],{complete:false})}).protection,'Unknown');
 assert.equal(row({backups:ev([]),jobs:ev([],{complete:false})}).protection,'Unknown');
 assert.equal(row({backups:ev([backup()],{complete:false})}).protection,'Backup evidence');
 assert.equal(row({backups:ev([]),servers:ev([server({type:'FutureType'})])}).protection,'Unknown');
});
test('unidentified unstructured backup records keep unmatched protection unresolved',()=>{
 assert.equal(row({backups:ev([backup({fileServerId:null,hostId:null})]),jobs:ev([])}).protection,'Unknown');
 assert.equal(row({backups:ev([backup({platformName:'VMware',fileServerId:id(1)})]),jobs:ev([])}).protection,'No protection found');
});
test('object-storage jobs join the server ID and preserve bucket, prefix and tag scopes',()=>{
 const r=row({servers:ev([server({type:'AmazonS3'})]),backups:ev([]),jobs:ev([job({type:'ObjectStorageBackup',objects:[{objectStorageServerId:id(1),container:'bucket-a',path:'prefix/',type:'Prefix',inclusionTagMask:[{name:'team',value:'ops',isObjectTag:true}]}]})])});
 assert.equal(r.jobs.length,1);assert.equal(r.jobs[0].scopes[0].container,'bucket-a');assert.equal(r.jobs[0].scopes[0].inclusionTagMask[0].value,'ops');assert.equal(r.protection,'Configured only');
 assert.equal(row({servers:ev([server({type:'AmazonS3'})])}).jobs.length,0);
});
test('cache health does not infer online from configuration and uses valid capacity readings',()=>{
 assert.equal(row({repositoryStates:ev([])}).cacheLabel,'State not reported');
 assert.equal(row({repositoryStates:ev([{id:id(8),isOnline:false}])}).cacheLabel,'Offline');
 assert.equal(row({repositoryStates:ev([{id:id(8),capacityGB:100,freeGB:0,isOnline:true}])}).cacheLabel,'Capacity pressure');
 assert.equal(row({repositoryStates:ev([{id:id(8),capacityGB:0,freeGB:0}])}).cacheUsedPercent,null);
 assert.equal(row({repositoryStates:ev([{id:id(8),capacityGB:100,freeGB:101}])}).cacheUsedPercent,null);
 assert.equal(row({repositoryStates:ev([{id:id(8),isOnline:true,isOutOfDate:true}])}).cacheLabel,'Update required');
 assert.equal(row({repositoryStates:ev([{id:id(8)}])}).issues.unknown,true);
});
test('credential failures, missing required reference and optional access are separate',()=>{
 const unknown=row({credentials:ev([],{available:false,complete:false})});assert.equal(unknown.issues.credentials,false);assert.equal(unknown.issues.unknown,true);
 assert.equal(row({servers:ev([server({accessCredentialsId:null})])}).issues.credentials,true);
 assert.equal(row({servers:ev([server({type:'NFSShare',accessCredentialsRequired:null,accessCredentialsId:null})])}).issues.credentials,false);
 assert.equal(row({servers:ev([server({type:'AzureBlob',credentialsId:null})])}).issues.credentials,true);
});
test('zero restore points, disabled jobs and latest job warnings have independent filters',()=>{
 assert.equal(row({backups:ev([backup({restorePointsCount:0})])}).issues.noPoints,true);
 assert.equal(row({backups:ev([backup({restorePointsCount:null})])}).issues.noPoints,false);
 assert.equal(row({jobs:ev([job({isDisabled:true})])}).issues.disabled,true);
 assert.equal(row({jobStates:ev([{id:id(2),lastResult:'Warning'}])}).issues.jobs,true);
 assert.equal(row({jobStates:ev([])}).issues.jobs,false);
});
test('filters compose across type, category, protection, cache, jobs and metadata',()=>{
 const r=row();assert.equal(matches(r,{...defaults,query:'original description',type:'SMBShare',category:'File shares',protection:'Backup evidence',cache:'Online'}),true);
 assert.equal(matches(r,{...defaults,query:'*.tmp'}),false);
 assert.equal(matches(r,{...defaults,query:'selected'}),true);
 assert.equal(matches(r,{...defaults,type:'NFSShare'}),false);
 assert.equal(matches(row({servers:ev([server({type:null})])}),{...defaults,type:'Not reported'}),true);
 assert.equal(matches(r,{...defaults,issue:'unprotected'}),false);
 const rows=buildRows(snapshot({servers:ev([server({name:'Z'}),server({id:id(9),name:'A'})])}));
 assert.deepEqual(sorted(rows,'name').map(r=>r.name),['A','Z']);assert.deepEqual(sorted(rows,'nameDesc').map(r=>r.name),['Z','A']);
});
const reader=(overrides={})=>async path=>{
 const url=new URL(path,'https://vbr.invalid'),p=url.pathname;
 if(overrides[p])return overrides[p](url);
 if(p==='/api/v1/serverInfo')return {buildVersion:'13.1.0.411'};
 if(p==='/api/v1/inventory/unstructuredDataServers')return {data:[server()],pagination:{total:1}};
 if(p==='/api/v1/jobs')return {data:url.searchParams.get('typeFilter')==='FileBackup'?[job()]:[],pagination:{total:url.searchParams.get('typeFilter')==='FileBackup'?1:0}};
 if(p==='/api/v1/credentials/'+id(7))return {id:id(7),username:'user',description:'metadata'};
 if(p==='/api/v1/backupObjects')return {data:[backup()],pagination:{total:1}};
 return {data:[],pagination:{total:0}};
};
test('loader paginates servers, preserves API filters and deduplicates credential reads',async()=>{
 const calls=[];const get=reader({'/api/v1/inventory/unstructuredDataServers':url=>({data:[server({id:id(Number(url.searchParams.get('skip'))+10)})],pagination:{total:3}})});
 const data=await loadUnstructured(async(path,rev)=>{calls.push({path,rev});return get(path)},'Source');
 assert.equal(data.servers.data.length,3);assert.equal(data.servers.complete,true);
 assert.equal(calls.filter(c=>c.path.includes('/credentials/')).length,1);
 assert.ok(calls.filter(c=>c.path.startsWith('/api/v1/jobs?')).every(c=>c.path.includes('typeFilter=')));
 assert.ok(calls.find(c=>c.path.startsWith('/api/v1/backupObjects?')).path.includes('platformNameFilter=UnstructuredData'));
 assert.ok(calls.filter(c=>c.path!=='/api/v1/serverInfo').every(c=>c.rev==='1.3-rev2'));
});
test('loader preserves copies with identical object IDs in different backups',async()=>{
 const data=await loadUnstructured(reader({'/api/v1/backupObjects':()=>({data:[backup(),backup({backupId:id(5)})],pagination:{total:2}})}),'Source');
 assert.equal(data.backups.complete,true);assert.equal(data.backups.data.length,2);
});
test('optional read failures stay visible while primary source failures propagate',async()=>{
 const data=await loadUnstructured(reader({'/api/v1/backupObjects':()=>{throw new TopologyRequestError('Denied',403)}}),'Source');
 assert.equal(data.backups.available,false);assert.equal(buildRows(data)[0].protection,'Unknown');assert.ok(data.warnings.some(w=>w.includes('cannot read')));
 await assert.rejects(()=>loadUnstructured(reader({'/api/v1/inventory/unstructuredDataServers':()=>{throw new Error('down')}}),'Source'));
});
test('authentication failures propagate even for optional credential metadata',async()=>{
 await assert.rejects(()=>loadUnstructured(reader({['/api/v1/credentials/'+id(7)]:()=>{throw new TopologyRequestError('Expired',401)}}),'Source'),e=>e.status===401);
});
test('missing job scopes and repeated source pages never claim complete absence',async()=>{
 const data=await loadUnstructured(reader({'/api/v1/jobs':()=>({data:[job({objects:null})],pagination:{total:1}}),'/api/v1/inventory/unstructuredDataServers':()=>({data:[server()],pagination:{total:5}})}),'Source');
 assert.equal(data.jobs.complete,false);assert.equal(data.servers.complete,false);assert.ok(data.warnings.length>=2);
 const missing=await loadUnstructured(reader({'/api/v1/jobs':()=>({data:[job({objects:[{path:'share',fileServerId:null}]})],pagination:{total:1}}),'/api/v1/backupObjects':()=>({data:[],pagination:{total:0}})}),'Source');
 assert.equal(missing.jobs.complete,false);assert.equal(buildRows(missing)[0].protection,'Unknown');
});
test('cloud credentials retain only safe metadata and mismatched credential IDs are rejected',async()=>{
 const cloud=server({type:'S3Compatible',account:{friendlyName:'Store',credentialsId:id(9)}});
 const data=await loadUnstructured(reader({'/api/v1/inventory/unstructuredDataServers':()=>({data:[cloud]}),['/api/v1/cloudCredentials/'+id(9)]:()=>({id:id(9),type:'Amazon',description:'Storage credential',lastModified:'2026-01-01',accessKey:'secret',secretKey:'secret'})}),'Source');
 assert.equal(data.credentials.data[0].kind,'cloud');assert.equal(JSON.stringify(data).includes('secret'),false);
 const wrong=await loadUnstructured(reader({['/api/v1/credentials/'+id(7)]:()=>({id:id(99),username:'wrong'})}),'Source');
 assert.equal(wrong.credentials.data.length,0);assert.equal(wrong.credentials.complete,false);
});
