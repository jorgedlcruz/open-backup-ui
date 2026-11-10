// Open Backup UI v1.0.2
import {NextRequest} from 'next/server'
import {withVbrRecovery,VbrRecoveryError} from '@/lib/server/vbr-recovery'
import {agentVolumes,volumeCommand} from '@/lib/recovery/agent-volumes'
import {checkSource} from '@/lib/recovery/error'
export const dynamic='force-dynamic'
export function POST(request:NextRequest){return withVbrRecovery(request,async({send,getExplorer,sourceKey})=>{
 const command=volumeCommand.safeParse(await request.json().catch(()=>null));if(!command.success)throw new VbrRecoveryError('Invalid computer recovery request.')
 checkSource(command.data.sourceKey,sourceKey);const privateApi=getExplorer()
 return agentVolumes(send,privateApi.send,privateApi.principalKey,command.data)
},{backgroundRestore:true})}


export function GET(request:NextRequest){return withVbrRecovery(request,async({send,getExplorer,sourceKey})=>{
 const command=volumeCommand.safeParse({...Object.fromEntries(request.nextUrl.searchParams),action:'download'})
 if(!command.success)throw new VbrRecoveryError('Invalid recovery media request.')
 checkSource(command.data.sourceKey,sourceKey);const privateApi=getExplorer()
 return agentVolumes(send,privateApi.send,privateApi.principalKey,command.data)
})}
