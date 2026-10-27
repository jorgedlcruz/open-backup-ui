type ApplicationRequest = { headers: Headers; nextUrl: URL }

// TLS terminates at the reverse proxy. Host remains the requested application
// host; do not accept an unrelated X-Forwarded-Host as a CSRF allowlist.
export function applicationOrigin(request: ApplicationRequest): string {
  const host = request.headers.get('host') || request.nextUrl.host
  if (!host || /[\s,/@?#\\]/.test(host)) throw new Error('Invalid application host.')
  const protocol = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https' ? 'https:' : 'http:'
  return new URL(`${protocol}//${host}`).origin
}

export function isSameApplicationOrigin(request: ApplicationRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try { return origin === applicationOrigin(request) }
  catch { return false }
}

export function isSecureApplicationRequest(request: ApplicationRequest): boolean {
  return applicationOrigin(request).startsWith('https:')
}
