// Open Backup UI v1.0.2
const fs = require('node:fs')
const ts = require('typescript')
const { test } = require('node:test')
const assert = require('node:assert/strict')
require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, path)
const { guestFiles, filesSchema } = require('../lib/recovery/files.ts')
const { guestCrumbs, addToCart, readWorkspace, workspaceKey, searchHasResults, guestRestoreBusy } = require('../lib/restore-points/guest-workspace.ts')
const sourceKey = 'a'.repeat(64)
const sessionId = '11111111-1111-4111-8111-111111111111'
const taskId = '22222222-2222-4222-8222-222222222222'
const key = 'a-test-signing-key'

test('Windows Keep and Linux Overwrite use native guest paths, validate defaults, and only submit after review', async()=>{
  const {guestItemPath}=require('../lib/restore-points/workflow.ts')
  for(const [type,restoreType,location,name,separator,expected] of [
    ['Windows','Keep','?\\Volume{42}\\reports','Q1 & Q2.txt','\\','\\\\?\\Volume{42}\\reports\\Q1 & Q2.txt'],
    ['Linux','Overwrite','/srv/data','Résumé 2026.txt','/','/srv/data/Résumé 2026.txt'],
  ]){
    const calls=[],paths=[guestItemPath({location,name,type:'File'},{path:'',pathSeparator:separator}),type==='Windows'?'D:\\second.txt':'/etc/hosts']
    assert.equal(paths[0],expected)
    const base='/api/v1/backupBrowser/flr/'+sessionId,native='/api/v1/restore/flr/'+sessionId
    const send=async(path,opts)=>{
      calls.push({path,opts})
      if(path===base)return {sessionId,type}
      if(path===native+'/validateCredentials')return {isSuccessful:true,message:'',credentialsId:taskId}
      if(path===native+'/validateRestoreItemTargetPath')return {isTargetPathNeeded:false,targetPath:''}
      if(path===base+'/restore')return {id:taskId,type:'FlrRestore',name:'Restore',state:'Starting',result:'None',progressPercent:0}
      if(path==='/api/v1/tasks/'+taskId)return {id:taskId,type:'FlrRestore',name:'Restore',state:'Stopped',result:'Failed',progressPercent:100,
        logs:{records:[{status:'Succeeded',title:'Preparations finished'},{status:'Failed',description:'Native guest write failure'}]}}
      throw Error('unexpected '+path)
    }
    const run=(action,extra={},scope='source-and-principal')=>guestFiles(send,sourceKey,filesSchema.parse({action,sourceKey,sessionId,sourcePaths:paths,restoreType,...extra}),key,scope)
    assert.deepEqual(await run('validateRestore'),{status:'ready'})
    const task=await run('restore')
    assert.deepEqual(calls.map(r=>r.path),[base,native+'/validateCredentials',native+'/validateRestoreItemTargetPath',base,native+'/validateCredentials',native+'/validateRestoreItemTargetPath',base+'/restore'])
    assert.deepEqual(calls[1].opts,{method:'POST',body:{restoreMode:'OriginalLocation'}})
    assert.deepEqual(calls[2].opts,{method:'POST',body:{isRestoreToOriginal:true,itemPath:expected}})
    assert.deepEqual(calls[6].opts,{method:'POST',mutation:true,body:{sourcePath:paths,restoreType}})
    assert.equal(calls.filter(r=>r.opts?.mutation).length,1)
    assert.ok(task.restoreKey)
    assert.equal((await run('task',{taskId,restoreKey:task.restoreKey})).message,'Native guest write failure')
    assert.equal((await run('task',{taskId})).message,undefined)
    await assert.rejects(run('task',{taskId,restoreKey:task.restoreKey},'another-account'),e=>e.status===409)
    await assert.rejects(run('task',{sessionId:taskId,taskId,restoreKey:task.restoreKey}),e=>e.status===409)
  }
})

