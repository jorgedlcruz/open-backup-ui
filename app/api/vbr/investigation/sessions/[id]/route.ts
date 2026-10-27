import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadSessionInvestigation } from '@/lib/investigation/load'
import { validId } from '@/lib/investigation/model'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.toLowerCase()
  if (!validId(id)) return NextResponse.json({ error: 'Select a valid session.' }, { status: 400 })
  return withVbrRead(request, (read, source) => loadSessionInvestigation(read, source, id))
}
