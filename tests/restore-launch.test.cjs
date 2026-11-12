// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file)
const path = require.resolve('../lib/restore-points/launch.ts')
const { restoreActivityUrl, restoreOperations } = require('../lib/restore-points/workflow.ts')
const sourceKey = '1'.repeat(64)
const id = '11111111-1111-4111-8111-111111111111'
function freshClient() {
  delete require.cache[path]
  return require(path)
}
function newTab() {
  let value
  global.sessionStorage = { getItem: () => value, setItem: (_, next) => { value = next } }
  return freshClient()
}

test('the native unstructured write receives the durable Recovery Center request ID',async()=>{
  const launch=newTab()
  let submitted
  const receipt=launch.beginRestoreLaunch({sourceKey,operation:'nas-entire'},'Share',undefined,async(draft,requestId)=>{
    submitted={...draft,requestId};return {id,sourceKey}
  })
  await launch.observeRestoreLaunch(receipt.requestId)
  assert.deepEqual(submitted,{sourceKey,operation:'nas-entire',requestId:receipt.requestId})
  assert.equal(freshClient().readRestoreLaunch(receipt.requestId).sessionId,id)
})

test('every supported operation hands off its exact session, and observers never resubmit', async () => {
  const launch = newTab()
  for (const operation of [...restoreOperations, launch.activeDirectoryOperation, launch.sqlOperation]) {
    const draft = { sourceKey, restorePointId: id, backupId: id, operation, mode: 'OriginalLocation' }
    let calls = 0, resolve
    const request = launch.beginRestoreLaunch(draft, 'VM A', undefined, input => {
      assert.equal(input, draft)
      calls++
      return new Promise(ready => { resolve = ready })
    })
    const first = launch.observeRestoreLaunch(request.requestId)
    const remount = launch.observeRestoreLaunch(request.requestId)
    await Promise.resolve()
    assert.equal(calls, 1)
    assert.equal(launch.readRestoreLaunch(request.requestId).phase, 'starting')
    const refreshed = freshClient()
    assert.equal((await refreshed.observeRestoreLaunch(request.requestId)).phase, 'unknown')
    const mountErrors = [{type:'Mount', message:'One disk could not be mounted'}]
    resolve({ id, sourceKey, mountErrors })
    assert.deepEqual(await first, await remount)
    const receipt = await refreshed.observeRestoreLaunch(request.requestId)
    assert.equal(receipt.sessionId, id)
    assert.deepEqual(receipt.mountErrors, mountErrors)
    assert.equal(refreshed.findSessionLaunch(sourceKey, id).sourceKey, sourceKey)
    assert.equal(refreshed.findSessionLaunch('a'.repeat(64), id), undefined)
    assert.equal(restoreActivityUrl(receipt.sessionId, receipt.sourceKey), '/vbr/activity/' + id + '?sourceKey=' + sourceKey)
    assert.equal(calls, 1)
  }
})

test('lost responses and mismatched sources remain unconfirmed, while explicit rejections preserve their reason', async () => {
  const launch = newTab()
  for (const [outcome, phase] of [
    [() => Promise.reject(new TypeError('Network failure')), 'unknown'],
    [() => Promise.reject(Object.assign(new Error('Lost confirmation'), {uncertain: true})), 'unknown'],
    [async () => ({id, sourceKey:'a'.repeat(64)}), 'unknown'],
    [async () => ({sourceKey}), 'unknown'],
    [async () => { throw new Error('The selected target changed.') }, 'rejected'],
  ]) {
    const request = launch.beginRestoreLaunch({ sourceKey, restorePointId:id, backupId:id, operation:'StartFlrRestore', mode:'OriginalLocation' }, 'VM', undefined, outcome)
    const result = await launch.observeRestoreLaunch(request.requestId)
    assert.equal(result.phase, phase)
    assert.equal(result.sessionId, undefined)
    if (phase === 'rejected') assert.equal(result.message, 'The selected target changed.')
  }
})

