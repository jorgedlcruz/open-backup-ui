import { NextRequest } from 'next/server'
import { readConfiguration, updateConfiguration } from '@/lib/server/ai-integrations'
export const dynamic = 'force-dynamic'
export const GET = readConfiguration
export const POST = (request: NextRequest) => updateConfiguration(request, 'save')
