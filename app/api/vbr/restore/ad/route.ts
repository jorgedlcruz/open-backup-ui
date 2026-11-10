// Open Backup UI v1.0.2
import { after, NextRequest } from 'next/server'
import { adExplorerSchema, runAdExplorer } from '@/lib/recovery/ad-explorer'
import { verifyExplorerPoint } from '@/lib/recovery/application-eligibility'
import { checkSource, VbrRecoveryError } from '@/lib/recovery/error'
import { withVbrRecovery } from '@/lib/server/vbr-recovery'
import { ENCRYPTION_KEY,LEGACY_DEFAULT_KEY } from '@/lib/server/encryption'
import { explorerSession, rememberExplorerSession } from '@/lib/server/explorer-session-records'
import { explorerLaunchRequest,isExplorerLaunchRequest } from '@/lib/recovery/explorer-launch-request'

export const dynamic='force-dynamic'
export async function POST(request:NextRequest) {
  const raw=await request.json().catch(()=>null),tracked=isExplorerLaunchRequest(raw)
  return withVbrRecovery(request,async ({send,sourceKey,getExplorer})=>{
    if(ENCRYPTION_KEY===LEGACY_DEFAULT_KEY) throw new VbrRecoveryError('Application recovery requires a private server encryption key.',503)
    const explorer=getExplorer(), key={sourceKey,principalKey:explorer.principalKey}
    if(tracked)return explorerLaunchRequest(raw,'activeDirectory',{...key,secret:ENCRYPTION_KEY},send,explorer.send,after)
    const parsed=adExplorerSchema.safeParse(raw)
    if(!parsed.success) throw new VbrRecoveryError('Check the Active Directory Explorer options.')
    const input=parsed.data
    checkSource(input.sourceKey,sourceKey)
    if(input.action==='start') {
      await verifyExplorerPoint(explorer.send,send,{...input,objectId:input.backupObjectId},'activeDirectory')
    } else if('sessionId' in input) {
      const marker=await explorerSession({...key,sessionId:input.sessionId})
      if(marker?.kind!=='activeDirectory' || marker.closedAt) throw new VbrRecoveryError('Open a current Active Directory browse session for this VBR account.',409)
    }
    const result=await runAdExplorer(explorer.send,input,{...key,secret:ENCRYPTION_KEY})
    if('application' in result && result.application==='ActiveDirectory' && 'sessionId' in result && typeof result.sessionId==='string') {
      await rememberExplorerSession({...key,sessionId:result.sessionId},'activeDirectory',false,'restorePointId' in result && typeof result.restorePointId==='string'?result.restorePointId:undefined)
    } else if(input.action==='finish') await rememberExplorerSession({...key,sessionId:input.sessionId},'activeDirectory',true)
    return {sourceKey,...result}
  },{backgroundExplorerStart:tracked&&raw?.action==='start'})
}
