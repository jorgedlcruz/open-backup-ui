// Open Backup UI v1.2.0
import {z} from 'zod'
import {unstructuredReceipts} from '@/lib/server/unstructured-receipts'
import {unstructuredKinds} from '@/lib/recovery/unstructured-catalog'
import {checkSource} from '@/lib/recovery/error'
import {NextRequest} from 'next/server'
import {withVbrRecovery} from '@/lib/server/vbr-recovery'
import {ENCRYPTION_KEY,LEGACY_DEFAULT_KEY} from '@/lib/server/encryption'
import {pointQuery,unstructuredAction,unstructuredCommand,unstructuredOptions} from '@/lib/recovery/unstructured'
import {VbrRecoveryError} from '@/lib/recovery/error'

export const dynamic='force-dynamic'
export async function GET(request:NextRequest){
  return withVbrRecovery(request,async ctx=>{
    if(request.nextUrl.searchParams.has('requestId')){
      const address=z.object({sourceKey:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.string().uuid(),kind:z.enum(unstructuredKinds)}).strict().safeParse(Object.fromEntries(request.nextUrl.searchParams))
      if(!address.success)throw new VbrRecoveryError('Invalid recovery request.')
      const {sourceKey,requestId,kind}=address.data;checkSource(sourceKey,ctx.sourceKey)
      await ctx.send('/api/v1/serverInfo')
      return {sourceKey,requestId,kind,...await unstructuredReceipts.launchStatus(sourceKey,ctx.cacheKey,requestId,kind)}
    }
    const input=pointQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if(!input.success)throw new VbrRecoveryError('Select a restore point.')
    return unstructuredOptions({...ctx,secret:ENCRYPTION_KEY,privateSend:ctx.getExplorer().send},input.data)
  })
}
export async function POST(request:NextRequest){
  const raw=await request.json().catch(()=>null)
  return withVbrRecovery(request,async ctx=>{
    const input=unstructuredCommand.safeParse(raw)
    if(!input.success)throw new VbrRecoveryError('Check the recovery settings.')
    if(ENCRYPTION_KEY===LEGACY_DEFAULT_KEY)throw new VbrRecoveryError('Application recovery requires a private server encryption key.',503)
    // A replay can return an already accepted local receipt before another
    // native mutation. Authenticate that read against the live VBR principal.
    if(input.data.action==='start')await ctx.send('/api/v1/serverInfo')
    const access={...ctx,secret:ENCRYPTION_KEY,privateSend:ctx.getExplorer().send}
    return {sourceKey:ctx.sourceKey,...await unstructuredAction(access,input.data)}
  },{backgroundExplorerStart:raw?.action==='start'})
}
