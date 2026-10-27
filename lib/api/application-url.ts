// A server-to-server app request must not loop through the public access gate
// or send a Veeam bearer token to an origin supplied by a browser Host header.
export function applicationApiUrl(path: string): string {
  if (!path.startsWith('/api/')) throw new Error('Expected an application API path.')
  if (typeof window !== 'undefined') return path
  const port = process.env.PORT || '3000'
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid application port.')
  const origin = new URL(process.env.INTERNAL_APP_URL || `http://127.0.0.1:${port}`)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('INTERNAL_APP_URL must be an HTTP(S) origin.')
  }
  return new URL(path, origin).href
}
