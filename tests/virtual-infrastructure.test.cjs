const fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildVirtualRows,power,sizeOrder,sortVirtual,matchesVirtual,memberVms,membershipIndex,itemKey,canQuickBackup,defaultVirtualFilters:defaults}=require('../lib/virtual-infrastructure/model.ts');
const {loadVirtualInventory}=require('../lib/virtual-infrastructure/load.ts');
const {TopologyRequestError}=require('../lib/topology/load.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const vm=(extra={})=>({name:'VM',type:'VirtualMachine',platform:'VSphere',hostName:'vc.example',objectId:'vm-1',urn:'vc:vc.example;datacenter:dc-1;cluster:c-1;hostsystem:h-1;vm:vm-1',powerState:'PoweredOn',size:'8.2 GB',...extra});
const backup=(extra={})=>({id:id(1),objectId:'vm-1',platformName:'VMware',path:'vc.example\\DC\\VM',restorePointsCount:4,lastRunFailed:false,...extra});
const ev=(data,extra={})=>({data,available:true,complete:true,...extra});
const snap=(items=[vm()],backups=[backup()],extra={})=>({inventory:ev(items),backups:ev(backups),...extra});
const container=(type,objectId,name,extra={})=>vm({type,objectId,name,...extra});
test('preserves exact sizes, DNS, guest OS and metadata while using documented power states',()=>{
 const r=buildVirtualRows(snap([vm({metadata:[{field:'dnsName',data:'vm.example'},{field:'GuestOS',data:'Ubuntu'},{field:'cpuCount',data:'4'}]})]))[0];
 assert.equal(r.item.size,'8.2 GB');assert.equal(r.dns,'vm.example');assert.equal(r.os,'Ubuntu');assert.equal(r.item.metadata.length,3);assert.equal(r.power,'Running');
 assert.equal(power(vm({powerState:'PoweredOff',isEnabled:true})),'Stopped');
 assert.equal(power(vm({powerState:'Suspended'})),'Suspended');
 assert.equal(power(vm({powerState:null,isEnabled:false})),'Disabled (legacy)');
 assert.equal(power(vm({powerState:null})),'Not reported');
});
test('numeric size ordering handles units, unknown sizes last, and preserves source strings',()=>{
 const rows=buildVirtualRows(snap([vm({objectId:'a',size:'8.2 GB'}),vm({objectId:'b',size:'1.2 TB'}),vm({objectId:'c',size:'900 MB'}),vm({objectId:'d',size:'N/A'})],[]));
 assert.deepEqual(sortVirtual(rows,'sizeDesc').map(r=>r.item.objectId),['b','a','c','d']);
 assert.deepEqual(sortVirtual(rows,'sizeAsc').map(r=>r.item.objectId),['c','a','b','d']);
 assert.equal(sizeOrder('1 GiB'),1073741824);assert.equal(sizeOrder('1,024 MB'),1024000000);
});
test('hierarchy IDs are scoped by platform and manager, including same IDs in another vCenter',()=>{
 const items=[vm(),container('Datacenter','dc-1','DC'),container('Cluster','c-1','Cluster'),container('Host','h-1','ESXi'),
  vm({hostName:'vc2.example',urn:'vc:vc2.example;datacenter:dc-1;cluster:c-1;hostsystem:h-1;vm:vm-1'}),container('Cluster','c-1','Other cluster',{hostName:'vc2.example'})];
 const rows=buildVirtualRows(snap(items));assert.equal(rows[0].datacenter.name,'DC');assert.equal(rows[0].cluster.name,'Cluster');assert.equal(rows[0].host.name,'ESXi');assert.equal(rows[4].cluster.name,'Other cluster');
 assert.equal(rows[0].protection,'Protected');assert.equal(rows[4].protection,'Unprotected');
 assert.equal(memberVms(rows[2],rows).length,1);assert.equal(memberVms(rows[3],rows).length,1);
});
test('ambiguous unscoped backup IDs never protect multiple vCenters',()=>{
 const rows=buildVirtualRows(snap([vm(),vm({hostName:'other.example'})],[backup({path:null})]));
 assert.deepEqual(rows.map(r=>r.protection),['Unknown','Unknown']);
 assert.equal(buildVirtualRows(snap([vm()],[backup({path:null})]))[0].protection,'Protected');
});
test('partial inventory prevents unsafe unscoped matching but preserves scoped positive evidence',()=>{
 const r=buildVirtualRows(snap([vm()],[],{inventory:ev([vm()],{complete:false}),backups:ev([backup({path:null})])}))[0];assert.equal(r.protection,'Unknown');
 assert.equal(buildVirtualRows(snap([vm()],[],{inventory:ev([vm()],{complete:false}),backups:ev([backup()])}))[0].protection,'Protected');
});
test('unbrowsed standalone registrations cannot establish uniqueness for pathless backup objects',()=>{
 const r=buildVirtualRows(snap([vm()],[backup({path:null})],{unscopedIdentityComplete:false}))[0];
 assert.equal(r.protection,'Unknown');
 assert.equal(buildVirtualRows(snap([vm()],[backup()],{unscopedIdentityComplete:false}))[0].protection,'Protected');
});
test('partial or denied backup evidence does not turn missing matches into unprotected',()=>{
 for(const evidence of [ev([],{complete:false}),ev([],{available:false,complete:false})])assert.equal(buildVirtualRows(snap([vm()],[],{backups:evidence}))[0].protection,'Unknown');
 assert.equal(buildVirtualRows(snap([vm()],[]))[0].protection,'Unprotected');
 assert.equal(buildVirtualRows(snap([vm({objectId:null})],[]))[0].protection,'Unknown');
 assert.equal(buildVirtualRows(snap([vm({platform:'Future'})],[]))[0].protection,'Unknown');
});
test('backup matching uses object identity and platform, never the VM name',()=>{
 assert.equal(buildVirtualRows(snap([vm()],[backup({objectId:'vm-2',name:'VM'})]))[0].protection,'Unprotected');
 assert.equal(buildVirtualRows(snap([vm()],[backup({platformName:'HyperV'})]))[0].protection,'Unprotected');
});
test('backup copies are retained separately and do not inflate VM counts; zero-point evidence is explicit',()=>{
 const r=buildVirtualRows(snap([vm(),vm()],[backup({restorePointsCount:0,lastRunFailed:true}),backup({id:id(2),restorePointsCount:5}),backup({id:id(2),restorePointsCount:5})]));
 assert.equal(r.length,1);assert.equal(r[0].backups.length,2);assert.equal(r[0].backupIssue,true);assert.equal(r[0].zeroPoints,false);
 assert.equal(buildVirtualRows(snap([vm()],[backup({restorePointsCount:0})]))[0].zeroPoints,true);
 assert.equal(buildVirtualRows(snap([vm()],[backup({restorePointsCount:null})]))[0].zeroPoints,false);
});
test('Hyper-V cluster parents are not mislabeled as hosts',()=>{
 const r=buildVirtualRows(snap([vm({platform:'HyperV',urn:null,parentObjectId:'cluster'}),container('Cluster','cluster','Cluster',{platform:'HyperV'})],[]))[0];
 assert.equal(r.host.name,'Not reported');
});
test('facets use OR within a selection, AND between fields, and support omission for counts',()=>{
 const rows=buildVirtualRows(snap([vm({metadata:[{field:'guestOsName',data:'Ubuntu'}]}),vm({objectId:'vm-2',powerState:'PoweredOff'})],[]));
 const f={...defaults,facets:{power:['Running','Stopped'],protection:['Unprotected']}};assert.equal(rows.filter(r=>matchesVirtual(r,f)).length,2);
 assert.equal(matchesVirtual(rows[0],{...f,facets:{...f.facets,power:['Stopped']}}),false);
 assert.equal(matchesVirtual(rows[0],{...f,facets:{...f.facets,power:['Stopped']}},'power'),true);
 assert.equal(matchesVirtual(rows[0],{...defaults,query:'ubuntu'}),true);
 assert.equal(matchesVirtual(rows[0],{...defaults,issue:'runningUnprotected'}),true);
});
test('quick backup is restricted to vSphere VMs with usable identity',()=>{
 assert.equal(canQuickBackup(vm()),true);for(const extra of [{type:'Template'},{platform:'HyperV'},{hostName:null},{objectId:null}])assert.equal(canQuickBackup(vm(extra)),false);
});
const root=()=>container('vCenterServer','vc-1','vc.example',{urn:'vc:vc.example'});
const read=async path=>path==='/api/v1/serverInfo'?{buildVersion:'13.1.0.411'}:{data:[backup()],pagination:{total:1}};
test('loader follows short inventory pages with reported totals and requests platform hierarchy',async()=>{
 const calls=[];
 const browse=async(host,skip,limit,revision,hierarchy)=>{calls.push({host,skip,limit,revision,hierarchy});return host ? {data:[vm({objectId:`vm-${skip}`})],pagination:{total:3}}:{data:[root()],pagination:{total:1}}};
 const r=await loadVirtualInventory(read,browse,'Source');
 assert.equal(r.inventory.complete,true);assert.equal(r.inventory.data.length,4);
 assert.deepEqual(calls.filter(c=>c.host).map(c=>c.skip),[0,1,2]);
 assert.ok(calls.every(c=>c.revision==='1.3-rev2'));assert.ok(calls.filter(c=>c.host).every(c=>c.hierarchy==='HostsAndClusters'));
});
test('repeated inventory pages terminate and surface partial evidence',async()=>{
 const browse=async host=>host?{data:[vm()],pagination:{total:3}}:{data:[root()],pagination:{total:1}};
 const r=await loadVirtualInventory(read,browse,'Source');assert.equal(r.inventory.complete,false);assert.ok(r.warnings.some(w=>w.includes('partial')));
});
test('failed server browse keeps root inventory and discloses partial coverage',async()=>{
 const r=await loadVirtualInventory(read,async host=>{if(host)throw new TopologyRequestError('Forbidden',403);return {data:[root()]};},'Source');
 assert.equal(r.inventory.data.length,1);assert.equal(r.inventory.complete,false);assert.ok(r.warnings.some(w=>w.includes('cannot read')));
});
test('authorization failure propagates instead of silently claiming partial evidence',async()=>{
 await assert.rejects(()=>loadVirtualInventory(read,async host=>{if(host)throw new TopologyRequestError('expired',401);return {data:[root()]};},'Source'),e=>e.status===401);
});
test('standalone ESXi registrations stay listed without duplicating managed-vCenter VMs',async()=>{
 const hosts=[];const r=await loadVirtualInventory(read,async host=>{hosts.push(host);return {data:host ? [vm()]:[root(),container('Host',null,'standalone',{hostName:'standalone',urn:'host:standalone'})]};},'Source');
 assert.deepEqual(hosts,[null,'vc.example']);assert.equal(r.inventory.data.length,3);
});
test('repeated protected-object IDs in different backups preserve both copies and complete pagination',async()=>{
 const copies=[backup({backupId:id(10),lastRunFailed:true,restorePointsCount:2}),backup({backupId:id(11),lastRunFailed:false,restorePointsCount:8})];
 const r=await loadVirtualInventory(async path=>path==='/api/v1/serverInfo'?{buildVersion:'13.1.0.411'}:{data:copies,pagination:{total:2}},async host=>({data:host?[vm()]:[root()]}),'Source');
 assert.equal(r.backups.complete,true);assert.equal(r.backups.data.length,2);
 const v=buildVirtualRows(r).find(r=>r.item.type==='VirtualMachine');
 assert.equal(v.backups.length,2);assert.equal(v.backupIssue,true);
 assert.deepEqual(v.backups.map(b=>b.restorePointsCount),[2,8]);
});
test('host-filter membership uses matching inventory IDs and remains unresolved when ambiguous',()=>{
 const v=vm({urn:'vc:vc.example;cluster:c-1;vm:vm-1'}),h=container('Host','h-1','host'),h2=container('Host','h-2','other');
 const links=[{vmKey:itemKey(v),hostKey:itemKey(h)}];
 const rows=buildVirtualRows(snap([v,h,h2],[],{hostLinks:ev(links)}));
 assert.equal(rows[0].host.name,'host');assert.equal(membershipIndex(rows).get(itemKey(h)).length,1);
 const ambiguous=buildVirtualRows(snap([v,h,h2],[],{hostLinks:ev([...links,{vmKey:itemKey(v),hostKey:itemKey(h2)}])}));
 assert.equal(ambiguous[0].host.name,'Not reported');
});
test('loader uses documented host membership filter and ignores foreign VM identities',async()=>{
 const v=vm({urn:'vc:vc.example;vm:vm-1'}),host=container('Host','h-1','host.example');
 const calls=[];
 const r=await loadVirtualInventory(async path=>{
   if(path.startsWith('/api/v1/inventory/vmware/hosts/')){
     calls.push(path);return {data:[v,vm({objectId:'foreign'})],pagination:{total:2}};
   }return read(path);
 },async h=>({data:h?[v,host]:[root()]}),'Source');
 assert.equal(r.hostLinks.data.length,1);assert.equal(buildVirtualRows(r).find(r=>r.item.objectId==='vm-1').host.name,'host.example');
 const query=new URL(calls[0],'https://vbr.invalid').searchParams;
 assert.equal(query.get('parentContainerNameFilter'),'host.example');assert.equal(query.get('typeFilter'),'VirtualMachine');assert.equal(query.get('hierarchyTypeFilter'),'HostsAndClusters');
});
