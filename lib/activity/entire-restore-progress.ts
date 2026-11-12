// Open Backup UI v1.2.0
import { time, type LogRecord, type Session, type Task } from '../investigation/model'
import { parseRestoreDisk } from './throughput'

type RestoreRecord = Pick<Session, 'state' | 'result' | 'endTime' | 'progress' | 'progressPercent'>
type Phase = 'checking' | 'accepted' | 'completed' | 'warning' | 'failed' | 'canceled' | 'unknown'

export function restoreProgress(record?: RestoreRecord | null) {
  const rawPercent = record?.progressPercent ?? record?.progress?.progressPercent
  const percent = rawPercent != null && rawPercent >= 0 && rawPercent <= 100 ? rawPercent : undefined
  const rawBytes = record?.progress?.transferredSize
  const transferred = rawBytes != null && Number.isSafeInteger(rawBytes) && rawBytes >= 0 ? rawBytes : undefined
  const state = record?.state, result = record?.result?.result
  let phase: Phase = 'unknown'
  if (record?.result?.isCanceled || ['Canceled', 'Cancelled'].includes(state || '')) phase = 'canceled'
  else if (record?.endTime || state === 'Stopped' || !state) {
    if (result === 'Success') phase = 'completed'
    else if (result === 'Failed') phase = 'failed'
    else if (result === 'Warning') phase = 'warning'
    else if (result === 'Canceled' || result === 'Cancelled') phase = 'canceled'
  } else if (state === 'Working') phase = 'accepted'
  else if (['Starting', 'Stopping', 'Pending', 'Pausing', 'Resuming', 'WaitingTape', 'WaitingRepository', 'WaitingSlot', 'Postprocessing', 'ActionRequired'].includes(state)) phase = 'checking'
  return { phase, percent, transferred, state }
}

export function currentRestoreTask(taskId: string | undefined, sessionId: string, tasks: Task[]) {
  return taskId ? tasks.find(task => task.id === taskId && task.sessionId === sessionId) : undefined
}

// VBR can continue to report accumulated bytes while a restore is registering or stopping.
// Animate a transfer only for a current disk/file restore operation in this VM's scope.
export function isTransferring(record: RestoreRecord | null | undefined, log?: LogRecord) {
  if (!record || record.state !== 'Working' || record.endTime || record.result?.isCanceled ||
    (record.result?.result && record.result.result !== 'None') || !log) return false
  const disk = parseRestoreDisk(log.title)
  if (/^(InProgress|Running|Working)$/i.test(log.status || '')) return !!disk || /^Restoring file\b/i.test(log.title || '')
  return (!log.status || log.status === 'None') && (disk?.bytesPerSecond ?? 0) > 0
}

export type RestoreDiskPath = {disk: string; proxy?: string; event?: LogRecord}

// Disk names are local to one VM. The caller supplies only its task log or an unambiguous one-VM session log.
export function restoreDiskPaths(records: LogRecord[]) {
  const paths = new Map<string, RestoreDiskPath>()
  const sequence = (event: LogRecord) => time(event.startTime) ?? time(event.updateTime) ?? 0
  for (const event of [...records].sort((a, b) => sequence(a) - sequence(b) || (a.id ?? 0) - (b.id ?? 0))) {
    const assigned = /^Using proxy (\S+) for restoring disk (.+)$/i.exec(event.title || '')
    const disk = (assigned?.[2] || parseRestoreDisk(event.title)?.disk)?.trim().replace(/\s+/g, ' ')
    if (!disk) continue
    const key = disk.toLowerCase(), path = paths.get(key)
    if (assigned) {
      const failed = /^(Failed|Error|Canceled|Cancelled)$/i.test(event.status || '')
      paths.set(key, {disk, proxy:failed ? undefined : assigned[1]})
    } else paths.set(key, {disk, proxy:path?.proxy, event})
  }
  return [...paths.values()]
}

export function diskPathActive(session: Session | null, task: Task | undefined, event?: LogRecord, latest?: LogRecord) {
  if (!isTransferring(session, event) || (task && !isTransferring({...task, state:task.state || session?.state}, event))) return false
  // A newer explicit finalization step supersedes an unclassified native disk row that still has its last measured rate.
  return event === latest || !/^(?:Finalizing\b|Stopping\b|Powering on\b|Unmounting\b|Registering restored VM\b|Restore completed\b)/i.test(latest?.title || '')
}

export function latestRestoreEvent(records: LogRecord[]) {
  let latest: LogRecord | undefined, stamp = -Infinity
  for (const event of records) {
    if (!event.title?.trim()) continue
    const eventStamp = time(event.updateTime) ?? time(event.startTime) ?? -Infinity
    if (!latest || eventStamp > stamp || (eventStamp === stamp && (event.id ?? -1) >= (latest.id ?? -1))) {
      latest = event
      stamp = eventStamp
    }
  }
  return latest
}
