import { z } from 'zod'
import { jobSchema, type Collection } from '../operations/model'

const text = z.string().nullish()
const number = z.number().finite().nullish()
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const validId = (id?: string | null): id is string => !!id && uuid.test(id) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id)
const id = z.string().regex(uuid).transform(value => value.toLowerCase())
const reference = text.transform(value => value?.toLowerCase())
const result = z.object({ result: text, message: text, isCanceled: z.boolean().nullish() }).nullish()
export const progressSchema = z.object({ duration: text, processingRate: text, bottleneck: text, processedSize: number, readSize: number, transferredSize: number, progressPercent: number }).nullish()
export const investigationSessionSchema = z.object({
  id, jobId: reference, name: text, sessionType: text, creationTime: text, endTime: text,
  state: text, result, progress: progressSchema, progressPercent: number, initiatedBy: text,
  originalSessionId: reference, parentSessionId: reference, relatedSessionId: reference,
  retryInfo: z.object({ isRecheckRetry: z.boolean().nullish(), retryNumber: z.number().int().positive().nullish() }).nullish(),
})
export const taskSchema = z.object({
  id, sessionId: reference, type: text, sessionType: text, name: text, creationTime: text, endTime: text,
  state: text, result, progress: progressSchema, platformType: text, algorithm: text, repositoryId: reference,
  restorePointId: reference, scanState: text, scanResult: text, scanType: text, antivirusName: text,
})
export const logSchema = z.object({
  id: z.number().int().nullish(), status: text, startTime: text, updateTime: text, title: text, description: text,
  // Older revisions return free text here; rev2 documents key/value pairs.
  additionalInfo: z.union([z.array(z.object({ field: text, data: text })), z.string().transform(data => data ? [{ field: 'Additional information', data }] : [])]).nullish(),
})
export const investigationJobSchema = jobSchema.extend({ description: text, isDisabled: z.boolean().nullish() })
export type Session = z.infer<typeof investigationSessionSchema>
export type Task = z.infer<typeof taskSchema>
export type LogRecord = z.infer<typeof logSchema>
export type InvestigationJob = z.infer<typeof investigationJobSchema>
export type HistoryRange = '7d' | '30d' | '90d'
export type Evidence<T> = Collection<T> & { error?: string }
export type Logs = Evidence<LogRecord> & { total: number | null }
export type RetryChain = { originalId: string | null; data: Session[]; note: string; complete: boolean }
export type JobInvestigation = {
  jobId: string; job: InvestigationJob | null; sessions: Evidence<Session>; sourceName: string;
  apiRevision: string; from: string; range: HistoryRange; fetchedAt: string; warnings: string[];
}
export type SessionInvestigation = {
  session: Session; tasks: Evidence<Task>; logs: Logs; chain: RetryChain;
  sourceName: string; apiRevision: string; fetchedAt: string; warnings: string[]; progressSource: 'session' | 'history';
}
export type TaskInvestigation = { task: Task; logs: Logs; fetchedAt: string; apiRevision: string; warnings: string[] }

export function revisionForBuild(build: unknown): '1.3-rev1' | '1.3-rev2' {
  // Veeam's published release boundary for 1.3-rev2; unknown/pre-release builds stay on rev1.
  if (typeof build !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(build)) return '1.3-rev1'
  const parts = build.split('.').map(Number), minimum = [13, 1, 0, 411]
  for (let i = 0; i < minimum.length; i++) {
    if (parts[i] > minimum[i]) return '1.3-rev2'
    if (parts[i] < minimum[i]) return '1.3-rev1'
  }
  return '1.3-rev2'
}
export function recordStatus(record: Pick<Session, 'state' | 'result'> & { scanState?: string | null; scanResult?: string | null }) {
  if (record.result?.isCanceled) return 'Canceled'
  if (record.scanState === 'InProgress') return 'Scanning'
  if (record.state && !['Stopped', 'Idle'].includes(record.state)) return record.state
  if (record.scanResult && record.scanResult !== 'None') return record.scanResult
  if (record.result?.result && record.result.result !== 'None') return record.result.result
  return record.scanState || record.state || 'Not reported'
}
export function tone(value: string) {
  return ['Failed', 'Infected'].includes(value) ? 'danger'
    : ['Warning', 'Inconclusive', 'ActionRequired', 'Canceled'].includes(value) ? 'warning'
      : ['Success', 'Succeeded', 'Clean'].includes(value) ? 'success'
        : ['Working', 'Starting', 'Stopping', 'Pausing', 'Resuming', 'WaitingTape', 'Postprocessing', 'WaitingRepository', 'WaitingSlot', 'Scanning'].includes(value) ? 'active' : 'neutral'
}
export const needsInvestigation = (record: Session | Task) => ['danger', 'warning'].includes(tone(recordStatus(record)))
export const time = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
export const newestFirst = (a: Session, b: Session) => (time(b.creationTime) ?? -Infinity) - (time(a.creationTime) ?? -Infinity)
export function duration(record: Pick<Session, 'creationTime' | 'endTime' | 'progress'>) {
  if (record.progress?.duration) return record.progress.duration
  const start = time(record.creationTime), end = time(record.endTime)
  if (start === null || end === null || end < start) return 'Not reported'
  const seconds = Math.floor((end - start) / 1000)
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s`
}
export function attemptLabel(session: Session) {
  if (session.retryInfo) return `${session.retryInfo.isRecheckRetry === true ? 'Health-check retry' : session.retryInfo.isRecheckRetry === false ? 'Retry' : 'Retry (kind not reported)'}${session.retryInfo.retryNumber != null ? ` ${session.retryInfo.retryNumber}` : ' · unnumbered'}`
  if (validId(session.originalSessionId)) return session.originalSessionId === session.id ? 'Original run' : 'Retry · unnumbered'
  return 'Run linkage not reported'
}
export function linkedAttempts(selected: Session, candidates: Session[]): Session[] {
  if (!validId(selected.originalSessionId) || !validId(selected.jobId)) return []
  const root = selected.originalSessionId
  const matches = candidates.filter(s => s.jobId === selected.jobId && (s.originalSessionId === root || (s.id === root && !s.originalSessionId)))
  // Some VBR builds populate progress in collection rows but omit it from GET by ID.
  // Only the exact same session/job may supplement the primary record.
  const listed = matches.find(s => s.id === selected.id && s.progress != null)
  const evidence = { ...selected, progress: selected.progress ?? listed?.progress }
  return [...new Map([...matches, evidence].map(s => [s.id, s])).values()].sort((a, b) => {
    if (a.id === root) return -1
    if (b.id === root) return 1
    return (time(a.creationTime) ?? Infinity) - (time(b.creationTime) ?? Infinity)
  })
}
