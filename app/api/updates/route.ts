// Open Backup UI v1.3.0

import { APP_VERSION } from '@/lib/version'
import { readRelease } from '@/lib/updates/release-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const status = await readRelease(APP_VERSION)
  const details = new URL(request.url).searchParams.get('notes') === '1'
  const release = status.release && (details ? status.release : { tag: status.release.tag })
  return Response.json({ ...status, release }, { headers: { 'Cache-Control': 'no-store' } })
}
