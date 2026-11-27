// Open Backup UI v1.3.0
import type { RecoverySession } from './model'

/** Compact display reference. Navigation and Veeam requests always use the full UUID. */
export function recoverySessionReference(id: string): string | undefined {
  return /^([0-9a-f]{8})(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.exec(id)?.[1].toLowerCase()
}

export const recoveryFilters = ['all', 'active', 'attention', 'completed'] as const
export type RecoveryFilter = typeof recoveryFilters[number]
export type RecoveryCategory = Exclude<RecoveryFilter, 'all'>
export type RecoverySummary = Record<RecoveryFilter, number>

// Keep the familiar VBR labels while only showing states reported by VB365.
export const recoveryLabels: Record<RecoveryFilter, string> = {
  all: 'All recoveries',
  active: 'In progress',
  attention: 'Needs attention',
  completed: 'Completed',
}

/**
 * VB365 reports Working/Stopped, not whether a backup explorer is ready.
 * Local context identifies its origin but must not invent readiness or success.
 */
export function recoveryCategory(session: Pick<RecoverySession, 'state' | 'result'>): RecoveryCategory {
  if (session.state === 'Working') return 'active'
  if (session.state === 'Stopped' && session.result === 'Success') return 'completed'
  return 'attention'
}

/** Counts describe the loaded sessions only; overlapping pages count once. */
export function recoverySummary(sessions: readonly RecoverySession[]): RecoverySummary {
  const unique = new Map(sessions.map(session => [session.id, session]))
  const counts: RecoverySummary = { all: unique.size, active: 0, attention: 0, completed: 0 }
  for (const session of unique.values()) counts[recoveryCategory(session)]++
  return counts
}

/** Active sessions use a year-9999 placeholder in Veeam; it is not an end date. */
export function recoveryEndTime(session: Pick<RecoverySession, 'state' | 'endTime'>): string | undefined {
  if (session.state !== 'Stopped' || !session.endTime) return undefined
  const date = new Date(session.endTime)
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1970 && date.getUTCFullYear() < 9999 ? session.endTime : undefined
}

export function recoveryDurationSeconds(session: Pick<RecoverySession, 'creationTime' | 'state' | 'endTime'>, now = Date.now()): number | undefined {
  const started = Date.parse(session.creationTime || '')
  const end = session.state === 'Stopped' ? Date.parse(recoveryEndTime(session) || '') : now
  return Number.isFinite(started) && Number.isFinite(end) && end >= started ? Math.floor((end - started) / 1000) : undefined
}
