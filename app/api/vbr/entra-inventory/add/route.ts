// Open Backup UI v1.3.0
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { registrationPayload, tenantRegistration, maxPfxBytes } from '@/lib/entra-inventory/registration'
import { readOperationsCollection } from '@/lib/operations/load'
import { isSameApplicationOrigin } from '@/lib/server/request-origin'
import { readBody } from '@/lib/server/kiosk-http'
import { withVbrRead, type VbrReader } from '@/lib/server/vbr-read'
import { selectedVbrWriteSource } from '@/lib/server/vbr-write-source'
import { TopologyRequestError } from '@/lib/topology/load'
import type { VbrRevision } from '@/lib/vbr/revision'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
const repository = z.object({ id: z.string().uuid(), name: z.string(), type: z.string(), isOnline: z.boolean().nullish(),
  scaleOutRepositoryDetails: z.object({ scaleOutRepositoryId: z.string().nullish() }).nullish() })

async function registrationRevision(read: VbrReader, negotiate: () => Promise<VbrRevision>): Promise<VbrRevision> {
  try { return await negotiate() }
  catch (error) {
    if (!(error instanceof TopologyRequestError) || error.status !== 403) throw error
    // Some roles can manage inventory without reading serverInfo. Check the baseline on this same source.
    const page = await read('/api/v1/inventory/entraId/tenants?skip=0&limit=1', '1.3-rev0')
    z.object({data:z.array(z.object({id:z.string().uuid()}))}).parse(page)
    return '1.3-rev0'
  }
}

export async function GET(request: NextRequest) {
  return withVbrRead(request, async (read, sourceName, _browse, context) => {
    const revision = await registrationRevision(read, context.getRevision)
    try {
      const result = await readOperationsCollection(path => read(path, revision), '/api/v1/backupInfrastructure/repositories/states', repository)
      const repositories = result.data.filter(repo => ['WinLocal','LinuxLocal','Nfs','Smb'].includes(repo.type)
        && repo.isOnline !== false && !repo.scaleOutRepositoryDetails?.scaleOutRepositoryId)
        .map(({ id, name }) => ({ id, name }))
      return { sourceKey: context.sourceKey, sourceName, repositories, repositoriesComplete: result.complete }
    } catch (error) {
      if (error instanceof TopologyRequestError && error.status === 401) throw error
      return { sourceKey: context.sourceKey, sourceName, repositories: [], repositoriesComplete: false }
    }
  })
}

export async function POST(request: NextRequest) {
  const fail = (error: string, status: number, uncertain = false) => NextResponse.json({ error, uncertain }, { status, headers })
  if (!isSameApplicationOrigin(request)) return fail('Tenant registration must originate from this application.', 403)
  let raw: unknown
  try { raw = await readBody(request, 4 * Math.ceil(maxPfxBytes / 3) + 65536) }
  catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return fail('Invalid tenant registration request.', [413,415].includes(status) ? status : 400)
  }
  const parsed = tenantRegistration.safeParse(raw)
  if (!parsed.success) return fail('Check the tenant ID, application ID and credentials.', 400)
  const form = parsed.data
  let revision: VbrRevision | undefined
  const check = await withVbrRead(request, async (read, _source, _browse, context) => {
    if (context.sourceKey !== form.sourceKey) throw new TopologyRequestError('The selected VBR source changed. Reopen the form.', 409)
    revision = await registrationRevision(read, context.getRevision)
    return { valid: true }
  })
  if (!check.ok || !revision) return check
  let connection
  try { connection = await selectedVbrWriteSource(request, form.sourceKey) }
  catch (error) { return error instanceof TopologyRequestError ? fail(error.message,error.status) : fail('Could not connect to VBR.',502) }
  // The returned ID identifies the registration session. An interrupted write must never be replayed.
  const unconfirmed = () => fail('Check inventory and VBR sessions before submitting again.',502,true)
  try {
    const response = await fetch(new URL('/api/v1/inventory/entraId/tenants', connection.target), {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer '+connection.token, 'x-api-version': revision },
      body: JSON.stringify(registrationPayload(form, revision)),
    })
    if (response.status >= 400 && response.status < 500) return fail(`VBR rejected tenant registration (HTTP ${response.status}). Check the account permissions and tenant settings.`, response.status)
    if (response.status !== 201) return unconfirmed()
    const session = z.object({ id: z.string().uuid() }).safeParse(await response.json())
    return session.success ? NextResponse.json({ sessionId: session.data.id }, { status: 202, headers }) : unconfirmed()
  } catch { return unconfirmed() }
}
