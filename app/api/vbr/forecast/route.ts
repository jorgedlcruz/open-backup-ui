// Open Backup UI v1.2.0
import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import {startCapacityCollector} from '@/lib/server/capacity-collector'
import {readForecastPreview,readForecastSnapshot,startForecastRefresh} from '@/lib/server/forecast-cache'

export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  if(request.nextUrl.searchParams.get('preview')==='1') {
    return withVbrRead(request,async(_read,_sourceName,_inventory,context)=>readForecastPreview(context))
  }
  startCapacityCollector()
  startForecastRefresh()
  return withVbrRead(request,async(read,sourceName,_inventory,context)=>{
    return readForecastSnapshot(read,sourceName,context,{force:request.nextUrl.searchParams.get('refresh')==='1',signal:context.signal})
  })
}
