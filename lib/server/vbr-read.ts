import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { configStore } from '@/lib/server/config-store'
import { tokenManager } from '@/lib/server/token-manager'
import { getChunkedCookie } from '@/lib/utils/cookie-manager'
import { TopologyRequestError } from '@/lib/topology/load'
import { readCacheScope } from './read-cache-scope'
import { createHash } from 'node:crypto'

export type VbrRevision = '1.3-rev1' | '1.3-rev2'
export type VbrReader = (path: string, revision?: VbrRevision) => Promise<unknown>
// VBR's inventory browse operation is a read-only POST with pagination in its body.
// This capability cannot call rescan or other inventory mutations.
export type VbrInventoryReader = (host: string | null, skip: number, limit: number, revision?: VbrRevision, hierarchy?: 'HostsAndClusters'|'HostsAndVms') => Promise<unknown>

export async function withVbrRead(request: NextRequest, load: (read: VbrReader, sourceName: string, inventory: VbrInventoryReader, context: { cacheKey: string; sourceKey: string; serverCredentials: boolean }) => Promise<unknown>) {
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
    const requestJson = async (path: string, revision: VbrRevision = '1.3-rev1', browseBody?: string): Promise<unknown> => {
      const send = () => fetch(new URL(path, destination), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'x-api-version': revision, ...(browseBody ? { 'Content-Type': 'application/json' } : {}) },
        ...(browseBody ? { method: 'POST', body: browseBody } : {}),
        cache: 'no-store', redirect: 'error', signal: controller.signal,
      })
      let response = await send()
      if (response.status === 401 && sourceId) {
        token = await tokenManager.refreshToken(sourceId)
        if (token) response = await send()
      }
      if (!response.ok) throw new TopologyRequestError(
        response.status === 401 ? 'Your VBR session has expired. Reconnect your data source.'
          : response.status === 403 ? 'Your VBR account cannot read the required backup records.'
            : 'The VBR platform could not return protection data.', response.status === 401 || response.status === 403 ? response.status : 502)
      return response.json()
    }
    const browse: VbrInventoryReader = (host, skip, limit, revision, hierarchyType) => requestJson(
      `/api/v1/inventory${host ? `/${encodeURIComponent(host)}` : ''}`, revision,
      JSON.stringify({ pagination: { skip, limit }, permissionScope: 'Any', ...(hierarchyType ? {hierarchyType}:{}) }),
    )
    const cacheKey = readCacheScope(destination.href, token, configuredPrincipal ? source : undefined)
    const sourceKey = createHash('sha256').update(JSON.stringify([destination.href, source?.id || 'environment'])).digest('hex')
    return NextResponse.json(await load(requestJson, source?.host || destination.hostname, browse, { cacheKey, sourceKey, serverCredentials: configuredPrincipal && !!source?.password }), { headers })
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
