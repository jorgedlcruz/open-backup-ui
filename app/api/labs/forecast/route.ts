import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { readCachedForecastSnapshot } from '@/lib/server/forecast-cache'
import { forecastDataset } from '@/lib/labs/forecast-data'
import { isCachedSource } from '@/lib/labs/model'

export const dynamic = 'force-dynamic'
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams, source = params.get('source') ?? 'forecast'
  const repositoryId = params.get('repository') ?? '', mode = params.get('mode') ?? 'capacity', horizon = Number(params.get('horizon') ?? 30)
  if (!isCachedSource(source) || repositoryId.length > 80 || !['capacity', 'files'].includes(mode) || ![30, 60, 90].includes(horizon)) return NextResponse.json({ error: 'Invalid forecast selection.' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })
  return withVbrRead(request, async (_read, _name, _inventory, context) => forecastDataset(readCachedForecastSnapshot(context), source, { repositoryId, forecastMode: mode as 'capacity' | 'files', horizon: horizon as 30 | 60 | 90 }))
}