test('a rejected guest credential or a changed path challenges before any final mutation; selected credential and confirmed directory are used',async()=>{
  const credId='33333333-3333-4333-8333-333333333333',otherId='44444444-4444-4444-8444-444444444444'
  const pointId='55555555-5555-4555-8555-555555555555'
  const calls=[],native='/api/v1/restore/flr/'+sessionId,base='/api/v1/backupBrowser/flr/'+sessionId
  let credentialType='Linux',changed=false
  const send=async(path,opts)=>{
    calls.push({path,opts})
    if(path===base)return {sessionId,type:'Windows',restorePointId:pointId}
    if(path==='/api/v1/restorePoints/'+pointId)return {id:pointId,guestOsFamily:'Linux'}
    if(path.startsWith('/api/v1/credentials?'))return {data:[
      {id:credId,type:'Linux',username:'ssh-user'},{id:otherId,type:'Standard',username:'windows-user'}],pagination:{skip:0,total:2}}
    if(path==='/api/v1/credentials/'+credId)return {id:credId,type:credentialType,username:'ssh-user'}
    if(path===native+'/validateCredentials')return {isSuccessful:opts.body.credentialsId===credId,message:'VBR guest logon failed',credentialsId:null}
    if(path===native+'/validateRestoreItemTargetPath')return {isTargetPathNeeded:!changed&&opts.body.itemPath.includes('renamed'),targetPath:'/mnt/target'}
    if(path===base+'/restore')return {id:taskId,type:'FlrRestore',state:'Starting',result:'None',progressPercent:0,name:'Restore'}
    throw Error('unexpected '+path)
  }
  const run=(action,extra={})=>guestFiles(send,sourceKey,filesSchema.parse({sessionId,sourceKey,sourcePaths:['/etc/hosts'],restoreType:'Overwrite',action,...extra}),key)
  assert.deepEqual(await run('restore'),{status:'credentialsRequired',message:'VBR guest logon failed'})
  assert.deepEqual(await run('credentials'),{credentials:[{id:credId,name:'ssh-user'}]})
  credentialType='ManagedService'
  assert.equal((await run('restore',{credentialsId:credId})).status,'credentialsRequired')
  credentialType='Linux'
  assert.deepEqual(await run('validateRestore',{credentialsId:credId}),{status:'ready'})
  // Changing the selection after the ready response must recheck the submitted paths.
  const plan={sourcePaths:['/renamed','/etc/hosts'],credentialsId:credId}
  assert.deepEqual(await run('restore',plan),{status:'targetPathRequired',targetPath:'/mnt/target'})
  assert.equal(calls.filter(r=>r.opts?.mutation).length,0)
  changed=true
  await assert.rejects(run('restore',{...plan,targetPath:'/approved'}),e=>e.status===409&&!e.uncertain)
  assert.equal(calls.filter(r=>r.opts?.mutation).length,0)
  changed=false
  await run('restore',{...plan,targetPath:'/approved'})
  assert.deepEqual(calls.at(-1),{path:base+'/restore',opts:{method:'POST',mutation:true,body:{sourcePath:plan.sourcePaths,restoreType:'Overwrite',credentialsId:credId,targetPath:'/approved'}}})
  assert.equal(calls.filter(r=>r.opts?.mutation).length,1)
})

test('Windows guest credentials on Linux mounts exclude gMSA; failed or unreadable preflights do not submit',async()=>{
  const pointId='55555555-5555-4555-8555-555555555555'
  let mode='path',guest='Windows',mountType='Linux'
  const send=async(path,opts)=>{
    assert.ok(!opts?.mutation)
    if(path.endsWith('/validateCredentials'))return mode==='credentials'?{ok:true}:{isSuccessful:true}
    if(path.endsWith('/validateRestoreItemTargetPath'))return {ok:true}
    if(path.includes('/restorePoints/'))return {id:pointId,guestOsFamily:guest}
    if(path.includes('/credentials?'))return {data:[{id:taskId,type:'Standard'},{id:sessionId,type:'ManagedService'}],pagination:{skip:0,total:2}}
    return {sessionId,type:mountType,restorePointId:pointId}
  }
  const run=action=>guestFiles(send,sourceKey,filesSchema.parse({sessionId,sourceKey,sourcePaths:['C:\\report.txt'],restoreType:'Keep',action}),key)
  assert.equal((await run('credentials')).credentials.length,1)
  mountType='Windows';assert.equal((await run('credentials')).credentials.length,2)
  await assert.rejects(run('restore'),e=>e.status===502&&!e.uncertain)
  mode='credentials';await assert.rejects(run('restore'),e=>e.status===502&&!e.uncertain)
})

