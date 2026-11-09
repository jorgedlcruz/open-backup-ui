// Open Backup UI v1.0.2
import { NextRequest } from 'next/server'
import { publishSchema, publishShare, revokeShare, ShareError, sourceBinding } from '@/lib/server/kiosk-shares'
import { failure, json, linkInfo, managedSource, ownerCookie, readBody, sameOrigin } from '@/lib/server/kiosk-http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
export async function PUT(request: NextRequest, context: Context) {
  try {
    sameOrigin(request)
    const source = managedSource(request), owner = ownerCookie(request), { id } = await context.params
    if (!owner) throw new ShareError('Shared kiosk not found.', 404)
    const parsed = publishSchema.safeParse(await readBody(request))
    if (!parsed.success || !parsed.data.board.widgets.length) throw new ShareError('Add at least one valid widget before sharing.')
    return json({ share: linkInfo(await publishShare(owner, { id: source.id, binding: sourceBinding(source) }, parsed.data, id), request) })
  } catch (error) { return failure(error) }
}
export async function DELETE(request: NextRequest, context: Context) {
  try {
    sameOrigin(request)
    const source = managedSource(request), owner = ownerCookie(request), { id } = await context.params
    if (!owner) throw new ShareError('Shared kiosk not found.', 404)
    await revokeShare(id, owner, source.id)
    return json({ revoked: true })
  } catch (error) { return failure(error) }
}
