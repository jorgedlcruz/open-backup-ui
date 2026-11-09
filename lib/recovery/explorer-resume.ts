// Open Backup UI v1.0.2
import {z} from 'zod'
import {investigationSessionSchema} from '../investigation/model'
import type {Session} from '../investigation/model'
import type {RecoverySend} from '../server/vbr-recovery'
import type {ExplorerKind} from '../server/explorer-session-records'
import {VbrRecoveryError} from './error'

// This is a display hint from a VBR-generated browse-session name. A native
// provider-specific check and the current operator permissions authorize resuming.
export function nativeExplorerKind(session?:Session|null):ExplorerKind|undefined {
  if(session?.sessionType!=='ApplicationLevelRestore') return
  if(/^Microsoft SQL Server items browsing \(.+\)$/i.test(session.name||'')) return 'sql'
  if(/^(?:Microsoft )?Active Directory (?:items|objects) browsing \(.+\)$/i.test(session.name||'')) return 'activeDirectory'
}
export async function authorizeExplorerResume(read:RecoverySend,send:RecoverySend,id:string,kind:ExplorerKind) {
  const session=investigationSessionSchema.parse(await read('/api/v1/sessions/'+id))
  if(session.id!==id || session.endTime || !['Working','Starting'].includes(session.state||'') || nativeExplorerKind(session)!==kind) throw new VbrRecoveryError('This application browse session is no longer available.',409)
  const permissions=z.object({permissions:z.array(z.string()),username:z.string().min(1)}).parse(await send('/private-api/v1/permissions',{method:'POST'}))
  if(!session.initiatedBy || permissions.username.toLowerCase()!==session.initiatedBy.toLowerCase() || !permissions.permissions.includes(kind==='sql'?'StartExplorerForMsSql':'StartExplorerForMsAd')) throw new VbrRecoveryError('Open a browse session started by the connected VBR account.',403)
  const route=kind==='sql'?'/private-api/v1/restore/applicationItems/vesql/':'/private-api/v1/backupBrowser/applicationItems/vead/'
  await send(route+id+'/keepAlive',{method:'POST'})
}
