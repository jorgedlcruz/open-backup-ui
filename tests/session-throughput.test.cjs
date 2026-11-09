// Open Backup UI v1.0.2
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const ts = require('typescript'), test = require('node:test'), assert = require('node:assert/strict')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText,file)
const {SessionThroughputStore,throughputRetentionMs,maxThroughputSamples} = require('../lib/server/session-throughput.ts')
const {parseRestoreDisk,processingBytesPerSecond} = require('../lib/activity/throughput.ts')

const source = 'a'.repeat(64), secondSource = 'b'.repeat(64), now = Date.parse('2026-11-09T21:11:00Z')
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0')
const stamp = ms => new Date(ms).toISOString()
const session = {id:id(1),state:'Working',creationTime:stamp(now)}
const evidence = data => ({data,available:true,complete:true})
const disk = (restored,rate,update,status='No status') => ({id:7028841, status, startTime:stamp(now+8000),
  updateTime:update ? stamp(update) : undefined, title:`Restoring Hard disk 1 (60 GB) : ${restored} restored at ${rate}  [hotadd]`})

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(),'obui-throughput-'))
  t.after(() => fs.promises.rm(dir,{recursive:true,force:true}))
  const clock = {at:now}, open = () => new SessionThroughputStore(dir,()=>clock.at)
  return {store:open(),clock,dir,open}
}

test('parses VBR restore log evidence and native processing rate units without mixing sizes or bits', () => {
  assert.deepEqual(parseRestoreDisk(disk('5.8 GB','141 MB/s',now).title),
    {disk:'Hard disk 1',restoredBytes:5800000000,bytesPerSecond:141000000})
  assert.deepEqual(parseRestoreDisk('Restoring Virtual disk 2 (8 GiB)'),{disk:'Virtual disk 2'})
  assert.equal(parseRestoreDisk('Using proxy proxy for restoring disk Hard disk 1'),null)
  assert.equal(parseRestoreDisk(disk('4 GB','141 MB',now).title).bytesPerSecond,undefined)
  assert.equal(processingBytesPerSecond('1,5 MiB/s'),1.5 * 1024 ** 2)
  assert.equal(processingBytesPerSecond('8 Mbps'),1000000)
  assert.equal(processingBytesPerSecond('53.7 MB'),53700000)
  for (const value of ['N/A','','Infinity KB/s','-2 MB/s','1 MB per minute']) assert.equal(processingBytesPerSecond(value),undefined)
})

test('a changing No status disk row is sampled at its native update time and frozen when it stops changing', async t => {
  const {store,clock,open} = await fixture(t), t1=now+18_000,t2=now+29_000
  const first=disk('5.8 GB','141 MB/s',t1)
  clock.at=t1+2000
  await store.record(source,session,evidence([first]))
  clock.at=t2+2000
  const second=disk('6.4 GB','120 MB/s',t2)
  await store.record(source,session,evidence([second]))
  clock.at+=30000
  let result=await open().record(source,session,evidence([second]))
  assert.deepEqual(result.samples.map(p=>[p.at,p.bytesPerSecond,p.basis,p.disk,p.logId]),[
    [t1,141000000,'disk','Hard disk 1',7028841],[t2,120000000,'disk','Hard disk 1',7028841]])
  const end=now+300_000
  clock.at=end+60_000
  const final=disk('29.9 GB','109 MB/s',end-10_600,'Succeeded')
  const stopped={...session,state:'Stopped',endTime:stamp(end)}
  result=await store.record(source,stopped,evidence([final]))
  assert.equal(result.samples.at(-1).at,end-10_600)
  assert.equal(result.expiresAt,end+throughputRetentionMs)
  clock.at+=60000
  assert.deepEqual(await open().record(source,stopped,evidence([final])),result)
  assert.deepEqual(await store.read(secondSource,session.id),{samples:[],expiresAt:null})
})

test('a changing live row with a frozen timestamp uses its observed time; a terminal row with only its start is never backdated', async t => {
  const {store,clock}=await fixture(t)
  clock.at=now+60000
  await store.record(source,session,evidence([disk('1 GB','90 MB/s',clock.at-1000)]))
  clock.at+=5000
  const result=await store.record(source,session,evidence([disk('3 GB','100 MB/s',clock.at-6000)]))
  assert.deepEqual(result.samples.map(p=>p.at),[now+59000,now+65000])
  const stopped={...session,id:id(5),state:'Stopped',endTime:stamp(clock.at)}
  assert.equal((await store.record(source,stopped,evidence([disk('1 GB','80 MB/s',now+8000)]))).samples.length,0)
})

