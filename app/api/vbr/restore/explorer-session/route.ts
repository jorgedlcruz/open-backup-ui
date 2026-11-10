// Open Backup UI v1.2.0
import {NextRequest} from 'next/server'
import {z} from 'zod'
import {withVbrRecovery,VbrRecoveryError} from '@/lib/server/vbr-recovery'
import {checkSource} from '@/lib/recovery/error'
import {authorizeExplorerResume} from '@/lib/recovery/explorer-resume'
import {rememberExplorerSession} from '@/lib/server/explorer-session-records'
export const dynamic='force-dynamic'
export function POST(request:NextRequest) {
  return withVbrRecovery(request,async ({send,sourceKey,getExplorer})=>{
    const result=z.object({sourceKey:z.string(),sessionId:z.string().uuid(),kind:z.enum(['activeDirectory','sql'])}).strict().safeParse(await request.json().catch(()=>null))
    if(!result.success)throw new VbrRecoveryError('Select a live Explorer session.')
    const data=result.data;checkSource(data.sourceKey,sourceKey)
    const explorer=getExplorer()
    await authorizeExplorerResume(send,explorer.send,data.sessionId,data.kind)
    await rememberExplorerSession({sourceKey,principalKey:explorer.principalKey,sessionId:data.sessionId},data.kind,false)
    return {ok:true}
  })
}
