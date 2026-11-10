// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
// Optional production TLS terminator. Next continues to run as a normal server
// on an ephemeral loopback port; the generated standalone server is supported.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { TlsSettingsError, loadBundle, generateSelfSigned, safeEqual, createCertificateController, readJsonBody } = require('../lib/server/tls-runtime.cjs')

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const failed = error => { server.removeListener('listening', ready); reject(error) }
    const ready = () => { server.removeListener('error', failed); resolve(server.address().port) }
    server.once('error', failed)
    server.once('listening', ready)
    server.listen(port, host)
  })
}
async function availablePort() {
  const probe = net.createServer()
  const port = await listen(probe, 0, '127.0.0.1')
  await new Promise(resolve => probe.close(resolve))
  return port
}
function sendJson(response, status, result) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify(result))
}
function controlServer(controller, secret, options) {
  return http.createServer(async (request, response) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) || !safeEqual(request.headers.authorization, `Bearer ${secret}`)) {
      sendJson(response, 403, { error: 'Forbidden.' }); return
    }
    if (request.url !== '/certificate') { sendJson(response, 404, { error: 'Not found.' }); return }
    try {
      if (request.method === 'GET') {
        sendJson(response, 200, { mode: 'managed', uploadsEnabled: options.uploadsEnabled, certificate: controller.getMetadata(), reloadSupported: true, httpsPort: options.httpsPort })
      } else if (request.method === 'POST') {
        if (!options.uploadsEnabled) throw new TlsSettingsError('Certificate uploads are disabled. Configure HTTPS_ADMIN_TOKEN on the server first.', 403)
        const { bundle, hostname } = await readJsonBody(request)
        if (typeof hostname !== 'string' || !hostname || hostname.length > 253) throw new TlsSettingsError('A valid application hostname is required.')
        const certificate = controller.install(bundle, hostname)
        sendJson(response, 200, { success: true, certificate, reloadSupported: true, restartRequired: false })
      } else {
        response.setHeader('allow', 'GET, POST'); sendJson(response, 405, { error: 'Method not allowed.' })
      }
    } catch (error) {
      sendJson(response, error instanceof TlsSettingsError ? error.status : 500, { error: error instanceof TlsSettingsError ? error.message : 'The HTTPS listener could not process this request.' })
    }
  })
}

function proxyHeaders(request, secret, port) {
  const headers = { ...request.headers }
  // Never relay client-supplied forwarding/security assertions to Next.
  for (const name of Object.keys(headers)) {
    if (name.startsWith('x-forwarded-') || name === 'forwarded' || name.startsWith('x-open-backup-')) delete headers[name]
  }
  headers['x-forwarded-proto'] = 'https'
  headers['x-forwarded-host'] = request.headers.host
  headers['x-forwarded-port'] = String(port)
  headers['x-forwarded-for'] = request.socket.remoteAddress
  headers['x-open-backup-https'] = secret
  return headers
}

function createProxyServer(certificate, upstreamPort, secret, httpsPort) {
  const server = https.createServer(certificate.options, (request, response) => {
    if (!request.url?.startsWith('/') || request.url.startsWith('//')) { response.writeHead(400); response.end('Invalid request path.'); return }
    const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, method: request.method, path: request.url,
      headers: proxyHeaders(request, secret, httpsPort) }, result => {
      response.writeHead(result.statusCode || 502, result.headers)
      result.pipe(response)
      result.on('error', () => response.destroy())
    })
    upstream.setTimeout(120000, () => upstream.destroy())
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' }); response.end('The application server is unavailable.'); })
    request.on('aborted', () => upstream.destroy())
    response.on('close', () => { if (!response.writableFinished) upstream.destroy() })
    request.pipe(upstream)
  })
  server.headersTimeout = 30000
  server.requestTimeout = 120000
  // Production features currently use HTTP/SSE. Preserve standard WebSocket
  // upgrades for integrations without making this an open TCP proxy.
  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith('/') || request.url.startsWith('//')) { socket.destroy(); return }
    const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: request.url,
      method: request.method, headers: proxyHeaders(request, secret, httpsPort) })
    upstream.on('upgrade', (result, target, upstreamHead) => {
      socket.write(`HTTP/1.1 ${result.statusCode} ${result.statusMessage}\r\n`)
      for (let index = 0; index < result.rawHeaders.length; index += 2) socket.write(`${result.rawHeaders[index]}: ${result.rawHeaders[index + 1]}\r\n`)
      socket.write('\r\n')
      if (upstreamHead.length) socket.write(upstreamHead)
      if (head.length) target.write(head)
      socket.pipe(target); target.pipe(socket)
      socket.on('error', () => target.destroy()); target.on('error', () => socket.destroy())
      socket.on('close', () => target.destroy()); target.on('close', () => socket.destroy())
    })
    upstream.on('response', result => { result.resume(); socket.destroy() })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    upstream.setTimeout(15000, () => upstream.destroy())
    upstream.end()
  })
  return server
}

