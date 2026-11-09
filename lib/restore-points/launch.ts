import { v4 as uuid } from 'uuid'
import { isRestoreOperation, uncertainRestore, type RestoreDraft, type RestoreOperation, type RestoreResult } from './workflow'

export type RestoreLaunch = {
  requestId: string
  sourceKey: string
  operation: RestoreOperation
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
      && isRestoreOperation(value.operation) && typeof value.workload === 'string'
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
  return receipt
}

export function beginRestoreLaunch(draft: RestoreDraft, workload: string, pointTime: string | undefined, start: (draft: RestoreDraft) => Promise<RestoreResult>) {
  const receipt = remember({ requestId: uuid(), sourceKey: draft.sourceKey, operation: draft.operation, workload, pointTime, phase: 'starting' })
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

export function observeRestoreLaunch(requestId: string) {
  return inFlight.get(requestId) ?? Promise.resolve(readRestoreLaunch(requestId))
}

export function findSessionLaunch(sourceKey: string, sessionId: string) {
  return [...recent.values(), ...storedLaunches()].find(receipt =>
    receipt.phase === 'accepted' && receipt.sourceKey === sourceKey && receipt.sessionId === sessionId)
}
