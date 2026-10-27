import { z } from 'zod'
import type { VbrReader } from '../server/vbr-read'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import { investigationSessionSchema, taskSchema, revisionForBuild, type Evidence, type Task } from '../investigation/model'
import { knownSize } from '../restore-points/model'
import { eventSchema, settingsSchema, analyzeTasks, type Snapshot, type Indicator, type TaskCoverage } from './model'

export async function loadRansomware(raw: VbrReader, sourceName: string, now = new Date()): Promise<Snapshot> {
  const warnings: string[] = []
  let revision: '1.3-rev1' | '1.3-rev2' = '1.3-rev1'
  try { revision = revisionForBuild(z.object({ buildVersion: z.string() }).parse(await raw('/api/v1/serverInfo')).buildVersion) }
  catch (error) {
    if (error instanceof TopologyRequestError && error.status === 401) throw error
    warnings.push('Server version unavailable. Using API 1.3-rev1; newer detection settings may not be reported.')
  }
  const read = (path: string) => raw(path, revision)
  async function optional<T>(label: string, work: Promise<Evidence<T>>, warnPartial = true): Promise<Evidence<T>> {
    try {
      const result = await work
      if (!result.complete && warnPartial) warnings.push(`${label}: partial collection. Only loaded records are included.`)
      return result
    } catch (error) {
      if (error instanceof TopologyRequestError && error.status === 401) throw error
      const message = error instanceof TopologyRequestError && error.status === 403 ? 'Read access was denied.'
        : error instanceof z.ZodError ? 'The response did not match the expected fields.' : 'The source could not return these records.'
      warnings.push(`${label} unavailable. ${message}`)
      return { data: [], available: false, complete: false, error: message }
    }
  }
  const [events, sessions, settingsResult] = await Promise.all([
    optional('Malware events', readOperationsCollection(read, '/api/v1/malwareDetection/events?orderColumn=DetectionTimeUtc&orderAsc=false', eventSchema, 5000)),
    // Preserve the previous 30-session sample, ordered explicitly newest first.
    optional('Recent sessions', readOperationsCollection(read, '/api/v1/sessions?orderColumn=CreationTime&orderAsc=false', investigationSessionSchema, 30), false),
    optional('Detection settings', read('/api/v1/malwareDetection/settings/general').then(value => ({ data: [settingsSchema.parse(value)], available: true, complete: true }))),
  ])
  if (!events.available && !sessions.available) throw new TopologyRequestError('Malware events and recent sessions are unavailable. Check the source connection and read permissions.', 502)
  if (!sessions.complete && sessions.available) warnings.push(`Session analysis is limited to the ${sessions.data.length} most recent loaded sessions; it does not cover the full session history.`)
  const tasks: TaskCoverage[] = [], anomalies: Indicator[] = []
  let cursor = 0, scannedTasks = 0, measuredTasks = 0, globalRead = 0, globalTransferred = 0
  await Promise.all(Array.from({ length: Math.min(4, sessions.data.length) }, async () => {
    while (cursor < sessions.data.length) {
      const session = sessions.data[cursor++]
      const result = await optional<Task>(`Tasks for ${session.name || session.id}`,
        readOperationsCollection(read, `/api/v1/sessions/${encodeURIComponent(session.id)}/taskSessions`, taskSchema, 2000))
      const scoped = result.data.filter(task => task.sessionId === session.id)
      const foreign = scoped.length !== result.data.length
      if (foreign) warnings.push(`Tasks for ${session.name || session.id}: records from another session were excluded.`)
      tasks.push({ sessionId: session.id, name: session.name || session.id, count: scoped.length, available: result.available, complete: result.complete && !foreign, error: result.error })
      scannedTasks += scoped.length
      for (const task of scoped) {
        const readSize = knownSize(task.progress?.readSize), transferredSize = knownSize(task.progress?.transferredSize)
        if (readSize !== null && transferredSize !== null) { measuredTasks++; globalRead += readSize; globalTransferred += transferredSize }
      }
      anomalies.push(...analyzeTasks(session, scoped))
    }
  }))
  const measured = measuredTasks > 0 && Number.isSafeInteger(globalRead) && Number.isSafeInteger(globalTransferred)
  anomalies.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  tasks.sort((a, b) => sessions.data.findIndex(s => s.id === a.sessionId) - sessions.data.findIndex(s => s.id === b.sessionId))
  return { sourceName, fetchedAt: now.toISOString(), apiRevision: revision, events, sessions, settings: settingsResult.data[0] || null,
    tasks, anomalies, warnings: [...new Set(warnings)], metadata: { scannedSessions: sessions.data.length, scannedTasks, measuredTasks,
      globalDataReduction: measured && globalTransferred > 0 ? globalRead / globalTransferred : null,
      readSize: measured ? globalRead : null, transferredSize: measured ? globalTransferred : null } }
}
