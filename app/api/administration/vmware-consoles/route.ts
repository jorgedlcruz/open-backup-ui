import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readOperationsCollection } from '@/lib/operations/load'
import { TopologyRequestError } from '@/lib/topology/load'
import { withVbrRead } from '@/lib/server/vbr-read'
import { readVmwareSettings, requireVmwareAdmin } from '@/lib/server/vmware-console-admin'
import { getVmwareConsoleConnection, listVmwareConsoleConnections, normalizeVmwareCa, vmwareManager, writeVmwareConnection } from '@/lib/server/vmware-console-connections'
import { verifyVmwareConsoleConnection } from '@/lib/server/vmware-ticket'

export const dynamic = 'force-dynamic'
const managerPath = '/api/v1/backupInfrastructure/managedServers'
const conflict = () => new TopologyRequestError('This VMware connection changed. Reload before editing.', 409)
function failure(error: unknown) {
  return NextResponse.json({error:error instanceof TopologyRequestError ? error.message : 'Invalid VMware connection settings.'},
    {status:error instanceof TopologyRequestError ? error.status : 400, headers:{'Cache-Control':'private, no-store'}})
}
export async function GET(request: NextRequest) {
  try { requireVmwareAdmin(request) } catch (error) { return failure(error) }
  return withVbrRead(request, async (read, sourceName, _inventory, {sourceKey}) => {
    const collection = await readOperationsCollection(read, managerPath + '?typeFilter=ViHost&includeNestedHosts=false', z.object({id:z.string()}).passthrough())
    const managers = collection.data.flatMap(raw => { const item = vmwareManager(raw); return item ? [item] : [] })
    return {sourceKey, sourceName, managers, connections:listVmwareConsoleConnections(sourceKey), complete:collection.complete}
  })
}
export async function POST(request: NextRequest) {
  let body: Awaited<ReturnType<typeof readVmwareSettings>>
  try { requireVmwareAdmin(request); body = await readVmwareSettings(request) } catch (error) { return failure(error) }
  return withVbrRead(request, async (read, _name, _inventory, {sourceKey}) => {
    if (body.sourceKey !== sourceKey) throw conflict()
    const saved = listVmwareConsoleConnections(sourceKey).find(row => row.hostname === body.hostname && row.port === body.port)
    if ((saved?.revision ?? null) !== body.revision || saved && saved.id !== body.id) throw conflict()
    if (body.action === 'remove') {
      if (!saved) throw conflict()
      await writeVmwareConnection(sourceKey, saved, body.revision, null)
      return {success:true}
    }
    const manager = vmwareManager(await read(managerPath + '/' + body.id))
    if (!manager || manager.id !== body.id || manager.hostname !== body.hostname || manager.port !== body.port) throw conflict()
    const prior = saved ? getVmwareConsoleConnection(sourceKey, manager.hostname, manager.port) : null
    const caPem = body.trust === 'keep' ? prior?.caPem : body.trust === 'custom' ? normalizeVmwareCa(body.caPem) : undefined
    if (body.trust === 'custom' && !caPem) throw new TopologyRequestError('Enter a PEM-encoded VMware CA or server certificate.', 400)
    // Reuse a saved password only for the same identity and TLS trust configuration.
    const password = body.password || (prior?.username === body.username && prior.caPem === caPem ? prior.password : '')
    if (!password) throw new TopologyRequestError('Enter the VMware account password.', 400)
    const connection = {hostname:manager.hostname, port:manager.port, username:body.username, password, caPem}
    try { await verifyVmwareConsoleConnection(connection, request.signal) }
    catch { throw new TopologyRequestError('VMware sign-in or TLS verification failed.', 502) }
    await writeVmwareConnection(sourceKey, manager, body.revision, connection)
    return {success:true}
  })
}
