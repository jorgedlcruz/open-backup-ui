// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports -- These tests run with Node's CommonJS test harness. */
const fs=require('node:fs'),ts=require('typescript'),{test}=require('node:test'),assert=require('node:assert/strict');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {breadcrumbsForPath,navigationLabels}=require('../lib/navigation/breadcrumbs.ts');
const {protectionColors,protectionTextColors,protectionStatusLabel}=require('../lib/protected-data/colors.ts');
const labels=path=>breadcrumbsForPath(path).map(item=>item.label);
const {sessionHomeFor,sessionHref}=require('../lib/navigation/recovery.ts');

test('session links and breadcrumbs preserve the entry section and source across related runs',()=>{
 for(const [root,tab] of [['/vbr/activity','Sessions'],['/vbr/recovery-center','Recovery Center']]){
  const href=sessionHref(sessionHomeFor(root+'/a'), 'b','source');
  assert.equal(href,root+'/b?sourceKey=source');
  for(const path of [root+'/a',root+'/preparing'])assert.deepEqual(breadcrumbsForPath(path).at(-2),{href:root,label:tab});
 }
 assert.equal(breadcrumbsForPath('/vbr/recovery-center/batches/b').at(-1).label,'VM recovery group');
 assert.equal(sessionHomeFor('/vbr/recovery-centerish/a'),'/vbr/activity');
});

test('primary VBR trails use the same platform and actual menu names',()=>{
 assert.deepEqual(labels('/vbr/jobs'),['Veeam Backup & Replication','Jobs & Policies']);
 assert.deepEqual(labels('/vbr/protected-data'),['Veeam Backup & Replication','Protected Data']);
 assert.deepEqual(labels('/vbr/topology'),['Veeam Backup & Replication','Protection Topology']);
 assert.deepEqual(labels('/analytics/alarms'),['Veeam ONE','Alarms Overview']);
 for(const [path,label] of Object.entries(navigationLabels))assert.equal(labels(path).at(-1),label,path);
});

test('Microsoft 365 recovery sessions have a route-specific breadcrumb and keep the center link',()=>{
 const home='/vbm/recovery-center',id='7708a5f1-aafc-4467-a8f0-eeb88b509609'
 const trail=breadcrumbsForPath(home+'/'+id.toUpperCase()+'/',{vbm:'Cloud Backup'})
 assert.deepEqual(trail,[{label:'Cloud Backup'},{label:'Recovery Center',href:home},{label:'Recovery session',reference:'7708a5f1'}])
 assert.equal(breadcrumbsForPath(home+'/'+id.replace('7708a5f1','12345678')).at(-1).reference,'12345678')
 assert.deepEqual(labels(home),['Veeam Backup for Microsoft 365','Recovery Center'])
 assert.deepEqual(labels(home+'/invalid'),[])
})
test('infrastructure, inventory and identity trails preserve their menu parents',()=>{
 assert.deepEqual(labels('/vbr/infrastructure/repositories'),['Veeam Backup & Replication','Backup Infrastructure','Backup Repositories']);
 assert.deepEqual(labels('/vbr/inventory/protection-groups'),['Veeam Backup & Replication','Inventory','Physical and Cloud']);
 assert.deepEqual(labels('/settings/identity/users'),['Settings','Identity','Users']);
});
test('detail pages link to the proper collection without exposing UUIDs as breadcrumb names',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 for(const [path,parent,last] of [
  ['/vbr/protected-data/restore-points','/vbr/protected-data','Restore Points'],
  ['/vbr/jobs/'+id,'/vbr/jobs','Job Investigation'],
  ['/vbr/workloads/'+id,'/vbr/protected-data','Workload Inspection'],
  ['/vbr/sessions/'+id,'/vbr/jobs','Session Investigation'],
  ['/vbm/jobs/'+id+'/sessions','/vbm/jobs','Session History'],
  ['/vbm/infrastructure/proxies/'+id,'/vbm/infrastructure/proxies','Proxy Details'],
 ]){const trail=breadcrumbsForPath(path);assert.equal(trail.at(-2).href,parent);assert.equal(trail.at(-1).label,last);assert.equal(JSON.stringify(trail).includes(id),false)}
});
test('saved report workspaces lead back to Saved Reports, not the catalog',()=>{
 assert.equal(breadcrumbsForPath('/analytics/reports/saved-123').at(-2).href,'/analytics/saved-reports');
 assert.equal(breadcrumbsForPath('/analytics/reports/template-123').at(-2).href,'/analytics/reports');
});
test('Lens views and job creation screens have specific names rather than generic Operations labels',()=>{
 assert.deepEqual(labels('/vbr/lens/capacity'),['Veeam Backup & Replication','Protection Lens','Capacity Watch']);
 assert.deepEqual(labels('/vbr/lens/operations'),['Veeam Backup & Replication','Protection Lens','Job Operations']);
 assert.equal(labels('/vbr/jobs/create-backup-copy').at(-1),'Create Backup Copy Job');
});
test('custom platform names follow the sidebar and unsupported paths do not invent a trail',()=>{
 assert.equal(breadcrumbsForPath('/vbm/protected-items',{vbm:'Cloud Backup'}).at(0).label,'Cloud Backup');
 assert.deepEqual(breadcrumbsForPath('/connect'),[]);
 assert.deepEqual(breadcrumbsForPath('/vbr/jobstuff'),[]);
 assert.deepEqual(labels('/vbr/jobs/'),labels('/vbr/jobs'));
});
test('RPO colors retain blue/orange semantics and never conflate absent points with an RPO breach',()=>{
 assert.equal(protectionColors['Within threshold'],'#0073e6');
 assert.equal(protectionColors['Outside threshold'],'#d95319');
 assert.notEqual(protectionColors['No restore points'],protectionColors['Outside threshold']);
 assert.equal(protectionStatusLabel('Within threshold'),'Within RPO');
 assert.equal(protectionStatusLabel('Outside threshold'),'Outside RPO');
 assert.equal(protectionStatusLabel('Unknown'),'Recovery age unknown');
});
test('HexMap text meets normal-text contrast on every semantic fill in either theme',()=>{
 const luminance=color=>color.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 for(const [status,fill] of Object.entries(protectionColors)){const a=luminance(fill),b=luminance(protectionTextColors[status]);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,status)}
});

test('settings sections link to the hub and Exit settings accepts only workspace locations',()=>{
 const {isSettingsPath,settingsReturnPath}=require('../lib/navigation/settings.ts');
 assert.deepEqual(breadcrumbsForPath('/settings/licensing'),[{label:'Settings',href:'/settings'},{label:'Licensing'}]);
 assert.deepEqual(labels('/settings/updates'),['Settings','Updates']);
 for(const path of ['/settings','/settings/licensing'])assert.equal(isSettingsPath(path),true);
 assert.equal(isSettingsPath('/settings-other'),false);
 assert.equal(settingsReturnPath('/vbm/jobs/a?filter=active#results'),'/vbm/jobs/a?filter=active#results');
 for(const invalid of [null,'//other.example/vbm','/\\other.example/vbr','https://other.example','/settings/licensing','/api/settings','/vbr/../settings'])assert.equal(settingsReturnPath(invalid),'/dashboard');
});
