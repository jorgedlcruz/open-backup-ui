// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {randomUUID}=require('node:crypto')
const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,name)=>module._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},
}).outputText,name)
const {viewContent}=require('../lib/vbm-recovery/content.ts')
const {matchesPreviewMedia,availableContent,previewLimit,previewMedia}=require('../lib/vbm-recovery/content-types.ts')
const {readMessageBody}=require('../lib/vbm-recovery/message-reader.ts')
const {burn}=require('@kenjiuno/msgreader/lib/Burner')

function fixture(workload='Exchange') {
  const sessionId=randomUUID(),ownerId=randomUUID(),id='selected+item/abc'
  const input={action:'viewContent',sessionId,workload,ownerId,id,kind:workload==='Exchange'?'item':'document'}
  const entity=workload==='Exchange'?{id,subject:'Private fixture',mailboxId:ownerId,itemClass:'IPM.Note'}
    :{id,name:'notes.txt',oneDriveId:ownerId,sizeBytes:5}
  const events=[],reads=[]
  const session={id:sessionId,type:workload==='Exchange'?'Vex':'Veod',state:'Working',name:'Source'}
  const context={scope:'fixture',actor:'connected principal',sourceName:'host',sourceOrigin:'https://backup.invalid',signal:new AbortController().signal,
    execute:async path=>{reads.push(path);return path.endsWith(sessionId)?session:entity}}
  const audit=async(scope,sid,event)=>{events.push(event);return 'available'}
  return {input,context,entity,session,reads,events,audit}
}

test('view one exported message as plain text, with an item-scoped content-free audit',async()=>{
  const f=fixture(),s=Uint8Array.from(Buffer.from('Hello from backup\0','utf16le'))
  const bytes=burn([{name:'Root Entry',type:5,length:0,children:[1]},{type:2,name:'__substg1.0_1000001F',length:s.length,binaryProvider:()=>s}])
  const res=await viewContent(f.context,f.input,async(path,body)=>{
    assert.equal(path,'/v8/RestoreSessions/'+f.input.sessionId+'/organization/mailboxes/'+f.input.ownerId+'/items/selected%2Bitem%2Fabc/save')
    assert.equal(body,undefined)
    return new Response(bytes)
  },f.audit)
  assert.equal((await res.json()).content,'Hello from backup')
  assert.equal(f.events.length,1);assert.equal(f.events[0].itemId,f.input.id);assert.equal(f.events[0].actor,f.context.actor)
  assert.doesNotMatch(JSON.stringify(f.events),/Private fixture|Hello from backup/)
  assert.equal(res.headers.get('cache-control'),'private, no-store')
})

function messageBytes(streams) {
  const root = {name:'Root Entry',type:5,length:0,children:streams.map((_,i)=>i+1)}
  return burn([root, ...streams.map(([tag, bytes])=>({
    type:2, name:'__substg1.0_' + tag, length:bytes.length, binaryProvider:()=>Uint8Array.from(bytes),
  }))])
}

test('Exchange exports prefer the newsletter HTML layout to its plain text alternative',async()=>{
  const html = '<html><body><table><tr><td>News</td></tr></table></body></html>'
  const bytes = messageBytes([
    ['1000001F', Buffer.from('Plain text alternative\0','utf16le')],
    ['1013001F', Buffer.from(html+'\0','utf16le')],
  ])
  const f=fixture()
  const res=await viewContent(f.context,f.input,async()=>new Response(bytes),f.audit)
  assert.deepEqual(await res.json(),{format:'html',content:html,truncated:false})
})

test('Exchange exports decode HTML bytes using the declared charset',async()=>{
  const html = '<meta charset="windows-1252"><p>Café</p>'
  const bytes = messageBytes([['10130102', Buffer.from(html+'\0','latin1')]])
  const body=await readMessageBody(Uint8Array.from(bytes),new AbortController().signal)
  assert.deepEqual(body,{format:'html',content:html,truncated:false})
})

