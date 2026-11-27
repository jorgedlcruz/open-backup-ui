// Open Backup UI v1.3.0
import { browseCollectionNotFound } from '../../lib/vbm-recovery/read-retry'
import { browseReceiptWaitMs } from '../../lib/vbm-recovery/proxy-wait-policy'

export class RecoveryRequestError extends Error {
  constructor(message:string,public status:number,public outcomeUnknown:boolean,
    public code?:typeof browseCollectionNotFound) { super(message); this.name='RecoveryRequestError' }
}

const asRecord=(value:unknown):Record<string,unknown>|undefined=>value!==null && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:undefined
const isId=(value:unknown)=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const isStringArray=(value:unknown):value is string[]=>Array.isArray(value) && value.every(item=>typeof item==='string' && item.length>0)
function validRecoveryResult(value:unknown,action?:unknown) {
  const result=asRecord(value)
  if(!result)return false
  if(action!=='restore' && result.session!==undefined) {
    const session=asRecord(result.session)
    return !!session && isId(session.id) && typeof session.name==='string' && typeof session.state==='string' && typeof session.type==='string' &&
      ({Exchange:'Vex',OneDrive:'Veod',SharePoint:'Vesp',Teams:'Vet'} as Record<string,string>)[String(session.workload)]===session.type
  }
  return action!=='start' && isId(result.sessionId) && Array.isArray(result.operations) && result.operations.length>0 && result.operations.every(value=>{
    const operation=asRecord(value)
    return !!operation && typeof operation.group==='string' && operation.group.length>0 && isStringArray(operation.itemIds) &&
      operation.itemIds.length>0 && Number.isInteger(operation.itemCount) && operation.itemCount===operation.itemIds.length &&
      (operation.itemKeys===undefined || isStringArray(operation.itemKeys) && operation.itemKeys.length===operation.itemCount) &&
      typeof operation.status==='string' && ['accepted','failed','unknown','notSubmitted'].includes(operation.status) &&
      (operation.status!=='accepted' || isId(operation.sessionId)) && (operation.error===undefined || typeof operation.error==='string')
  })
}
const unconfirmed='The request outcome is unconfirmed. Check recovery operations before trying again.'

export async function recoveryGet<T>(query:Record<string,string|number|undefined>,signal?:AbortSignal):Promise<T> {
  const params=new URLSearchParams()
  Object.entries(query).forEach(([key,value])=>{if(value!==undefined)params.set(key,String(value))})
  const response=await fetch(`/api/vbm/recovery?${params}`,{signal,cache:'no-store'})
  const body=await response.json().catch(()=>{throw new RecoveryRequestError('The recovery service did not return a readable response.',response.status,false)})
  if(!response.ok) {
    const code = query.action==='browse' && query.kind==='owners' && !query.parentId && Number(query.offset ?? 0)===0 && response.status===404 && body.code===browseCollectionNotFound ? browseCollectionNotFound:undefined
    throw new RecoveryRequestError(body.error || 'Recovery information could not be loaded.',response.status,body.outcomeUnknown!==false,code)
  }
  return body as T
}
async function postResponse(body:unknown, signal?:AbortSignal, asyncBrowse=false) {
  const response=await fetch('/api/vbm/recovery',{method:'POST',headers:{'Content-Type':'application/json',...(asyncBrowse?{Prefer:'respond-async'}:{})},body:JSON.stringify(body),cache:'no-store',signal})
  const data=await response.json().catch(()=>{throw new RecoveryRequestError('The recovery response could not be read. Check operations before trying again.',response.status,true)})
  const action=asRecord(body)?.action
  if (!response.ok) {
    const problem = asRecord(data)
    throw new RecoveryRequestError(
      typeof problem?.error === 'string' && problem.error || 'The recovery request could not be completed.',
      response.status, problem?.outcomeUnknown !== false,
    )
  }
  if(asyncBrowse && response.status===202) {
    const receipt=asRecord(data)
    if(receipt?.status!=='pending' || receipt.requestId!==asRecord(body)?.requestId)throw new RecoveryRequestError(unconfirmed,502,true)
    return {pending:true,data:undefined}
  }
  if((action==='start' || action==='restore') && !validRecoveryResult(data,action))throw new RecoveryRequestError(unconfirmed,response.status,true)
  return {pending:false,data}
}
export async function recoveryPost<T>(body:unknown, signal?:AbortSignal):Promise<T> {
  return (await postResponse(body,signal)).data as T
}
export async function openBrowseSession<T>(body:{action:'start';requestId:string;[field:string]:unknown},signal:AbortSignal,onProxyWaitChange?:(waiting:boolean)=>void):Promise<T> {
  try {
    const response=await postResponse(body,signal,true)
    if(!response.pending)return response.data as T
  } catch(error) {
    signal.throwIfAborted()
    if(error instanceof RecoveryRequestError && !error.outcomeUnknown)throw error
  }
  return recoverReceipt<T>(body.requestId,signal,onProxyWaitChange)
}
/** Reconcile a submitted request; never repeat a restore POST after a network failure. */
export async function recoverReceipt<T>(requestId:string,browseSignal?:AbortSignal,onProxyWaitChange?:(waiting:boolean)=>void):Promise<T> {
  const until=Date.now()+(browseSignal ? browseReceiptWaitMs : 3*60_000)
  let failedReads=0
  let pendingDelayMs=browseSignal?1000:3000
  while(Date.now()<until) {
    browseSignal?.throwIfAborted()
    let value:unknown
    const signal=browseSignal?AbortSignal.any([browseSignal,AbortSignal.timeout(10_000)]):undefined
    try {value=await recoveryGet<unknown>({action:'request',requestId},signal)}
    catch(error) {
      browseSignal?.throwIfAborted()
      const status=error instanceof RecoveryRequestError?error.status:0
      // Only a local receipt GET is retried. Allow a brief registration race after a dropped POST.
      if(!browseSignal || ++failedReads>=4 || !(status===0 || [404,408,429].includes(status) || status>=500))throw new RecoveryRequestError(unconfirmed,status,true)
      await receiptDelay(3000,browseSignal)
      continue
    }
    failedReads=0
    const receipt=asRecord(value)
    if(!receipt || typeof receipt.createdAt!=='string' || !Number.isFinite(Date.parse(receipt.createdAt)) ||
      typeof receipt.status!=='string' || !['pending','completed','failed','unknown'].includes(receipt.status) ||
      (receipt.error!==undefined && typeof receipt.error!=='string'))throw new RecoveryRequestError(unconfirmed,502,true)
    if(receipt.status==='completed') {
      if(!validRecoveryResult(receipt.result,browseSignal?'start':undefined))throw new RecoveryRequestError(unconfirmed,502,true)
      return receipt.result as T
    }
    if(receipt.status!=='pending')throw new RecoveryRequestError(typeof receipt.error==='string'?receipt.error:unconfirmed,409,receipt.status!=='failed')
    onProxyWaitChange?.(receipt.phase==='waitingForProxy')
    await receiptDelay(pendingDelayMs,browseSignal)
    if(browseSignal)pendingDelayMs=Math.min(5000,pendingDelayMs*2)
  }
  throw new RecoveryRequestError('The request is still being prepared. Check Recovery Center for its session before trying again.',408,true)
}

function receiptDelay(delay:number,signal?:AbortSignal) {
  return new Promise<void>((resolve,reject)=>{
    signal?.throwIfAborted()
    const cancel=()=>{clearTimeout(timer);reject(signal!.reason)}
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve()},delay)
    signal?.addEventListener('abort',cancel,{once:true})
  })
}
