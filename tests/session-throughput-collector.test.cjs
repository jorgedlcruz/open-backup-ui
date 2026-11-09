// Open Backup UI v1.0.2
const test=require('node:test'), assert=require('node:assert/strict'), ts=require('typescript')
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), vm=require('node:vm')
const {createRequire}=require('node:module')
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText
require.extensions['.ts']=(m,f)=>m._compile(compile(f),f)
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const now=Date.parse('2026-11-09T12:00:00Z'), ttl=12*3600000
const source={id:'vbr',platform:'vbr',username:'user',password:'testing',protocol:'https',host:'backup.test',port:9419,hasCredentials:true}
const session=(n,extra={})=>({id:id(n),state:'Working',sessionType:'RestoreVm',...extra})
const paged=(rows,skip,total=rows.length)=>({data:rows,pagination:{skip,total}})
const urls=(read,predicate)=>read.map(p=>new URL(p,'https://unit.invalid')).filter(predicate)
function harness(options={}) {
  const file=require.resolve('../lib/server/session-throughput-collector.ts'),localRequire=createRequire(file)
  const exports={}, measures=[], sources=new Map([[source.id,{...source}]]), timers=[],sweeps=[]
  const {readCacheScope}=require('../lib/server/read-cache-scope.ts')
  const dependencies={
    './capacity-collector':{configuredScope:s=>{const destination=new URL(s.protocol+'://'+s.host+':'+s.port);return {destination,scope:readCacheScope(destination.href,'',s)}}},
    './config-store':{configStore:{getById:id=>sources.get(id),getAll:()=>[...sources.values()]}},
    './token-manager':{tokenManager:{getToken:async()=>'in-memory',refreshToken:async()=>'refreshed'}},
    './session-throughput':{throughputRetentionMs:ttl,recordSessionThroughput:async(...args)=>{measures.push(args)},sweepSessionThroughput:async()=>{sweeps.push(true)}},
  }
  const env={...options.env}
  vm.runInNewContext(compile(file),{exports,require:k=>dependencies[k]||localRequire(k),process:{cwd:()=>options.dir||process.cwd(),env},
    URL,URLSearchParams,Date,setTimeout,AbortSignal,fetch:options.fetch,setInterval:(fn,ms)=>{timers.push({fn,ms});return {unref(){}}}})
  return {api:exports,sources,measures,timers,sweeps,env}
}
function fixture(live,ended=[],taskData=[],logData=[]) {
  const calls=[]
  return {calls,read:async pathname=>{
    calls.push(pathname)
    const u=new URL(pathname,'https://unit.invalid'),q=u.searchParams
    const skip=Number(q.get('skip')),limit=Number(q.get('limit'))
    if(u.pathname==='/api/v1/sessions') {
      const rows=q.has('endedAfterFilter') ? ended.filter(s=>Date.parse(s.endTime)>Date.parse(q.get('endedAfterFilter'))&&Date.parse(s.endTime)<=Date.parse(q.get('endedBeforeFilter')))
        : q.has('stateFilter') ? live.filter(s=>s.state===q.get('stateFilter')) : live.filter(s=>!s.result||s.result.result==='None')
      return paged(rows.slice(skip,skip+limit),skip,rows.length)
    }
    if(u.pathname.endsWith('/logs'))return {totalRecords:logData.length,records:logData}
    if(u.pathname.endsWith('/taskSessions'))return paged(taskData.slice(skip,skip+limit),skip,taskData.length)
    const row=[...live,...ended].find(s=>s.id===u.pathname.split('/').at(-1))
    if(row)return row
    throw Error('unexpected endpoint '+u.pathname)
  }}
}

test('without a page request, live discovery passes native disk logs and only that session’s task measurements',async()=>{
  const {api}=harness(),s=session(1)
  const tasks=[{id:id(10),sessionId:s.id,type:'Restore',progress:{processingRate:'22 MB'}},{id:id(11),sessionId:id(2),progress:{processingRate:'99 MB'}}]
  const disk={id:13,updateTime:new Date(now).toISOString(),title:'Restoring Hard disk 1 (60 GB) : 29.9 GB restored at 109 MB/s  [hotadd]'}
  const {read}=fixture([s],[],tasks,[disk]),records=[]
  await api.sampleSessionCycle(read,async(...args)=>records.push(args),api.initialSampleCursor(now),now)
  assert.equal(records.length,1)
  assert.equal(records[0][1].data[0].title,disk.title)
  assert.deepEqual(Array.from(records[0][3].data,t=>t.id),[id(10)])
  assert.equal(records[0][3].complete,false)
})

