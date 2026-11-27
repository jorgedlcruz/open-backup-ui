// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const {recoveryTransport,RestoreStatisticsPendingError}=require('../lib/vbm-recovery/transport.ts')
const {readRetryDelay}=require('../lib/vbm-recovery/read-retry.ts')
const path='/v8/RestoreSessions/11111111-1111-4111-8111-111111111111'
const options={baseUrl:'https://vbm.test',token:'secret',refresh:async()=>null}
const json=value=>Response.json(value)

test('native Explorer POST waits for a slow acknowledgement after the browser disconnects',async t=>{
  const http=require('node:http'),received=[]
  const server=http.createServer((req,res)=>{
    req.setEncoding('utf8')
    let body=''
    req.on('data',chunk=>body+=chunk)
    req.on('end',()=>{
      received.push([req.method,req.url,JSON.parse(body)])
      setTimeout(()=>{res.writeHead(201);res.end(JSON.stringify({id:'confirmed-session'}))},75)
    })
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>{server.closeAllConnections();server.close()})
  const inbound=new AbortController(),execute=recoveryTransport({...options,baseUrl:'http://127.0.0.1:'+server.address().port,signal:inbound.signal,writeTimeoutMs:15,browseStartTimeoutMs:2000})
  const url='/v8/Organizations/example/explore',result=execute(url,'POST',{type:'Vex'})
  inbound.abort()
  assert.deepEqual(await result,{id:'confirmed-session'})
  assert.deepEqual(received,[['POST',url,{type:'Vex'}]])
})

test('the extended mutation deadline is exclusive to administrator browse starts',async t=>{
  const timeouts=[],timer=setTimeout
  t.mock.method(global,'setTimeout',(fn,ms,...args)=>{timeouts.push(ms);return timer(fn,ms,...args)})
  const execute=recoveryTransport({...options,fetcher:async()=>json({accepted:true})})
  for(const resource of ['/v8/Organizations/o/explore','/v8/BackupRepositories/r/explore?organizationId=o','/v8/DataRetrievals/r/explore',path+'/organization/mailboxes/o/items/restoreTo',path+'/Stop'])await execute(resource,'POST')
  assert.deepEqual(timeouts,[1800000,1800000,1800000,180000,180000])
  await assert.rejects(execute('/v8/Organization/OperatorExplore','POST'),/Unsupported recovery resource/)
})

test('Exchange mailbox, folder and message listings allow for cold repository reads',async t=>{
  const timeouts=[]
  const timer=setTimeout
  t.mock.method(global,'setTimeout',(callback,delay,...args)=>{timeouts.push(delay);return timer(callback,delay,...args)})
  const execute=recoveryTransport({...options,fetcher:async()=>json({})})
  for (const suffix of ['/organization/mailboxes?offset=0&limit=100','/organization/mailboxes?offset=100','/organization/mailboxes/owner/folders','/organization/mailboxes/owner/items','/organization/mailboxes/owner/items/message','/Events']) {
    await execute(path+suffix)
  }
  assert.deepEqual(timeouts,[720000,720000,720000,720000,60000,60000])
})

async function localExchangeSource(t,respond) {
  const server=require('node:http').createServer(respond)
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>{server.closeAllConnections();server.close()})
  return {...options,baseUrl:'http://127.0.0.1:'+server.address().port}
}
const inbox=path+'/organization/mailboxes/owner/items?parentId=inbox'

test('slow Exchange GET uses native HTTP and accepts JSON pages above the restore acknowledgement size',async t=>{
  const expected='a'.repeat(1024*1024+1)
  const {gzipSync}=require('node:zlib')
  const source=await localExchangeSource(t,(req,res)=>{
    assert.equal(req.method,'GET');assert.equal(req.url,inbox);assert.equal(req.headers.authorization,'Bearer secret')
    setTimeout(()=>{res.writeHead(200,{'Content-Encoding':'gzip'});res.end(gzipSync(JSON.stringify({name:expected})))},40)
  })
  t.mock.method(global,'fetch',()=>{throw Error('Exchange collection GET unexpectedly used fetch')})
  assert.equal((await recoveryTransport({...source,readTimeoutMs:4000})(inbox)).name,expected)
})

