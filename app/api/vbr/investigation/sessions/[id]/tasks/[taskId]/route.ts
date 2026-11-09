// Open Backup UI v1.0.2
import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadTaskInvestigation } from '@/lib/investigation/load'
import { validId } from '@/lib/investigation/model'
import { TopologyRequestError } from '@/lib/topology/load'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params
  if (!validId(id) || !validId(taskId)) return NextResponse.json({ error: 'Select a valid session and task.' }, { status: 400 })
  return withVbrRead(request, (read, _source, _inventory, ctx) => {
    const expected = request.nextUrl.searchParams.get('sourceKey')
    if (expected && expected !== ctx.sourceKey) throw new TopologyRequestError('This session belongs to a different VBR source.', 409)
    return loadTaskInvestigation(read, id.toLowerCase(), taskId.toLowerCase())
  })
}
