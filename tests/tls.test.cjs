// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const https = require('node:https')
const http = require('node:http')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const vm = require('node:vm')
const ts = require('typescript')
const core = require('../lib/server/tls-runtime.cjs')
const launcher = require('../scripts/https-server.cjs')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-backup-ui-tls-test-'))
const candidates = [process.env.OPENSSL_BIN, 'openssl', 'C:/Program Files/Git/usr/bin/openssl.exe'].filter(Boolean)
const openssl = candidates.find(command => { try { execFileSync(command, ['version'], { stdio: 'pipe', timeout: 5000, windowsHide: true }); return true } catch { return false } })
const skip = !openssl && 'OpenSSL is required for real TLS certificate tests.'
let first, second
before(() => {
  if (skip) return
  first = core.generateSelfSigned(path.join(root, 'first'), { openssl })
  second = core.generateSelfSigned(path.join(root, 'second'), { openssl })
})
after(() => fs.rmSync(root, { recursive: true, force: true }))

function typescriptModule(relative, extraRequire = {}) {
  const file = path.join(__dirname, '..', relative), exports = {}
  const context = { exports, require: name => extraRequire[name] || require(name), process: { env: {} }, URL, Headers, Buffer, Request, AbortSignal, fetch, Uint8Array, Error }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context)
  return exports
}
const origin = typescriptModule('lib/server/request-origin.ts')
const settings = typescriptModule('lib/server/tls-settings.ts', { './request-origin': origin })
const env = { HTTPS_ADMIN_TOKEN: 'a'.repeat(64), OPEN_BACKUP_HTTPS_CONTROL_TOKEN: 'b'.repeat(96) }
const request = headers => ({ headers: new Headers({ host: 'backup.example.test:3443', origin: 'https://backup.example.test:3443', 'x-forwarded-proto': 'https', 'x-open-backup-https': env.OPEN_BACKUP_HTTPS_CONTROL_TOKEN, 'x-https-admin-token': env.HTTPS_ADMIN_TOKEN, 'content-type': 'application/json', ...headers }), nextUrl: new URL('http://localhost:3000/api/settings/tls') })

test('certificate mutation requires the dedicated admin token and the managed TLS hop', () => {
  assert.equal(settings.validateHttpsMutation(request({}), env), 'backup.example.test')
  for (const headers of [ { 'x-https-admin-token': '' }, { 'x-https-admin-token': 'wrong' }, { 'x-https-admin-token': 'z'.repeat(64) }, { 'x-open-backup-https': '' }, { 'x-open-backup-https': 'z'.repeat(96) }, { 'x-forwarded-proto': 'http' }, { origin: 'https://attacker.test' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' } ]) {
    assert.throws(() => settings.validateHttpsMutation(request(headers), env))
  }
  assert.throws(() => settings.validateHttpsMutation(request({}), {}), /disabled/)
  assert.throws(() => settings.validateHttpsMutation(request({}), { ...env, HTTPS_ADMIN_TOKEN: 'short' }), /disabled/)
})

test('launcher rejects out-of-range administrator tokens before opening listeners or writing certificates', async () => {
  const previousToken = process.env.HTTPS_ADMIN_TOKEN
  try {
    for (const length of [31, 513]) {
      process.env.HTTPS_ADMIN_TOKEN = 'x'.repeat(length)
      await assert.rejects(launcher.main(), /HTTPS_ADMIN_TOKEN must contain 32 to 512 characters/)
    }
  } finally {
    if (previousToken === undefined) delete process.env.HTTPS_ADMIN_TOKEN
    else process.env.HTTPS_ADMIN_TOKEN = previousToken
  }
})

test('direct HTTP cannot spoof secure transport using forwarded headers', () => {
  const r = request({ 'x-open-backup-https': 'spoofed', 'x-forwarded-host': 'backup.example.test:3443' })
  assert.throws(() => settings.validateHttpsMutation(r, env), /managed HTTPS/)
})

test('bounded JSON parser rejects oversized declared and streamed bodies', async () => {
  await assert.rejects(settings.boundedHttpsJson(new Request('http://localhost/api', { method: 'POST', body: '{}', headers: { 'content-length': '300000' } })), /256 KiB/)
  await assert.rejects(settings.boundedHttpsJson(new Request('http://localhost/api', { method: 'POST', body: 'x'.repeat(settings.TLS_REQUEST_LIMIT + 1) })), /256 KiB/)
  await assert.rejects(settings.boundedHttpsJson(new Request('http://localhost/api', { method: 'POST', body: '{invalid' })), /valid JSON/)
  assert.deepEqual(JSON.parse(JSON.stringify(await settings.boundedHttpsJson(new Request('http://localhost/api', { method: 'POST', body: '{"certificatePem":"test"}' })))), { certificatePem: 'test' })
})

test('plain Next deployment reports externally managed HTTPS without exposing secrets', async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(await settings.httpsControl('GET'))), { mode: 'external', uploadsEnabled: false, certificate: null, reloadSupported: false, httpsPort: null })
  await assert.rejects(settings.httpsControl('POST', {}), /managed HTTPS launcher/)
})

