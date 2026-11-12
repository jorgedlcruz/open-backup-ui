// Open Backup UI v1.2.0
export type ExplorerProvider='ad'|'sql-explorer'
export type ExplorerStage='opening'|'polling'|'checking'
export type ExplorerSelection={restorePointId:string;backupId:string;backupObjectId:string;reviewedMalwareStatus?:string}
type Address={requestId:string;sourceKey:string;provider:ExplorerProvider}
export type ExplorerCommand={action:'start'|'poll'|'status';sourceKey:string;requestId:string;[key:string]:unknown}
export type ExplorerTransport=(provider:ExplorerProvider,command:ExplorerCommand)=>Promise<unknown>
export type ExplorerHandoffIO={send:ExplorerTransport;wait?:(ms:number)=>Promise<void>}
type Outcome={phase:'accepted';sessionId:string}|{phase:'rejected'|'unknown';message?:string}
type Reply={sourceKey?:unknown;requestId?:unknown;requestStatus?:unknown;pending?:unknown;sessionId?:unknown;error?:unknown}

const guid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
const retryDelays=[600,1400,3000,6000]
const errorText=(error:unknown)=>error instanceof Error?error.message:undefined
const invalid='VBR could not verify this recovery request.'
export const explorerHandoffIO:ExplorerHandoffIO={send:async(provider,command)=>{
  const {veeamApi}=await import('../api/veeam-client')
  return veeamApi.applicationExplorerRequest(provider,command)
}}

// Only a click supplies selection. Recovery from a reload, interrupted response,
// access gateway, or failed poll issues status/poll requests under the same UUID.
export async function resolveExplorerHandoff(address:Address,selection:ExplorerSelection|undefined,stage:(value:ExplorerStage)=>void,
  {send,wait=sleep}:ExplorerHandoffIO):Promise<Outcome>{
  const {provider,requestId,sourceKey}=address,scope={requestId,sourceKey}
  const bound=(reply:Reply)=>reply.sourceKey===sourceKey&&(reply.requestId===undefined||reply.requestId===requestId)
  const accepted=(reply:Reply):Outcome|undefined=>bound(reply)&&typeof reply.sessionId==='string'&&guid.test(reply.sessionId)
    ?{phase:'accepted',sessionId:reply.sessionId.toLowerCase()}:undefined
  const terminal=(reply:Reply):Outcome|undefined=>{
    if(!bound(reply)||reply.requestId!==requestId)return undefined
    const message=typeof reply.error==='string'?reply.error:undefined
    if(reply.requestStatus==='failed')return {phase:'rejected',message}
    if(reply.requestStatus==='unknown')return {phase:'unknown',message}
    return undefined
  }
  const handle=(reply:Reply)=>typeof reply.pending==='string'&&reply.pending.length>0?reply.pending:undefined
  let pending:string|undefined,rejection:string|undefined
  if(selection){
    try{
      const {backupObjectId,...point}=selection
      const reply=await send(provider,{action:'start',...scope,...point,...(provider==='ad'?{backupObjectId}:{objectId:backupObjectId})}) as Reply|null
      if(reply&&typeof reply==='object'&&(reply.sourceKey===undefined||bound(reply))){
        const outcome=terminal(reply)||accepted(reply)
        if(outcome)return outcome
        pending=handle(reply)
      }
    }catch(error){
      // Preserve an explicit validation error only if the status read also
      // confirms that this account has no reservation for the request.
      if(error instanceof Error&&'uncertain' in error&&error.uncertain===false)rejection=error.message
    }
  }
  let misses=0
  for(;;){
    stage(pending?'polling':'checking')
    if(pending)await wait(1000)
    try{
      const checking=!pending
      const reply=await send(provider,pending?{action:'poll',...scope,pending}:{action:'status',...scope}) as Reply|null
      if(!reply||typeof reply!=='object')throw Error(invalid)
      const outcome=terminal(reply)
      if(outcome)return outcome
      if(checking){
        if(!bound(reply)||reply.requestId!==requestId)throw Error(invalid)
        switch(reply.requestStatus){
          case 'ready': {const ready=accepted(reply);if(ready)return ready;throw Error(invalid)}
          case 'starting': pending=handle(reply);if(!pending)await wait(1200);continue
          case 'pending': pending=handle(reply);if(!pending)throw Error(invalid);continue
          case 'missing':
            if(rejection)return {phase:'rejected',message:rejection}
            // A status read can overtake the initial POST when a tab is reloaded.
            if(misses>=retryDelays.length)return {phase:'unknown'}
            await wait(retryDelays[misses++]);continue
          default: throw Error(invalid)
        }
      }
      if(reply.sourceKey!==undefined&&!bound(reply))throw Error(invalid)
      const ready=accepted(reply)
      if(ready)return ready
      pending=handle(reply)
      if(!pending)throw Error(invalid)
      misses=0
    }catch(error){
      // A failed read cannot establish that the browse failed. Look up the
      // durable server receipt, including when VBR already completed the task.
      pending=undefined
      stage('checking')
      if(misses>=retryDelays.length)return {phase:'unknown',message:errorText(error)}
      await wait(retryDelays[misses++])
    }
  }
}
