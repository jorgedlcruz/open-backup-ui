import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { withVbrRecovery } from '@/lib/server/vbr-recovery'
import { TopologyRequestError } from '@/lib/topology/load'
import { validId } from '@/lib/investigation/model'
import { loadActivitySession, type MountHint } from '@/lib/activity/session'
import { platforms } from '@/lib/activity/model'
import { stopEntireVm } from '@/lib/activity/stop-session'

type Context = { params: Promise<{id: string}> }
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, {params}: Context) {
  const id = (await params).id.toLowerCase()
  const search = request.nextUrl.searchParams
  const mount = search.get('mount')?.toLowerCase(), kind = search.get('kind'), expected = search.get('sourceKey')
  if (!validId(id) || ((mount || kind) && (!validId(mount) || ![...platforms, 'other'].includes(kind || ''))) ||
    (expected !== null && !/^[a-f0-9]{64}$/.test(expected))) return NextResponse.json({error:'Invalid session link.'}, {status:400})
  return withVbrRead(request, (read, sourceName, _inventory, ctx) => {
    if (expected && expected !== ctx.sourceKey) throw new TopologyRequestError('This session belongs to a different VBR source.', 409)
    return loadActivitySession(read, sourceName, ctx.sourceKey, id, mount && kind ? {id: mount, kind} as MountHint : undefined, ctx.publishedRecoveries, ctx.vmPower)
  })
}
export async function POST(request: NextRequest, {params}: Context) {
  const id = (await params).id.toLowerCase()
  const body = await request.json().catch(() => null)
  if (!validId(id) || body?.action !== 'stop' || typeof body?.sourceKey !== 'string' || !/^[0-9a-f]{64}$/.test(body.sourceKey))
    return NextResponse.json({error:'Invalid recovery action.'}, {status:400})
  return withVbrRecovery(request, ({send, sourceKey}) => stopEntireVm(send, sourceKey, body.sourceKey, id))
}
