// Open Backup UI v1.2.0
import { NextRequest } from 'next/server'
import { readAlarms, mutateAlarms } from '@/lib/server/one-alarms'
export const dynamic = 'force-dynamic'
export function GET(request: NextRequest) { return readAlarms(request) }
export function POST(request: NextRequest) { return mutateAlarms(request) }
