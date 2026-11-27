// Open Backup UI v1.3.0
import { NextRequest } from 'next/server'
import { handleVbmRecovery } from '@/lib/server/vbm-recovery'

export const dynamic='force-dynamic'
export const runtime='nodejs'
// Next.js needs a literal here. Leave room for the 30-minute browse-start window and final response.
export const maxDuration=1860
export function GET(request:NextRequest){return handleVbmRecovery(request)}
export function POST(request:NextRequest){return handleVbmRecovery(request)}
