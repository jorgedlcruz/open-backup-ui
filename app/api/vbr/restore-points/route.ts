// Open Backup UI v1.0.2
import { NextRequest, NextResponse } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadRestorePoints } from '@/lib/restore-points/load'
import { attachApplications } from '@/lib/recovery/application-eligibility'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const objectId = request.nextUrl.searchParams.get('objectId') || undefined;
  const backupId = request.nextUrl.searchParams.get('backupId') || undefined;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ((!objectId && !backupId) || [objectId, backupId].some(id => id && !uuid.test(id))) {
    return NextResponse.json({ error: 'Select a valid backup object or backup ID.' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
  }
  return withVbrRead(request, async (read, sourceName, _inventory, context) => {
    const snapshot = await loadRestorePoints(read, sourceName, {objectId,backupId})
    if(snapshot.data.length && context.serverCredentials && context.sourceId) {
      try {
        await attachApplications(context.getExplorer().send,snapshot.data,objectId)
      } catch { snapshot.warnings.push('Application recovery options could not be checked with the VBR web console.') }
    }
    return {...snapshot,sourceKey:context.sourceKey}
  });
}
