import { NextRequest,NextResponse } from 'next/server'
import { withVbmRead } from '@/lib/server/vbm-read'
import { validId } from '@/lib/investigation/model'
import { loadRepositories } from '@/lib/vbm-repositories/load'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  const id=request.nextUrl.searchParams.get('repositoryId')
  if(id!==null && !validId(id))return NextResponse.json({error:'Invalid repository ID.'},{status:400,headers:{'Cache-Control':'private, no-store'}})
  return withVbmRead(request,(read,source)=>loadRepositories(read,source,id || undefined))
}
