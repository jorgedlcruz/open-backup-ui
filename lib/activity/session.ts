import type { PublishedRecoveryReader, VbrReader, VmPowerReader } from '../server/vbr-read'
import { investigationSessionSchema, taskSchema, validId, revisionForBuild, type Evidence, type Logs, type Session, type Task } from '../investigation/model'
import { loadLogs } from '../investigation/load'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import { loadActivityMounts } from './load'
import { mountBelongsToSession, type Mount } from './model'
import { enrichInstantVm, relatedMigration } from './instant-vm-evidence'

export type MountHint = Pick<Mount, 'id'|'kind'>
export type ActivityDetail = {
  instantMigration?: Session | null
  id: string; sourceKey: string; sourceName: string; updatedAt: string; session: Session | null
  mounts: Mount[]; mountWarnings: string[]; logs: Logs; tasks: Evidence<Task>; children: Evidence<Session> | null; canStop: boolean
}

const mayHaveMount = /InstantRecovery|InstantRestore|FileLevelRestore|InstantDiskRecovery|PublishBackupContent/i
export const isApplicationBrowse = (type?: string | null) => type === 'ApplicationLevelRestore' || type === 'AdForestRestore'
export function canStopEntireVm(session: Session | null) {
  return !!session && ['RestoreVm','CloudDirectorVmRestore','CloudDirectorVAppRestore'].includes(session.sessionType || '') &&
    ['Starting','Working','WaitingRepository','WaitingSlot'].includes(session.state || '') && !session.endTime
}
const unavailable = <T>(): Evidence<T> => ({ data: [], available: false, complete: false })
function authError(error: unknown) {
  if (error instanceof TopologyRequestError && error.status === 401) throw error
}

export async function loadActivitySession(raw: VbrReader, sourceName: string, sourceKey: string, id: string,
  hint?: MountHint, published?: PublishedRecoveryReader, vmPower?: VmPowerReader): Promise<ActivityDetail> {
  if (!validId(id)) throw new TopologyRequestError('Select a valid session.', 400)
  const version = await raw('/api/v1/serverInfo').catch(error => { authError(error); return null })
  const revision = revisionForBuild((version as {buildVersion?:string} | null)?.buildVersion)
  const read = (path: string) => raw(path, revision)
  const path = '/api/v1/sessions/' + id
  let session: Session | null = null, sessionError: unknown
  try { session = investigationSessionSchema.parse(await read(path)) } catch (error) { authError(error); sessionError = error }
  if (session && session.id !== id) throw new TopologyRequestError('VBR returned a different session than requested.', 502)
  const checkMounts = !!hint || !session || mayHaveMount.test(session.sessionType || '')
  const type = session?.sessionType || ''
  const kinds: Mount['kind'][] | undefined = hint ? [hint.kind] :
    /FileLevelRestore/.test(type) ? ['flr'] : /FirstClassDisk/.test(type) ? ['fcd'] :
      /PublishBackupContent/.test(type) ? ['publish'] : type === 'InstantRecovery' ? ['vSphere', 'hyperV'] : undefined
  const [inventory, logs, taskRecords, children] = await Promise.all([
    checkMounts ? loadActivityMounts(raw, published, kinds) : { mounts: [], warnings: [] as string[] },
    session ? loadLogs(read, path + '/logs') : { ...unavailable(), total: null } as Logs,
    session ? readOperationsCollection(read, path + '/taskSessions', taskSchema, 4000).catch(error => { authError(error); return unavailable<Task>() }) : unavailable<Task>(),
    isApplicationBrowse(session?.sessionType) ? readOperationsCollection(read, '/api/v1/restore/applicationItems/' + id + '/childSessions', investigationSessionSchema, 1000)
      .catch(error => { authError(error); return unavailable<Session>() }) : null,
  ])
  const mounts = inventory.mounts.filter(m => (session ? mountBelongsToSession(m, session) : m.sessionId === id) && m.state !== 'Unmounted' && (!hint || m.id === hint.id && m.kind === hint.kind))
    .map(m => m.sessionId === id ? m : { ...m, sessionId: id })
  if (!session && !mounts.length) throw sessionError instanceof TopologyRequestError ? sessionError : new TopologyRequestError('The session is not available on this source.', 404)
  const tasks = { ...taskRecords, data: taskRecords.data.filter(t => t.sessionId === id) }
  if (tasks.data.length !== taskRecords.data.length) tasks.complete = false
  if (children) {
    const scoped = children.data.filter(child => child.id !== id && (!validId(child.parentSessionId) || child.parentSessionId === id))
    if (scoped.length !== children.data.length) children.complete = false
    children.data = scoped
  }
  const [enriched, instantMigration] = await Promise.all([
    Promise.all(mounts.map(mount => enrichInstantVm(raw, mount, vmPower))), relatedMigration(raw, session),
  ])
  return { id, sourceName, sourceKey, updatedAt: new Date().toISOString(), session, mounts:enriched, instantMigration, mountWarnings: inventory.warnings, logs, tasks, children, canStop: canStopEntireVm(session) }
}
