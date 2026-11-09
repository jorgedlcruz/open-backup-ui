import { NextRequest } from 'next/server'
import { withVbrRecovery, VbrRecoveryError } from '@/lib/server/vbr-recovery'
import { filesSchema, guestFiles } from '@/lib/recovery/files'
import { ENCRYPTION_KEY, LEGACY_DEFAULT_KEY } from '@/lib/server/encryption'
import { randomBytes } from 'node:crypto'

const searchSigningKey = ENCRYPTION_KEY === LEGACY_DEFAULT_KEY ? randomBytes(32).toString('hex') : ENCRYPTION_KEY

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const form = request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')
  const native = form ? filesSchema.safeParse(Object.fromEntries(new URLSearchParams(await request.text()))) : undefined
  return withVbrRecovery(request, async ({ send, sourceKey, bearerOnly }) => {
    const input = native || filesSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) throw new VbrRecoveryError(input.error.issues.map(issue => issue.message).join(' ').slice(0, 1000))
    if (form && input.data.action !== 'streamDownload') throw new VbrRecoveryError('Invalid archive request.')
    const result = await guestFiles(send, sourceKey, input.data, searchSigningKey)
    return input.data.action === 'prepareDownload' && typeof result === 'object' ? { ...result, bearerOnly } : result
  })
}
