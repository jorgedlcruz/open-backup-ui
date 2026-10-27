import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadForecast } from '@/lib/forecast/load'
import { recordCapacity } from '@/lib/server/capacity-history'
import {getCollectorStatus,startCapacityCollector} from '@/lib/server/capacity-collector'

export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  startCapacityCollector()
  return withVbrRead(request,async(read,sourceName,_inventory,context)=>{
    const snapshot=await loadForecast(read,sourceName)
    try { snapshot.observations=await recordCapacity(context.cacheKey,snapshot.repositories.data);snapshot.historyAvailable=true }
    catch { snapshot.warnings.push('Capacity history could not be saved or read. Current API evidence remains available.') }
    snapshot.collector=await getCollectorStatus(context.cacheKey,context.serverCredentials)
    return snapshot
  })
}