test('asynchronous search tracks the returned VBR task, pages scoped results, and stops only its own task', async () => {
  const calls = []
  const searchTask = { id: taskId, type: 'FlrSearch', state: 'Working', result: 'None', progressPercent: 25, name: 'Find documents' }
  const base = '/api/v1/backupBrowser/flr/' + sessionId
  const send = async (path, options) => {
    calls.push({ path, options })
    if (path.includes('/tasks/') && path.endsWith('/stop')) return {}
    if (path === base + '/search' || path === '/api/v1/tasks/' + taskId) return searchTask
    if (path.includes('/search/') && path.endsWith('/browse')) return { path: '/home', searchString: '*.docx', items: [],
      pagination: { total: 200, count: 0, limit: 200, skip: 200 } }
    return { sessionId: path.split('/').pop(), type: 'Linux' }
  }
  const run = args => guestFiles(send, sourceKey, filesSchema.parse({ sourceKey, sessionId, ...args }), key)
  const search = await run({ action: 'search', path: '/home', query: '*.docx', recursive: false })
  assert.equal(search.id, taskId)
  assert.deepEqual(calls.at(-1).options.body, { path: '/home', searchString: '*.docx', disableRecursiveSearch: true })
  assert.equal(calls.at(-1).options.mutation, true)
  const receipt = { taskId, searchKey: search.searchKey }
  const status = await run({ action: 'searchStatus', ...receipt })
  assert.equal(status.progressPercent, 25)
  const page = await run({ action: 'searchResults', ...receipt, skip: 200 })
  assert.equal(page.pathSeparator, '/')
  assert.equal(calls.at(-1).path, base + '/search/' + taskId + '/browse')
  assert.equal(calls.at(-1).options.body.pagination.skip, 200)
  await assert.rejects(run({ action: 'stopSearch', ...receipt, sessionId: taskId }), /selected guest file mount/)
  await assert.rejects(run({ action: 'stopSearch', ...receipt, taskId: sessionId }), /selected guest file mount/)
  assert.equal(calls.filter(call => call.path.endsWith('/stop')).length, 0)
  await run({ action: 'stopSearch', ...receipt })
  assert.equal(calls.at(-1).path, '/api/v1/tasks/' + taskId + '/stop')
  searchTask.state = 'Stopped'
  searchTask.result = 'Cancelled'
  await run({ action: 'stopSearch', ...receipt })
  assert.equal(calls.filter(call => call.path.endsWith('/stop')).length, 1)
  assert.equal(searchHasResults(searchTask), false)
  assert.equal(searchHasResults({ ...searchTask, result: 'Success' }), true)
})

test('folder tree browsing requests only folders and drives using VBR filters', async () => {
  const calls = []
  const send = async (path, options) => {
    calls.push({ path, options })
    return options ? { path: '', items: [] } : { sessionId, type: 'Windows' }
  }
  await guestFiles(send, sourceKey, filesSchema.parse({ action: 'browse', sourceKey, sessionId, foldersOnly: true }))
  assert.deepEqual(calls.at(-1).options.body.filter, { itemTypes: ['Drive', 'Folder'] })
  assert.equal(calls.at(-1).options.body.path, '')
})

