// Open Backup UI v1.2.0
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {matchesWorkloadSearch,matchesWorkloadType}=require('../lib/restore-points/workload-search.ts')
const {readWorkloadIndex}=require('../lib/restore-points/workload-index.ts')
const guid='deadbeef-1111-4111-8111-00000000abcd'
const vm={objectId:guid,name:'Finance',platform:'VMware',copies:[{backupId:'00000000-0000-4000-8000-feed0000cafe',name:'AD backup',kinds:['guest-files']}]}

test('picker matches only human-readable workload name and displayed inventory path',()=>{
  assert(matchesWorkloadSearch(vm,' fInAnCe '))
  for(const q of ['ad','0000abcd','backup','VMware','cafe'])assert.equal(matchesWorkloadSearch(vm,q),false,q)
  assert(matchesWorkloadSearch({...vm,displayPath:'vc.example\\AD zone\\Finance'},'vc.example / ad'))
  assert(matchesWorkloadSearch({...vm,distinguishingLocation:'West / AD site · 0000abcd'},'ad site'))
  assert.equal(matchesWorkloadSearch({...vm,distinguishingLocation:'West / AD site · 0000abcd'},'00abcd'),false)
  assert.equal(matchesWorkloadSearch({...vm,name:guid,distinguishingLocation:'0000abcd'},'deadbeef'),false)
  assert(matchesWorkloadSearch(vm,' '))
})

test('type filtering maps file shares and object storage together and keeps older VM records',()=>{
  const items=[vm,...['vm','physical','nas','object'].map(workloadType=>({...vm,workloadType}))]
  assert.equal(items.filter(o=>matchesWorkloadType(o,'all')).length,5)
  assert.equal(items.filter(o=>matchesWorkloadType(o,'vm')).length,2)
  assert.equal(items.filter(o=>matchesWorkloadType(o,'physical')).length,1)
  assert.deepEqual(items.filter(o=>matchesWorkloadType(o,'unstructured')).map(o=>o.workloadType),['nas','object'])
})

const page=(id,total,rows)=>({sourceKey:guid,snapshotId:id,complete:true,total,data:rows,notices:[]})
test('all pages use one pinned snapshot, independent of text, type or the visible page',async()=>{
  const calls=[],progress=[],rows=Array.from({length:419},(_,i)=>({...vm,name:'VM'+i}))
  await readWorkloadIndex(async args=>{
    calls.push(args);const start=Number(args.offset)
    return page('first',rows.length,rows.slice(start,start+Number(args.limit)))
  },new AbortController().signal,true,(p,done)=>progress.push([p.data.length,done]),()=>assert.fail('unexpected reset'))
  assert.deepEqual(calls,[{offset:'0',limit:'200',refresh:'true'},{offset:'200',limit:'200',snapshotId:'first'},{offset:'400',limit:'200',snapshotId:'first'}])
  assert.deepEqual(progress,[[200,false],[400,false],[419,true]])
})
test('expiry discards old membership before restarting and stops after a second conflict',async()=>{
  const events=[],ctrl=new AbortController(),expired=Object.assign(new Error('expired'),{status:409});let run=0
  await assert.rejects(readWorkloadIndex(async args=>{
    if(args.offset!=='0')throw expired
    return page('pin'+(++run),2,[{...vm,name:'Version '+run}])
  },ctrl.signal,false,p=>events.push(p.data[0].name),()=>events.push('discard')),expired)
  assert.deepEqual(events,['Version 1','discard','Version 2'])
})
test('abort while fetching another page cannot publish information from the closed scope',async()=>{
  const events=[],controller=new AbortController()
  await readWorkloadIndex(async args=>{
    if(args.snapshotId){controller.abort();return page('pin',2,[{name:'stale'}])}
    return page('pin',2,[{name:'first'}])
  },controller.signal,false,p=>events.push(p.data.map(r=>r.name)),()=>{})
  assert.deepEqual(events,[['first']])
})
