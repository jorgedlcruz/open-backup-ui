// Open Backup UI v1.0.2
import { v4 as uuid } from 'uuid'
import { isRestoreOperation, uncertainRestore, type RestoreOperation, type RestoreResult } from './workflow'
import {explorerHandoffIO,resolveExplorerHandoff,type ExplorerHandoffIO,type ExplorerSelection,type ExplorerStage} from './explorer-handoff'

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
  explorerTracked?:true
  explorerStage?:ExplorerStage
  explorerPoint?:Pick<ExplorerSelection,'restorePointId'|'backupId'|'backupObjectId'>
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
      && (value.explorerTracked===undefined||value.explorerTracked===true&&(value.operation===activeDirectoryOperation||value.operation===sqlOperation)
        && ['opening','polling','checking'].includes(value.explorerStage)
        && ['restorePointId','backupId','backupObjectId'].every(key=>uuidPattern.test(value.explorerPoint?.[key])))
      && (value.message == null || typeof value.message === 'string')
      && (value.mountErrors == null || Array.isArray(value.mountErrors) && value.mountErrors.every((issue: {type?: unknown; message?: unknown} | null) =>
        issue && typeof issue.type === 'string' && typeof issue.message === 'string'))
      && (value.phase !== 'accepted' || uuidPattern.test(value.sessionId)))
  } catch { return [] }
}

function remember(receipt: RestoreLaunch) {
  const stored=storedLaunches()
  if(receipt.explorerTracked){
    // A late response from a previous observation must not undo a definitive
    // result already recorded for this exact source-bound request.
    const finished=[recent.get(receipt.requestId),...stored].find(r=>r?.explorerTracked&&r.requestId===receipt.requestId&&r.sourceKey===receipt.sourceKey&&
      r.operation===receipt.operation&&(r.phase==='accepted'||r.phase==='rejected'))
    if(finished){recent.set(receipt.requestId,finished);return finished}
  }
  recent.set(receipt.requestId, receipt)
  if (recent.size > 24) recent.delete(recent.keys().next().value!)
  const entries = stored.filter(item => item.requestId !== receipt.requestId)
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
  if (receipt?.phase === 'starting' && !receipt.explorerTracked && !inFlight.has(requestId)) return { ...receipt, phase: 'unknown' as const }
  // Previous Explorer versions recorded some browser transport errors as a rejection.
  // Their original requests have no server receipt, so they can only be investigated.
  if(receipt?.phase==='rejected'&&!receipt.explorerTracked&&(receipt.operation===activeDirectoryOperation||receipt.operation===sqlOperation)&&
    /^(?:TypeError:\s*)?(?:Failed to fetch|NetworkError when attempting to fetch resource|Network request failed|Load failed)\.?$/i.test(receipt.message?.trim()||'')){
    return {...receipt,phase:'unknown' as const}
  }
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

type TrackedExplorer=RestoreLaunch & {explorerTracked:true;operation:typeof activeDirectoryOperation|typeof sqlOperation}
export function canCheckExplorerLaunch(receipt?:RestoreLaunch):receipt is TrackedExplorer{
  return !!receipt?.explorerTracked&&(receipt.operation===activeDirectoryOperation||receipt.operation===sqlOperation)&&(receipt.phase==='starting'||receipt.phase==='unknown')
}

function trackExplorer(receipt:TrackedExplorer,selection:ExplorerSelection|undefined,io:ExplorerHandoffIO){
  let current:RestoreLaunch=receipt
  const result=Promise.resolve().then(()=>resolveExplorerHandoff({requestId:receipt.requestId,sourceKey:receipt.sourceKey,
    provider:receipt.operation===activeDirectoryOperation?'ad':'sql-explorer'},selection,next=>{
    if(current.explorerStage===next&&current.phase==='starting')return
    current=remember({...current,phase:'starting',message:undefined,explorerStage:next})
  },io)).then(outcome=>remember({...current,...outcome})).catch(error=>remember({...current,phase:'unknown',message:error instanceof Error?error.message:undefined}))
  inFlight.set(receipt.requestId,result)
  void result.finally(()=>inFlight.delete(receipt.requestId))
  return result
}

export function beginExplorerLaunch(input:{sourceKey:string;operation:TrackedExplorer['operation']} & ExplorerSelection,
  workload:string,pointTime?:string,io=explorerHandoffIO){
  const {sourceKey,operation,reviewedMalwareStatus,...point}=input
  const existing=recentRestoreLaunches(sourceKey).find(row=>canCheckExplorerLaunch(row)&&row.operation===operation&&
    row.explorerPoint?.restorePointId===point.restorePointId&&row.explorerPoint?.backupId===point.backupId&&row.explorerPoint?.backupObjectId===point.backupObjectId)
  if(existing&&(existing.phase==='starting'||inFlight.has(existing.requestId)))return existing
  // A new review can reach the server even if the original POST never arrived.
  // Reuse the reservation key so an existing native browse is never started twice.
  const receipt:TrackedExplorer={requestId:existing?.requestId??uuid(),createdAt:existing?.createdAt??new Date().toISOString(),sourceKey,operation,workload,pointTime,
    phase:'starting',explorerTracked:true,explorerStage:'opening',explorerPoint:point}
  remember(receipt)
  void trackExplorer(receipt,{...point,reviewedMalwareStatus},io)
  return receipt
}

export function observeRestoreLaunch(requestId:string,io=explorerHandoffIO){
  const existing=inFlight.get(requestId)
  if(existing)return existing
  const receipt=readRestoreLaunch(requestId)
  return canCheckExplorerLaunch(receipt)?trackExplorer(receipt,undefined,io):Promise.resolve(receipt)
}

export function findSessionLaunch(sourceKey: string, sessionId: string) {
  return [...recent.values(), ...storedLaunches()].find(receipt =>
    receipt.phase === 'accepted' && receipt.sourceKey === sourceKey && receipt.sessionId === sessionId)
}
