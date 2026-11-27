// Open Backup UI v1.3.0
import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadEntraInventory } from '@/lib/entra-inventory/load'
import { TopologyRequestError } from '@/lib/topology/load'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  return withVbrRead(request, async (read, source, _browse, context) => {
    // serverInfo can be restricted independently of inventory. The list and evidence endpoints exist since rev0.
    const revision = await context.getRevision().catch((error: unknown) => {
      if (error instanceof TopologyRequestError && error.status === 401) throw error
      return '1.3-rev0' as const
    })
    return loadEntraInventory(path => read(path, revision), source, context.sourceKey)
  })
}
