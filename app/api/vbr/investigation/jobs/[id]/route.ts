import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadJobInvestigation } from '@/lib/investigation/load'
import { validId, type HistoryRange } from '@/lib/investigation/model'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.toLowerCase()
  const range = request.nextUrl.searchParams.get('range') || '7d'
  if (!validId(id) || !['7d', '30d', '90d'].includes(range)) return NextResponse.json({ error: 'Select a valid job and history range.' }, { status: 400 })
  return withVbrRead(request, (read, source) => loadJobInvestigation(read, source, id, range as HistoryRange))
}
