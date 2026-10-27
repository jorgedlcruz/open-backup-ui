import { NextRequest } from 'next/server'
import { readIdentity, mutateIdentity } from '@/lib/server/identity'
export const dynamic = 'force-dynamic'
export function GET(request: NextRequest) { return readIdentity(request) }
export function POST(request: NextRequest) { return mutateIdentity(request) }