test('native Exchange GET enforces the existing 16 MiB JSON response limit',async t=>{
  const source=await localExchangeSource(t,(_req,res)=>{res.end('"'+'a'.repeat(16*1024*1024)+'"')})
  await assert.rejects(()=>recoveryTransport(source)(inbox),e=>e.status===502 && !e.outcomeUnknown && /too large/.test(e.message))
})

test('native Exchange GET honors Retry-After and never sends the bearer token to a redirect target',async t=>{
  let calls=0
  const source=await localExchangeSource(t,(req,res)=>{
    calls++
    if(req.url==='/redirect-target')return assert.fail('Followed upstream redirect')
    if(req.url.includes('redirect')){res.writeHead(302,{Location:'/redirect-target'});res.end();return}
    res.writeHead(429,{'Retry-After':'120'});res.end('{}')
  })
  const execute=recoveryTransport(source)
  await assert.rejects(()=>execute(inbox),e=>e.status===429 && !e.outcomeUnknown)
  assert.equal(calls,1)
  await assert.rejects(()=>execute(inbox+'&redirect=1'),e=>e.status===502 && !e.outcomeUnknown)
})

test('cancelling a body read and an explicit short header deadline close native Exchange GETs',async t=>{
  let closed,received=0
  const closedRequest=new Promise(resolve=>{closed=resolve}),controller=new AbortController()
  const source=await localExchangeSource(t,(req,res)=>{
    received++
    if(req.url.includes('cancel')) {
      res.writeHead(200);res.write('{"items":')
      res.on('close',closed)
      setTimeout(()=>controller.abort(),30)
    }
  })
  await assert.rejects(()=>recoveryTransport({...source,signal:controller.signal})(inbox+'&cancel=1'),e=>e.status===499 && !e.outcomeUnknown)
  await closedRequest
  await assert.rejects(()=>recoveryTransport({...source,readTimeoutMs:100})(inbox),e=>e.status===504 && !e.outcomeUnknown)
  assert.equal(received,2)
})

test('a rejected restore identifies known missing options without reauthenticating or replaying it',async()=>{
  let writes=0,refreshes=0
  const execute=recoveryTransport({...options,refresh:async()=>{refreshes++;return 'unused'},fetcher:async()=>{writes++;return Response.json({message:'Missing mandatory parameters: MarkRestoredAsUnread.',errorCode:'ParameterValidationFailure',stackTrace:'private details'},{status:400})}})
  await assert.rejects(()=>execute(path+'/organization/mailboxes/mailbox/items/restoreTo','POST',{}),error=>{
    assert.equal(error.status,400);assert.equal(error.outcomeUnknown,false)
    assert.equal(error.message,'The restore request is missing required options: mark restored items as unread. Review the restore options and try again.')
    return true
  })
  assert.equal(writes,1);assert.equal(refreshes,0)
})

test('multiple missing options are translated only when every field is allowlisted',async()=>{
  const execute=recoveryTransport({...options,fetcher:async()=>Response.json({message:'Missing mandatory parameters: Mailbox, Folder, MarkRestoredAsUnread.',errorCode:'ParameterValidationFailure'},{status:400})})
  await assert.rejects(()=>execute(path+'/organization/mailboxes/mailbox/items/restoreTo','POST',{}),error=>error.message==='The restore request is missing required options: destination mailbox, destination folder, mark restored items as unread. Review the restore options and try again.'&&error.outcomeUnknown===false)
})

test('an explicit REST requirement for an impersonation account is reported without replaying the restore',async()=>{
  let writes=0
  const execute=recoveryTransport({...options,fetcher:async()=>{
    writes++
    return Response.json({message:'Missing mandatory parameters: ImpersonationAccountName.',errorCode:'ParameterValidationFailure'},{status:400})
  }})
  await assert.rejects(()=>execute(path+'/organization/mailboxes/mailbox/items/restoreTo','POST',{}),error=>error.status===400&&error.outcomeUnknown===false&&error.message.includes('Exchange impersonation account'))
  assert.equal(writes,1)
})

