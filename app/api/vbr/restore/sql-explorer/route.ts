// Open Backup UI v1.0.2
import {after,NextRequest} from 'next/server'
import {runSqlExplorer, sqlAfterClose, sqlExplorerSchema, sqlRequestSession} from '@/lib/recovery/sql-explorer'
import {verifyExplorerPoint} from '@/lib/recovery/application-eligibility'
import {checkSource} from '@/lib/recovery/error'
import {explorerSession,rememberExplorerSession} from '@/lib/server/explorer-session-records'
import {ENCRYPTION_KEY, LEGACY_DEFAULT_KEY} from '@/lib/server/encryption'
import {VbrRecoveryError, withVbrRecovery} from '@/lib/server/vbr-recovery'
import {explorerLaunchRequest,isExplorerLaunchRequest} from '@/lib/recovery/explorer-launch-request'

export const dynamic='force-dynamic'
export async function POST(request:NextRequest) {
  const raw=await request.json().catch(()=>null),tracked=isExplorerLaunchRequest(raw)
  return withVbrRecovery(request,async ({send,sourceKey,getExplorer})=>{
    if(ENCRYPTION_KEY===LEGACY_DEFAULT_KEY)throw new VbrRecoveryError('Application recovery requires a private server encryption key.',503)
    const explorer=getExplorer(),key={sourceKey,principalKey:explorer.principalKey},ctx={...key,secret:ENCRYPTION_KEY,stagingGateway:explorer.origin}
    if(tracked)return explorerLaunchRequest(raw,'sql',ctx,send,explorer.send,after)
    const parsed=sqlExplorerSchema.safeParse(raw)
    if(!parsed.success)throw new VbrRecoveryError('Invalid Explorer request.')
    const input=parsed.data
    checkSource(input.sourceKey,sourceKey)
    if(input.action==='start')await verifyExplorerPoint(explorer.send,send,input,'sql')
    const sessionId=sqlRequestSession(input,ctx)
    if(sessionId) {
      const marker=await explorerSession({...key,sessionId})
      if(marker?.kind!=='sql' || (marker.closedAt && !await sqlAfterClose(input,ctx)))throw new VbrRecoveryError('Open a current SQL browse session for this VBR account.',409)
    }
    const result=await runSqlExplorer(explorer.send,input,ctx)
    if('application' in result && result.application==='SQL' && 'sessionId' in result && typeof result.sessionId==='string') {
      await rememberExplorerSession({...key,sessionId:result.sessionId},'sql',false,'restorePointId' in result && typeof result.restorePointId==='string'?result.restorePointId:undefined)
    } else if(input.action==='finish')await rememberExplorerSession({...key,sessionId:input.sessionId},'sql',true)
    return {sourceKey,...result}
  },{backgroundExplorerStart:tracked&&raw?.action==='start'})
}
