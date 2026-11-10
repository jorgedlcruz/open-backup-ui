// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('node:http'), assert = require('node:assert/strict'), { test } = require('node:test')
const { createKioskServer } = require('../scripts/lib/kiosk-gateway.cjs')
const id = 'a'.repeat(43), origin = 'http://kiosk.example:3102'
const listen = (server, hostname = '127.0.0.1') => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, hostname, () => { server.off('error', reject); resolve(server.address().port) })
})
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })
function request(port, path, method = 'GET', headers = {}, body, hostname = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ hostname, port, path, method, headers: { host: 'kiosk.example:3102', ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }))
    })
    outgoing.on('error', reject); outgoing.end(body)
  })
}
test('kiosk listener serves only shared routes and cannot forward private pages, mutations or credentials', async t => {
  const received = []
  const upstream = http.createServer((req, res) => {
    received.push({ path: req.url, method: req.method, headers: req.headers })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': ['kiosk-view-access=public-ticket; Path=/api/public/kiosks/' + id + '; HttpOnly', 'veeam_source_id=private; Path=/', 'kiosk-share-owner=private; Path=/api/labs/shares'] })
    res.end(JSON.stringify({ shared: true }))
  })
  const appPort = await listen(upstream), gateway = createKioskServer({ appUrl: `http://127.0.0.1:${appPort}`, publicOrigin: origin }), port = await listen(gateway)
  t.after(async () => { await close(gateway); await close(upstream) })
  const ticket = '1234567890123.' + 'b'.repeat(43)
  const result = await request(port, `/share/kiosk/${id}`, 'GET', { cookie: `veeam_source_id=secret; kiosk-share-owner=secret; kiosk-view-access=${ticket}`, authorization: 'Bearer secret', 'x-forwarded-host': 'private.example', 'x-forwarded-proto': 'https', 'x-middleware-subrequest': 'middleware:middleware:middleware', 'x-pathname': '/labs', 'next-action': 'secret-action' })
  assert.equal(result.status, 200); assert.equal(received.length, 1)
  assert.equal(received[0].headers.cookie, `kiosk-view-access=${ticket}`); assert.equal(received[0].headers.host, 'kiosk.example:3102'); assert.equal(received[0].headers['x-forwarded-proto'], 'http')
  for (const key of ['authorization', 'x-forwarded-host', 'x-middleware-subrequest', 'x-pathname', 'next-action']) assert.equal(received[0].headers[key], undefined, key)
  assert.equal(result.headers['set-cookie'].length, 1); assert.ok(result.headers['set-cookie'][0].startsWith('kiosk-view-access='))
  assert.equal(result.headers['referrer-policy'], 'no-referrer'); assert.equal(result.headers['x-frame-options'], 'DENY')
  for (const path of ['/', '/labs', '/connect', '/api/auth/vbr', '/api/config/sources', '/api/labs/shares', '/api/administration/data-sources', `//private.example/share/kiosk/${id}`, '/_next/static/%2e%2e/%2fapi/config/sources', '/_next/static/..%5c..%5capi/config/sources']) assert.equal((await request(port, path)).status, 404, path)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal((await request(port, `/share/kiosk/${id}`, method)).status, 404)
  assert.equal((await request(port, `/api/public/kiosks/${id}`, 'POST')).status, 404)
  assert.equal((await request(port, `/share/kiosk/${id}`, 'GET', { host: 'private.example' })).status, 404)
  assert.equal(received.length, 1, 'No blocked request may reach the application')
  assert.equal((await request(port, '/_next/static/chunks/app_123.js')).status, 200)
  assert.equal((await request(port, `/api/public/kiosks/${id}`, 'GET')).status, 200)
  assert.equal((await request(port, `/share/kiosk/${id}`, 'HEAD')).status, 200)
})

test('unlock requires same-origin JSON, rejects oversized bodies, and refuses private redirects', async t => {
  let calls = 0, redirect = false
  const upstream = http.createServer((req, res) => { calls++; req.resume(); if (redirect) { res.writeHead(307, { location: '/administration/data-sources' }); res.end() } else { res.writeHead(200); res.end('unlocked') } })
  const appPort = await listen(upstream), gateway = createKioskServer({ appUrl: `http://127.0.0.1:${appPort}`, publicOrigin: origin }), port = await listen(gateway)
  t.after(async () => { await close(gateway); await close(upstream) })
  const path = `/api/public/kiosks/${id}/unlock`, body = JSON.stringify({ password: 'synthetic' })
  assert.equal((await request(port, path, 'POST', { origin: 'http://evil.example' }, body)).status, 403)
  assert.equal((await request(port, path, 'POST', {}, body)).status, 403)
  assert.equal((await request(port, path, 'POST', { origin, 'sec-fetch-site': 'cross-site' }, body)).status, 403)
  assert.equal((await request(port, path, 'POST', { origin, 'content-length': '1025' }, 'a'.repeat(1025))).status, 413)
  assert.equal(calls, 0)
  assert.equal((await request(port, path, 'POST', { origin, 'content-type': 'application/json' }, body)).status, 200)
  assert.equal(calls, 1)
  redirect = true
  assert.equal((await request(port, `/share/kiosk/${id}`)).status, 502)
})

test('kiosk listener rejects credentials, paths, unsupported protocols and self-proxy configuration', () => {
  for (const appUrl of ['ftp://example.com', 'https://user:password@example.com', 'http://example.com/private', origin]) assert.throws(() => createKioskServer({ appUrl, publicOrigin: origin }))
})

test('kiosk startup rejects malformed CIDRs', () => {
  for (const allowedSubnet of ['', 'localhost/8', '127.0.0.1', '192.168.1.0/33', '::1/129', 'fe80::1%eth0/64', '::1/-1', '::1/', '::1/1/2', '::1/1.0', '::1/ 1', '::1/01']) {
    assert.throws(() => createKioskServer({ appUrl: 'http://127.0.0.1', publicOrigin: origin, allowedSubnet }), /KIOSK_ALLOWED_SUBNET/, allowedSubnet)
  }
})

for (const [family, hostname, allowed, excluded, spoof] of [
  ['IPv4', '127.0.0.1', '127.0.0.0/8', '192.168.1.0/24', '192.168.1.41'],
  ['IPv6', '::1', '::1/128', '2001:db8::/32', '2001:db8::1'],
]) {
  test(`kiosk uses only the ${family} socket peer for subnet authorization`, async t => {
    let calls = 0
    const upstream = http.createServer((_req, res) => { calls++; res.end('ok') })
    const appUrl = 'http://127.0.0.1:' + await listen(upstream)
    t.after(() => close(upstream))
    for (const [allowedSubnet, forwarded, expected] of [[allowed, spoof, 200], [excluded, spoof, 403]]) {
      const gateway = createKioskServer({ appUrl, publicOrigin: origin, allowedSubnet })
      let port
      try { port = await listen(gateway, hostname) } catch (error) {
        if (family === 'IPv6' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) return t.skip('IPv6 loopback unavailable')
        throw error
      }
      t.after(() => close(gateway))
      const response = await request(port, '/share/kiosk/' + id, 'GET', {
        forwarded: `for="${forwarded}"`, 'x-forwarded-for': forwarded, 'x-real-ip': forwarded,
      }, undefined, hostname)
      assert.equal(response.status, expected)
    }
    assert.equal(calls, 1)
  })
}
