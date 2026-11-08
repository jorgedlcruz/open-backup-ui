import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withVbrRecovery, VbrRecoveryError } from '@/lib/server/vbr-recovery'
import { browseInventory, kindSchema, platformSchema } from '@/lib/recovery/inventory'

export const dynamic = 'force-dynamic'
const querySchema = z.object({ platform: platformSchema, kind: kindSchema, server: z.string().max(500).optional(), skip: z.coerce.number().int().nonnegative().default(0) })

export function GET(request: NextRequest) {
  return withVbrRecovery(request, async ({ send, sourceKey }) => {
    const input = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!input.success) throw new VbrRecoveryError('Select a valid destination inventory.')
    const { platform, kind, server, skip } = input.data
    return { ...await browseInventory(send, platform, kind, server, skip), sourceKey }
  })
}