test('single restore handoff recovers a lost response using only its exact durable status',async()=>{
  const launch=newTab(),calls=[]
  const draft={sourceKey,restorePointId:id,backupId:id,operation:'StartFlrRestore',mode:'OriginalLocation'}
  const io={wait:async()=>{},send:async(address,input)=>{
    calls.push(input?'start':'status')
    assert.equal(address.sourceKey,sourceKey);assert.equal(address.operation,draft.operation)
    if(input){assert.deepEqual(input,draft);throw new TypeError('Failed to fetch')}
    return {...address,phase:calls.length===2?'starting':'accepted',sessionId:id,mountErrors:[{type:'Mount',message:'Partial mount'}]}
  }}
  const receipt=launch.beginTrackedRestoreLaunch(draft,'Computer',undefined,io)
  const result=await launch.observeRestoreLaunch(receipt.requestId,undefined,io)
  assert.equal(result.sessionId,id);assert.equal(result.mountErrors[0].message,'Partial mount')
  assert.deepEqual(calls,['start','status','status'])
  assert.match(launch.recoveryPreparingHref(receipt),/provider=StartFlrRestore/)
  assert.doesNotMatch(global.sessionStorage.getItem('open-backup-ui.restore-launches'),/restorePointId|backupId|OriginalLocation/)
})

test('single restores survive hard reload without replay, and late transport errors cannot undo an accepted receipt',async()=>{
  const original=newTab(),calls=[]
  let lostResponse
  const draft={sourceKey,restorePointId:id,backupId:id,operation:'StartViVMInstantRecovery',mode:'OriginalLocation'}
  const request=original.beginTrackedRestoreLaunch(draft,'VM',undefined,{wait:async()=>{},send:async(address,input)=>{
    calls.push(input?'start':'status')
    if(input)return new Promise(resolve=>{lostResponse=resolve})
    return {...address,phase:'unknown'}
  }})
  await Promise.resolve()
  const refreshed=freshClient(),io={wait:async()=>{},send:async(address,input)=>{
    assert.equal(input,undefined);calls.push('status');return {...address,phase:'accepted',sessionId:id}
  }}
  assert.equal(refreshed.readRestoreLaunch(request.requestId).phase,'starting')
  const first=refreshed.observeRestoreLaunch(request.requestId,undefined,io),second=refreshed.observeRestoreLaunch(request.requestId,undefined,io)
  assert.equal(first,second);assert.equal((await first).sessionId,id)
  const old=original.observeRestoreLaunch(request.requestId)
  lostResponse({});assert.equal((await old).phase,'accepted')
  assert.equal(freshClient().readRestoreLaunch(request.requestId).sessionId,id)
  assert.equal(calls.filter(value=>value==='start').length,1)
  const empty=newTab()
  const reopened=await empty.observeAddressedLaunch(request.requestId,sourceKey,draft.operation,undefined,io)
  assert.equal(reopened.sessionId,id);assert.equal(reopened.restoreTracked,true)
})

test('single restore status rejects foreign bindings and only known preflight failures are retryable',async()=>{
  const {resolveRestoreHandoff}=require('../lib/restore-points/restore-handoff.ts')
  const address={sourceKey,requestId:id,operation:'StartEntireVmRestore'}
  for(const wrong of [{sourceKey:'f'.repeat(64)},{requestId:'22222222-2222-4222-8222-222222222222'},{operation:'StartFlrRestore'},{sessionId:'invalid'}]){
    const calls=[]
    const outcome=await resolveRestoreHandoff(address,undefined,{wait:async()=>{},send:async(_address,draft)=>{
      calls.push(draft);return {...address,phase:'accepted',sessionId:id,...wrong}
    }})
    assert.equal(outcome.phase,'unknown');assert.ok(calls.every(value=>value===undefined));assert.ok(calls.length<7)
  }
  const rejected=await resolveRestoreHandoff(address,{...address,restorePointId:id,backupId:id,mode:'OriginalLocation'},{wait:async()=>{},send:async(_address,draft)=>{
    if(draft)throw Object.assign(new Error('Review malware status.'),{uncertain:false})
    throw Object.assign(new Error('Not found'),{status:404})
  }})
  assert.deepEqual(rejected,{phase:'rejected',message:'Review malware status.'})
})