test('Exchange exports with blank HTML still show their plain text body',async()=>{
  const bytes = messageBytes([
    ['1000001F', Buffer.from('Only text\0','utf16le')],
    ['1013001F', Buffer.from('  \r\n\0','utf16le')],
  ])
  const body=await readMessageBody(Uint8Array.from(bytes),new AbortController().signal)
  assert.deepEqual(body,{format:'text',content:'Only text',truncated:false})
})

test('download streams the original document and filenames stay in a single attachment header',async()=>{
  const f=fixture('OneDrive');f.input.action='downloadOriginal';f.entity.name='Réport "\r\n.docx'
  const res=await viewContent(f.context,f.input,async(path,body)=>{
    assert.ok(path.endsWith('/Documents/selected%2Bitem%2Fabc/save'))
    assert.deepEqual(body,{asZip:false})
    return new Response('original')
  },f.audit)
  assert.equal(await res.text(),'original');assert.equal(res.headers.get('content-type'),'application/octet-stream')
  const name=res.headers.get('content-disposition')
  assert.ok(name.startsWith('attachment;'));assert.doesNotMatch(name,/[\r\n]/);assert.ok(name.includes('filename*=UTF-8'))
  assert.equal(f.events[0].action,'Original download opened')
})

test('message preview limits simultaneous parser workers and handles malformed inputs',async()=>{
  const prefix=[0xd0,0xcf,0x11,0xe0]
  const requests=Array.from({length:3},()=>readMessageBody(Uint8Array.from(prefix),new AbortController().signal))
  const results=await Promise.allSettled(requests)
  assert.ok(results.some(r=>r.status==='rejected'&&r.reason.status===429))
  assert.ok(results.some(r=>r.status==='fulfilled'&&r.value.format==='unavailable'))
})

test('reject mismatched sessions, forged item ids, disabled item kinds and failed upstream export',async()=>{
  for(const change of [f=>f.session.state='Stopped',f=>f.session.type='Vesp',f=>f.entity.id='different',f=>f.entity.mailboxId='different',f=>f.input.kind='file',f=>f.entity.itemClass='IPM.Contact',f=>f.input.id='..']){
    const f=fixture();change(f);let exports=0
    await assert.rejects(()=>viewContent(f.context,f.input,()=>{exports++;return new Response('bad')},f.audit))
    assert.equal(exports,0);assert.equal(f.events.length,0)
  }
  const f=fixture();await assert.rejects(()=>viewContent(f.context,f.input,async()=>new Response(null,{status:403}),f.audit),{status:403})
  assert.equal(f.events.length,0)
})

test('inline media is allowlisted, limited by observed bytes, and checked before exposure',async()=>{
  assert.equal(previewMedia('notes.constructor'),undefined)
  assert.equal(availableContent({isFolder:true,workload:'OneDrive',kind:'document',ownerId:'o',name:'f.pdf',selectable:true}),false)
  assert.equal(matchesPreviewMedia(new TextEncoder().encode('<html>'), 'application/pdf'),false)
  assert.equal(matchesPreviewMedia(new TextEncoder().encode('<svg>'), 'image/png'),false)
  assert.equal(matchesPreviewMedia(new TextEncoder().encode('%PDF-1.4'), 'application/pdf'),true)
  const f=fixture('OneDrive');f.entity.name='unsafe.html'
  await assert.rejects(()=>viewContent(f.context,f.input,()=>assert.fail('must not export'),f.audit),{status:415})
  f.entity.name='sample.pdf'
  await assert.rejects(()=>viewContent(f.context,f.input,async()=>new Response('<svg>'),f.audit),{status:415})
  const excess=new ReadableStream({start(ctrl){ctrl.enqueue(new Uint8Array(previewLimit));ctrl.enqueue(Uint8Array.of(0));ctrl.close()}})
  await assert.rejects(()=>viewContent(f.context,f.input,async()=>new Response(excess),f.audit),{status:413})
  assert.equal(f.events.length,0)
  f.entity.name='notes.txt'
  await assert.rejects(()=>viewContent(f.context,f.input,async()=>new Response('private'),async()=>'unavailable'),{status:503})
})
