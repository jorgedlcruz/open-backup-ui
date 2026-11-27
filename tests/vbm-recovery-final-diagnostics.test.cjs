// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const component=process.env.VBM_SESSION_COMPONENT_FILE||path.join(__dirname,'../components/vbm-recovery/session.tsx')
const exportsForTest={}
const cartKey=item=>JSON.stringify([item.ownerId,item.channelId,item.kind,item.id])
const modules={
  './browser':{itemKey:cartKey},
  '@/components/providers/i18n-provider':{useI18n:()=>({t:(key,values)=>key.replace('{count}',values?.count??'{count}')})},
  '@/components/ui/button':{Button:'button'},
  '@/components/ui/data-loading':{DataLoading:()=>null},
  '@/lib/vbm-recovery/restore-results':{restoreResultCounts:()=>({}),restoreItemResults:()=>[]},
  './session-events':{recoveryStatusTone:()=>''},
}
const requireForComponent=id=>['react','react/jsx-runtime','lucide-react'].includes(id)?require(id):id.endsWith('.css')?{default:{}}:modules[id]||{}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(component,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:exportsForTest,require:requireForComponent})
const {createFinalDiagnosticsRetryPolicy}=exportsForTest
const snapshot=(state,overrides={})=>({session:{id:'child',state},statistics:{totalItemsCount:1,restoredItemsCount:1},statisticsAvailability:'available',events:[],warnings:[],...overrides})
function poller(responses) {
  const policy=createFinalDiagnosticsRetryPolicy()
  let value,failedRead=false,reads=0
  return {
    poll(manual=false) {
      if(manual)policy.reset('child')
      if(!manual&&!policy.shouldRead('child',value,failedRead))return false
      policy.attempted('child',value);reads++
      const next=responses.shift()
      assert.notEqual(next,undefined,'unexpected extra diagnostic read')
      if(next instanceof Error)failedRead=true
      else {value=next;failedRead=false}
      return true
    },
    get reads(){return reads},get value(){return value},
  }
}

test('a stopped restore recovers delayed statistics and a transient final read failure',()=>{
  const run=poller([
    snapshot('Working',{statistics:null,statisticsAvailability:'afterCompletion'}),
    snapshot('Stopped',{statistics:null,statisticsAvailability:'unavailable'}),
    new Error('Source temporarily unavailable'),
    snapshot('Stopped',{events:[{message:'One item restored'}]}),
  ])
  for(let tick=0;tick<8;tick++)run.poll()
  assert.equal(run.reads,4)
  assert.equal(run.value.statistics.restoredItemsCount,1)
  assert.equal(run.value.events[0].message,'One item restored')
})

test('missing final events have a bounded retry budget and manual refresh can recover afterward',()=>{
  const missing=snapshot('Stopped',{warnings:['Session events could not be loaded.']})
  const run=poller([missing,missing,new Error('Slow controller'),missing,snapshot('Stopped',{events:[{message:'Restore finished'}]})])
  for(let tick=0;tick<20;tick++)run.poll()
  assert.equal(run.reads,4,'first stopped observation plus only three automatic retries')
  assert.equal(run.poll(true),true)
  assert.equal(run.value.events[0].message,'Restore finished')
  assert.equal(run.poll(),false,'complete final diagnostics stop background reads')
})

test('running polls do not exhaust the final diagnostic budget or share it across operations',()=>{
  const policy=createFinalDiagnosticsRetryPolicy(),running=snapshot('Working'),missing=snapshot('Stopped',{statistics:null,statisticsAvailability:'unavailable'})
  for(let tick=0;tick<12;tick++){assert.equal(policy.shouldRead('a',running),true);policy.attempted('a',running)}
  for(let retry=0;retry<3;retry++){assert.equal(policy.shouldRead('a',missing),true);policy.attempted('a',missing)}
  assert.equal(policy.shouldRead('a',missing),false)
  assert.equal(policy.shouldRead('b',missing),true)
  assert.equal(policy.shouldRead('b',snapshot('Stopped')),false)
})

test('a blocked group identifies the selected email and displays the exact local diagnostic in its row',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
  const {presentSubmission,Operations}=exportsForTest
  const items=['mailbox-1','mailbox-2'].map((ownerId,index)=>({id:'same-id',ownerId,kind:'item',name:['First subject','VMware newsletter'][index]}))
  const group=JSON.stringify(['mailbox-2','','item',''])
  const receipt={group,itemIds:['same-id'],itemKeys:[cartKey(items[1])],itemCount:1,status:'notSubmitted',error:'The restore audit settings could not be validated.'}
  const labeled=presentSubmission([receipt],items,'request').operations
  const html=renderToStaticMarkup(React.createElement(Operations,{receipts:labeled,setActive:()=>{}}))
  assert.match(html,/VMware newsletter/)
  assert.match(html,/Not submitted/)
  assert.match(html,/The restore audit settings could not be validated\./)
  assert.doesNotMatch(html,/First subject|mailbox-2|No item totals reported/)
  assert.equal(presentSubmission([{...receipt,itemKeys:undefined}],items,'request').operations[0].itemName,undefined)
})

test('a completed audited restore shows its outcome with item details initially closed',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
  const receipt={group:'group',sessionId:'child',itemIds:['file'],itemName:'Report.pdf',itemCount:1,status:'accepted',
    auditEntry:{outcome:{result:'Success',counts:{total:1,restored:1,skipped:0,failed:0},items:[]}}}
  const html=renderToStaticMarkup(React.createElement(exportsForTest.Operations,{receipts:[receipt],setActive:()=>{}}))
  assert.match(html,/Report\.pdf/)
  assert.match(html,/>Success</)
  assert.match(html,/aria-expanded="false"/)
  assert.doesNotMatch(html,/Restore summary|Restore audit|>Session log</)
})

