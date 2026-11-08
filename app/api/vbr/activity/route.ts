import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadActivity } from '@/lib/activity/load'
import { validId } from '@/lib/investigation/model'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const skip = Number(params.get('skip') || 0)
  const name = (params.get('name') || '').trim()
  const focus = params.get('session')?.toLowerCase()
  const state = params.get('state') || ''
  if (!Number.isSafeInteger(skip) || skip < 0 || name.length > 200 || (focus && !validId(focus)) ||
      !['', 'Starting', 'Working', 'Stopping', 'Stopped', 'ActionRequired'].includes(state)) {
    return NextResponse.json({error: 'Invalid activity filter.'}, {status: 400})
  }
  return withVbrRead(request, (read, sourceName, _inventory, {sourceKey, publishedRecoveries}) => loadActivity(read, sourceName, sourceKey, {skip, name, focus, state}, publishedRecoveries))
}
