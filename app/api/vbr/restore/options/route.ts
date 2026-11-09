// Open Backup UI v1.0.2
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withVbrRecovery, VbrRecoveryError } from '@/lib/server/vbr-recovery'
import { restoreOptions } from '@/lib/recovery/options'

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  return withVbrRecovery(request, async ({ send, sourceKey }) => {
    const input = z.object({ restorePointId: z.string().uuid(), backupId: z.string().uuid(), operation: z.string().min(1).max(100).optional() }).safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!input.success) throw new VbrRecoveryError('Select a restore point from the calendar.')
    return restoreOptions(send, sourceKey, input.data.restorePointId, input.data.backupId, input.data.operation)
  })
}