test('self-signed certificates are unique per installation and retained on disk', { skip }, () => {
  assert.notEqual(first.certificate.fingerprint256, second.certificate.fingerprint256)
  assert.equal(core.loadBundle(path.join(root, 'first')).certificate.fingerprint256, first.certificate.fingerprint256)
  assert.equal(first.certificate.selfSigned, true)
  assert.equal(first.certificate.daysRemaining >= 364, true)
  assert.match(first.certificate.subjectAltName, /DNS:localhost/)
  assert.match(first.certificate.subjectAltName, /IP Address:127.0.0.1/)
  assert.equal('privateKeyPem' in first.certificate, false)
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(root, 'first', 'certificate.json')).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.join(root, 'first')).mode & 0o777, 0o700)
  }
})

test('mismatched keys, wrong hostnames, expired and future certificates are rejected', { skip }, () => {
  assert.throws(() => core.validateBundle({ certificatePem: first.bundle.certificatePem, privateKeyPem: second.bundle.privateKeyPem }), /does not match/)
  assert.throws(() => core.validateBundle(first.bundle, { hostname: 'wrong.example.test' }), /hostname/)
  assert.throws(() => core.validateBundle(first.bundle, { now: Date.parse(first.certificate.validTo) + 1 }), /expired/)
  assert.throws(() => core.validateBundle(first.bundle, { now: Date.parse(first.certificate.validFrom) - 1 }), /not valid yet/)
  assert.equal(core.validateBundle(first.bundle, { hostname: 'localhost' }).certificate.fingerprint256, first.certificate.fingerprint256)
  assert.equal(core.validateBundle(first.bundle, { hostname: '127.0.0.1' }).certificate.fingerprint256, first.certificate.fingerprint256)
})

test('invalid, duplicate and unrelated chains cannot replace a valid certificate', { skip }, () => {
  assert.throws(() => core.validateBundle({ ...first.bundle, chainPem: first.bundle.certificatePem }), /duplicate/)
  assert.throws(() => core.validateBundle({ ...first.bundle, chainPem: second.bundle.certificatePem }), /issuer chain/)
  assert.throws(() => core.validateBundle({ ...first.bundle, certificatePem: 'not PEM' }), /only PEM/)
  assert.throws(() => core.validateBundle({ ...first.bundle, privateKeyPem: 'x'.repeat(32769) }), /32 KiB/)
  assert.throws(() => core.validateBundle({ ...first.bundle, privateKeyPem: first.bundle.privateKeyPem + first.bundle.privateKeyPem }), /one unencrypted|could not be read/)
  assert.throws(() => core.selfSignedNames('good.example.test\n[evil]'), /valid DNS/)
})

