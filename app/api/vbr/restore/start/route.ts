// Open Backup UI v1.0.2
import { NextRequest } from 'next/server'
import { withVbrRecovery, VbrRecoveryError } from '@/lib/server/vbr-recovery'
import { draftSchema, startRestore } from '@/lib/recovery/start'

export const dynamic = 'force-dynamic'

export function POST(request: NextRequest) {
  return withVbrRecovery(request, async ({ send, sourceKey }) => {
    const input = draftSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) throw new VbrRecoveryError(input.error.issues.map(issue => issue.message).join(' ').slice(0, 1000))
    return startRestore(send, sourceKey, input.data)
  })
}