test('structured task and session averages stay distinct; transferred fallback uses observed byte deltas and excludes reset, repeated and foreign counters', async t => {
  const {store,clock}=await fixture(t), observed=now+10000
  const task={id:id(2),sessionId:session.id,name:'VM',state:'Working',progress:{processingRate:'2 KiB/s'}}
  clock.at=observed
  const row=await store.record(source,{...session,progress:{duration:'00:00:08',processingRate:'2.5 MB/s',transferredSize:10}},evidence([]),clock.at,
    evidence([task,{...task,id:id(3),sessionId:id(4)}]))
  assert.deepEqual(row.samples.map(p=>[p.at,p.bytesPerSecond,p.basis,p.taskId]),[
    [now+8000,2500000,'session',undefined],[observed,2048,'task',id(2)]])
  const point=async (delta,transferredSize) => {
    clock.at=observed+delta
    return store.record(source,{...session,progress:{transferredSize}},evidence([]))
  }
  await point(2000,10)
  let points=(await point(8000,1010)).samples.filter(p=>p.basis==='transferred')
  assert.equal(points.length,1)
  assert.equal(points[0].bytesPerSecond,100)
  await point(12000,1010)
  await point(16000,100)
  points=(await point(20000,1100)).samples.filter(p=>p.basis==='transferred')
  assert.deepEqual(points.map(p=>p.bytesPerSecond),[100,250])
})

test('completed history expires exactly twelve hours from native finish on every read, is physically removed, and cannot be recreated from old logs', async t => {
  const {store,clock,dir,open}=await fixture(t)
  const finish=now+50000, stopped={...session,state:'Stopped',endTime:stamp(finish)}
  const logs=evidence([disk('29.9 GB','109 MB/s',finish-1000)])
  clock.at=finish+throughputRetentionMs-1
  assert.equal((await store.record(source,stopped,logs)).samples.length,1)
  const file=path.join(dir,source,session.id+'.json')
  assert.ok(fs.existsSync(file))
  clock.at++
  assert.deepEqual(await open().read(source,session.id),{samples:[],expiresAt:clock.at})
  assert.equal(fs.existsSync(file),false)
  assert.equal((await store.record(source,stopped,logs)).samples.length,0)
  assert.equal(fs.existsSync(file),false)
})

test('cleanup removes finished and abandoned histories; verified child endTime alone caps an active cache read', async t => {
  const {store,dir,clock}=await fixture(t)
  const logs=evidence([disk('1 GB','109 MB/s',now+10000)])
  const sid=id(2), orphan=id(3)
  clock.at=now+25000
  await store.record(source,session,logs)
  await store.record(source,{...session,id:sid,state:'Stopped',endTime:stamp(now+15000)},logs)
  await store.record(source,{...session,id:orphan},logs)
  clock.at=now+throughputRetentionMs+16000
  assert.equal((await store.read(source,session.id,stamp(now+15000))).samples.length,0)
  await store.sweep()
  assert.equal(fs.existsSync(path.join(dir,source,sid+'.json')),false)
  assert.equal((await store.read(source,orphan)).samples.length,1)
  clock.at+=10000
  await store.sweep()
  assert.deepEqual(await fs.promises.readdir(path.join(dir,source)),[])
})

test('overlapping readers and collector writers retain distinct native rows across store instances and bound large histories', async t => {
  const {store,clock,open}=await fixture(t)
  clock.at=now+30000
  await Promise.all(Array.from({length:12},(_,i)=>open().record(source,session,evidence([{...disk('1 GB','10 MB/s',now+10000+i),id:i}]))))
  assert.equal((await store.read(source,session.id)).samples.length,12)
  const rows=Array.from({length:maxThroughputSamples+300},(_,i)=>({...disk('2 GB','20 MB/s',now+12000+i),id:100+i}))
  const result=await store.record(source,session,evidence(rows))
  assert.ok(result.samples.length<=maxThroughputSamples)
  assert.equal(result.samples[0].at,now+10000)
  assert.equal(result.samples.at(-1).at,now+12000+rows.length-1)
  await assert.rejects(()=>store.read('../outside',session.id))
  await assert.rejects(()=>store.read(source,'../../target'))
})
