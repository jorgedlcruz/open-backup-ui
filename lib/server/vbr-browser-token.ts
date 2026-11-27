// Open Backup UI v1.3.0
import { getChunkedCookie } from '../utils/cookie-manager'

type Cookies = Parameters<typeof getChunkedCookie>[0]

export function vbrBrowserToken(cookies: Cookies, target: URL, sourceId?: string, authorization?: string | null) {
  const endpoint = cookies.get('veeam_vbr_token_url')?.value
  if (endpoint) {
    try {
      const bound = new URL(endpoint)
      if (bound.origin !== target.origin || bound.username || bound.password) return null
    } catch { return null }
  } else if (sourceId) {
    return null
  }
  const cookieToken = getChunkedCookie(cookies, 'veeam_vbr_token')
  if (cookieToken) return cookieToken
  // Header-only clients authenticate against the configured environment endpoint.
  // A saved selection must instead have its own managed or origin-bound token.
  return sourceId ? null : authorization?.match(/^Bearer ([^\s,]+)$/i)?.[1] || null
}