test('untrusted messages and unknown field names retain the generic redacted diagnostic',async()=>{
  const messages=[
    'Missing mandatory parameters: MarkRestoredAsUnread. private-secret',
    'Missing mandatory parameters: MarkRestoredAsUnread.\nprivate-secret',
    'Missing mandatory parameters: MarkRestoredAsUnread.\n',
    ' Missing mandatory parameters: MarkRestoredAsUnread.',
    'Missing mandatory parameters: MarkRestoredAsUnread',
    'Missing mandatory parameters: MarkRestoredAsUnread, PrivateSecret.',
    'Missing mandatory parameters: UserPassword.',
    'Missing mandatory parameters: access_token.',
    'Missing mandatory parameters: constructor.',
    'Missing mandatory parameters: toString.',
    'Missing mandatory parameters: MarkRestoredAsUnread=private-secret.',
    'Private stack trace and credentials',
    {value:'Missing mandatory parameters: MarkRestoredAsUnread.'},
  ]
  for(const message of messages){
    const execute=recoveryTransport({...options,fetcher:async()=>Response.json({message,errorCode:'ParameterValidationFailure'},{status:400})})
    await assert.rejects(()=>execute(path+'/organization/mailboxes/mailbox/items/restoreTo','POST',{}),error=>error.message==='The Microsoft 365 source rejected the operation (HTTP 400) · ParameterValidationFailure.'&&error.outcomeUnknown===false)
  }
})

test('missing-option parsing is confined to explicit restore validation errors',async()=>{
  for(const [resource,method,status,errorCode] of [
    [path+'/Stop','POST',400,'ParameterValidationFailure'],
    [path+'/organization/restoreDeviceCode','POST',400,'ParameterValidationFailure'],
    [path+'/organization/mailboxes/mailbox/items/restoreTo','GET',400,'ParameterValidationFailure'],
    [path+'/organization/mailboxes/mailbox/items/restoreTo','POST',409,'ParameterValidationFailure'],
    [path+'/organization/mailboxes/mailbox/items/restoreTo','POST',400,'ResourceNotFound'],
  ]){
    const execute=recoveryTransport({...options,fetcher:async()=>Response.json({message:'Missing mandatory parameters: MarkRestoredAsUnread.',errorCode},{status})})
    await assert.rejects(()=>execute(resource,method),error=>!error.message.includes('required options')&&!error.message.includes('MarkRestoredAsUnread'))
  }
})

test('statistics after completion is a precise capability response, not a generic conflict',async()=>{
  const pending='Unable to provide statistics until the restore session completes.'
  const execute=recoveryTransport({...options,fetcher:async()=>Response.json({message:pending},{status:409})})
  await assert.rejects(()=>execute(path+'/Statistics'),error=>error instanceof RestoreStatisticsPendingError)
  for(const [resource,method] of [[path,'GET'],[path+'/Stop','POST']])await assert.rejects(()=>execute(resource,method),error=>error.status===409 && !(error instanceof RestoreStatisticsPendingError))
  const unrelated=recoveryTransport({...options,fetcher:async()=>Response.json({message:'Other conflict with private details'},{status:409})})
  await assert.rejects(()=>unrelated(path+'/Statistics'),error=>error.status===409 && !(error instanceof RestoreStatisticsPendingError) && !error.message.includes('private'))
})

test('transient read recovery retries once and keeps the same fixed destination and signal',async()=>{
  const calls=[]
  const execute=recoveryTransport({...options,fetcher:async(url,request)=>{
    calls.push({url,request})
    return calls.length===1 ? new Response('gateway unavailable',{status:502,headers:{'Retry-After':'0'}}):json({items:[{id:'document'}]})
  }})
  assert.deepEqual(await execute(path),{items:[{id:'document'}]})
  assert.equal(calls.length,2)
  assert.equal(String(calls[0].url),String(calls[1].url))
  assert.equal(calls[0].request.signal,calls[1].request.signal)
  assert.equal(calls[1].request.method,'GET')
  assert.equal(calls[1].request.redirect,'error')
})

test('network failure gets one read retry while persistent gateways stop after two attempts',async()=>{
  let networkCalls=0,gatewayCalls=0
  const network=recoveryTransport({...options,fetcher:async()=>{if(++networkCalls===1)throw new TypeError('socket closed');return json({ok:true})}})
  assert.deepEqual(await network(path),{ok:true})
  assert.equal(networkCalls,2)
  const gateway=recoveryTransport({...options,fetcher:async()=>{gatewayCalls++;return new Response('private upstream details',{status:503,headers:{'Retry-After':'0'}})}})
  await assert.rejects(()=>gateway(path),error=>error.status===502 && !error.outcomeUnknown && !error.message.includes('private upstream'))
  assert.equal(gatewayCalls,2)
})

