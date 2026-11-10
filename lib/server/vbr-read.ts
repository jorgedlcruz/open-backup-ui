// Open Backup UI v1.2.0
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { configStore } from '@/lib/server/config-store'
import { tokenManager } from '@/lib/server/token-manager'
import { getChunkedCookie } from '@/lib/utils/cookie-manager'
import { TopologyRequestError } from '@/lib/topology/load'
import { readCacheScope } from './read-cache-scope'
import { explorerConnection, explorerPrincipal } from './vbr-explorer'
import { createHash } from 'node:crypto'

export type VbrRevision = '1.3-rev1' | '1.3-rev2'
export type VbrReader = (path: string, revision?: VbrRevision, signal?:AbortSignal) => Promise<unknown>
// VBR's inventory browse operation is a read-only POST with pagination in its body.
// This capability cannot call rescan or other inventory mutations.
export type VbrInventoryReader = (host: string | null, skip: number, limit: number, revision?: VbrRevision, hierarchy?: 'HostsAndClusters'|'HostsAndVms') => Promise<unknown>

// VBR exposes this read-only cross-platform mount list as a POST with query parameters.
export type PublishedRecoveryReader = (skip: number, limit: number) => Promise<unknown>
export type VmPowerReader = (manager: string, platform: 'VSphere'|'HyperV', vmName: string) => Promise<unknown>
export async function withVbrRead(request: NextRequest, load: (read: VbrReader, sourceName: string, inventory: VbrInventoryReader, context: { cacheKey: string; sourceKey: string; explorerPrincipalKey?: string; getExplorer: () => ReturnType<typeof explorerConnection>; serverCredentials: boolean; sourceId?: string; signal: AbortSignal; publishedRecoveries: PublishedRecoveryReader; vmPower: VmPowerReader }) => Promise<unknown>) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)
  const abort = () => controller.abort()
  request.signal.addEventListener('abort', abort, { once: true })
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const cookieStore = await cookies()
    const sourceId = cookieStore.get('veeam_source_id')?.value
    const source = sourceId ? configStore.getById(sourceId) : undefined
    if (sourceId && (!source || source.platform !== 'vbr')) {
      throw new TopologyRequestError('Select a valid VBR data source.', 400)
    }
    // Resolve destinations from server configuration, never a client-supplied URL.
    const baseUrl = source ? `${source.protocol}://${source.host}:${source.port}` : process.env.VEEAM_API_URL
    if (!baseUrl) throw new TopologyRequestError('Connect a VBR data source to explore protection.', 400)
    let token = sourceId ? await tokenManager.getToken(sourceId) : null
    const configuredPrincipal = !!(source && token)
    token ||= getChunkedCookie(cookieStore, 'veeam_vbr_token') || request.headers.get('authorization')?.replace(/^Bearer /, '') || null
    if (!token) throw new TopologyRequestError('Your VBR session has expired. Reconnect your data source.', 401)
    const destination = new URL(baseUrl)
    if (!['http:', 'https:'].includes(destination.protocol)) throw new TopologyRequestError('Invalid VBR source protocol.', 400)
    const requestJson = async (path: string, revision: VbrRevision = '1.3-rev1', browseBody?: string, listPublished = false,signal?:AbortSignal): Promise<unknown> => {
      const send = () => fetch(new URL(path, destination), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'x-api-version': revision, ...(browseBody ? { 'Content-Type': 'application/json' } : {}) },
        ...(browseBody || listPublished ? { method: 'POST', body: browseBody } : {}),
        cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([controller.signal,signal]) : controller.signal,
      })
      let response = await send()
      if (response.status === 401 && sourceId) {
        token = await tokenManager.refreshToken(sourceId)
        if (token) response = await send()
      }
      if (!response.ok) throw new TopologyRequestError(
        response.status === 401 ? 'Your VBR session has expired. Reconnect your data source.'
          : response.status === 403 ? 'Your VBR account cannot read the required backup records.'
            : response.status === 404 ? 'The requested VBR record could not be found.' : 'The VBR platform could not return protection data.',
        [401, 403, 404].includes(response.status) ? response.status : 502)
      return response.json()
    }
    const browse: VbrInventoryReader = (host, skip, limit, revision, hierarchyType) => requestJson(
      `/api/v1/inventory${host ? `/${encodeURIComponent(host)}` : ''}`, revision,
      JSON.stringify({ pagination: { skip, limit }, permissionScope: 'Any', ...(hierarchyType ? {hierarchyType}:{}) }),
    )
    const publishedRecoveries: PublishedRecoveryReader = async (skip, limit) => {
      const query = new URLSearchParams({skip: String(skip), limit: String(limit), orderColumn: 'VmName', orderAsc: 'true'})
      for (const platform of ['VMware', 'HyperV', 'UnstructuredData', 'Nutanix', 'Proxmox', 'CustomPlatform', 'WindowsPhysical', 'LinuxPhysical', 'LinuxPhysicalPpc', 'AWSEC2', 'AzureCompute', 'GCE']) {
        query.append('targetPlatform', platform)
      }
      const path=`/private-api/v1/restore/instantRecovery/sessions?${query}`
      try{return await requestJson(path, '1.3-rev2', undefined, true)}
      catch(error){
        if(!configuredPrincipal||!source?.password||controller.signal.aborted)throw error
        return explorerConnection(source,controller.signal).send(path,{method:'POST'})
      }
    }
    const cacheKey = readCacheScope(destination.href, token, configuredPrincipal ? source : undefined)
    const vmPower: VmPowerReader = (manager, platform, vmName) => {
      if (!manager || /[\\/?#\x00-\x1f]/.test(manager) || ['.', '..'].includes(manager)) throw new TopologyRequestError('Invalid inventory server.', 400)
      return requestJson('/api/v1/inventory/' + encodeURIComponent(manager), '1.3-rev2', JSON.stringify({
        permissionScope:'Restore', hierarchyType:platform === 'VSphere' ? 'HostsAndClusters' : 'HostsAndVms', pagination:{skip:0,limit:2},
        filter:{type:'GroupExpression', operation:'And', items:Object.entries({platform, type:'VirtualMachine', name:vmName})
          .map(([property,value]) => ({type:'PredicateExpression', operation:'Equals', property, value}))},
      }))
    }
    const sourceKey = createHash('sha256').update(JSON.stringify([destination.href, source?.id || 'environment'])).digest('hex')
    const read:VbrReader=(path,revision,signal)=>requestJson(path,revision,undefined,false,signal)
    return NextResponse.json(await load(read, source?.host || destination.hostname, browse, { cacheKey, sourceKey, explorerPrincipalKey:configuredPrincipal && source?.password ? explorerPrincipal(source):undefined, getExplorer:()=>explorerConnection(configuredPrincipal ? source:undefined,controller.signal), publishedRecoveries, vmPower, serverCredentials: configuredPrincipal && !!source?.password, sourceId: configuredPrincipal ? source?.id : undefined, signal: controller.signal }), { headers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof TopologyRequestError ? error.message
      : controller.signal.aborted ? 'Loading took too long. Retry or narrow the source environment.'
        : 'Protection data could not be loaded. Check the connection and retry.' }, {
      status: error instanceof TopologyRequestError ? error.status : controller.signal.aborted ? 504 : 502, headers,
    })
  } finally {
    clearTimeout(timeout)
    controller.abort()
    request.signal.removeEventListener('abort', abort)
  }
}
