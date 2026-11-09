// Open Backup UI v1.0.2
import { NextRequest } from 'next/server'
import { listShares, opaqueToken, publishSchema, publishShare, ShareError, sourceBinding } from '@/lib/server/kiosk-shares'
import { cookieOptions, failure, json, linkInfo, managedSource, OWNER_COOKIE, ownerCookie, readBody, sameOrigin } from '@/lib/server/kiosk-http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  try { const source = managedSource(request), owner = ownerCookie(request); return json({ shares: owner ? (await listShares(owner, source.id)).map(r => linkInfo(r, request)) : [] }) }
  catch (error) { return failure(error) }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request)
    const source = managedSource(request), parsed = publishSchema.safeParse(await readBody(request))
    if (!parsed.success || !parsed.data.board.widgets.length) throw new ShareError('Add at least one valid widget before sharing.')
    const owner = ownerCookie(request) ?? opaqueToken()
    const record = await publishShare(owner, { id: source.id, binding: sourceBinding(source) }, parsed.data)
    const response = json({ share: linkInfo(record, request) }, 201)
    response.cookies.set(OWNER_COOKIE, owner, cookieOptions(request))
    return response
  } catch (error) { return failure(error) }
}
