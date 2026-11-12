// Open Backup UI v1.2.0
import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {withVbrRead} from '@/lib/server/vbr-read'
import {TopologyRequestError} from '@/lib/topology/load'
import {pickerScopes} from '@/lib/restore-points/recovery-picker'
import {pickerPage} from '@/lib/recovery/picker-catalog'
import {VbrRecoveryError} from '@/lib/recovery/error'

export const dynamic='force-dynamic'
const params=z.object({sourceKey:z.string().regex(/^[a-f0-9]{64}$/),kind:z.enum(pickerScopes),view:z.enum(['goals','objects','points','index']),snapshotId:z.string().uuid().optional(),
  objectId:z.string().uuid().optional(),backupId:z.string().uuid().optional(),restorePointId:z.string().uuid().optional(),query:z.string().max(256).optional(),
  offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(200).default(50),refresh:z.literal('true').optional(),
  pointLimit:z.coerce.number().int().min(200).max(20000).multipleOf(200).default(200),
  calendarZone:z.string().min(1).max(100).refine(zone=>{try{new Intl.DateTimeFormat('en',{timeZone:zone});return true}catch{return false}}).optional(),
  calendarDay:z.string().regex(/^(?:\d{4}-\d{2}-\d{2}|undated)$/).optional(),calendarIndex:z.literal('true').optional()})
export async function GET(request:NextRequest){
  const input=params.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if(!input.success||(input.data.view==='points'&&!input.data.objectId)||
    (input.data.view==='index'&&(input.data.query!==undefined||input.data.objectId||input.data.backupId||input.data.restorePointId||input.data.refresh&&input.data.snapshotId))||
    (input.data.snapshotId&&input.data.view!=='index'))return NextResponse.json({error:'Select a valid recovery option.'},{status:400,headers:{'Cache-Control':'private, no-store'}})
  return withVbrRead(request,async(read,_name,_inventory,context)=>{
    if(context.sourceKey!==input.data.sourceKey)throw new TopologyRequestError('The connected VBR source changed. Reopen this workflow.',409)
    const privateClient=context.serverCredentials?context.getExplorer():undefined
    try{return {...await pickerPage(read,privateClient?.send,context.cacheKey+'/'+(privateClient?.principalKey||'public'),{...input.data,publicCacheKey:context.cacheKey,refresh:input.data.refresh==='true',calendarIndex:input.data.calendarIndex==='true'}),sourceKey:context.sourceKey}}
    catch(e){if(e instanceof TopologyRequestError)throw e;if(e instanceof VbrRecoveryError)throw new TopologyRequestError(e.message,e.status);throw new TopologyRequestError('VBR could not check the recovery options for this source.',502)}
  })
}
