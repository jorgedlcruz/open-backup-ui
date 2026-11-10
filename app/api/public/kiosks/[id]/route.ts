// Open Backup UI v1.2.0
import { NextRequest } from 'next/server'
import { canView, readShare, ShareError } from '@/lib/server/kiosk-shares'
import { ACCESS_COOKIE, failure, json } from '@/lib/server/kiosk-http'
import { readPublicKiosk, shareSource } from '@/lib/server/kiosk-reader'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, record = await readShare(id)
    if (!record) throw new ShareError('Shared kiosk not found.', 404)
    if (!canView(record, request.cookies.get(ACCESS_COOKIE)?.value)) return json({ passwordRequired: true }, 401)
    const kiosk = await readPublicKiosk(record)
    // A revoked or re-published link must not finish an older in-flight response.
    const current = await readShare(id)
    if (!current) throw new ShareError('Shared kiosk not found.', 404)
    if (current.revision !== record.revision || !canView(current, request.cookies.get(ACCESS_COOKIE)?.value)) throw new ShareError('The shared view changed. Refresh to continue.', 409)
    shareSource(current)
    return json(kiosk)
  } catch (error) { return failure(error) }
}
