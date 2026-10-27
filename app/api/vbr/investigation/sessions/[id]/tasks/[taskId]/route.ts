import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadTaskInvestigation } from '@/lib/investigation/load'
import { validId } from '@/lib/investigation/model'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params
  if (!validId(id) || !validId(taskId)) return NextResponse.json({ error: 'Select a valid session and task.' }, { status: 400 })
  return withVbrRead(request, read => loadTaskInvestigation(read, id.toLowerCase(), taskId.toLowerCase()))
}
