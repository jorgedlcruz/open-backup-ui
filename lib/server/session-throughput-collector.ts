// Open Backup UI v1.2.0
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { configStore, type VBRSource } from './config-store'
import { tokenManager } from './token-manager'
import { configuredScope } from './capacity-collector'
import { withFileLease } from './file-lease'
import { recordSessionThroughput, sweepSessionThroughput, throughputRetentionMs as retention } from './session-throughput'
import { loadLogs } from '../investigation/load'
import { investigationSessionSchema, revisionForBuild, taskSchema, validId, type Evidence, type Logs, type Session, type Task } from '../investigation/model'

const interval = 15_000, pageSize = 200
const root = path.join(process.cwd(), 'data', 'session-sampler')
const states = ['Working','Starting','Stopping','Idle','WaitingRepository','WaitingSlot','Postprocessing','Pausing','Resuming','WaitingTape','ActionRequired']
const offset = z.number().int().nonnegative()
const timeWindow = z.object({from:offset, until:offset, skip:offset})
const cursorSchema = z.object({
  lastPoll:offset, live:offset, state:offset, states:z.record(z.string(),offset), frontier:offset,
  recent:timeWindow.optional(), backfill:timeWindow.optional(),
  taskPages:z.record(z.string(),z.object({skip:offset, seen:offset, ended:offset.optional(), retries:offset.optional(), after:offset.optional()})),
})
type Cursor = z.infer<typeof cursorSchema>
type Read = (endpoint:string) => Promise<unknown>
type RecordSample = (session:Session, logs:Logs, time:number, tasks:Evidence<Task>) => Promise<unknown>
const emptyLogs: Logs = {data:[],available:false,complete:false,total:null}
const emptyTasks: Evidence<Task> = {data:[],available:false,complete:false}
const envelope = z.object({data:z.array(z.unknown()), pagination:z.object({skip:offset, total:offset})})
const iso = (n:number) => new Date(n).toISOString()
export function initialSampleCursor(now:number): Cursor {
  const boundary = Math.max(0,now-60_000)
  return {lastPoll:0,live:0,state:0,states:{},frontier:boundary,taskPages:{},
    backfill:{from:Math.max(0,now-retention),until:boundary,skip:0}}
}

async function mapWorkers<T>(items:T[], maximum:number, visit:(item:T)=>Promise<void>) {
  let position=0
  const results=await Promise.allSettled(Array.from({length:Math.min(maximum,items.length)},async()=>{
    while(position<items.length) await visit(items[position++])
  }))
  for(const result of results)if(result.status==='rejected')throw result.reason
}

async function discover(read:Read, filter:Record<string,string>, skip:number, limit:number, order:'CreationTime'|'EndTime') {
  const query=new URLSearchParams({...filter,skip:String(skip),limit:String(limit),orderColumn:order,orderAsc:order==='EndTime'?'false':'true'})
  const page=envelope.parse(await read('/api/v1/sessions?'+query))
  if(page.pagination.skip!==skip) throw new Error('Unexpected session offset.')
  const rows=page.data.flatMap(raw=>{const row=investigationSessionSchema.safeParse(raw); return row.success?[row.data]:[]})
  const next=skip+page.data.length
  return {rows, next:page.data.length && next<page.pagination.total ? next : 0}
}

