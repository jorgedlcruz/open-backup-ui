// Open Backup UI v1.2.0
import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { withVbrRecovery } from '@/lib/server/vbr-recovery'
import { TopologyRequestError } from '@/lib/topology/load'
import { validId } from '@/lib/investigation/model'
import { loadActivitySession, type MountHint } from '@/lib/activity/session'
import { platforms } from '@/lib/activity/model'
import { explorerSession } from '@/lib/server/explorer-session-records'
import { nativeExplorerKind } from '@/lib/recovery/explorer-resume'
import { stopEntireVm } from '@/lib/activity/stop-session'
import { readSessionThroughput, recordSessionThroughput } from '@/lib/server/session-throughput'

type Context = { params: Promise<{id: string}> }
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, {params}: Context) {
  const id = (await params).id.toLowerCase()
  const search = request.nextUrl.searchParams
  const mount = search.get('mount')?.toLowerCase(), kind = search.get('kind'), expected = search.get('sourceKey')
  if (!validId(id) || ((mount || kind) && (!validId(mount) || ![...platforms, 'other'].includes(kind || ''))) ||
    (expected !== null && !/^[a-f0-9]{64}$/.test(expected))) return NextResponse.json({error:'Invalid session link.'}, {status:400})
  return withVbrRead(request, async (read, sourceName, _inventory, ctx) => {
    if (expected && expected !== ctx.sourceKey) throw new TopologyRequestError('This session belongs to a different VBR source.', 409)
    const marker=ctx.explorerPrincipalKey ? await explorerSession({sourceKey:ctx.sourceKey,principalKey:ctx.explorerPrincipalKey,sessionId:id}) : undefined
    const detail = await loadActivitySession(read, sourceName, ctx.sourceKey, id, mount && kind ? {id: mount, kind} as MountHint : undefined, ctx.publishedRecoveries, ctx.vmPower, marker ? {kind:marker.kind,closed:!!marker.closedAt} : undefined)
    // The VBR read above authorizes each session before its principal-scoped history can be used.
    const [throughput, migrationThroughput] = await Promise.all([
      detail.session && recordSessionThroughput(ctx.cacheKey, detail.session, detail.logs, Date.now(), detail.tasks).catch(() => undefined),
      detail.instantMigration && readSessionThroughput(ctx.cacheKey, detail.instantMigration.id, detail.instantMigration.endTime).catch(() => undefined),
    ])
    const nativeKind = !marker && ctx.explorerPrincipalKey ? nativeExplorerKind(detail.session) : undefined
    return {...detail,...(nativeKind && {appExplorer:{kind:nativeKind,closed:!!detail.session?.endTime || detail.session?.state==='Stopped',needsResume:true}}),throughput:throughput || undefined, migrationThroughput:migrationThroughput || undefined}
  })
}
export async function POST(request: NextRequest, {params}: Context) {
  const id = (await params).id.toLowerCase()
  const body = await request.json().catch(() => null)
  if (!validId(id) || body?.action !== 'stop' || typeof body?.sourceKey !== 'string' || !/^[0-9a-f]{64}$/.test(body.sourceKey))
    return NextResponse.json({error:'Invalid recovery action.'}, {status:400})
  return withVbrRecovery(request, ({send, sourceKey}) => stopEntireVm(send, sourceKey, body.sourceKey, id))
}
