// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {storageCrumbs,pathWithin,storageFolders,sameStoragePath}=require('../lib/restore-points/storage-navigation.ts')

test('native NAS separators are displayed as breadcrumbs without changing outgoing paths',()=>{
  assert.deepEqual(storageCrumbs('mnt|backup|dashboards','|'),[
    {path:'mnt',label:'mnt'},{path:'mnt|backup',label:'backup'},{path:'mnt|backup|dashboards',label:'dashboards'}])
  assert.deepEqual(storageCrumbs('/mnt/a b','/'),[{path:'/mnt',label:'mnt'},{path:'/mnt/a b',label:'a b'}])
  assert.deepEqual(storageCrumbs('C:\\data\\reports','\\'),[{path:'C:\\',label:'C:'},{path:'C:\\data',label:'data'},{path:'C:\\data\\reports',label:'reports'}])
  assert.deepEqual(storageCrumbs('\\\\nas\\share\\reports','\\'),[{path:'\\\\nas\\share',label:'\\\\nas\\share'},{path:'\\\\nas\\share\\reports',label:'reports'}])
  assert.deepEqual(storageCrumbs('','|'),[])
})
test('reported compound roots stay intact and segment boundaries distinguish siblings',()=>{
  const root={path:'/mnt/backup',label:'Backup share'}
  assert.deepEqual(storageCrumbs('/mnt/backup/reports','/',[root]),[root,{path:'/mnt/backup/reports',label:'reports'}])
  assert.equal(pathWithin('mnt|backups','mnt|backup','|'),false)
  assert.equal(pathWithin('mnt|backup|docs','mnt|backup','|'),true)
  assert.equal(pathWithin('C:\\reports','C:\\','\\'),true)
  assert.equal(pathWithin('/DATA','/data','/'),false)
})
test('tree children preserve native paths while omitting files, links, duplicates and cycles',()=>{
  const items=[{type:'Folder',name:'docs'},{type:'Folder',name:'docs'},
    {type:'File',name:'file.txt'},{type:'Link',name:'linked'},
    {type:'Drive',name:'mnt|backup'},{type:'Folder',name:'backup',location:'mnt'}]
  assert.deepEqual(storageFolders(items,'mnt|backup','|'),[{path:'mnt|backup|docs',name:'docs',drive:false}])
  assert.deepEqual(storageFolders([{type:'Drive',name:'C:'}], '','\\'),[{path:'C:\\',name:'C:',drive:true}])
})

test('NAS leading-pipe aliases keep native child paths and the reported root breadcrumb',()=>{
  const root={path:'|mnt',label:'mnt'}
  assert.equal(pathWithin('mnt|backup','|mnt','|'),true)
  assert.equal(pathWithin('|mnt|backup','mnt','|'),true)
  assert.equal(pathWithin('mnt2|backup','|mnt','|'),false)
  assert.equal(sameStoragePath('|mnt','mnt','|'),true)
  assert.equal(sameStoragePath('||mnt','mnt','|'),true)
  assert.deepEqual(storageFolders([{type:'Folder',name:'backup',location:'mnt'}],'|mnt','|'),[
    {path:'mnt|backup',name:'backup',drive:false}])
  assert.deepEqual(storageCrumbs('mnt|backup','|',[root]),[root,{path:'mnt|backup',label:'backup'}])
  assert.deepEqual(storageCrumbs('|mnt|backup','|',[{path:'mnt',label:'mnt'}]),[
    {path:'mnt',label:'mnt'},{path:'|mnt|backup',label:'backup'}])
  assert.deepEqual(storageCrumbs('mnt','|',[root]),[root])
  assert.deepEqual(storageCrumbs('||mnt|backup','|',[root]),[root,{path:'||mnt|backup',label:'backup'}])
})

test('NAS aliases are deduplicated without creating self-cycles or changing UNC/POSIX identity',()=>{
  assert.deepEqual(storageFolders([{type:'Folder',name:'mnt',location:'|'},{type:'Folder',name:'mnt',location:''}],'','|'),[
    {path:'|mnt',name:'mnt',drive:false}])
  assert.deepEqual(storageFolders([{type:'Folder',name:'mnt',location:''},{type:'Drive',name:'|mnt'}],'|mnt','|'),[])
  assert.equal(sameStoragePath('/mnt','mnt','/'),false)
  assert.equal(sameStoragePath('\\\\nas\\share','\\nas\\share','\\'),false)
  assert.equal(sameStoragePath('|DATA','data','|'),false)
  assert.equal(sameStoragePath('mnt|','mnt','|'),false)
})