/** Poll one page per lane. A large queue cannot permanently hide old active sessions, recently finished jobs or shorter runs. */
export async function sampleSessionCycle(read:Read, record:RecordSample, cursor:Cursor, now=Date.now()) {
  const state=states[cursor.state%states.length]
  const cutoff=Math.max(0,now-retention)
  const recent=cursor.recent && cursor.recent.until>=cutoff ? cursor.recent : {from:Math.max(cutoff, cursor.frontier-5000),until:now,skip:0}
  const older=cursor.backfill && cursor.backfill.until>=cutoff ? cursor.backfill : undefined
  const ended=(window:z.infer<typeof timeWindow>,size:number)=>discover(read,{
    endedAfterFilter:iso(window.from),endedBeforeFilter:iso(window.until),
  },window.skip,size,'EndTime')
  const [active,other,finished,history]=await Promise.allSettled([
    discover(read,{resultFilter:'None'},cursor.live,16,'CreationTime'),
    discover(read,{stateFilter:state},cursor.states[state]||0,6,'CreationTime'),
    ended(recent,5), older ? ended(older,3) : Promise.resolve(undefined),
  ])
  if([active,other,finished].every(page=>page.status==='rejected')) throw new Error('Session discovery is unavailable.')
  const sessions=new Map<string,Session>()
  const addLive=(rows:Session[])=>rows.filter(s=>!s.endTime && s.state!=='Stopped').forEach(s=>sessions.set(s.id,s))
  const addEnded=(rows:Session[])=>rows.filter(s=>s.endTime && Date.parse(s.endTime)>=cutoff && Date.parse(s.endTime)<=now).forEach(s=>sessions.set(s.id,s))
  if(active.status==='fulfilled') {addLive(active.value.rows); cursor.live=active.value.next}
  if(other.status==='fulfilled') {addLive(other.value.rows);cursor.states[state]=other.value.next}
  cursor.state=(cursor.state+1)%states.length
  if(finished.status==='fulfilled') {
    addEnded(finished.value.rows)
    cursor.recent=finished.value.next ? {...recent,skip:finished.value.next} : undefined
    if(!cursor.recent)cursor.frontier=recent.until
  }
  if(!older)cursor.backfill=undefined
  else if(history.status==='fulfilled' && history.value) {
    addEnded(history.value.rows)
    cursor.backfill=history.value.next ? {...older,skip:history.value.next} : undefined
  }

  // A very large job may need several task pages. Resume terminal jobs by their exact session ID
  // after they leave the discovery window; never re-scan an unbounded task collection in one tick.
  const pending=Object.entries(cursor.taskPages)
  for(const [id,item] of pending) if(!validId(id) || (item.ended ?? item.seen)<cutoff) delete cursor.taskPages[id]
  const followups=pending.filter(([id,item])=>cursor.taskPages[id]?.ended && !sessions.has(id) && (!item.after || item.after<=now))
    .sort((a,b)=>a[1].seen-b[1].seen).slice(0,2)
  await Promise.all(followups.map(async ([id,item])=>{
    item.seen=now
    try {
      const row=investigationSessionSchema.parse(await read('/api/v1/sessions/'+id))
      if(row.id===id && row.endTime && Date.parse(row.endTime)>=cutoff)sessions.set(id,row)
    }catch{ /* Another tick can resume within retention. */ }
  }))
  await mapWorkers([...sessions.values()],3,async session=>{
    const base='/api/v1/sessions/'+session.id
    const prior=cursor.taskPages[session.id], skip=prior?.skip || 0
    if(session.endTime && prior?.after && prior.after>now)return
    let tasks:Evidence<Task>=emptyTasks,next=0,gotTasks=false
    try {
      const page=envelope.parse(await read(base+'/taskSessions?skip='+skip+'&limit='+pageSize))
      if(page.pagination.skip===skip) {
        const selected=page.data.flatMap(raw=>{const task=taskSchema.safeParse(raw);return task.success&&task.data.sessionId===session.id?[task.data]:[]})
        next=page.data.length && skip+page.data.length<page.pagination.total ? skip+page.data.length : 0
        tasks={data:selected,available:true,complete:!skip&&!next&&selected.length===page.pagination.total}
        gotTasks=true
      }
    }catch{ /* Session/log measurements can still be available. */ }
    const needsLogs=/Restore|Recovery|Migration/i.test(session.sessionType||'') ||
      !session.progress?.processingRate && !tasks.data.some(t=>t.progress?.processingRate)
    const logs=needsLogs ? await loadLogs(read,base+'/logs').catch(()=>emptyLogs) : emptyLogs
    await record(session,logs,now,tasks)
    const endedAt=session.endTime ? Date.parse(session.endTime) : undefined
    if(next || !endedAt && !gotTasks && skip) cursor.taskPages[session.id]={skip:next||skip,seen:now,ended:endedAt}
    else if(endedAt && (!gotTasks || needsLogs && !logs.available) && (prior?.retries || 0)<3) {
      const retries=(prior?.retries || 0)+1
      cursor.taskPages[session.id]={skip:gotTasks?0:skip,seen:now,ended:endedAt,retries,after:now+interval*4**(retries-1)}
    }
    else delete cursor.taskPages[session.id]
  })
  cursor.lastPoll=now
}

type Runtime = {timer?:ReturnType<typeof setInterval>; busy:boolean; nextSweep:number; sweeping?:boolean}
const globalSampler=globalThis as typeof globalThis & {vbrThroughputSampler?:Runtime}
const enabled=()=>process.env.SESSION_THROUGHPUT_COLLECTOR_ENABLED!=='false'

