import { NextRequest } from 'next/server'
import { withVbrRecovery, VbrRecoveryError } from '@/lib/server/vbr-recovery'
import { filesSchema, guestFiles } from '@/lib/recovery/files'

export const dynamic = 'force-dynamic'

export function POST(request: NextRequest) {
  return withVbrRecovery(request, async ({ send, sourceKey }) => {
    const input = filesSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) throw new VbrRecoveryError(input.error.issues.map(issue => issue.message).join(' ').slice(0, 1000))
    return guestFiles(send, sourceKey, input.data)
  })
}
