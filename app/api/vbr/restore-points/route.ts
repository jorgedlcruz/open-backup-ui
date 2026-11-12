// Open Backup UI v1.2.0
import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { completeVmMembership, loadRestorePoints, partialMembership } from '@/lib/restore-points/load'
import { attachApplications } from '@/lib/recovery/application-eligibility'
import { readObjectRestorePoints } from '@/lib/restore-points/cached-collection'
import { revisionForBuild } from '@/lib/investigation/model'
import { TopologyRequestError } from '@/lib/topology/load'
import { protectedDataCache } from '@/lib/protected-data/cache'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const objectId = request.nextUrl.searchParams.get('objectId') || undefined;
  const backupId = request.nextUrl.searchParams.get('backupId') || undefined;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ((!objectId && !backupId) || [objectId, backupId].some(id => id && !uuid.test(id))) {
    return NextResponse.json({ error: 'Select a valid backup object or backup ID.' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
  }
  return withVbrRead(request, async (read, sourceName, _inventory, context) => {
    const snapshot = await loadRestorePoints(read, sourceName, {objectId,backupId}, objectId ? async () => {
      let revision = protectedDataCache.apiRevision(context.cacheKey)
      if (!revision) {
        const info = await read('/api/v1/serverInfo').catch(error => {
          if (error instanceof TopologyRequestError && error.status === 401) throw error
          return null
        })
        revision = revisionForBuild(info && typeof info === 'object' && 'buildVersion' in info ? info.buildVersion : undefined)
      }
      return readObjectRestorePoints(path => read(path,revision), context.cacheKey+'/'+revision, objectId,
        {backupId, refresh:request.nextUrl.searchParams.get('refresh') === 'true'})
    } : undefined)
    const deadline=AbortSignal.timeout(12_000)
    const eligible=await completeVmMembership(path=>read(path,'1.3-rev2',deadline),snapshot,deadline)
    if(snapshot.data.length && context.serverCredentials && context.sourceId) {
      try {
        await attachApplications(context.getExplorer().send,snapshot.data,objectId,path=>read(path,'1.3-rev2'))
      } catch { snapshot.warnings.push('Application recovery options could not be checked with the VBR web console.') }
    }
    if(eligible?.some(point=>!point.verifiedObjectId))snapshot.warnings.push(partialMembership)
    return {...snapshot,sourceKey:context.sourceKey}
  });
}
