import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { configStore } from './config-store'
import { tokenManager } from './token-manager'
import { getChunkedCookie } from '../utils/cookie-manager'
import { actionSchema, executeAction, userRevision, type Execute } from '../identity/actions'
import { IdentityError, loadIdentity, loadRole } from '../identity/load'
import { idSchema } from '../identity/model'

const headers = { 'Cache-Control': 'private, no-store' }
const sourceRevision = (id: string | undefined, base: string) => createHash('sha256').update(JSON.stringify([id || 'environment', base])).digest('hex')
async function withIdentity(request: NextRequest, load: (execute: Execute, name: string, key: string) => Promise<unknown>, expectedSource?: string) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000)
  const abort = () => controller.abort(); request.signal.addEventListener('abort', abort, { once: true }); if (request.signal.aborted) controller.abort()
  let mutationSent = false
  try {
    const jar = await cookies(), selected = jar.get('veeam_source_id')?.value
    const source = selected ? configStore.getById(selected) : undefined
    if (selected && (!source || source.platform !== 'vbr')) throw new IdentityError('Select a valid VBR data source.', 400)
    const base = source ? `${source.protocol}://${source.host}:${source.port}` : process.env.VEEAM_API_URL || process.env.VBR_API_URL
    if (!base) throw new IdentityError('Connect a VBR data source to inspect identity.', 400)
    const destination = new URL(base)
    if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) throw new IdentityError('Invalid VBR source configuration.', 400)
    const sourceKey = sourceRevision(selected, base)
    if (expectedSource && expectedSource !== sourceKey) throw new IdentityError('The selected VBR source changed. Refresh before continuing.', 409)
    // Never reuse a different source's browser token when a configured source is selected.
    let token = selected ? await tokenManager.getToken(selected) : getChunkedCookie(jar, 'veeam_vbr_token') || request.headers.get('authorization')?.replace(/^Bearer /, '') || null
    if (!selected) {
      const tokenUrl = jar.get('veeam_vbr_token_url')?.value
      if (tokenUrl && new URL(tokenUrl).origin !== destination.origin) throw new IdentityError('Reconnect the selected VBR source.', 401)
    }
    if (!token) throw new IdentityError('Your VBR session has expired. Reconnect this data source.', 401)
    let refresh: Promise<string | null> | null = null, revision = '1.3-rev2'
    const execute: Execute = async (path, method = 'GET', body) => {
      if (!/^\/api\/v1\/security\/(?:users|roles|settings)(?:[/?]|$)/.test(path) || path.includes('..') || path.includes('://')) throw new IdentityError('Invalid identity resource.', 400)
      const send = () => {
        const current = selected ? configStore.getById(selected) : undefined
        const currentBase = selected ? current && current.platform === 'vbr' ? `${current.protocol}://${current.host}:${current.port}` : '' : process.env.VEEAM_API_URL || process.env.VBR_API_URL
        if (!currentBase || sourceRevision(selected, currentBase) !== sourceKey) throw new IdentityError('The data source changed. Refresh before continuing.', 409)
        if (method !== 'GET') mutationSent = true
        return fetch(new URL(path, destination), { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'x-api-version': revision, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'error', cache: 'no-store' })
      }
      let response = await send()
      if (method === 'GET' && [400,406].includes(response.status) && revision !== '1.3-rev1') { revision = '1.3-rev1'; response = await send() }
      if (method === 'GET' && response.status === 401 && selected) { refresh ||= tokenManager.refreshToken(selected); token = await refresh; if (token) response = await send() }
      if (!response.ok) {
        let fourEyes = false
        try { const error = await response.json(); fourEyes = typeof error.message === 'string' && /four[\s-]*eyes/i.test(error.message) } catch { /* Never return raw source messages. */ }
        throw new IdentityError(fourEyes ? 'VBR requires four-eyes authorization for this action. Complete it in the Veeam Backup & Replication console.' : response.status === 401 ? 'Your VBR session has expired. Reconnect this data source.' : response.status === 403 ? 'Your account does not have permission for this identity operation.' : `VBR could not complete the identity ${method === 'GET' ? 'read' : 'action'} (HTTP ${response.status}).${method !== 'GET' ? ' Refresh the account before retrying.' : ''}`, [400,401,403,404,409].includes(response.status) ? response.status : 502)
      }
      // Mutation response bodies are unnecessary and may contain sensitive account metadata.
      return method === 'GET' ? response.json() : { accepted: true }
    }
    return NextResponse.json(await load(execute, source?.host || destination.hostname, sourceKey), { headers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof IdentityError ? error.message : mutationSent ? 'The action outcome could not be confirmed. Refresh the account before retrying.' : controller.signal.aborted ? 'Identity loading timed out. Refresh to retry.' : 'Identity data could not be read. Check the connection and refresh.' }, { status: error instanceof IdentityError ? error.status : controller.signal.aborted ? 504 : 502, headers })
  } finally { clearTimeout(timer); controller.abort(); request.signal.removeEventListener('abort', abort) }
}
export function readIdentity(request: NextRequest) {
  const roleId = request.nextUrl.searchParams.get('roleId'), expected = request.nextUrl.searchParams.get('sourceKey') || undefined
  if (roleId && !idSchema.safeParse(roleId).success) return Promise.resolve(NextResponse.json({ error: 'Invalid role ID.' }, { status: 400, headers }))
  return withIdentity(request, (execute, name, key) => roleId ? loadRole(path => execute(path), roleId.toLowerCase(), key) : loadIdentity(path => execute(path), name, key, userRevision), expected)
}
export async function mutateIdentity(request: NextRequest) {
  const origin = request.headers.get('origin')
  if ((origin && origin !== request.nextUrl.origin) || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Identity actions must originate from this application.' }, { status: 403, headers })
  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid identity action. Check the account, roles and required fields.' }, { status: 400, headers })
  return withIdentity(request, execute => executeAction(execute, parsed.data), parsed.data.sourceKey)
}
