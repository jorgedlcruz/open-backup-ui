import { z } from 'zod'
import { type Evidence, type Session, type Task, validId, time } from '../investigation/model'
import { knownSize } from '../restore-points/model'

const text = z.string().nullish()
const bool = z.boolean().nullish()
const reference = text.transform(value => value?.toLowerCase())
// Whitelist display evidence; unrelated fields and notification credentials stay server-side.
export const eventSchema = z.object({
  id: z.string().min(1), type: text, creationTimeUtc: text, detectionTimeUtc: text,
  machine: z.object({ displayName: text, uuid: text, backupObjectId: reference, restorePointId: reference }).nullish(),
  state: text, details: text, source: text, severity: text, createdBy: text, engine: text,
})
export const settingsSchema = z.object({
  encryptionDetectionSettings: z.object({ inlineMalwareScanEnabled: bool, sensitivity: text }).nullish(),
  fileDetectionSettings: z.object({ guestIndexScanEnabled: bool, detectIndicatorsOfCompromise: bool, autoUpdateMalwareDefinitions: bool }).nullish(),
  signatureDetectionSettings: z.object({ detectionEngine: text, archivesScanEnabled: bool, autoSignatureBasedScanEnabled: bool, autoResolveEventAfterCleanScan: bool }).nullish(),
})
export type MalwareEvent = z.infer<typeof eventSchema>
export type DetectionSettings = z.infer<typeof settingsSchema>
export type Indicator = {
  id: string; vmName: string; sessionId: string; sessionName: string; creationTime?: string | null;
  readSize: number; transferredSize: number; dedupeRatio: number; reason: string; score: number;
  severity: 'critical' | 'warning'; task: Task; jobId?: string | null;
}
export type TaskCoverage = { sessionId: string; name: string; count: number; available: boolean; complete: boolean; error?: string }
export type Snapshot = {
  sourceName: string; fetchedAt: string; apiRevision: string; warnings: string[];
  events: Evidence<MalwareEvent>; settings: DetectionSettings | null;
  sessions: Evidence<Session>; tasks: TaskCoverage[]; anomalies: Indicator[];
  metadata: { scannedSessions: number; scannedTasks: number; measuredTasks: number; globalDataReduction: number | null; readSize: number | null; transferredSize: number | null };
}
export function analyzeTasks(session: Session, tasks: Task[]): Indicator[] {
  return tasks.flatMap(task => {
    const read = knownSize(task.progress?.readSize), transferred = knownSize(task.progress?.transferredSize)
    if (read === null || transferred === null || read <= 1024 ** 3 || transferred / read <= .85) return []
    const ratio = transferred / read
    return [{ id: task.id, vmName: task.name || 'Workload not reported', sessionId: session.id,
      sessionName: session.name || 'Session name not reported', creationTime: task.creationTime,
      readSize: read, transferredSize: transferred, dedupeRatio: ratio,
      reason: `Low data reduction: transferred ${(ratio * 100).toFixed(1)}% of bytes read. Review compression, encryption, and workload changes.`,
      score: Math.min(100, Math.floor(ratio * 100)), severity: ratio > .95 ? 'critical' as const : 'warning' as const, task, jobId: session.jobId }]
  })
}
export type Activity = {
  key: string; kind: 'event' | 'heuristic'; name: string; objectId?: string | null;
  severity: string; state: string; type: string; source: string; engine: string; detected?: string | null; details: string;
  event?: MalwareEvent; indicator?: Indicator;
}
export function activityRows(snapshot: Snapshot): Activity[] {
  return [...snapshot.events.data.map(event => ({ key: `event:${event.id}`, kind: 'event' as const,
    name: event.machine?.displayName || 'Workload not reported', objectId: event.machine?.backupObjectId,
    severity: event.severity || 'Not reported', state: event.state || 'Not reported', type: event.type || 'Unknown',
    source: event.source || 'Not reported', engine: event.engine || 'Not reported', detected: event.detectionTimeUtc,
    details: event.details || 'Description not reported', event })),
  ...snapshot.anomalies.map(indicator => ({ key: `heuristic:${indicator.sessionId}:${indicator.id}`, kind: 'heuristic' as const,
    name: indicator.vmName, severity: indicator.severity === 'critical' ? 'Critical indicator' : 'Warning indicator', state: 'Heuristic',
    type: 'Low data reduction', source: 'Backup analytics', engine: 'Data reduction heuristic', detected: indicator.creationTime,
    details: indicator.reason, indicator }))]
}
export const needsReview = (row: Activity) => row.kind === 'heuristic' || (row.state === 'Created' && ['Infected', 'Suspicious'].includes(row.severity))
export type Issue = 'all' | 'review' | 'infected' | 'suspicious' | 'heuristic' | 'falsePositive' | 'unknown'
export const issueMatch = (row: Activity, issue: Issue) => issue === 'all' || (issue === 'review' ? needsReview(row)
  : issue === 'infected' ? row.kind === 'event' && row.state === 'Created' && row.severity === 'Infected'
    : issue === 'suspicious' ? row.kind === 'event' && row.state === 'Created' && row.severity === 'Suspicious'
      : issue === 'heuristic' ? row.kind === 'heuristic' : issue === 'falsePositive' ? row.state === 'FalsePositive'
        : row.kind === 'event' && (!validId(row.objectId) || row.severity === 'Not reported' || row.state === 'Not reported' || time(row.detected) === null))