test('Recovery Center observes in-flight receipts only for this source and ages out old launches',async t=>{
  const launch=newTab(),windowBefore=global.window
  global.window=new EventTarget()
  t.after(()=>{if(windowBefore===undefined)delete global.window;else global.window=windowBefore})
  const phases=[]
  global.window.addEventListener('restore-launch-change',()=>phases.push(launch.recentRestoreLaunches(sourceKey)[0]?.phase))
  let finish
  const started=launch.beginRestoreLaunch({sourceKey,operation:'StartFlrRestore'},'test VM',undefined,()=>new Promise(resolve=>{finish=resolve}))
  await Promise.resolve()
  assert.deepEqual(phases,['starting'])
  assert.deepEqual(launch.recentRestoreLaunches('c'.repeat(64)),[])
  assert.deepEqual(launch.recentRestoreLaunches(sourceKey,Date.parse(started.createdAt)+86400001),[])
  finish({sourceKey,id});await launch.observeRestoreLaunch(started.requestId)
  assert.deepEqual(phases,['starting','accepted'])
})

const explorerSelection={sourceKey,restorePointId:id,backupId:'22222222-2222-4222-8222-222222222222',backupObjectId:'33333333-3333-4333-8333-333333333333',reviewedMalwareStatus:'Suspicious'}
const skipWait=async()=>{}

test('a definite Explorer rejection offers the same point for review without resubmitting the failed request',async()=>{
  const launch=newTab(),calls=[]
  const io={wait:skipWait,send:async(_provider,c)=>{
    calls.push(c.action)
    return {sourceKey,requestId:c.requestId,requestStatus:'failed',error:'Explorer was not started.'}
  }}
  const start=launch.beginExplorerLaunch({...explorerSelection,operation:'BrowseActiveDirectory'},'AD-DNS-001',undefined,io)
  const rejected=await launch.observeRestoreLaunch(start.requestId,io)
  const href=new URL(launch.explorerRetryHref(rejected),'https://fixture.test')
  assert.equal(href.pathname,'/vbr/recovery-center')
  assert.equal(href.searchParams.get('recover'),'active-directory')
  assert.equal(href.searchParams.get('sourceKey'),sourceKey)
  assert.equal(href.searchParams.get('objectId'),explorerSelection.backupObjectId)
  assert.equal(href.searchParams.get('restorePointId'),explorerSelection.restorePointId)
  for(const phase of ['starting','unknown','accepted'])assert.equal(launch.explorerRetryHref({...rejected,phase}),undefined)
  assert.deepEqual(calls,['start'])
  await launch.observeRestoreLaunch(start.requestId,io)
  assert.deepEqual(calls,['start'])
})

test('a new explicit review can recover a lost outbound POST using the original reservation',async()=>{
  const launch=newTab(),click={...explorerSelection,operation:'BrowseActiveDirectory'}
  const starts=[]
  const io={wait:skipWait,send:async(_provider,command)=>{
    if(command.action==='status')return {sourceKey,requestId:command.requestId,requestStatus:'missing'}
    assert.equal(command.action,'start')
    starts.push(command.requestId)
    if(starts.length===1)throw new TypeError('Failed to fetch')
    return {sourceKey,requestId:command.requestId,requestStatus:'ready',sessionId:id}
  }}
  const original=launch.beginExplorerLaunch(click,'AD',undefined,io)
  assert.equal((await launch.observeRestoreLaunch(original.requestId,io)).phase,'unknown')
  assert.deepEqual(starts,[original.requestId])
  const reviewed=launch.beginExplorerLaunch(click,'AD',undefined,io)
  assert.equal((await launch.observeRestoreLaunch(reviewed.requestId,io)).sessionId,id)
  assert.deepEqual(starts,[original.requestId,original.requestId])
})

