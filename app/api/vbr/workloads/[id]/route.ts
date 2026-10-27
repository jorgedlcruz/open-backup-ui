import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadWorkload } from '@/lib/resilience/load'
import { TopologyRequestError } from '@/lib/topology/load'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withVbrRead(request, (read, sourceName) => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new TopologyRequestError('Invalid workload identifier.', 400)
    return loadWorkload(read, sourceName, id)
  })
}
