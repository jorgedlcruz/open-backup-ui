// Open Backup UI v1.2.0
import type {RestoreDraft,RestoreOperation,RestoreResult,RestoreStartStatus} from './workflow'

type Address={requestId:string;sourceKey:string;operation:RestoreOperation}
type Outcome={phase:'accepted';sessionId:string;mountErrors?:RestoreResult['mountErrors']}|{phase:'rejected'|'unknown';message?:string}
export type RestoreHandoffIO={send:(address:Address,draft?:RestoreDraft)=>Promise<unknown>;wait?:(ms:number)=>Promise<void>}
const guid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
const retryDelays=[600,1400,3000,6000]
export const restoreHandoffIO:RestoreHandoffIO={send:async(address,draft)=>{
  const {veeamApi}=await import('../api/veeam-client')
  return draft?veeamApi.startRestore(draft,address.requestId):veeamApi.getRestoreStart(address.sourceKey,address.requestId)
}}

// A click sends one POST. Reloads and interrupted responses only read its durable
// receipt; an absent or ambiguous receipt never authorizes a second native start.
export async function resolveRestoreHandoff(address:Address,draft:RestoreDraft|undefined,{send,wait=sleep}:RestoreHandoffIO):Promise<Outcome>{
  let rejection:string|undefined,initial:unknown
  const decode=(raw:unknown):RestoreStartStatus=>{
    if(!raw||typeof raw!=='object')throw Error('The recovery result could not be verified.')
    const reply=raw as RestoreStartStatus
    if(reply.sourceKey!==address.sourceKey||reply.requestId!==address.requestId||reply.operation!==address.operation||
      !['starting','accepted','rejected','unknown'].includes(reply.phase)||
      (reply.phase==='accepted'&&(!reply.sessionId||!guid.test(reply.sessionId)))||
      (reply.mountErrors!==undefined&&(!Array.isArray(reply.mountErrors)||reply.mountErrors.some(item=>!item||typeof item.type!=='string'||typeof item.message!=='string'))))
      throw Error('The recovery result could not be verified.')
    return reply
  }
  if(draft){
    try{initial=await send(address,draft)}catch(error){
      // Only use a known validation rejection when an authenticated status read
      // also establishes that no reservation exists for this exact request.
      if(error instanceof Error&&'uncertain' in error&&error.uncertain===false)rejection=error.message
    }
  }
  let misses=0
  for(;;){
    try{
      const reply=decode(initial??await send(address))
      initial=undefined
      if(reply.phase==='accepted')return {phase:'accepted',sessionId:reply.sessionId!.toLowerCase(),mountErrors:reply.mountErrors}
      if(reply.phase==='rejected'||reply.phase==='unknown')return {phase:reply.phase,message:typeof reply.message==='string'?reply.message:undefined}
      misses=0
      await wait(1200)
    }catch(error){
      initial=undefined
      if(rejection&&error&&typeof error==='object'&&'status' in error&&error.status===404)return {phase:'rejected',message:rejection}
      if(error&&typeof error==='object'&&'status' in error&&[401,403,409].includes(Number(error.status)))
        return {phase:'unknown',message:error instanceof Error?error.message:undefined}
      if(misses>=retryDelays.length)return {phase:'unknown',message:error instanceof Error?error.message:undefined}
      await wait(retryDelays[misses++])
    }
  }
}
