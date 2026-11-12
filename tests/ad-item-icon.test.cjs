// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {directoryIconKind}=require('../lib/restore-points/ad-item-icon.ts')

test('AD object classes have distinct glyphs independent of names and class capitalization',()=>{
  const object=(itemType,name='Administrator')=>({type:'item',itemType,name})
  for(const [itemType,kind] of [['User','user'],['group','group'],['COMPUTER','computer'],['organizationalUnit','unit'],
    ['groupPolicyContainer','policy'],['dnsNode','dns'],['contact','contact'],
    ['msDS-GroupManagedServiceAccount','serviceAccount'],['foreignSecurityPrincipal','principal']]){
    assert.equal(directoryIconKind(object(itemType)),kind)
  }
  assert.equal(directoryIconKind(object('unrecognized','DNS Computer Users')),'object')
})

test('AD containers stay distinct from accounts and use native section metadata',()=>{
  assert.equal(directoryIconKind({type:'domain',itemType:'User'}),'domain')
  assert.equal(directoryIconKind({type:'container',containerType:'UsersAndComputers'}),'folder')
  assert.equal(directoryIconKind({type:'container',containerType:'UsersAndComputers',itemType:'User'}),'folder')
  assert.equal(directoryIconKind({type:'container',containerType:'UsersAndComputers',itemType:'organizationalUnit'}),'unit')
  assert.equal(directoryIconKind({type:'container',containerType:'GroupPolicyObjects'}),'policyFolder')
  assert.equal(directoryIconKind({type:'container',containerType:'IntegratedDNS'}),'dns')
  assert.equal(directoryIconKind({type:'container',containerType:'ConfigurationPartition'}),'configuration')
  assert.equal(directoryIconKind({type:'container',containerType:'DfsConfiguration'}),'dfs')
  assert.equal(directoryIconKind({type:'container'}),'folder')
  assert.equal(directoryIconKind({type:'item'}),'object')
})