test('the legacy audit warning explains an entirely unsent request and stays separate for partial acceptance',()=>{
  const {presentSubmission}=exportsForTest
  const audit='The application could not save the complete restore audit. Check the Veeam session log.'
  const first={group:'first',itemIds:['one'],itemCount:1,status:'notSubmitted'},second={...first,group:'second',itemIds:['two']}
  const blocked=presentSubmission([first,second],[],'request',audit)
  assert.equal(blocked.notices.length,0)
  assert.equal(blocked.operations[0].error,'The restore audit could not be saved.')
  assert.equal(blocked.cartError,blocked.operations[0].error)
  assert.equal(blocked.operations[1].error,undefined)
  const localFailure={...first,error:'The restore audit storage is full.'}
  assert.equal(presentSubmission([localFailure],[],'new-request').cartError,localFailure.error)
  assert.equal(presentSubmission([localFailure],[],'request','The operator explorer could not confirm it had stopped. Check its status in Recovery Center.').cartError,undefined)
  for(const status of ['accepted','unknown','failed']){
    const mixed=presentSubmission([{...first,status},second],[],'request',audit)
    assert.equal(mixed.notices[0],audit)
    assert.equal(mixed.cartError,undefined)
    assert.equal(mixed.operations[1].error,undefined)
  }
})

test('durable results supersede unknown receipts and retain independent outcomes for other groups',()=>{
  const {operationsFromAudit,operationStatus}=exportsForTest
  const pending={requestId:'request',group:'group',itemIds:['a'],itemCount:1,status:'unknown',error:'Unconfirmed',rowKey:'live-key'}
  const accepted={id:'audit-a',browseSessionId:'browse',requestId:'request',selection:[{id:'a',name:'Newsletter'}],status:'accepted',sessionId:'child',workload:'Exchange'}
  const skipped={...accepted,id:'audit-b',selection:[{id:'b',name:'Second item'}],status:'notSubmitted',sessionId:undefined,error:'An earlier group stopped this restore request.'}
  const merged=operationsFromAudit('browse',[pending],[accepted,skipped])
  assert.equal(merged.length,2)
  assert.equal(merged[0].itemName,'Newsletter')
  assert.equal(merged[0].error,undefined)
  assert.equal(operationStatus(merged[0]),'Accepted')
  assert.equal(operationStatus(merged[1]),'Not submitted')
  assert.equal(merged[1].auditEntry.error,skipped.error)
  assert.equal(operationStatus(operationsFromAudit('browse',[],[{...accepted,outcome:{result:'Success'}}])[0]),'Success')
  const entry={...accepted,status:'requested',sessionId:undefined}
  assert.equal(operationStatus(operationsFromAudit('browse',[pending],[entry])[0]),'Waiting for Veeam')
  assert.equal(operationStatus(operationsFromAudit('browse',[],[{...entry,status:'unknown'}])[0]),'Restore status unknown')
  assert.equal(operationStatus(operationsFromAudit('browse',[{...pending,status:'failed'}],[entry])[0]),'Failed')
})

test('an unconfirmed item shows the destination check and attributes a proxy failure to the browse session',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
  const receipt={group:'group',itemIds:['a'],itemName:'Newsletter',itemCount:1}
  const render=status=>renderToStaticMarkup(React.createElement(exportsForTest.Operations,{
    receipts:[{...receipt,status}],setActive:()=>{},browseFailure:'Proxy VB365 is unresponsive.'
  }))
  const unknown=render('unknown')
  assert.match(unknown,/Restore status unknown/)
  assert.match(unknown,/Check the destination and Veeam restore history before retrying/)
  assert.match(unknown,/Browse session failed<\/strong> · Proxy VB365 is unresponsive/)
  const waiting=render('requested')
  assert.match(waiting,/Waiting for Veeam/)
  assert.doesNotMatch(waiting,/before retrying|Proxy VB365|Restore status unknown/)
  assert.doesNotMatch(render('failed'),/No restore session ID|Proxy VB365/)
})

test('a recorded child reconciles the local request and the discovered session without matching unrelated restores',()=>{
  const {operationsFromAudit,operationStatus}=exportsForTest
  const unknown={requestId:'req',group:'mail',itemIds:['a'],itemCount:1,status:'unknown',error:'Missing response'}
  const discovered={group:'child',sessionId:'child',itemIds:[],itemCount:0,status:'accepted'}
  const unrelated={...discovered,group:'other',sessionId:'other'}
  const audit={id:'audit',requestId:'req',browseSessionId:'browse',status:'accepted',sessionId:'child',workload:'Exchange',selection:[{id:'a',name:'Subject'}]}
  for(const live of [[unknown,discovered,unrelated],[discovered,unrelated,unknown]]){
    const result=operationsFromAudit('browse',live,[audit])
    assert.equal(result.length,2)
    const linked=result.find(row=>row.sessionId==='child')
    assert.equal(operationStatus(linked),'Accepted')
    assert.equal(linked.requestId,'req')
    assert.equal(linked.error,undefined)
    assert.equal(result.find(row=>row.sessionId==='other').auditEntry,undefined)
  }
  const ambiguous=operationsFromAudit('browse',[unknown,discovered],[audit,{...audit,id:'second-audit',sessionId:'another-child'}])
  assert.equal(ambiguous.length,3)
  assert.equal(ambiguous.find(row=>row.status==='unknown').auditEntry,undefined)
})
