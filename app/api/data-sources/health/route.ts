// Open Backup UI v1.2.0
import { NextRequest } from 'next/server'
import { readConnectionSummary } from '@/lib/server/data-sources'

export const dynamic = 'force-dynamic'
export const GET = (request: NextRequest) => readConnectionSummary(request)
