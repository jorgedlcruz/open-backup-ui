// Open Backup UI v1.2.0
import { timingSafeEqual } from 'node:crypto'
import { applicationOrigin } from './request-origin'

export const TLS_REQUEST_LIMIT = 256 * 1024
export type CertificateMetadata = {
  subject: string; issuer: string; subjectAltName: string; validFrom: string; validTo: string
  fingerprint256: string; selfSigned: boolean; daysRemaining: number
}
export type HttpsStatus = {
  mode: 'managed' | 'external'; uploadsEnabled: boolean; certificate: CertificateMetadata | null
  reloadSupported: boolean; httpsPort: number | null
}
export class HttpsSettingsError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = 'HttpsSettingsError' }
}
type RequestInfo = { headers: Headers; nextUrl: URL }

export function validateHttpsMutation(request: RequestInfo, env = process.env): string {
  const configured = env.HTTPS_ADMIN_TOKEN || ''
  if (configured.length < 32) throw new HttpsSettingsError('Certificate uploads are disabled. Configure HTTPS_ADMIN_TOKEN on the server first.', 403)
  const supplied = request.headers.get('x-https-admin-token') || ''
  const a = Buffer.from(supplied), b = Buffer.from(configured)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpsSettingsError('The HTTPS administration token is not valid.', 403)
  let origin: URL
  try { origin = new URL(applicationOrigin(request)) }
  catch { throw new HttpsSettingsError('Invalid application origin.', 403) }
  const from = request.headers.get('origin')
  if (from && from !== origin.origin) throw new HttpsSettingsError('Certificate changes must come from this application origin.', 403)
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpsSettingsError('Cross-site certificate changes are not allowed.', 403)
  // A managed listener is the only trusted TLS termination path for this endpoint.
  // The launcher overwrites this header; an arbitrary forwarded-proto is insufficient.
  const runtimeSecret = env.OPEN_BACKUP_HTTPS_CONTROL_TOKEN || ''
  const requestSecret = request.headers.get('x-open-backup-https') || ''
  const x = Buffer.from(runtimeSecret), y = Buffer.from(requestSecret)
  if (!runtimeSecret || x.length !== y.length || !timingSafeEqual(x, y) || origin.protocol !== 'https:') {
    throw new HttpsSettingsError('Open these settings through the managed HTTPS listener to upload a certificate.', 403)
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpsSettingsError('Send the certificate as JSON.', 415)
  return origin.hostname.replace(/^\[|\]$/g, '')
}

export async function boundedHttpsJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') || 0)
  if (!Number.isFinite(length) || length > TLS_REQUEST_LIMIT) throw new HttpsSettingsError('Certificate upload exceeds the 256 KiB request limit.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new HttpsSettingsError('A certificate and private key are required.')
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > TLS_REQUEST_LIMIT) {
        await reader.cancel()
        throw new HttpsSettingsError('Certificate upload exceeds the 256 KiB request limit.', 413)
      }
      parts.push(value)
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } catch (error) {
    if (error instanceof HttpsSettingsError) throw error
    throw new HttpsSettingsError('The certificate request must be valid JSON.')
  } finally { reader.releaseLock() }
}

export async function httpsControl(method: 'GET' | 'POST', body?: unknown): Promise<HttpsStatus | { success: true; certificate: CertificateMetadata; reloadSupported: true; restartRequired: false }> {
  const port = Number(process.env.OPEN_BACKUP_HTTPS_CONTROL_PORT)
  const token = process.env.OPEN_BACKUP_HTTPS_CONTROL_TOKEN
  if (!token || !Number.isInteger(port) || port < 1 || port > 65535) {
    if (method === 'GET') return { mode: 'external', uploadsEnabled: false, certificate: null, reloadSupported: false, httpsPort: null }
    throw new HttpsSettingsError('Start the application with the managed HTTPS launcher to replace its certificate.', 409)
  }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/certificate`, {
      method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    })
    const result = await response.json()
    if (!response.ok) throw new HttpsSettingsError(typeof result.error === 'string' ? result.error : 'The HTTPS listener could not process this certificate.', response.status)
    return result
  } catch (error) {
    if (error instanceof HttpsSettingsError) throw error
    throw new HttpsSettingsError('The HTTPS listener did not respond. Reload certificate details before retrying.', 503)
  }
}
