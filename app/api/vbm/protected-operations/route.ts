import { NextRequest,NextResponse } from 'next/server'
import { withVbmRead } from '@/lib/server/vbm-read'
import { loadInventory,loadDetail } from '@/lib/vbm-protected/load'
import { opaqueId,objectType } from '@/lib/vbm-protected/model'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  const id=request.nextUrl.searchParams.get('id'),type=request.nextUrl.searchParams.get('type')
  if(id!==null || type!==null) {
    const parsedId=opaqueId.safeParse(id),parsedType=objectType.safeParse(type)
    if(!parsedId.success || !parsedType.success)return NextResponse.json({error:'A valid object ID and type are required.'},{status:400})
    return withVbmRead(request,(read,source)=>loadDetail(read,source,parsedType.data,parsedId.data))
  }
  return withVbmRead(request,(read,source)=>loadInventory(read,source))
}
