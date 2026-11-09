// Open Backup UI v1.0.2
import {randomUUID} from 'node:crypto'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {parseRestoreDisk, processingBytesPerSecond, type ThroughputHistory, type ThroughputSample} from '../activity/throughput'
import {validId, type Evidence, type Logs, type Session, type Task} from '../investigation/model'
import {withFileLease} from './file-lease'

export const throughputRetentionMs = 12 * 60 * 60_000
export const maxThroughputSamples = 1440
const scopePattern = /^[a-f0-9]{64}$/
type Series = Omit<ThroughputSample, 'at' | 'bytesPerSecond'>
type Reading = {key:string; series:Series; at:number; rate?:number; counter?:number; liveAt?:number}
type Cursor = Pick<Reading, 'at' | 'rate' | 'counter'> & {counterAt?:number; nativeAt?:number}
type Stored = ThroughputHistory & {scope:string; sessionId:string; lastSeen:number; cursors:Record<string, Cursor>}

function stamp(value?: string | null) {
  const at = Date.parse(value || '')
  return Number.isFinite(at) && at > 0 ? at : undefined
}
function elapsed(value?: string | null) {
  const match = /^(?:(\d+)\.)?(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,7}))?$/.exec(value || '')
  if (!match) return
  return (((Number(match[1] || 0) * 24 + Number(match[2])) * 60 + Number(match[3])) * 60 + Number(match[4])) * 1000 +
    Number((match[5] || '').padEnd(3, '0').slice(0, 3))
}
function stopped(record: Session | Task) {
  return !!stamp(record.endTime) || ['Stopped','Canceled','Cancelled','Failed','Succeeded'].includes(record.state || '') ||
    record.result?.isCanceled === true || ((!record.state || record.state === 'Idle') &&
      ['Success','Warning','Failed','Canceled','Cancelled'].includes(record.result?.result || ''))
}
function progressTime(record: Session | Task, observedAt: number) {
  const start = stamp(record.creationTime), duration = elapsed(record.progress?.duration)
  const end = stamp(record.endTime)
  if (end !== undefined && end <= observedAt) return end
  if (start !== undefined && duration !== undefined && start + duration <= observedAt) return start + duration
  if (record.state && !stopped(record)) return observedAt
}

function structured(record: Session | Task, observedAt: number, series: Series): Reading | undefined {
  if (!record.progress) return
  const at = progressTime(record, observedAt), rate = processingBytesPerSecond(record.progress.processingRate)
  const transferred = record.progress.transferredSize
  const counter = transferred != null && Number.isSafeInteger(transferred) && transferred >= 0 ? transferred : undefined
  if (at === undefined || (rate === undefined && counter === undefined)) return
  return {key:series.taskId ? 'task/' + series.taskId : 'session', series, at, rate, counter}
}

function readings(session: Session, logs: Logs, observedAt: number, tasks?: Evidence<Task>) {
  const result: Reading[] = []
  const parent = structured(session, observedAt, {basis:'session'})
  if (parent) result.push(parent)
  if (tasks?.available) for (const task of tasks.data) {
    if (task.sessionId !== session.id || !validId(task.id)) continue
    // A terminal parent can contain stale task rows without their own stop times.
    if (stopped(session) && !stopped(task)) continue
    const reading = structured(task, observedAt, {basis:'task',taskId:task.id, ...(task.name && {taskName:task.name.slice(0,256)})})
    if (reading) result.push(reading)
  }
  const sessionStart = stamp(session.creationTime), sessionEnd = stamp(session.endTime)
  if (logs.available) for (const log of logs.data) {
    const measurement = parseRestoreDisk(log.title)
    if (!measurement || measurement.bytesPerSecond === undefined) continue
    const updated = stamp(log.updateTime), start = stamp(log.startTime)
    // startTime is the beginning of disk restore. It cannot date a cumulative rate.
    const live = !!session.state && !stopped(session) && !/^(?:Succeeded|Success|Warning|Failed|Canceled|Cancelled)$/i.test(log.status || '')
    const at = updated !== undefined && (start === undefined || updated > start) ? updated : live ? observedAt : undefined
    if (at === undefined || at > observedAt || (sessionStart !== undefined && at < sessionStart) || (sessionEnd !== undefined && at > sessionEnd)) continue
    const logId = log.id != null && Number.isSafeInteger(log.id) ? log.id : undefined
    const {disk, bytesPerSecond:rate, restoredBytes:counter} = measurement
    // With no VBR record ID, use the disk start for identity when available. Do not
    // combine similarly named disks from different VMs into a session-wide total.
    const key = 'disk/' + (logId ?? (disk + '/' + (start ?? '')))
    result.push({key, at, rate, counter, liveAt:live ? observedAt : undefined,
      series:{basis:'disk',disk,...(logId !== undefined && {logId})}})
  }
  return result
}

