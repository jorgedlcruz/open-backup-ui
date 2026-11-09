// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('node:http')
const https = require('node:https')
const { publicPathAllowed } = require('../../lib/labs/public-paths.cjs')
const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' }
const reply = (response, status, message) => { if (response.writableEnded) return; if (response.headersSent) return response.destroy(); response.writeHead(status, { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8' }); response.end(message) }

function createKioskServer({ appUrl, publicOrigin }) {
  const target = new URL(appUrl), origin = new URL(publicOrigin)
  for (const url of [target, origin]) if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Kiosk URLs must be HTTP(S) origins without credentials or paths.')
  if (target.origin === origin.origin) throw new Error('The kiosk listener and private app must have different origins or ports.')
  const transport = target.protocol === 'https:' ? https : http
  const agent = new transport.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8 })
  const server = http.createServer(async (request, response) => {
    const raw = request.url || '/', method = request.method || 'GET'
    // A fixed upstream destination and a narrow route list, never an open proxy.
    if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\r\n]/.test(raw) || request.headers.host?.toLowerCase() !== origin.host.toLowerCase()) { request.resume(); return reply(response, 404, 'Not found') }
    let url
    try { url = new URL(raw, origin) } catch { request.resume(); return reply(response, 404, 'Not found') }
    if (url.origin !== origin.origin || !publicPathAllowed(url.pathname, method)) { request.resume(); return reply(response, 404, 'Not found') }
    if (method === 'POST' && (request.headers.origin !== origin.origin || request.headers['sec-fetch-site'] === 'cross-site')) { request.resume(); return reply(response, 403, 'Use the shared kiosk to unlock this view.') }
    let body
    if (method === 'POST') {
      if (Number(request.headers['content-length']) > 1024) { request.resume(); return reply(response, 413, 'Request is too large.') }
      const chunks = []; let size = 0
      try {
        for await (const chunk of request) { size += chunk.length; if (size > 1024) { reply(response, 413, 'Request is too large.'); request.destroy(); return } chunks.push(chunk) }
        body = Buffer.concat(chunks)
      } catch { return reply(response, 400, 'Invalid request.') }
    }
    const headers = { host: origin.host, 'x-forwarded-proto': origin.protocol.slice(0, -1) }
    for (const key of ['accept', 'accept-language', 'content-type', 'origin', 'sec-fetch-site', 'if-none-match', 'if-modified-since']) if (request.headers[key]) headers[key] = request.headers[key]
    // In particular, discard source/owner cookies, authorization, Next actions,
    // x-middleware-subrequest and all user-supplied forwarding headers.
    const access = (request.headers.cookie || '').split(';').map(s => s.trim()).find(s => /^kiosk-view-access=\d{13}\.[A-Za-z0-9_-]{43}$/.test(s))
    if (access) headers.cookie = access
    if (body) headers['content-length'] = String(body.length)
    const upstream = transport.request(new URL(url.pathname + url.search, target), { method, headers, agent }, incoming => {
      const output = { ...privateHeaders }
      for (const key of ['content-type', 'content-length', 'content-encoding', 'etag', 'last-modified', 'vary']) if (incoming.headers[key]) output[key] = incoming.headers[key]
      const cookies = incoming.headers['set-cookie']?.filter(value => /^kiosk-view-access=/.test(value))
      if (cookies?.length) output['set-cookie'] = cookies
      if (incoming.headers.location) {
        let location
        try { location = new URL(incoming.headers.location, origin) } catch { /* Reject malformed redirects. */ }
        if (!location || location.origin !== origin.origin || !publicPathAllowed(location.pathname, 'GET')) { incoming.resume(); return reply(response, 502, 'The shared view is unavailable.') }
        output.location = location.pathname + location.search
      }
      response.writeHead(incoming.statusCode || 502, output)
      incoming.on('error', () => response.destroy())
      incoming.pipe(response)
    })
    const timer = setTimeout(() => upstream.destroy(new Error('Kiosk upstream timed out')), 90000)
    upstream.on('error', () => reply(response, 502, 'The shared view is unavailable. Please retry.'))
    upstream.on('close', () => clearTimeout(timer))
    response.on('close', () => { if (!response.writableEnded) upstream.destroy() })
    upstream.end(body)
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.on('upgrade', (_request, socket) => socket.destroy())
  server.on('connect', (_request, socket) => socket.destroy())
  server.on('close', () => agent.destroy())
  return server
}
module.exports = { createKioskServer }