export async function collectThroughputSource(source:VBRSource) {
  if(!enabled() || source.platform!=='vbr' || !source.password)return
  const {scope,destination}=configuredScope(source), file=path.join(root,scope+'.json')
  await withFileLease(path.join(root,scope+'.lock'),90_000,async()=>{
    const now=Date.now()
    let cursor:Cursor
    try {
      const stored=cursorSchema.safeParse(JSON.parse(await fs.readFile(file,'utf8')))
      cursor=stored.success ? stored.data : initialSampleCursor(now)
    }catch(error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT' && !(error instanceof SyntaxError))throw error
      cursor=initialSampleCursor(now)
    }
    if(now>=cursor.lastPoll && now-cursor.lastPoll<interval-1000)return
    if(now<cursor.lastPoll || now-cursor.lastPoll>=retention)cursor=initialSampleCursor(now)
    const signal=AbortSignal.timeout(45_000)
    const check=()=>{
      signal.throwIfAborted()
      const current=configStore.getById(source.id)
      if(!current?.password || current.platform!=='vbr' || configuredScope(current).scope!==scope) throw new Error('VBR source changed.')
    }
    check()
    let token=await tokenManager.getToken(source.id), refreshed:Promise<string|null>|undefined
    if(!token)return
    let revision:'1.3-rev1'|'1.3-rev2'='1.3-rev1'
    const read:Read=async endpoint=>{
      const url=new URL(endpoint,destination)
      if(url.origin!==destination.origin || !/^\/api\/v1\/(?:serverInfo|sessions(?:\/[0-9a-f-]{36}(?:\/(?:logs|taskSessions))?)?)$/.test(url.pathname))throw new Error('Unsupported session sampler request.')
      const send=()=>{check();return fetch(url,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json','x-api-version':revision},cache:'no-store',redirect:'error',signal})}
      let response=await send()
      if(response.status===401) {
        refreshed ||= tokenManager.refreshToken(source.id)
        token=await refreshed
        if(token)response=await send()
      }
      if(!response.ok)throw new Error('Session measurement unavailable.')
      return response.json()
    }
    const server=await read('/api/v1/serverInfo').catch(()=>null) as {buildVersion?:string}|null
    revision=revisionForBuild(server?.buildVersion)
    await sampleSessionCycle(read,async(session,logs,_cycleStart,tasks)=>{
      check()
      await recordSessionThroughput(scope,session,logs,Date.now(),tasks)
    },cursor,now)
    check()
    const temp=file+'.'+randomUUID()+'.tmp'
    try {
      await fs.writeFile(temp,JSON.stringify(cursor),{flag:'wx',mode:0o600})
      await fs.rename(temp,file)
    }finally{await fs.unlink(temp).catch(()=>{})}
  })
}

async function sweep() {
  await sweepSessionThroughput()
  // Remove abandoned per-source paging cursors after saved credentials are removed or changed.
  for(const name of await fs.readdir(root).catch(()=>[] as string[])) {
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue
    const file=path.join(root,name)
    const stats=await fs.stat(file).catch(()=>null)
    if(!stats || Date.now()-stats.mtimeMs<retention)continue
    await withFileLease(path.join(root,name.slice(0,-5)+'.lock'),10_000,async()=>{
      const current=await fs.stat(file).catch(()=>null)
      if(current && Date.now()-current.mtimeMs>=retention)await fs.unlink(file).catch(()=>{})
    })
  }
}

export function startSessionThroughputCollector() {
  if(process.env.NEXT_PHASE==='phase-production-build')return
  const runtime=globalSampler.vbrThroughputSampler ||= {busy:false,nextSweep:0}
  if(runtime.timer)return
  const tick=async()=>{
    if(!runtime.sweeping && Date.now()>=runtime.nextSweep) {
      runtime.sweeping=true
      runtime.nextSweep=Date.now()+15*60_000
      void sweep().catch(()=>{}).finally(()=>{runtime.sweeping=false})
    }
    if(runtime.busy)return
    runtime.busy=true
    try {
      if(!enabled())return
      const ids=new Set(configStore.getAll().filter(s=>s.platform==='vbr' && s.hasCredentials).map(s=>s.id))
      if(configStore.getById('env-vbr')?.password)ids.add('env-vbr')
      await mapWorkers([...ids],2,async id=>{
        try { const source=configStore.getById(id); if(source)await collectThroughputSource(source) }
        catch { /* Offline/configuration changes are retried independently on the next tick. */ }
      })
    }catch{ /* An unavailable application data directory is retried on the next tick. */ }
    finally {runtime.busy=false}
  }
  runtime.timer=setInterval(()=>void tick(),interval)
  runtime.timer.unref()
  void tick()
}
