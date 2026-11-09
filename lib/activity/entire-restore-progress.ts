// Open Backup UI v1.0.2
import { time, type LogRecord, type Session, type Task } from '../investigation/model'

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
  return record?.state === 'Working' && !record.endTime && !record.result?.isCanceled &&
    /^(InProgress|Running|Working)$/i.test(log?.status || '') &&
    /^Restoring (?:hard disk\b|virtual disk\b|disk\b|file\b)/i.test(log?.title || '')
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
