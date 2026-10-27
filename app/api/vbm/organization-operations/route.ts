import { NextRequest,NextResponse } from 'next/server'
import { withVbmRead } from '@/lib/server/vbm-read'
import { validId } from '@/lib/investigation/model'
import { loadOrganizations } from '@/lib/vbm-organizations/load'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  const id=request.nextUrl.searchParams.get('organizationId')
  if(id!==null && !validId(id))return NextResponse.json({error:'Invalid organization ID.'},{status:400,headers:{'Cache-Control':'private, no-store'}})
  return withVbmRead(request,(read,source)=>loadOrganizations(read,source,id || undefined))
}
