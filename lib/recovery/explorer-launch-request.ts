// Open Backup UI v1.2.0
import {z} from 'zod'
import {validId} from '../investigation/model'
import {VbrRecoveryError,checkSource} from './error'
import {verifyExplorerPoint} from './application-eligibility'
import type {RecoverySend} from '../server/vbr-recovery'
import type {ExplorerKind} from '../server/explorer-session-records'
import {explorerLaunches} from '../server/explorer-launches'

const guid=z.string().refine(validId).transform(v=>v.toLowerCase())
const raw=z.object({action:z.string(),requestId:z.unknown().optional(),pending:z.string().optional()})
export function isExplorerLaunchRequest(value:unknown){
  const result=raw.safeParse(value)
  if(!result.success)return false
  const {action,requestId,pending}=result.data
  // Older pages omit the request UUID. Validate them here, before they can
  // enter the legacy native start path and create a session with no receipt.
  return action==='status'||action==='start'||action==='poll'&&(requestId!==undefined||pending?.startsWith('launch1.'))
}
const request=z.object({sourceKey:z.string().regex(/^[a-f0-9]{64}$/),requestId:guid.optional()})
const commands=z.discriminatedUnion('action',[
  request.extend({action:z.literal('status'),requestId:guid}),
  request.extend({action:z.literal('poll'),pending:z.string().min(1).max(256)}),
  request.extend({action:z.literal('start'),requestId:guid,restorePointId:guid,backupId:guid,objectId:guid.optional(),
    backupObjectId:guid.optional(),reviewedMalwareStatus:z.string().max(64).nullish()}),
])
type Context={sourceKey:string;principalKey:string;secret:string}
export async function explorerLaunchRequest(value:unknown,kind:ExplorerKind,ctx:Context,publicSend:RecoverySend,
    privateSend:RecoverySend,schedule:(callback:()=>Promise<void>)=>void){
  const action=raw.safeParse(value)
  if(action.success&&action.data.action==='start'&&action.data.requestId===undefined)throw new VbrRecoveryError('This recovery form is out of date. Refresh Recovery Center before starting.',409)
  const parsed=commands.safeParse(value)
  if(!parsed.success)throw new VbrRecoveryError('Invalid Explorer request.')
  const input=parsed.data
  checkSource(input.sourceKey,ctx.sourceKey)
  const id=guid.safeParse(input.requestId??(input.action==='poll'?input.pending.split('.')[1]:undefined))
  if(!id.success)throw new VbrRecoveryError('Invalid Explorer request.')
  const key={sourceKey:ctx.sourceKey,principalKey:ctx.principalKey,kind},requestId=id.data
  // Authenticate locally stored status reads against the same configured public
  // principal even when a private gateway outage prevented a native task.
  await publicSend('/api/v1/serverInfo')
  if(input.action==='start'){
    const objectId=kind==='sql'?input.objectId:input.backupObjectId
    if(!objectId||input.objectId&&input.backupObjectId&&input.objectId!==input.backupObjectId)throw new VbrRecoveryError('Select an application restore point.')
    const data={objectId,backupId:input.backupId,restorePointId:input.restorePointId,reviewedMalwareStatus:input.reviewedMalwareStatus}
    if(await explorerLaunches.reserve(key,requestId,data)){
      schedule(async()=>{
        await explorerLaunches.submit(key,requestId,data,()=>verifyExplorerPoint(privateSend,publicSend,data,kind),privateSend)
        // Materialize accepted sessions when the initiating tab has already left.
        // If this process stops, status/poll resumes only the exact recorded task.
        for(let i=0;i<24;i++){
          try {
            const state=await explorerLaunches.response(key,requestId,ctx.secret,privateSend)
            if(state.requestStatus!=='pending')return
          }catch{/* transient native reads leave the durable task available */}
          await new Promise(resolve=>setTimeout(resolve,Math.min(5000,1000+i*500)))
        }
      })
    }
    return explorerLaunches.response(key,requestId,ctx.secret)
  }
  return explorerLaunches.response(key,requestId,ctx.secret,privateSend,input.action==='poll'?input.pending:undefined)
}