export type Filters = { query: string; issue: Issue; severity: string; state: string; source: string; type: string; engine: string; range: string }
export const defaults: Filters = { query: '', issue: 'all', severity: 'all', state: 'all', source: 'all', type: 'all', engine: 'all', range: 'all' }
export function matches(row: Activity, filters: Filters, now: number) {
  const detected = time(row.detected), days = Number(filters.range)
  return issueMatch(row, filters.issue) && ['severity', 'state', 'source', 'type', 'engine'].every(key => {
    const field = key as 'severity' | 'state' | 'source' | 'type' | 'engine'
    return filters[field] === 'all' || row[field] === filters[field]
  }) && (filters.range === 'all' || (filters.range === 'unknown' ? detected === null : detected !== null && detected <= now && detected >= now - days * 86400000))
    && [row.name, row.details, row.type, row.source, row.engine, row.objectId, row.event?.id, row.event?.createdBy, row.event?.machine?.uuid,
      row.indicator?.sessionName, row.indicator?.sessionId, row.indicator?.id].join(' ').toLowerCase().includes(filters.query.trim().toLowerCase())
}
export function sortActivity(rows: Activity[], order: string) {
  const rank = (row: Activity) => row.state === 'FalsePositive' ? 5 : row.severity === 'Infected' ? 0 : row.severity === 'Suspicious' ? 1 : row.severity === 'Critical indicator' ? 2 : row.severity === 'Warning indicator' ? 3 : 4
  return [...rows].sort((a, b) => (order === 'risk' ? rank(a) - rank(b) : order === 'name' ? a.name.localeCompare(b.name) : 0)
    || (time(b.detected) ?? -Infinity) - (time(a.detected) ?? -Infinity) || a.key.localeCompare(b.key))
}
export function affectedWorkloads(rows: Activity[], order = 'risk') {
  const groups = new Map<string, { key: string; name: string; objectId?: string | null; rows: Activity[]; review: number }>()
  for (const row of sortActivity(rows, order)) {
    // Task sessions do not establish a backup object identity. Never join by display name.
    const key = validId(row.objectId) ? `object:${row.objectId.toLowerCase()}` : row.key
    const group = groups.get(key) || { key, name: row.name, objectId: row.objectId, rows: [], review: 0 }
    group.rows.push(row); if (needsReview(row)) group.review++; groups.set(key, group)
  }
  return [...groups.values()]
}
export function restoreHref(row: Activity) {
  return validId(row.objectId) ? `/vbr/protected-data/restore-points?objectId=${encodeURIComponent(row.objectId)}&name=${encodeURIComponent(row.name)}` : null
}
export function summary(rows: Activity[]) {
  const events = rows.filter(row => row.kind === 'event'), review = events.filter(needsReview)
  return { events: events.length, review: review.length, indicators: rows.length - events.length,
    affected: new Set(review.filter(row => validId(row.objectId)).map(row => row.objectId!.toLowerCase())).size,
    unresolved: review.filter(row => !validId(row.objectId)).length }
}