function sampleKey(point: ThroughputSample) {
  return [point.at, point.basis, point.taskId || '', point.logId ?? point.disk ?? ''].join('/')
}
function mergeReadings(record: Stored, items: Reading[]) {
  const additions = new Map<string, ThroughputSample>()
  for (const item of items) {
    const {rate, counter, series} = item, previous = record.cursors[item.key]
    // A poll of the same (possibly already completed) native row is not another measurement.
    if (previous && previous.rate === rate && previous.counter === counter) continue
    // Some active rows keep the same updateTime when VBR replaces the byte count.
    // The changed value was actually observed at this poll; retain the earlier point.
    const at = previous?.nativeAt === item.at && item.liveAt !== undefined && item.liveAt > previous.at ?
      item.liveAt : item.at
    let sample: ThroughputSample | undefined
    if (rate !== undefined) sample = {...series, at, bytesPerSecond:rate}
    else if (counter !== undefined && previous?.counter !== undefined && previous.counterAt !== undefined &&
      at > previous.counterAt && counter > previous.counter) {
      sample = {...series, basis:'transferred', at, bytesPerSecond:1000 * (counter - previous.counter) / (at - previous.counterAt)}
    }
    if (sample) additions.set(sampleKey(sample), sample)
    if (!previous || at >= previous.at) {
      const counterAt = counter === undefined ? undefined :
        previous?.counter === counter ? previous.counterAt : at
      record.cursors[item.key] = {at, nativeAt:item.at, rate, counter, counterAt}
    }
  }
  if (!additions.size) return
  const merged = new Map(record.samples.map(sample => [sampleKey(sample), sample]))
  for (const [key,sample] of additions) merged.set(key, sample)
  let samples = [...merged.values()].sort((a,b) => a.at - b.at)
  // Keep actual measurements spanning the run. Thin older observations first and
  // retain the recent detailed window; never interpolate or synthesize extrema.
  while (samples.length > maxThroughputSamples) {
    const midpoint = Math.ceil(samples.length / 2)
    samples = samples.filter((_, index) => index >= midpoint || index % 2 === 0)
  }
  record.samples = samples
}

