import { NextRequest, NextResponse } from 'next/server'
import { mountAction, runMountAction } from '@/lib/activity/actions'
import { withVbrRecovery } from '@/lib/server/vbr-recovery'
import { resolveInventory } from '@/lib/recovery/inventory'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  const parsed = mountAction.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({error: 'Invalid recovery action.'}, {status: 400})
  const id = (await params).id.toLowerCase()
  return withVbrRecovery(request, ({send, sourceKey}) =>
    runMountAction(send, (ref, kind) => resolveInventory(send, ref, 'VSphere', kind), sourceKey, id, parsed.data))
}