test('throttling preserves HTTP 429 and never ignores a long Retry-After',async()=>{
  let shortCalls=0,longCalls=0
  const short=recoveryTransport({...options,fetcher:async()=>{shortCalls++;return new Response('',{status:429,headers:{'Retry-After':'0'}})}})
  await assert.rejects(()=>short(path),error=>error.status===429 && !error.outcomeUnknown)
  assert.equal(shortCalls,2)
  const long=recoveryTransport({...options,fetcher:async()=>{longCalls++;return new Response('',{status:429,headers:{'Retry-After':'120'}})}})
  await assert.rejects(()=>long(path),error=>error.status===429)
  assert.equal(longCalls,1)
})

test('permanent errors and all ambiguous POST failures never use transient retries',async()=>{
  for(const status of [400,403,404,409]) {
    let calls=0
    const execute=recoveryTransport({...options,fetcher:async()=>{calls++;return new Response('',{status})}})
    await assert.rejects(()=>execute(path),error=>error.status===status)
    assert.equal(calls,1)
  }
  for(const status of [429,502,503,504]) {
    let calls=0
    const execute=recoveryTransport({...options,fetcher:async()=>{calls++;return new Response('',{status,headers:{'Retry-After':'0'}})}})
    await assert.rejects(()=>execute(path+'/Stop','POST'),error=>error.outcomeUnknown===(status>=500))
    assert.equal(calls,1)
  }
  let networkCalls=0
  const network=recoveryTransport({...options,fetcher:async()=>{networkCalls++;throw Error('disconnected')}})
  await assert.rejects(()=>network(path+'/Stop','POST'),error=>error.outcomeUnknown)
  assert.equal(networkCalls,1)
})

test('navigation cancellation during retry delay stops the retry and is not a timeout',async()=>{
  const controller=new AbortController()
  let calls=0
  const execute=recoveryTransport({...options,signal:controller.signal,fetcher:async()=>{
    calls++
    setTimeout(()=>controller.abort(),20)
    return new Response('',{status:503,headers:{'Retry-After':'1'}})
  }})
  await assert.rejects(()=>execute(path),error=>error.status===499 && !error.outcomeUnknown && /cancelled/.test(error.message))
  assert.equal(calls,1)
  const alreadyAborted=recoveryTransport({...options,signal:controller.signal,fetcher:async()=>{calls++;return json({})}})
  await assert.rejects(()=>alreadyAborted(path),error=>error.status===499)
  assert.equal(calls,1)
})

test('a timed out GET is not automatically retried',async()=>{
  let calls=0
  const execute=recoveryTransport({...options,readTimeoutMs:25,fetcher:async(_url,{signal})=>{
    calls++
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))
  }})
  await assert.rejects(()=>execute(path),error=>error.status===504 && !error.outcomeUnknown && /Retry to continue/.test(error.message))
  assert.equal(calls,1)
})

test('a second read uses the original total timeout budget',async()=>{
  let calls=0,originalSignal
  const originalTimeout=global.setTimeout,scheduled=[]
  global.setTimeout=(callback,delay,...args)=>{scheduled.push(delay);return originalTimeout(callback,delay,...args)}
  const execute=recoveryTransport({...options,readTimeoutMs:1250,fetcher:async(_url,{signal})=>{
    calls++
    if(calls===1) {
      originalSignal=signal
      return new Response('',{status:502,headers:{'Retry-After':'0'}})
    }
    assert.equal(signal,originalSignal)
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))
  }})
  try {
    await assert.rejects(()=>execute(path),error=>error.status===504)
    assert.equal(calls,2)
    assert.equal(scheduled.filter(delay=>delay===1250).length,1,'the retry must not start a fresh timeout')
  }finally {global.setTimeout=originalTimeout}
})

test('read retry scheduling respects rate limits, deadline and HTTP date Retry-After',()=>{
  const now=Date.parse('2026-11-20T12:00:00Z'),deadline=now+60000
  assert.equal(readRetryDelay(503,'Fri, 20 Nov 2026 12:00:02 GMT',deadline,now),2000)
  assert.equal(readRetryDelay(429,null,deadline,now),1000)
  assert.equal(readRetryDelay(502,'60',deadline,now),null)
  assert.equal(readRetryDelay(502,'0',now+999,now),null)
  assert.equal(readRetryDelay(403,'0',deadline,now),null)
})
