// Open Backup UI v1.0.2
import {NextRequest} from 'next/server'
import {runSqlExplorer, sqlAfterClose, sqlExplorerSchema, sqlRequestSession} from '@/lib/recovery/sql-explorer'
import {verifyExplorerPoint} from '@/lib/recovery/application-eligibility'
import {checkSource} from '@/lib/recovery/error'
import {explorerSession,rememberExplorerSession} from '@/lib/server/explorer-session-records'
import {ENCRYPTION_KEY, LEGACY_DEFAULT_KEY} from '@/lib/server/encryption'
import {VbrRecoveryError, withVbrRecovery} from '@/lib/server/vbr-recovery'

export const dynamic='force-dynamic'
export async function POST(request:NextRequest) {
  return withVbrRecovery(request,async ({send,sourceKey,getExplorer})=>{
    const parsed=sqlExplorerSchema.safeParse(await request.json().catch(()=>null))
    if(!parsed.success)throw new VbrRecoveryError('Invalid Explorer request.')
    const input=parsed.data
    checkSource(input.sourceKey,sourceKey)
    if(ENCRYPTION_KEY===LEGACY_DEFAULT_KEY)throw new VbrRecoveryError('Application recovery requires a private server encryption key.',503)
    const explorer=getExplorer(),key={sourceKey,principalKey:explorer.principalKey},ctx={...key,secret:ENCRYPTION_KEY}
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
  })
}
