import { NextResponse } from 'next/server'
import { sourcesForClient } from '@/lib/server/data-sources'
export const dynamic='force-dynamic'
export async function GET() {
  try { return NextResponse.json(await sourcesForClient(),{headers:{'Cache-Control':'private, no-store'}}) }
  catch { return NextResponse.json({error:'Data-source inventory could not be loaded.'},{status:502}) }
}
