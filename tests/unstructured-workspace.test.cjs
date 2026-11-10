// Open Backup UI v1.0.2
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)
const {storageView,storageEntry,storageSelectionValid,mergeStorageCart,readStorageCart,writeStorageValue,finishedStorageTask}=require('../lib/restore-points/unstructured-workspace.ts')
test('only exact live session classes can open a file workspace, including receipt handoff while history is delayed',()=>{
  assert.equal(storageView('UnstructuredDataBrowse'),'browse')
  assert.equal(storageView('FileInstantRecovery'),'instant')
  assert.equal(storageView('FileInstantRecoveryMigration','nas-instant'),undefined)
  assert.equal(storageView('NasRestore','object-files'),undefined)
  assert.equal(storageView(undefined,'nas-instant'),'instant')
  assert.equal(storageView(undefined,'object-files'),'browse')
})
test('storage paths honor native folder locations, drive roots, signed search scope and native separators',()=>{
  assert.deepEqual(storageEntry({type:'File',name:'report',location:'/data/share'},'other','/',true),{type:'File',path:'/data/share/report'})
  assert.equal(storageEntry({type:'File',name:'report'},'other','/',true),undefined)
  assert.equal(storageEntry({type:'Folder',name:'contracts'},'/data/share/','/').path,'/data/share/contracts')
  assert.equal(storageEntry({type:'Drive',name:'K:'},'','\\').path,'K:\\')
  assert.equal(storageEntry({type:'Unsupported',name:'r'},'','/'),undefined)
  assert.equal(storageSelectionValid([{type:'Drive',path:'/'}]),false)
})
test('cart preserves different versions, source and session bindings, and restricts historic writes to exactly one version',()=>{
  const values=new Map();global.sessionStorage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
  const scope={sourceKey:'a'.repeat(64),sessionId:'guid-a',view:'browse'}
  const item={path:'/docs/contract.pdf',type:'File'},v={...item,version:'2026-02-03T00:00:00Z'}
  const cart=mergeStorageCart([item],[v,item]);assert.equal(cart.length,2)
  assert.equal(storageSelectionValid(cart),false);assert.equal(storageSelectionValid([v]),true)
  assert.equal(storageSelectionValid(Array.from({length:201},()=>item)),false)
  writeStorageValue(scope,'cart',cart);assert.deepEqual(readStorageCart(scope),cart)
  assert.deepEqual(readStorageCart({...scope,sessionId:'guid-b'}),[])
  assert.deepEqual(readStorageCart({...scope,sourceKey:'b'.repeat(64)}),[])
  writeStorageValue(scope,'cart');assert.deepEqual(readStorageCart(scope),[]);delete global.sessionStorage
})
test('task results are usable only when VBR reports a completed successful or warning task',()=>{
  assert.equal(finishedStorageTask({state:'Working',result:'None'}),'working')
  assert.equal(finishedStorageTask({state:'Working',result:'Success'}),'working')
  assert.equal(finishedStorageTask({state:'Stopped',result:'None'}),'failed')
  assert.equal(finishedStorageTask({state:'Stopped',result:'Cancelled'}),'failed')
  assert.equal(finishedStorageTask({state:'Stopped',result:'Warning'}),'ready')
  assert.equal(finishedStorageTask({state:'Stopped',result:'Success'}),'ready')
})
