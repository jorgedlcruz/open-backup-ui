import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { validId } from '@/lib/investigation/model'
import { loadRepository } from '@/lib/repositories/load'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.toLowerCase()
  if (!validId(id)) return NextResponse.json({ error: 'Select a valid repository ID.' }, { status: 400 })
  return withVbrRead(request, (read, source) => loadRepository(read, source, id))
}