const missing = (error:unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const empty = (expiresAt:number | null = null):ThroughputHistory => ({samples:[], expiresAt})
const expiry = (row:Stored) => row.expiresAt ?? row.lastSeen + throughputRetentionMs

export class SessionThroughputStore {
  constructor(private directory = path.join(process.cwd(), 'data', 'session-throughput'), private now = Date.now) {}

  private file(scope: string, sessionId: string) {
    if (!scopePattern.test(scope) || !validId(sessionId)) throw new Error('Invalid session throughput scope.')
    return path.join(this.directory, scope, sessionId.toLowerCase() + '.json')
  }
  private async load(file:string, scope:string, id:string):Promise<Stored|null> {
    try {
      const row:Stored = JSON.parse(await fs.readFile(file,'utf8'))
      if (row.scope !== scope || row.sessionId !== id || !Number.isFinite(row.lastSeen) ||
          !(row.expiresAt === null || Number.isFinite(row.expiresAt)) || !Array.isArray(row.samples) ||
          row.samples.length > maxThroughputSamples || !row.cursors || typeof row.cursors !== 'object') throw new Error('Invalid session throughput history.')
      return row
    } catch (error) { if (missing(error)) return null; throw error }
  }
  private async save(file:string, row:Stored) {
    const temp = file + '.' + randomUUID() + '.tmp'
    try {
      await fs.writeFile(temp, JSON.stringify(row), {mode:0o600, flag:'wx'})
      await fs.rename(temp,file)
    } finally { await fs.unlink(temp).catch(() => {}) }
  }
  private async locked<T>(file:string, action:()=>Promise<T>) {
    for (let i=0; i<35; i++) {
      const value = await withFileLease(file + '.lock', 30_000, action)
      if (value !== null) return value
      await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 40))
    }
    throw new Error('Session throughput history is busy.')
  }

  async read(scope:string, sessionId:string, nativeEndTime?:string|null):Promise<ThroughputHistory> {
    const id = sessionId.toLowerCase(), file = this.file(scope,id)
    const nativeEnd = stamp(nativeEndTime)
    const deadline = nativeEnd === undefined ? null : nativeEnd + throughputRetentionMs
    const prior = await this.load(file,scope,id)
    if (!prior) return empty(deadline)
    if (expiry(prior) > this.now() && (deadline === null || deadline === prior.expiresAt)) {
      return {samples:prior.samples, expiresAt:prior.expiresAt}
    }
    return this.locked(file, async () => {
      const current = await this.load(file,scope,id)
      if (!current) return empty(deadline)
      if (expiry(current) <= this.now() || (deadline !== null && deadline <= this.now())) {
        await fs.unlink(file)
        return empty(deadline ?? current.expiresAt)
      }
      if (deadline !== null && deadline !== current.expiresAt) {
        current.expiresAt = deadline
        current.samples = current.samples.filter(point => point.at <= nativeEnd!)
        await this.save(file,current)
      }
      return {samples:current.samples, expiresAt:current.expiresAt}
    })
  }

  async record(scope:string, session:Session, logs:Logs, observedAt = this.now(), tasks?:Evidence<Task>):Promise<ThroughputHistory> {
    const id = session.id.toLowerCase(), file = this.file(scope,id)
    if (!Number.isFinite(observedAt) || observedAt <= 0 || observedAt > this.now()) throw new Error('Invalid throughput observation time.')
    const nativeEnd = stamp(session.endTime), done = stopped(session)
    const items = readings(session,logs,observedAt,tasks)
    return this.locked(file, async () => {
      const now = this.now()
      let prior = await this.load(file,scope,id)
      if (prior && expiry(prior) <= now) {
        await fs.unlink(file)
        prior = null
      }
      // An authorized fresh read of old VBR logs must not recreate expired history.
      // For terminal rows without endTime, use dated VBR evidence before the first
      // observed stop; repeated reads never push the deadline forward.
      let ends = nativeEnd !== undefined ? Math.min(nativeEnd, observedAt) : undefined
      if (done && ends === undefined) {
        if (prior?.expiresAt != null) ends = prior.expiresAt - throughputRetentionMs
        else {
          const dated = Math.max(0, progressTime(session,observedAt) || 0,
            ...logs.data.flatMap(log => {const at = stamp(log.updateTime); return at && at <= observedAt ? [at] : []}))
          ends = dated || (prior ? observedAt : undefined)
        }
      }
      const deadline = ends === undefined ? prior?.expiresAt ?? null : ends + throughputRetentionMs
      if (deadline !== null && deadline <= now) {
        if (prior) await fs.unlink(file)
        return empty(deadline)
      }
      if ((!prior && done && !ends) || observedAt + throughputRetentionMs <= now) return empty(deadline)
      if (!prior && !items.length) return empty(deadline)
      const row:Stored = prior ?? {scope, sessionId:id, lastSeen:observedAt, expiresAt:null, samples:[], cursors:{}}
      const before = JSON.stringify(row)
      row.expiresAt = deadline
      // A delayed active poll must not add observations after known completion.
      const end = deadline === null ? Infinity : deadline - throughputRetentionMs
      if (row.samples.some(sample => sample.at > end)) row.samples = row.samples.filter(sample => sample.at <= end)
      mergeReadings(row, items.filter(item => item.at <= end))
      const cursors = Object.entries(row.cursors)
      if (cursors.length > maxThroughputSamples) row.cursors = Object.fromEntries(cursors.sort((a,b) => b[1].at - a[1].at).slice(0,maxThroughputSamples))
      if (deadline === null && observedAt - row.lastSeen >= 60_000) row.lastSeen = observedAt
      if (!prior || before !== JSON.stringify(row)) await this.save(file,row)
      return {samples:row.samples, expiresAt:row.expiresAt}
    })
  }

  async sweep():Promise<void> {
    let scopes
    try { scopes = await fs.readdir(this.directory, {withFileTypes:true}) }
    catch (error) { if (missing(error)) return; throw error }
    for (const scope of scopes) {
      if (!scope.isDirectory() || !scopePattern.test(scope.name)) continue
      const dir = path.join(this.directory,scope.name)
      const files = await fs.readdir(dir)
      for (const name of files) {
        // After a process crash an unpublished temp file can still contain samples.
        const temp = /^([a-f0-9-]+)\.json\.([a-f0-9-]+)\.tmp$/.exec(name)
        if (temp && validId(temp[1]) && validId(temp[2])) {
          const file = path.join(dir,name)
          try {
            if ((await fs.stat(file)).mtimeMs + 5 * 60_000 <= this.now()) await fs.unlink(file)
          } catch (error) { if (!missing(error)) throw error }
          continue
        }
        const id = name.slice(0,-5)
        if (!name.endsWith('.json') || !validId(id)) continue
        const file = this.file(scope.name,id)
        const row = await this.load(file,scope.name,id)
        if (!row || expiry(row) > this.now()) continue
        // A worker may have refreshed the active session since the initial scan.
        await this.locked(file, async () => {
          const locked = await this.load(file,scope.name,id)
          if (locked && expiry(locked) <= this.now()) await fs.unlink(file)
          return true
        })
      }
    }
  }
}

const store = new SessionThroughputStore()
export const recordSessionThroughput = store.record.bind(store)
export const readSessionThroughput = store.read.bind(store)
export const sweepSessionThroughput = store.sweep.bind(store)
