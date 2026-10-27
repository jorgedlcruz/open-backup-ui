import { z } from 'zod'
import type { VbrReader } from '../server/vbr-read'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import { investigationJobSchema, investigationSessionSchema, taskSchema, logSchema, validId, revisionForBuild, linkedAttempts, newestFirst, time, type Evidence, type Logs, type Session, type HistoryRange, type JobInvestigation, type SessionInvestigation, type TaskInvestigation, type RetryChain } from './model'

type Read = (path: string) => Promise<unknown>
function reason(error: unknown) {
  return error instanceof z.ZodError ? 'The response did not match the expected API fields.'
    : error instanceof TopologyRequestError ? error.message : 'The source could not return these records. Retry to load them.'
}
async function optional<T>(work: Promise<Evidence<T>>): Promise<Evidence<T>> {
  try { return await work } catch (error) {
    if (error instanceof TopologyRequestError && error.status === 401) throw error
    return { data: [], available: false, complete: false, error: reason(error) }
  }
}
async function reader(raw: VbrReader) {
  let revision: '1.3-rev1' | '1.3-rev2' = '1.3-rev1'
  const warnings: string[] = []
  try {
    const info = z.object({ buildVersion: z.string() }).parse(await raw('/api/v1/serverInfo'))
    revision = revisionForBuild(info.buildVersion)
  } catch (error) {
    if (error instanceof TopologyRequestError && error.status === 401) throw error
    warnings.push('Server version could not be checked. Using API 1.3-rev1; retry metadata may be unavailable.')
  }
  return { read: (path: string) => raw(path, revision), revision, warnings }
}
function scope<T>(section: Evidence<T>, predicate: (item: T) => boolean): Evidence<T> {
  const data = section.data.filter(predicate)
  return data.length === section.data.length ? section : { ...section, data, complete: false, error: 'VBR returned records outside the requested scope. Those records were excluded.' }
}
export async function loadLogs(read: Read, path: string): Promise<Logs> {
  let total: number | null = null
  const section = await optional((async () => {
    // These endpoints have statusFilter only, not skip/limit. Never pretend to paginate them.
    const result = z.object({ records: z.array(logSchema), totalRecords: z.number().int().nonnegative().nullish() }).parse(await read(path))
    total = result.totalRecords ?? null
    const data = result.records.slice(0, 10000)
    return { data, available: true, complete: result.records.length <= 10000 && (total === null || total === data.length) }
  })())
  return { ...section, total }
}
export async function loadJobInvestigation(raw: VbrReader, sourceName: string, jobId: string, range: HistoryRange, now = new Date()): Promise<JobInvestigation> {
  const { read, revision, warnings } = await reader(raw)
  const from = new Date(now.getTime() - ({ '7d': 7, '30d': 30, '90d': 90 }[range] * 86400000)).toISOString()
  const [jobs, history] = await Promise.all([
    optional(readOperationsCollection(read, `/api/v1/jobs/states?idFilter=${encodeURIComponent(jobId)}`, investigationJobSchema)),
    optional(readOperationsCollection(read, `/api/v1/sessions?jobIdFilter=${encodeURIComponent(jobId)}&createdAfterFilter=${encodeURIComponent(from)}&orderColumn=CreationTime&orderAsc=false`, investigationSessionSchema, 4000)),
  ])
  const sessions = scope(history, s => s.jobId === jobId && (time(s.creationTime) === null || time(s.creationTime)! >= Date.parse(from)))
  sessions.data.sort(newestFirst)
  const job = jobs.data.find(j => j.id.toLowerCase() === jobId) || null
  if (!job) warnings.push(jobs.error || 'Job configuration is unavailable. Retained sessions can still be investigated.')
  if (!sessions.available && !job) throw new TopologyRequestError(sessions.error || 'Job investigation data could not be loaded.', 502)
  return { jobId, job, sessions, sourceName, apiRevision: revision, from, range, fetchedAt: now.toISOString(), warnings }
}
async function loadChain(read: Read, selected: Session): Promise<RetryChain> {
  const rootId = selected.originalSessionId
  if (!validId(rootId) || !validId(selected.jobId)) return { originalId: null, data: [], complete: false, note: 'VBR did not report an original-session ID for this run. Retry relationships cannot be established.' }
  let root = selected
  if (rootId !== selected.id) {
    try {
      root = investigationSessionSchema.parse(await read(`/api/v1/sessions/${encodeURIComponent(rootId)}`))
      if (root.id !== rootId || root.jobId !== selected.jobId || (validId(root.originalSessionId) && root.originalSessionId !== root.id)) {
        return { originalId: rootId, data: [selected], complete: false, note: 'The original-session record conflicts with this run. The chain could not be verified.' }
      }
    } catch (error) {
      if (error instanceof TopologyRequestError && error.status === 401) throw error
      return { originalId: rootId, data: [selected], complete: false, note: `Original run unavailable. ${reason(error)}` }
    }
  }
  const start = time(root.creationTime)
  if (start === null) return { originalId: rootId, data: linkedAttempts(selected, [root]), complete: false, note: 'The original run has no valid start time. Related attempts could not be searched.' }
  const history = await optional(readOperationsCollection(read, `/api/v1/sessions?jobIdFilter=${encodeURIComponent(selected.jobId)}&createdAfterFilter=${encodeURIComponent(new Date(start - 1).toISOString())}&orderColumn=CreationTime&orderAsc=false`, investigationSessionSchema, 4000))
  const scoped = scope(history, s => s.jobId === selected.jobId)
  return { originalId: rootId, data: linkedAttempts(selected, [root, ...scoped.data]), complete: scoped.available && scoped.complete,
    note: scoped.error || (!scoped.complete ? 'Partial history. More attempts may exist.' : 'Linked by the original-session ID reported by VBR. Covers retained history through this refresh.') }
}
export async function loadSessionInvestigation(raw: VbrReader, sourceName: string, sessionId: string, now = new Date()): Promise<SessionInvestigation> {
  const { read, revision, warnings } = await reader(raw)
  const session = investigationSessionSchema.parse(await read(`/api/v1/sessions/${encodeURIComponent(sessionId)}`))
  if (session.id !== sessionId) throw new TopologyRequestError('VBR returned a different session than requested.', 502)
  const [taskRecords, logs, chain] = await Promise.all([
    optional(readOperationsCollection(read, `/api/v1/sessions/${encodeURIComponent(sessionId)}/taskSessions`, taskSchema)),
    loadLogs(read, `/api/v1/sessions/${encodeURIComponent(sessionId)}/logs`), loadChain(read, session),
  ])
  const tasks = scope(taskRecords, t => t.sessionId === sessionId)
  const historyProgress = chain.data.find(row => row.id === sessionId && row.jobId === session.jobId)?.progress
  const fromHistory = !session.progress && !!historyProgress
  return { session: fromHistory ? { ...session, progress: historyProgress } : session, tasks, logs, chain, sourceName,
    apiRevision: revision, fetchedAt: now.toISOString(), warnings, progressSource: fromHistory ? 'history' : 'session' }
}
export async function loadTaskInvestigation(raw: VbrReader, sessionId: string, taskId: string, now = new Date()): Promise<TaskInvestigation> {
  const { read, revision, warnings } = await reader(raw)
  const task = taskSchema.parse(await read(`/api/v1/taskSessions/${encodeURIComponent(taskId)}`))
  if (task.id !== taskId || task.sessionId !== sessionId) throw new TopologyRequestError('This task does not belong to the selected session.', 404)
  return { task, logs: await loadLogs(read, `/api/v1/taskSessions/${encodeURIComponent(taskId)}/logs`), fetchedAt: now.toISOString(), apiRevision: revision, warnings }
}
