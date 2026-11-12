// Open Backup UI v1.2.0
import {time, type LogRecord, type Session, type Task} from '../investigation/model'
import {processingBytesPerSecond, type ThroughputHistory} from './throughput'

export type MigrationPlan = {sourceHost?: string; targetHost?: string; sources: string[]; targets: string[]}
export type MigrationProxy = {name:string; transport?:string}
export type MigrationProxies = {source?:MigrationProxy; target?:MigrationProxy}
export type MigrationSpeed = {bytesPerSecond:number; basis:'processing'|'transferred'}

const eventTime = (row:LogRecord) => time(row.updateTime) ?? time(row.startTime) ?? 0
function newest(a:LogRecord, b:LogRecord) {
  return eventTime(b) - eventTime(a) || (b.id ?? 0) - (a.id ?? 0)
}

/** Assignment events belong to the current VM task and its latest migration plan. */
export function readMigrationProxies(logs: LogRecord[]):MigrationProxies {
  const ordered = [...logs].sort(newest), proxies:MigrationProxies = {}
  for (const row of ordered) {
    if (/^Migration plan:[ \t]*\r?\n/i.test(row.title || '') && (eventTime(row) || row.id != null)) break
    if (/fail|error|cancel/i.test(row.status || '')) continue
    const assignment = /^Using (source|target) proxy ([^\[\]\r\n]+?)(?:\s+\[([^\[\]\r\n]+)\])?\s*$/i.exec(row.title || '')
    if (!assignment || !assignment[2].trim()) continue
    const role = assignment[1].toLowerCase() === 'source' ? 'source' : 'target'
    if (!proxies[role]) proxies[role] = {name:assignment[2].trim(), ...(assignment[3]?.trim() && {transport:assignment[3].trim()})}
  }
  return proxies
}

export function migrationHops(proxies:MigrationProxies) {
  const {source,target} = proxies
  if (source && target && source.name.toLowerCase() === target.name.toLowerCase()) {
    return [{role:'both' as const, name:source.name, read:source.transport, write:target.transport}]
  }
  return [...(source ? [{role:'source' as const,name:source.name,read:source.transport,write:undefined}] : []),
    ...(target ? [{role:'target' as const,name:target.name,read:undefined,write:target.transport}] : [])]
}

/** A task's processingRate is VBR's average; it is not separate read and write throughput. */
export function migrationSpeed(session:Session|null|undefined, task:Task|undefined, single:boolean, history?:ThroughputHistory):MigrationSpeed|undefined {
  if (session?.sessionType !== 'QuickMigration' || (task && task.sessionId !== session.id)) return
  const native = processingBytesPerSecond(task?.progress?.processingRate) ??
    (single || !task ? processingBytesPerSecond(session.progress?.processingRate) : undefined)
  if (native !== undefined) return {bytesPerSecond:native,basis:'processing'}
  if (!history || history.expiresAt != null && history.expiresAt <= Date.now()) return
  const now=Date.now()
  const usable = history.samples.filter(row => Number.isFinite(row.bytesPerSecond) && row.bytesPerSecond >= 0 &&
    row.at <= now && row.at >= now-120_000 &&
    (row.basis === 'task' || row.basis === 'session' || row.basis === 'transferred'))
  const selected = task ? usable.filter(row => row.taskId === task.id) : []
  const candidates = selected.length ? selected : single || !task ? usable.filter(row => !row.taskId) : []
  const latest = candidates.reduce<typeof candidates[number]|undefined>((a,b)=>!a || b.at > a.at ? b : a, undefined)
  if (latest) return {bytesPerSecond:latest.bytesPerSecond,basis:latest.basis==='transferred' ? 'transferred' : 'processing'}
}

// VBR writes one multi-line migration plan to the individual VM's task log.
export function readMigrationPlan(logs: LogRecord[]): MigrationPlan | undefined {
  const plans = logs.filter(entry => /^Migration plan:[ \t]*\r?\n/i.test(entry.title || ''))
    .sort(newest)
  const lines = plans[0]?.title?.split(/\r?\n/)
  if (!lines) return
  const sources = new Set<string>(), targets = new Set<string>()
  const hosts = new Set<string>(), destinations = new Set<string>()
  for (const line of lines) {
    const pair = /^\s*\[(Host|Datastore)\]\s+(.+?)\s+>\s+(.+?)\s*$/i.exec(line)
    if (!pair) continue
    const [, type, from, to] = pair
    if (type.toLowerCase() === 'host') {
      hosts.add(from); destinations.add(to)
    } else {
      sources.add(from.replace(/^\[(.*)\]$/, '$1'))
      targets.add(to.replace(/^\[(.*)\]$/, '$1'))
    }
  }
  if (!hosts.size && !sources.size) return
  return {sourceHost:hosts.size === 1 ? [...hosts][0] : undefined, targetHost:destinations.size === 1 ? [...destinations][0] : undefined,
    sources:[...sources], targets:[...targets]}
}