test('AD and SQL launches recover a lost start response by exact scoped request ID and never start again',async()=>{
  for(const [operation,provider,objectField] of [['BrowseActiveDirectory','ad','backupObjectId'],['BrowseSql','sql-explorer','objectId']]){
    const launch=newTab(),calls=[]
    const io={wait:skipWait,send:async(actual,command)=>{
      assert.equal(actual,provider);calls.push(command)
      if(command.action==='start'){
        assert.equal(command[objectField],explorerSelection.backupObjectId)
        assert.equal(command.reviewedMalwareStatus,'Suspicious')
        throw new TypeError('Failed to fetch')
      }
      assert.deepEqual(Object.keys(command).sort(),['action','requestId','sourceKey'])
      return {sourceKey,requestId:command.requestId,requestStatus:'ready',sessionId:id}
    }}
    const receipt=launch.beginExplorerLaunch({...explorerSelection,operation},'AD SQL',undefined,io)
    const duplicate=launch.beginExplorerLaunch({...explorerSelection,operation},'AD SQL',undefined,io)
    assert.equal(duplicate.requestId,receipt.requestId)
    assert.equal((await launch.observeRestoreLaunch(receipt.requestId,io)).sessionId,id)
    assert.deepEqual(calls.map(c=>c.action),['start','status'])
    assert.ok(calls.every(c=>c.requestId===receipt.requestId&&c.sourceKey===sourceKey))
  }
})

test('a hard reload and two observers resume only status/poll, even while the original start response is in flight',async()=>{
  const original=newTab(),calls=[]
  let lostResponse
  const submit={...explorerSelection,operation:'BrowseSql'}
  const request=original.beginExplorerLaunch(submit,'SQL',undefined,{wait:skipWait,send:async(_provider,c)=>{
    calls.push(c.action)
    if(c.action==='start')return new Promise(resolve=>{lostResponse=resolve})
    return {requestId:c.requestId,sourceKey,requestStatus:'unknown'}
  }})
  await Promise.resolve()
  const refreshed=freshClient(),io={wait:skipWait,send:async(p,c)=>{
    assert.equal(p,'sql-explorer');calls.push(c.action);assert.equal(c.requestId,request.requestId)
    if(c.action==='status')return {requestId:c.requestId,sourceKey,requestStatus:'pending',pending:'secret-signed-task'}
    assert.equal(c.action,'poll');assert.equal(c.pending,'secret-signed-task')
    return {sourceKey,sessionId:id}
  }}
  assert.equal(refreshed.readRestoreLaunch(request.requestId).phase,'starting')
  assert.equal(refreshed.beginExplorerLaunch(submit,'SQL',undefined,io).requestId,request.requestId)
  const a=refreshed.observeRestoreLaunch(request.requestId,io),b=refreshed.observeRestoreLaunch(request.requestId,io)
  assert.equal(a,b);assert.equal((await a).phase,'accepted')
  assert.deepEqual(calls,['start','status','poll'])
  assert.doesNotMatch(global.sessionStorage.getItem('open-backup-ui.restore-launches'),/secret-signed-task|Suspicious/)
  const previous=original.observeRestoreLaunch(request.requestId)
  lostResponse({});assert.equal((await previous).phase,'accepted')
  assert.equal(freshClient().readRestoreLaunch(request.requestId).sessionId,id)
})

test('poll errors retrieve the tracked result; only an explicit terminal failure is rejected',async()=>{
  const launch=newTab(),calls=[]
  const io={wait:skipWait,send:async(_p,c)=>{
    calls.push(c.action)
    if(c.action==='start')return {sourceKey,pending:'signed-start-task'}
    if(c.action==='poll')throw Object.assign(new Error('Request interrupted'),{uncertain:false})
    return {sourceKey,requestId:c.requestId,requestStatus:'failed',error:'VBR could not mount this backup.'}
  }}
  const receipt=launch.beginExplorerLaunch({...explorerSelection,operation:'BrowseActiveDirectory'},'AD',undefined,io)
  const final=await launch.observeRestoreLaunch(receipt.requestId,io)
  assert.deepEqual(calls,['start','poll','status'])
  assert.equal(final.phase,'rejected');assert.equal(final.message,'VBR could not mount this backup.');assert.equal(launch.canCheckExplorerLaunch(final),false)
  const second=launch.beginExplorerLaunch({...explorerSelection,operation:'BrowseActiveDirectory'},'AD',undefined,{wait:skipWait,send:async(_provider,c)=>{
    if(c.action==='start')throw Object.assign(new Error('Review changed malware status.'),{uncertain:false})
    assert.equal(c.action,'status');return {sourceKey,requestId:c.requestId,requestStatus:'missing'}
  }})
  assert.notEqual(second.requestId,receipt.requestId)
  assert.equal((await launch.observeRestoreLaunch(second.requestId)).phase,'rejected')
})