async function waitForApplication(port, child) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('The application server exited before becoming ready.')
    const ready = await new Promise(resolve => {
      const request = http.get({ hostname: '127.0.0.1', port, path: '/connect', timeout: 1500 }, response => { response.resume(); resolve(response.statusCode < 500) })
      request.on('timeout', () => request.destroy()); request.on('error', () => resolve(false))
    })
    if (ready) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('The application server did not become ready within 60 seconds.')
}

async function main() {
  const root = process.cwd()
  const port = Number(process.env.HTTPS_PORT || 3443)
  const host = process.env.HTTPS_BIND || '0.0.0.0'
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HTTPS_PORT must be between 1 and 65535.')
  const adminToken = process.env.HTTPS_ADMIN_TOKEN || ''
  if (adminToken && (adminToken.length < 32 || adminToken.length > 512)) throw new Error('HTTPS_ADMIN_TOKEN must contain 32 to 512 characters, or be omitted to disable uploads.')
  const standalone = path.join(root, 'server.js')
  let childArgs
  const upstreamPort = await availablePort()
  if (fs.existsSync(standalone)) childArgs = [standalone]
  else {
    if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) throw new Error('Build the production application with npm run build before starting HTTPS.')
    childArgs = [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(upstreamPort)]
  }
  const directory = path.resolve(process.env.HTTPS_DATA_DIR || path.join(root, 'data', 'tls'))
  let certificate = loadBundle(directory)
  if (!certificate) {
    certificate = generateSelfSigned(directory)
    console.log('Generated a unique self-signed certificate for this installation. Replace it with a trusted certificate in Settings > HTTPS.')
  }
  const secret = crypto.randomBytes(48).toString('hex')
  const server = createProxyServer(certificate, upstreamPort, secret, port)
  const controller = createCertificateController(server, certificate, directory)
  const control = controlServer(controller, secret, { uploadsEnabled: !!adminToken, httpsPort: port })
  const controlPort = await listen(control, 0, '127.0.0.1')
  const child = spawn(process.execPath, childArgs, { cwd: root, windowsHide: true, stdio: 'inherit', env: {
    ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(upstreamPort),
    INTERNAL_APP_URL: `http://127.0.0.1:${upstreamPort}`, OPEN_BACKUP_HTTPS_CONTROL_PORT: String(controlPort),
    OPEN_BACKUP_HTTPS_CONTROL_TOKEN: secret, OPEN_BACKUP_HTTPS_PORT: String(port),
  } })
  let stopping = false
  const onInterrupt = () => stop()
  const onTerminate = () => stop()
  const stop = (code = 0) => {
    if (stopping) return
    stopping = true
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onTerminate)
    server.close(); control.close()
    server.closeAllConnections(); control.closeAllConnections()
    child.kill()
    process.exitCode = code
    if (child.exitCode === null && child.signalCode === null) {
      const force = setTimeout(() => { child.kill('SIGKILL'); process.exit(code) }, 5000)
      child.once('exit', () => clearTimeout(force))
      force.unref()
    }
  }
  child.once('error', () => { console.error('The application server could not be launched.'); stop(1) })
  child.once('exit', code => { if (!stopping) { console.error('The application server stopped.'); stop(code || 1) } })
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)
  try {
    await waitForApplication(upstreamPort, child)
    await listen(server, port, host)
    console.log(`Open Backup UI HTTPS is listening on port ${port}. Internal HTTP is restricted to loopback.`)
    console.log(adminToken ? 'Certificate uploads are enabled with your HTTPS administration token.' : 'Certificate uploads are disabled; set HTTPS_ADMIN_TOKEN to enable them.')
    return { server, control, child, stop }
  } catch (error) { stop(1); throw error }
}

if (require.main === module) main().catch(error => { console.error(error instanceof TlsSettingsError ? error.message : error.message || 'HTTPS startup failed.'); process.exitCode = 1 })
module.exports = { listen, controlServer, proxyHeaders, createProxyServer, main }
