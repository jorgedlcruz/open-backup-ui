// Open Backup UI v1.2.0
import { z } from 'zod'
import { validId, type Evidence, type Logs, type Session, type Task } from '../investigation/model'
import { readEntireRestore } from '../server/entire-restore-records'
import { TopologyRequestError } from '../topology/load'

export type EntireRestoreVm = {
  taskId?:string; sourceVm?:string; backupName?:string; repository?:string; pointTime?:string
  targetVm?:string; vmConfigFile?:string; host?:string; datastore?:string; storagePath?:string
}
export type EntireRestore = { mode?:'OriginalLocation'|'Customized'; vms:EntireRestoreVm[] }
export const isEntireRestore = (type?: string | null) => type === 'RestoreVm' || type === 'CloudDirectorVmRestore' || type === 'CloudDirectorVAppRestore'

function distinct(values: string[]) {
  const unique = [...new Set(values.map(value => value.trim()).filter(Boolean))]
  return unique.length === 1 ? unique[0] : undefined
}

// Session-level log entries have no task ID. Attribute these native messages only for one completely enumerated VM.
function logPlacement(logs: Logs) {
  const titles = logs.data.map(entry => entry.title || '')
  const registered = titles.flatMap(title => {
    const found = /^Registering restored VM on host: ([^,\r\n]+), pool: [^\r\n]*?, folder: [^\r\n]*?, storage: ([^\r\n]+)$/.exec(title)
    return found ? [{host:found[1], datastore:found[2]}] : []
  })
  const configs = titles.flatMap(title => {
    const found = /^Restoring \[([^\]\r\n]+)\] (?:[^\r\n]+\/)?([^/\\\r\n]+\.vmx)$/i.exec(title)
    return found ? [{datastore:found[1], vmConfigFile:found[2]}] : []
  })
  return {
    host:distinct(registered.map(item => item.host)),
    datastore:distinct((registered.length ? registered : configs).map(item => item.datastore)),
    vmConfigFile:distinct(configs.map(item => item.vmConfigFile)),
    repository:distinct(titles.flatMap(title => /^Restoring from ([^\r\n]+)$/.exec(title)?.slice(1) || [])),
  }
}

const pointSchema = z.object({id:z.string(), name:z.string(), creationTime:z.string().nullish(), backupId:z.string().nullish()})
const backupSchema = z.object({id:z.string(), name:z.string(), repositoryName:z.string().nullish()})
async function sourceDetails(read: (path:string) => Promise<unknown>, pointId: string, expectedBackup?: string): Promise<Partial<EntireRestoreVm>> {
  const get = async (path: string) => {
    try { return await read(path) }
    catch (error) {
      if (error instanceof TopologyRequestError && error.status === 401) throw error
      return undefined
    }
  }
  const point = pointSchema.safeParse(await get('/api/v1/restorePoints/' + pointId))
  if (!point.success || point.data.id.toLowerCase() !== pointId || expectedBackup && point.data.backupId?.toLowerCase() !== expectedBackup) return {}
  const {name, creationTime, backupId} = point.data
  const result: Partial<EntireRestoreVm> = {sourceVm:name, pointTime:creationTime || undefined}
  if (validId(backupId)) {
    const backup = backupSchema.safeParse(await get('/api/v1/backups/' + backupId))
    if (backup.success && backup.data.id.toLowerCase() === backupId.toLowerCase()) {
      result.backupName = backup.data.name
      result.repository = backup.data.repositoryName || undefined
    }
  }
  return result
}

export async function loadEntireRestore(read: (path:string) => Promise<unknown>, sourceKey: string, session: Session | null,
  tasks: Evidence<Task>, logs: Logs, receiptReader = readEntireRestore): Promise<EntireRestore | undefined> {
  if (!session || !isEntireRestore(session.sessionType)) return
  const owned = tasks.data.filter(task => task.sessionId === session.id)
  const single = tasks.available && tasks.complete && owned.length === 1 && tasks.data.length === 1
  const receipt = await receiptReader(sourceKey, session.id)
  // A launch represents one restore point. Never attach its destination to an unrelated task.
  const verified = receipt?.sessionId === session.id && receipt.sourceKey === sourceKey ? receipt : undefined
  const selected = verified && owned.filter(task => validId(task.restorePointId) ? task.restorePointId === verified.restorePointId : task.name === verified.sourceVm)
  const matched = selected?.length === 1 && tasks.complete ? selected[0] : undefined
  const vms: EntireRestoreVm[] = owned.map(task => ({taskId:task.id, sourceVm:task.name || undefined}))
  if (!vms.length) vms.push({})
  const row = matched ? vms[owned.indexOf(matched)] : !owned.length ? vms[0] : undefined
  const accepted = row ? verified : undefined
  const focus = row ?? (single ? vms[0] : undefined)
  if (single && logs.available && logs.complete) Object.assign(vms[0], logPlacement(logs))
  if (focus) {
    const pointId = accepted?.restorePointId ?? (single ? owned[0].restorePointId : undefined)
    if (validId(pointId)) {
      const source = await sourceDetails(read, pointId, accepted?.backupId)
      if (source.sourceVm) focus.sourceVm = source.sourceVm
      if (source.backupName) focus.backupName = source.backupName
      if (source.pointTime) focus.pointTime = source.pointTime
      if (source.repository && !focus.repository) focus.repository = source.repository
    }
    if (accepted) {
      focus.sourceVm ||= accepted.sourceVm
      focus.pointTime ||= accepted.pointTime
      focus.targetVm = accepted.targetVm
      focus.host ||= accepted.host
      focus.datastore ||= accepted.datastore
      focus.storagePath = accepted.storagePath
    }
  }
  return {mode:accepted?.mode, vms}
}
