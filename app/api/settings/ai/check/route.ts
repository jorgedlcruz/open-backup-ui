// Open Backup UI v1.0.2
import { NextRequest } from 'next/server'
import { updateConfiguration } from '@/lib/server/ai-integrations'
export const dynamic = 'force-dynamic'
export const POST = (request: NextRequest) => updateConfiguration(request, 'check')