test('a valid CA-issued leaf and separate intermediate/root chain are accepted', { skip }, () => {
  const directory = path.join(root, 'issued')
  fs.mkdirSync(directory)
  const run = args => execFileSync(openssl, args, { cwd: directory, stdio: 'pipe', timeout: 30000, windowsHide: true })
  fs.writeFileSync(path.join(directory, 'ca.cnf'), '[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=ca\n[dn]\nCN=Open Backup UI Test CA\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n')
  fs.writeFileSync(path.join(directory, 'leaf.cnf'), '[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=localhost\n')
  fs.writeFileSync(path.join(directory, 'extensions.cnf'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n')
  run(['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-config','ca.cnf','-keyout','ca-key.pem','-out','ca.pem'])
  run(['req','-new','-newkey','rsa:2048','-nodes','-config','leaf.cnf','-keyout','leaf-key.pem','-out','leaf.csr'])
  run(['x509','-req','-in','leaf.csr','-CA','ca.pem','-CAkey','ca-key.pem','-CAcreateserial','-days','2','-extfile','extensions.cnf','-out','leaf.pem'])
  const certificatePem = fs.readFileSync(path.join(directory, 'leaf.pem'), 'utf8')
  const chainPem = fs.readFileSync(path.join(directory, 'ca.pem'), 'utf8')
  const privateKeyPem = fs.readFileSync(path.join(directory, 'leaf-key.pem'), 'utf8')
  const result = core.validateBundle({ certificatePem, privateKeyPem, chainPem }, { hostname: 'localhost' })
  assert.equal(result.certificate.selfSigned, false)
  assert.match(result.certificate.issuer, /Test CA/)
  assert.equal((result.bundle.certificatePem.match(/BEGIN CERTIFICATE/g) || []).length, 2)
  assert.throws(() => core.validateBundle({ certificatePem: chainPem, privateKeyPem, chainPem: certificatePem }), /not a CA/)
})

function certificateRequest(port, ca) {
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: '127.0.0.1', port, path: '/', ca, agent: false }, response => {
      const peer = response.socket.getPeerCertificate()
      let body = ''
      response.setEncoding('utf8'); response.on('data', part => { body += part }); response.on('end', () => resolve({ fingerprint: peer.fingerprint256, body }))
    })
    request.on('error', reject)
  })
}
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.() })

test('live certificate replacement uses the new certificate on real TLS handshakes', { skip }, async () => {
  const directory = path.join(root, 'live')
  core.storeBundle(directory, first.bundle)
  const server = https.createServer(first.options, (_request, response) => response.end('application response'))
  const port = await launcher.listen(server, 0, '127.0.0.1')
  const controller = core.createCertificateController(server, first, directory)
  try {
    assert.equal((await certificateRequest(port, first.bundle.certificatePem)).fingerprint, first.certificate.fingerprint256)
    const result = controller.install(second.bundle, 'localhost')
    assert.equal(result.fingerprint256, second.certificate.fingerprint256)
    assert.equal((await certificateRequest(port, second.bundle.certificatePem)).fingerprint, second.certificate.fingerprint256)
    assert.equal(core.loadBundle(directory).certificate.fingerprint256, second.certificate.fingerprint256)
    assert.throws(() => controller.install({ ...first.bundle, privateKeyPem: second.bundle.privateKeyPem }, 'localhost'), /does not match/)
    assert.equal((await certificateRequest(port, second.bundle.certificatePem)).fingerprint, second.certificate.fingerprint256)
    assert.equal(controller.getMetadata().fingerprint256, second.certificate.fingerprint256)
  } finally { await close(server) }
})

test('a failed atomic commit restores both the serving certificate and persistent state', { skip }, async () => {
  const directory = path.join(root, 'rollback')
  core.storeBundle(directory, first.bundle)
  const server = https.createServer(first.options, (_request, response) => response.end('still online'))
  const port = await launcher.listen(server, 0, '127.0.0.1')
  const controller = core.createCertificateController(server, first, directory, { commit() { throw new Error('simulated disk failure') } })
  try {
    assert.throws(() => controller.install(second.bundle, 'localhost'), /previous certificate is still in use/)
    assert.equal((await certificateRequest(port, first.bundle.certificatePem)).fingerprint, first.certificate.fingerprint256)
    assert.equal(core.loadBundle(directory).certificate.fingerprint256, first.certificate.fingerprint256)
    assert.deepEqual(fs.readdirSync(directory), ['certificate.json'])
  } finally { await close(server) }
})