test('ZIP preparation, cancellation and delivery bind to the selected source, mount, task type and successful completion', async () => {
  const base = '/api/v1/backupBrowser/flr/' + sessionId
  const task = { id: taskId, type: 'FlrDownload', state: 'Working', result: 'None', progressPercent: 35, name: 'Archive' }
  const calls = []
  const stream = new Response(new Uint8Array([80, 75]))
  const send = async (path, options) => {
    calls.push({ path, options })
    if (path === base + '/prepareDownload' || path === '/api/v1/tasks/' + taskId) return task
    if (path.endsWith('/stop')) return {}
    if (path.endsWith('/download')) return stream
    return { sessionId: path.split('/').pop(), type: 'Windows' }
  }
  const run = args => guestFiles(send, sourceKey, filesSchema.parse({ sourceKey, sessionId, ...args }), key)
  const issued = await run({ action: 'prepareDownload', sourcePaths: ['/first','/second'] })
  assert.deepEqual(calls.at(-1).options.body, { sourcePath: ['/first','/second'] })
  const receipt = { taskId, downloadKey: issued.downloadKey }
  await assert.rejects(run({ action: 'streamDownload', ...receipt }), /not ready/)
  await assert.rejects(run({ action: 'streamDownload', ...receipt, sessionId: taskId }), /selected guest file mount/)
  await assert.rejects(run({ action: 'stopSearch', taskId, searchKey: issued.downloadKey }), /selected guest file mount/)
  assert.equal(calls.filter(call => call.path.endsWith('/download') || call.path.endsWith('/stop')).length, 0)
  await run({ action: 'stopDownload', ...receipt })
  assert.equal(calls.at(-1).path, '/api/v1/tasks/' + taskId + '/stop')
  task.state = 'Stopped'; task.result = 'Success'
  const result = await run({ action: 'streamDownload', ...receipt })
  assert.strictEqual(result, stream)
  assert.deepEqual(calls.at(-1), { path: base + '/prepareDownload/' + taskId + '/download', options: {method:'POST', archive:true} })
  task.type = 'FlrRestore'
  await assert.rejects(run({ action: 'streamDownload', ...receipt }), /unavailable/)
})

test('guest carts survive reload scoped to mount and source and remove nested selections', () => {
  const folder = { path: '/home/ops', type: 'Folder' }
  const first = { path: '/home/ops/doc.txt', type: 'File' }
  const other = { path: '/etc/hosts', type: 'File' }
  let cart = addToCart([], first, '/')
  cart = addToCart(cart, other, '/')
  cart = addToCart(cart, folder, '/')
  assert.deepEqual(cart, [other, folder])
  assert.deepEqual(addToCart(cart, first, '/'), cart)
  assert.deepEqual(readWorkspace(JSON.stringify({cart,path:'/etc'})), {cart,path:'/etc'})
  assert.notEqual(workspaceKey(sourceKey,sessionId),workspaceKey(sourceKey,taskId))
  assert.notEqual(workspaceKey(sourceKey,sessionId),workspaceKey('b'.repeat(64),sessionId))
  assert.deepEqual(readWorkspace('broken data'), { cart: [] })
  const win = [{path:'C:\\Users\\Ops',type:'Folder'}]
  assert.deepEqual(addToCart(win, {path:'c:\\users\\OPS\\doc.txt',type:'File'}, '\\'), win)
  assert.deepEqual(guestCrumbs('C:\\Users\\Ops', '\\').map(x => x.path), ['C:\\','C:\\Users','C:\\Users\\Ops'])
  assert.deepEqual(guestCrumbs('/home/ops','/').map(x=>x.path), ['/home','/home/ops'])
})

test('reopening a cart preserves the destination and requires explicit review of an interrupted submission', () => {
  const cart = [{ path: '/home/report', type: 'File' }]
  const receipt = { phase: 'sending', count: 1, target: 'Destination VM', folder: '/srv/recovered', policy: 'Keep' }
  const pending = readWorkspace(JSON.stringify({ cart, restore: receipt }))
  assert.deepEqual(pending, { cart, restore: { ...receipt, phase: 'unconfirmed' } })
  assert.equal(guestRestoreBusy(pending), true)
  assert.equal(guestRestoreBusy({ ...pending, restore: undefined }), false)
  const accepted = { ...receipt, phase: 'accepted' }
  assert.equal(guestRestoreBusy({ cart, restore: accepted, task: { id: taskId, state: 'Working' } }), true)
  assert.equal(guestRestoreBusy({ cart, restore: accepted, task: { id: taskId, state: 'Stopped', result: 'Success' } }), false)
})

test('guest cart refresh keeps the exact failed task, scoped key, and provider explanation', () => {
  const receipt = { phase: 'accepted', count: 2, policy: 'Overwrite' }
  const task = { id: taskId, state: 'Stopped', result: 'Failed', progressPercent: 12, message: 'Disk full on mounted guest.', restoreKey: 'scoped-flr-task' }
  assert.deepEqual(readWorkspace(JSON.stringify({ cart: [], restore: receipt, task })), { cart: [], restore: receipt, task })
  const legacy = { id: taskId, state: 'Working', progressPercent: 5 }
  assert.deepEqual(readWorkspace(JSON.stringify({ cart: [], task: legacy })).task, legacy)
})
