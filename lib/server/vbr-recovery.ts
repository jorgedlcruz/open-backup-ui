import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { configStore } from './config-store'
import { tokenManager } from './token-manager'
import { isSameApplicationOrigin } from './request-origin'
import { getChunkedCookie } from '../utils/cookie-manager'

import { VbrRecoveryError } from '../recovery/error'
export { VbrRecoveryError }

export type RecoverySend = (path: string, options?: {
  method?: 'GET' | 'POST'
  body?: unknown
  mutation?: boolean
  archive?: boolean
}) => Promise<unknown>

export async function withVbrRecovery(request: NextRequest, run: (context: {
  send: RecoverySend
  sourceKey: string
  bearerOnly: boolean
}) => Promise<unknown>) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    if (request.method !== 'GET' && !isSameApplicationOrigin(request)) {
      throw new VbrRecoveryError('Use the connected Open Backup UI to perform this action.', 403)
    }
    const jar = await cookies()
    const sourceId = jar.get('veeam_source_id')?.value
    const source = sourceId ? configStore.getById(sourceId) : undefined
    if (sourceId && source?.platform !== 'vbr') throw new VbrRecoveryError('Select a VBR source.')
    const base = source ? `${source.protocol}://${source.host}:${source.port}` : process.env.VEEAM_API_URL
    if (!base) throw new VbrRecoveryError('Connect a VBR source.')
    const destination = new URL(base)
    if (!['https:', 'http:'].includes(destination.protocol)) throw new VbrRecoveryError('Invalid VBR source.')
    const sourceKey = createHash('sha256').update(JSON.stringify([destination.href, source?.id || 'environment'])).digest('hex')
    let token = sourceId ? await tokenManager.getToken(sourceId) : null
    token ||= getChunkedCookie(jar, 'veeam_vbr_token') || null
    const bearerOnly = !token
    token ||= request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1] || null
    if (!token) throw new VbrRecoveryError('Reconnect your VBR source.', 401)
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)])
    const send: RecoverySend = async (path, { method = 'GET', body, mutation = false, archive = false } = {}) => {
      const url = new URL(path, destination)
      if (url.origin !== destination.origin || !url.pathname.startsWith('/api/v1/')) throw new VbrRecoveryError('Invalid VBR operation.')
      if (archive && (method !== 'POST' || !/^\/api\/v1\/backupBrowser\/flr\/[a-f\d-]{36}\/prepareDownload\/[a-f\d-]{36}\/download$/i.test(path))) {
        throw new VbrRecoveryError('Invalid archive request.')
      }
      // The request signal cancels upstream I/O if the browser disconnects.
      // Once headers arrive a large ZIP may take longer than the JSON timeout.
      const connectTimeout = new AbortController()
      const transferSignal = archive ? AbortSignal.any([request.signal, connectTimeout.signal]) : signal
      const timer = archive ? setTimeout(() => connectTimeout.abort(), 60000) : undefined
      const fetchOnce = () => fetch(url, {
        method, redirect: 'error', cache: 'no-store', signal: transferSignal,
        headers: { Authorization: `Bearer ${token}`, Accept: archive ? 'application/octet-stream' : 'application/json', 'x-api-version': '1.3-rev2',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      try {
        let response = await fetchOnce()
        if (response.status === 401 && sourceId) {
          await response.body?.cancel()
          token = await tokenManager.refreshToken(sourceId)
          if (token) response = await fetchOnce()
        }
        if (!response.ok) {
          const uncertain = mutation && response.status >= 500
          const error = await response.json().catch(() => null)
          const message = typeof error?.message === 'string' ? error.message.slice(0, 1000) : `VBR returned HTTP ${response.status}.`
          throw new VbrRecoveryError(uncertain ? 'VBR could not confirm the operation. Check Sessions before trying again.' : message,
            response.status >= 500 ? 502 : response.status, uncertain)
        }
        if (archive) {
          if (!response.body || !/^(application\/(octet-stream|zip|x-zip-compressed))(;|$)/i.test(response.headers.get('content-type') || '')) {
            await response.body?.cancel()
            throw new VbrRecoveryError('VBR did not return the prepared ZIP archive.', 502)
          }
          return new Response(response.body, { headers: { ...headers, 'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="guest-files-' + path.split('/').at(-2) + '.zip"',
            'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } })
        }
        const text = await response.text()
        return text ? JSON.parse(text) : null
      } catch (error) {
        if (error instanceof VbrRecoveryError) throw error
        throw new VbrRecoveryError(mutation ? 'The result is unknown. Check Sessions before trying again.' : 'The VBR source could not be reached.',
          signal.aborted ? 504 : 502, mutation)
      } finally { if (timer) clearTimeout(timer) }
    }
    const result = await run({ send, sourceKey, bearerOnly })
    return result instanceof Response ? result : NextResponse.json(result, { headers })
  } catch (error) {
    const failure = error instanceof VbrRecoveryError ? error : new VbrRecoveryError('The VBR response could not be processed.', 502)
    return NextResponse.json({ error: failure.message, uncertain: failure.uncertain }, { status: failure.status, headers })
  }
}