test('the loopback controller authenticates uploads and never returns private key material', { skip }, async () => {
  const directory = path.join(root, 'control')
  core.storeBundle(directory, first.bundle)
  const tlsServer = https.createServer(first.options)
  const controller = core.createCertificateController(tlsServer, first, directory)
  const secret = crypto.randomBytes(48).toString('hex')
  const server = launcher.controlServer(controller, secret, { uploadsEnabled: true, httpsPort: 3443 })
  const port = await launcher.listen(server, 0, '127.0.0.1')
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/certificate`)).status, 403)
    const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }
    const get = await (await fetch(`http://127.0.0.1:${port}/certificate`, { headers })).json()
    assert.equal(get.mode, 'managed'); assert.equal(get.uploadsEnabled, true)
    assert.equal(JSON.stringify(get).includes('PRIVATE KEY'), false)
    const response = await fetch(`http://127.0.0.1:${port}/certificate`, { method: 'POST', headers, body: JSON.stringify({ bundle: second.bundle, hostname: 'localhost' }) })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.restartRequired, false)
    assert.equal(result.certificate.fingerprint256, second.certificate.fingerprint256)
    assert.equal(JSON.stringify(result).includes('PRIVATE KEY'), false)
    const invalid = await fetch(`http://127.0.0.1:${port}/certificate`, { method: 'POST', headers, body: JSON.stringify({ bundle: { ...first.bundle, privateKeyPem: second.bundle.privateKeyPem }, hostname: 'localhost' }) })
    assert.equal(invalid.status, 400)
    assert.equal(controller.getMetadata().fingerprint256, second.certificate.fingerprint256)
  } finally { await close(server) }
})

test('HTTPS proxy preserves application traffic while replacing untrusted forwarding headers', { skip }, async () => {
  let observed
  const app = http.createServer((request, response) => { observed = request.headers; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: true })) })
  const appPort = await launcher.listen(app, 0, '127.0.0.1')
  const proxy = launcher.createProxyServer(first, appPort, 'private-runtime-proof', 3443)
  const port = await launcher.listen(proxy, 0, '127.0.0.1')
  try {
    const result = await certificateRequest(port, first.bundle.certificatePem)
    assert.deepEqual(JSON.parse(result.body), { ok: true })
    assert.equal(observed['x-forwarded-proto'], 'https')
    assert.equal(observed['x-open-backup-https'], 'private-runtime-proof')
    const headers = launcher.proxyHeaders({ headers: { host: 'backup.test', forwarded: 'attacker', 'x-forwarded-proto': 'http', 'x-open-backup-https': 'attacker' }, socket: { remoteAddress: '127.0.0.1' } }, 'real-proof', 3443)
    assert.equal(headers.forwarded, undefined)
    assert.equal(headers['x-open-backup-https'], 'real-proof')
    assert.equal(headers['x-forwarded-proto'], 'https')
  } finally { await close(proxy); await close(app) }
})

test('production launcher starts and stops a standalone child on loopback with persistent identity', { skip }, async () => {
  const directory = path.join(root, 'standalone')
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'server.js'), "const http=require('node:http');http.createServer((req,res)=>{res.end('child:'+req.headers['x-forwarded-proto'])}).listen(Number(process.env.PORT),process.env.HOSTNAME)")
  const probe = http.createServer()
  const port = await launcher.listen(probe, 0, '127.0.0.1')
  await close(probe)
  const previousCwd = process.cwd(), previousExit = process.exitCode
  const changes = { HTTPS_PORT: String(port), HTTPS_BIND: '127.0.0.1', HTTPS_DATA_DIR: path.join(directory, 'tls'), HTTPS_ADMIN_TOKEN: 'c'.repeat(64), OPENSSL_BIN: openssl }
  const old = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]))
  let running
  try {
    Object.assign(process.env, changes)
    process.chdir(directory)
    running = await launcher.main()
    const identity = core.loadBundle(changes.HTTPS_DATA_DIR)
    const response = await certificateRequest(port, identity.bundle.certificatePem)
    assert.equal(response.body, 'child:https')
    assert.equal(response.fingerprint, identity.certificate.fingerprint256)
  } finally {
    process.chdir(previousCwd)
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    if (running) {
      const stopped = new Promise(resolve => running.child.once('exit', resolve))
      running.stop()
      await stopped
      assert.equal(running.server.listening, false)
      assert.equal(running.control.listening, false)
    }
    process.exitCode = previousExit
  }
})