test('state filters and continued live pages cover all session types without truncating a long-running queue',async()=>{
  const {api}=harness(),seen=new Set(), live=Array.from({length:37},(_,i)=>session(i+1,{sessionType:'BackupJob'}))
  live.push(session(125,{state:'WaitingSlot',result:{result:'Warning'}}))
  const {read,calls}=fixture(live),cursor=api.initialSampleCursor(now)
  for(let n=0;n<12;n++)await api.sampleSessionCycle(read,async s=>seen.add(s.id),cursor,now+15000*n)
  assert.equal(seen.size,38)
  assert.ok(urls(calls,u=>u.searchParams.get('resultFilter')==='None').some(u=>u.searchParams.get('skip')==='32'))
  assert.ok(urls(calls,u=>u.searchParams.get('stateFilter')==='WaitingSlot').length)
})

test('terminal closeout captures runs between polls and continues task pages after the discovery window',async()=>{
  const {api}=harness(),s=session(1,{endTime:new Date(now-1000).toISOString(),state:'Stopped'})
  const old=session(3,{endTime:new Date(now-ttl-1).toISOString(),state:'Stopped'})
  const tasks=Array.from({length:203},(_,i)=>({id:id(i+10),sessionId:s.id,name:'job VM',progress:{processingRate:'3 MB'}}))
  const {read,calls}=fixture([],[s,old],tasks),cursor=api.initialSampleCursor(now),taskIds=new Set()
  const capture=async(row,_logs,_time,evidence)=>{assert.equal(row.id,s.id);for(const t of evidence.data)taskIds.add(t.id)}
  await api.sampleSessionCycle(read,capture,cursor,now)
  assert.equal(taskIds.size,200)
  await api.sampleSessionCycle(read,capture,cursor,now+15000)
  assert.equal(taskIds.size,203)
  assert.equal(cursor.taskPages[s.id],undefined)
  assert.ok(calls.some(url=>url.endsWith('taskSessions?skip=200&limit=200')))
  assert.ok(!calls.some(url=>url.includes(old.id)))
})

test('an unavailable terminal log is retried by its verified ID without replaying an expired session',async()=>{
  const {api}=harness(),s=session(1,{state:'Stopped',endTime:new Date(now-55_000).toISOString()})
  const cursor=api.initialSampleCursor(now),disk={title:'Restoring Hard disk 1 (60 GB) : 29.9 GB restored at 109 MB/s'}
  const original=fixture([],[s],[],[disk]),captured=[]
  let offline=true
  const read=async path=>{
    if(offline && path.endsWith('/logs'))throw Error('temporary failure')
    return original.read(path)
  }
  await api.sampleSessionCycle(read,async(_s,logs)=>captured.push(logs.available),cursor,now)
  assert.equal(cursor.taskPages[s.id].retries,1)
  offline=false
  await api.sampleSessionCycle(read,async(_s,logs)=>captured.push(logs.available),cursor,now+15_000)
  assert.deepEqual(captured,[false,true])
  assert.equal(cursor.taskPages[s.id],undefined)
})

test('bootstrap starts once, scopes concurrent workers to the configured principal, and refuses redirected/changed sources',async t=>{
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'vbr-sampler-'))
  t.after(()=>fs.promises.rm(dir,{recursive:true,force:true}))
  const s=session(1),{read}=fixture([s]),calls=[]
  let change=false
  const h=harness({dir,fetch:async(url,opts)=>{
    calls.push([url,opts])
    assert.equal(url.origin,'https://backup.test:9419');assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error')
    if(url.pathname==='/api/v1/serverInfo')return {status:200,ok:true,json:async()=>({buildVersion:'13.1.0.411'})}
    const result=await read(url.pathname+url.search)
    if(change && url.pathname.endsWith('/logs'))h.sources.set(source.id,{...source,username:'different'})
    return {status:200,ok:true,json:async()=>result}
  }})
  await Promise.all([h.api.collectThroughputSource({...source}),h.api.collectThroughputSource({...source})])
  assert.equal(h.measures.length,1)
  assert.match(h.measures[0][0],/^[a-f0-9]{64}$/)
  assert.equal(calls.find(([u])=>u.pathname==='/api/v1/sessions')[1].headers['x-api-version'],'1.3-rev2')
  await h.api.collectThroughputSource({...source})
  assert.equal(h.measures.length,1)
  const names=await fs.promises.readdir(path.join(dir,'data','session-sampler'))
  const file=path.join(dir,'data','session-sampler',names.find(n=>n.endsWith('.json')))
  const marker=JSON.parse(await fs.promises.readFile(file,'utf8'));marker.lastPoll=0
  await fs.promises.writeFile(file,JSON.stringify(marker))
  change=true;await assert.rejects(h.api.collectThroughputSource({...source}),/source changed/)
  assert.equal(h.measures.length,1)
  h.sources.clear()
  h.api.startSessionThroughputCollector();h.api.startSessionThroughputCollector()
  assert.equal(h.timers.length,1);assert.equal(h.sweeps.length,1)
})
