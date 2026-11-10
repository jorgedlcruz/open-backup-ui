// Open Backup UI v1.0.2
import { v4 as uuid } from 'uuid'
import { isRestoreOperation, uncertainRestore, type RestoreOperation, type RestoreResult } from './workflow'

export const activeDirectoryOperation = 'BrowseActiveDirectory'
export const sqlOperation = 'BrowseSql'

export type RestoreLaunch = {
  requestId: string
  createdAt?: string
  sourceKey: string
  operation: RestoreOperation | typeof activeDirectoryOperation | typeof sqlOperation
  workload: string
  pointTime?: string
  phase: 'starting' | 'accepted' | 'rejected' | 'unknown'
  sessionId?: string
  message?: string
  mountErrors?: {type: string; message: string}[]
}

const storageKey = 'open-backup-ui.restore-launches'
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const inFlight = new Map<string, Promise<RestoreLaunch>>()
const recent = new Map<string, RestoreLaunch>()

function storedLaunches(): RestoreLaunch[] {
  try {
    const items: unknown = JSON.parse(sessionStorage.getItem(storageKey) || '[]')
    if (!Array.isArray(items)) return []
    return items.filter(value => value && uuidPattern.test(value.requestId) && /^[a-f0-9]{64}$/.test(value.sourceKey)
      && (isRestoreOperation(value.operation) || value.operation === activeDirectoryOperation || value.operation === sqlOperation) && typeof value.workload === 'string'
      && ['starting', 'accepted', 'rejected', 'unknown'].includes(value.phase)
      && (value.message == null || typeof value.message === 'string')
      && (value.mountErrors == null || Array.isArray(value.mountErrors) && value.mountErrors.every((issue: {type?: unknown; message?: unknown} | null) =>
        issue && typeof issue.type === 'string' && typeof issue.message === 'string'))
      && (value.phase !== 'accepted' || uuidPattern.test(value.sessionId)))
  } catch { return [] }
}

function remember(receipt: RestoreLaunch) {
  recent.set(receipt.requestId, receipt)
  if (recent.size > 24) recent.delete(recent.keys().next().value!)
  const entries = storedLaunches().filter(item => item.requestId !== receipt.requestId)
  try { sessionStorage.setItem(storageKey, JSON.stringify([receipt, ...entries].slice(0, 24))) } catch { /* Tab storage can be disabled. */ }
  // Publish after beginRestoreLaunch has registered the in-flight request.
  if(typeof window!=='undefined')queueMicrotask(()=>window.dispatchEvent(new Event('restore-launch-change')))
  return receipt
}

export function beginRestoreLaunch<Draft extends Pick<RestoreLaunch, 'sourceKey' | 'operation'>>(draft: Draft, workload: string, pointTime: string | undefined, start: (draft: Draft) => Promise<RestoreResult>) {
  const receipt = remember({ requestId: uuid(), createdAt:new Date().toISOString(), sourceKey: draft.sourceKey, operation: draft.operation, workload, pointTime, phase: 'starting' })
  // The mutation belongs to the user's submit event. A page mount or refresh only observes its receipt.
  const result = Promise.resolve().then(() => start(draft)).then(response => {
    if (!response.id || !uuidPattern.test(response.id) || response.sourceKey !== draft.sourceKey) {
      return remember({ ...receipt, phase: 'unknown' })
    }
    return remember({ ...receipt, phase: 'accepted', sessionId: response.id.toLowerCase(), mountErrors: response.mountErrors })
  }).catch(error => remember({ ...receipt, phase: uncertainRestore(error) ? 'unknown' : 'rejected',
    message: error instanceof Error ? error.message : undefined }))
  inFlight.set(receipt.requestId, result)
  void result.finally(() => inFlight.delete(receipt.requestId))
  return receipt
}

export function readRestoreLaunch(requestId: string) {
  const receipt = recent.get(requestId) ?? storedLaunches().find(item => item.requestId === requestId)
  // After a hard reload the request may already have reached VBR. Never replay it.
  if (receipt?.phase === 'starting' && !inFlight.has(requestId)) return { ...receipt, phase: 'unknown' as const }
  return receipt
}

export function recentRestoreLaunches(sourceKey:string,now=Date.now()):RestoreLaunch[] {
  const ids=new Set([...recent.keys(),...storedLaunches().map(r=>r.requestId)])
  return [...ids].flatMap(id=>{
    const row=readRestoreLaunch(id)
    if(!row||row.sourceKey!==sourceKey||row.phase==='rejected')return []
    if(row.createdAt&&(!Number.isFinite(Date.parse(row.createdAt))||now-Date.parse(row.createdAt)>86400000))return []
    return [row]
  })
}

export function observeRestoreLaunch(requestId: string) {
  return inFlight.get(requestId) ?? Promise.resolve(readRestoreLaunch(requestId))
}

export function findSessionLaunch(sourceKey: string, sessionId: string) {
  return [...recent.values(), ...storedLaunches()].find(receipt =>
    receipt.phase === 'accepted' && receipt.sourceKey === sourceKey && receipt.sessionId === sessionId)
}
