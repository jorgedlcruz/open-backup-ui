// Open Backup UI v1.2.0
import { NextRequest } from 'next/server'
import { ShareError, unlockShare } from '@/lib/server/kiosk-shares'
import { ACCESS_COOKIE, cookieOptions, failure, json, readBody, sameOrigin } from '@/lib/server/kiosk-http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request)
    const { id } = await context.params, input = await readBody(request, 1024)
    if (typeof input?.password !== 'string' || input.password.length > 128) throw new ShareError('Enter a valid password.')
    const { ticket } = await unlockShare(id, input.password)
    const response = json({ unlocked: true })
    response.cookies.set(ACCESS_COOKIE, ticket, cookieOptions(request, `/api/public/kiosks/${id}`, 8 * 60 * 60))
    return response
  } catch (error) { return failure(error) }
}
