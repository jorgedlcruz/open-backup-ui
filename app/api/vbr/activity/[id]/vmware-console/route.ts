import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveVmwareDestination, vmwareManagementUrl } from '@/lib/activity/vmware-destination'
import { checkSource, VbrRecoveryError } from '@/lib/recovery/error'
import { applicationOrigin } from '@/lib/server/request-origin'
import { withVbrRecovery } from '@/lib/server/vbr-recovery'
import { getVmwareConsoleConnection } from '@/lib/server/vmware-console-connections'
import { getVcenterInstanceUuid, issueVmwareConsoleTicket } from '@/lib/server/vmware-ticket'

export const dynamic = 'force-dynamic'
type Context = {params: Promise<{id:string}>}
const scope = z.object({sourceKey:z.string().regex(/^[a-f0-9]{64}$/), mountId:z.string().uuid()}).strict()
const invalid = () => NextResponse.json({error:'Invalid session link.'}, {status:400, headers:{'Cache-Control':'private, no-store'}})
const power = {PoweredOn:'on', PoweredOff:'off', Suspended:'suspended', Unknown:'unknown'} as const

async function consoleRequest(request: NextRequest, {params}: Context) {
  const issue = request.method === 'POST'
  const id = (await params).id
  const input = scope.safeParse(issue ? await request.json().catch(() => null) : Object.fromEntries(request.nextUrl.searchParams))
  if (!z.string().uuid().safeParse(id).success || !input.success) return invalid()
  return withVbrRecovery(request, async ({send, sourceKey, canStartVmwareRecovery}) => {
    checkSource(input.data.sourceKey, sourceKey)
    const target = await resolveVmwareDestination(send, id, input.data.mountId).catch(error => {
      if (!issue && error instanceof VbrRecoveryError && [404,409].includes(error.status)) return null
      throw error
    })
    if (!target) return {destination:null}
    const permitted = target.canConsole && canStartVmwareRecovery()
    if (issue) {
      if (!permitted) throw new VbrRecoveryError('Your VBR account cannot open a console for this recovery.', 403)
      if (target.powerState !== 'PoweredOn') throw new VbrRecoveryError('The recovered VM must be powered on to open its console.', 409)
      const origin = new URL(applicationOrigin(request))
      if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin.protocol !== 'https:' &&
        !['localhost','[::1]'].includes(origin.hostname) && !/^127\.\d+\.\d+\.\d+$/.test(origin.hostname))) {
        throw new VbrRecoveryError('Use HTTPS or a loopback address to open the VMware console.', 403)
      }
    }
    const connection = getVmwareConsoleConnection(sourceKey, target.server, target.port)
    if (issue) {
      if (!connection) throw new VbrRecoveryError('Configure a VMware console connection for this destination.', 409)
      return issueVmwareConsoleTicket(connection, target, request.signal)
    }
    let managementUrl = target.url
    if (!managementUrl && target.provider === 'vcenter') {
      const uuid = await getVcenterInstanceUuid({hostname:target.server, port:target.port, caPem:connection?.caPem}, request.signal)
        .catch(() => undefined)
      managementUrl = vmwareManagementUrl(target, uuid)
    }
    return {destination:{name:target.vmName, managerType:target.provider, powerState:power[target.powerState],
      managementUrl, consoleConfigured:!!connection, consolePermitted:permitted}}
  }, {preferOperatorToken:true})
}

export const GET = consoleRequest
export const POST = consoleRequest
