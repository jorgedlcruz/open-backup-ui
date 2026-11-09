// Open Backup UI v1.0.2
import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadActivity } from '@/lib/activity/load'
import { activityQuerySchema } from '@/lib/activity/filters'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const query = activityQuerySchema.safeParse({...Object.fromEntries(params), types: params.getAll('type'), results: params.getAll('result')})
  if (!query.success) return NextResponse.json({error: 'Invalid activity filter.'}, {status: 400})
  return withVbrRead(request, (read, name, _inventory, {sourceKey, publishedRecoveries}) =>
    loadActivity(read, name, sourceKey, query.data, publishedRecoveries))
}