test('missing, foreign and inaccessible receipts stay unconfirmed and can be checked again after reconnection',async()=>{
  for(const failure of ['missing','foreign-source','foreign-request','unreachable']){
    const launch=newTab(),calls=[]
    const io={wait:skipWait,send:async(_p,c)=>{
      calls.push(c.action)
      if(c.action==='start'||failure==='unreachable')throw new TypeError('Failed to fetch')
      return {sourceKey:failure==='foreign-source'?'f'.repeat(64):sourceKey,requestId:failure==='foreign-request'?id:c.requestId,
        requestStatus:failure==='missing'?'missing':'ready',sessionId:id}
    }}
    const request=launch.beginExplorerLaunch({...explorerSelection,operation:'BrowseActiveDirectory'},'AD',undefined,io)
    const lost=await launch.observeRestoreLaunch(request.requestId,io)
    assert.equal(lost.phase,'unknown');assert.equal(lost.sessionId,undefined);assert.ok(launch.canCheckExplorerLaunch(lost))
    assert.equal(calls.filter(c=>c==='start').length,1);assert.ok(calls.length<9)
    const reload=freshClient()
    assert.equal((await reload.observeRestoreLaunch(request.requestId,{wait:skipWait,send:async(_p,c)=>{
      assert.equal(c.action,'status');return {sourceKey,requestId:c.requestId,requestStatus:'ready',sessionId:id}
    }})).phase,'accepted')
  }
})

test('historical Explorer network diagnostics remain visible as unconfirmed without probing or resubmitting them',async()=>{
  const launch=newTab(),receipt={requestId:id,sourceKey,operation:'BrowseActiveDirectory',workload:'AD-DNS-001',phase:'rejected',message:'Failed to fetch'}
  for(const operation of ['BrowseActiveDirectory','BrowseSql']){
    global.sessionStorage.setItem('open-backup-ui.restore-launches',JSON.stringify([{...receipt,operation}]))
    const old=await launch.observeRestoreLaunch(id,{send:()=>{throw Error('Legacy requests cannot be correlated')}})
    assert.equal(old.phase,'unknown');assert.equal(launch.canCheckExplorerLaunch(old),false)
    assert.equal(launch.recentRestoreLaunches(sourceKey)[0].phase,'unknown')
  }
  for(const unchanged of [{...receipt,message:'VBR denied access.'},{...receipt,operation:'StartFlrRestore'}]){
    global.sessionStorage.setItem('open-backup-ui.restore-launches',JSON.stringify([unchanged]))
    assert.equal(launch.readRestoreLaunch(id).phase,'rejected')
  }
})

test('an addressed Recovery Center request in a new tab observes only the exact server receipt',async()=>{
  const launch=newTab(),sent=[]
  const silent={send:async(provider,body)=>{sent.push(body.action);assert.equal(provider,'ad');assert.equal(body.requestId,id);assert.equal(body.sourceKey,sourceKey);return {...body,requestStatus:'ready',sessionId:id}}}
  const address=launch.recoveryPreparingHref({sourceKey,operation:'BrowseActiveDirectory',requestId:id})
  assert.match(address,/^\/vbr\/recovery-center\/preparing\?/);assert.match(address,/provider=ad/)
  const seen=await launch.observeAddressedLaunch(id,sourceKey,'ad',silent)
  assert.equal(seen.sessionId,id);assert.deepEqual(sent,['status'])
  assert.equal(await launch.observeAddressedLaunch(id,'2'.repeat(64),'ad',silent),undefined)
  assert.equal(await launch.observeAddressedLaunch(id,sourceKey,'sql-explorer',silent),undefined)
  assert.deepEqual(sent,['status'])
})
