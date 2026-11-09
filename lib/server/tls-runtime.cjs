// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
// Shared by the HTTPS launcher and its authenticated, loopback-only control API.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const crypto = require('node:crypto')
const tls = require('node:tls')
const { execFileSync } = require('node:child_process')

const MAX_BODY_BYTES = 256 * 1024
const MAX_CERT_BYTES = 64 * 1024
const MAX_KEY_BYTES = 32 * 1024
const CERT_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g

class TlsSettingsError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'TlsSettingsError'; this.status = status }
}

function certificates(value, label, required) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_CERT_BYTES) {
    throw new TlsSettingsError(`${label} must be a PEM file no larger than 64 KiB.`)
  }
  const matches = value.match(CERT_PATTERN) || []
  if ((required && !matches.length) || matches.length > 8 || value.replace(CERT_PATTERN, '').trim()) {
    throw new TlsSettingsError(`${label} must contain only PEM certificates, in leaf-to-root order.`)
  }
  return matches.map(pem => {
    try { return new crypto.X509Certificate(pem) }
    catch { throw new TlsSettingsError(`${label} contains an invalid certificate.`) }
  })
}

function metadata(cert, now = Date.now()) {
  return {
    subject: cert.subject,
    issuer: cert.issuer,
    subjectAltName: cert.subjectAltName || '',
    validFrom: new Date(cert.validFrom).toISOString(),
    validTo: new Date(cert.validTo).toISOString(),
    fingerprint256: cert.fingerprint256,
    selfSigned: cert.subject === cert.issuer && cert.verify(cert.publicKey),
    daysRemaining: Math.floor((Date.parse(cert.validTo) - now) / 86400000),
  }
}

function validateBundle(input, { hostname, now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TlsSettingsError('A certificate and private key are required.')
  const { certificatePem, privateKeyPem, chainPem = '' } = input
  if (typeof privateKeyPem !== 'string' || Buffer.byteLength(privateKeyPem) > MAX_KEY_BYTES) {
    throw new TlsSettingsError('The private key must be a PEM file no larger than 32 KiB.')
  }
  if (!/^\s*-----BEGIN ((?:RSA |EC )?PRIVATE KEY)-----[\sA-Za-z0-9+/=]+-----END \1-----\s*$/.test(privateKeyPem)) {
    throw new TlsSettingsError('Upload one unencrypted PEM private key. Encrypted keys and PFX files are not supported.')
  }
  const all = [...certificates(certificatePem, 'Server certificate', true), ...certificates(chainPem, 'Certificate chain', false)]
  if (all.length > 8 || new Set(all.map(cert => cert.fingerprint256)).size !== all.length) {
    throw new TlsSettingsError('The chain contains too many or duplicate certificates.')
  }
  const leaf = all[0]
  if (leaf.ca) throw new TlsSettingsError('The first certificate must be a server certificate, not a CA certificate.')
  if (!leaf.subjectAltName) throw new TlsSettingsError('The server certificate must include a Subject Alternative Name (SAN).')
  if (leaf.keyUsage && !leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1') && !leaf.keyUsage.includes('2.5.29.37.0')) {
    throw new TlsSettingsError('The certificate is not valid for TLS server authentication.')
  }
  for (const cert of all) {
    if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now) {
      throw new TlsSettingsError('A certificate is expired or is not valid yet.')
    }
  }
  for (let index = 1; index < all.length; index++) {
    if (!all[index].ca || !all[index - 1].checkIssued(all[index]) || !all[index - 1].verify(all[index].publicKey)) {
      throw new TlsSettingsError('The certificate chain is not a valid leaf-to-root issuer chain.')
    }
  }
  const last = all[all.length - 1]
  if (last.subject === last.issuer && !last.verify(last.publicKey)) {
    throw new TlsSettingsError('The self-signed certificate has an invalid signature.')
  }
  let key
  try { key = crypto.createPrivateKey(privateKeyPem) }
  catch { throw new TlsSettingsError('The private key could not be read. Use an unencrypted PEM key.') }
  if (!leaf.checkPrivateKey(key)) throw new TlsSettingsError('The private key does not match the server certificate.')
  if (key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails.modulusLength < 2048) {
    throw new TlsSettingsError('RSA private keys must be at least 2048 bits.')
  }
  if (hostname) {
    const host = hostname.replace(/^\[|\]$/g, '')
    const matches = net.isIP(host) ? leaf.checkIP(host) : leaf.checkHost(host, { subject: 'never' })
    if (!matches) throw new TlsSettingsError('The certificate does not cover the hostname used to open these settings.')
  }
  const bundle = { certificatePem: all.map(cert => cert.toString()).join('\n'), privateKeyPem: key.export({ type: 'pkcs8', format: 'pem' }).toString() }
  const options = { cert: bundle.certificatePem, key: bundle.privateKeyPem, minVersion: 'TLSv1.2' }
  try { tls.createSecureContext(options) }
  catch { throw new TlsSettingsError('TLS rejected this certificate or key. Check the certificate algorithm and chain.') }
  return { bundle, options, certificate: metadata(leaf, now) }
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (fs.lstatSync(directory).isSymbolicLink()) throw new TlsSettingsError('The TLS data directory cannot be a symbolic link.', 500)
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
}

function stageBundle(directory, bundle) {
  privateDirectory(directory)
  const target = path.join(directory, 'certificate.json')
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new TlsSettingsError('The TLS certificate file cannot be a symbolic link.', 500)
  const temporary = path.join(directory, `.certificate-${crypto.randomUUID()}.tmp`)
  const fd = fs.openSync(temporary, 'wx', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(bundle)); fs.fsyncSync(fd) }
  catch (error) { fs.closeSync(fd); fs.rmSync(temporary, { force: true }); throw error }
  fs.closeSync(fd)
  return { target, temporary }
}

function storeBundle(directory, bundle) {
  const staged = stageBundle(directory, bundle)
  try { fs.renameSync(staged.temporary, staged.target) }
  catch (error) { fs.rmSync(staged.temporary, { force: true }); throw error }
}

function loadBundle(directory) {
  const file = path.join(directory, 'certificate.json')
  if (!fs.existsSync(file)) return null
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > MAX_BODY_BYTES) throw new TlsSettingsError('The stored TLS certificate file is invalid.', 500)
  try { return validateBundle(JSON.parse(fs.readFileSync(file, 'utf8'))) }
  catch (error) {
    if (error instanceof TlsSettingsError) throw error
    throw new TlsSettingsError('The stored TLS certificate could not be read. Restore a valid certificate.json before starting HTTPS.', 500)
  }
}

function selfSignedNames(value = '') {
  const names = [...new Set(['localhost', '127.0.0.1', '::1', os.hostname(), ...value.split(',').map(item => item.trim()).filter(Boolean)])]
  if (names.length > 30 || names.some(name => name.length > 253 || (!net.isIP(name) && !/^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)*$/i.test(name)))) {
    throw new TlsSettingsError('HTTPS_HOSTNAMES must be a comma-separated list of valid DNS names or IP addresses.')
  }
  return names
}

function generateSelfSigned(directory, { openssl = process.env.OPENSSL_BIN || 'openssl', names = process.env.HTTPS_HOSTNAMES || '' } = {}) {
  privateDirectory(directory)
  const hostnames = selfSignedNames(names)
  const temporary = fs.mkdtempSync(path.join(directory, '.generate-'))
  if (process.platform !== 'win32') fs.chmodSync(temporary, 0o700)
  try {
    // Use our own minimal config so portable OpenSSL installations do not
    // depend on a machine-specific openssl.cnf location.
    fs.writeFileSync(path.join(temporary, 'openssl.cnf'), '[req]\ndistinguished_name=subject\nprompt=no\n[subject]\nCN=Open Backup UI\n', { mode: 0o600 })
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '365',
      '-config', path.join(temporary, 'openssl.cnf'), '-keyout', path.join(temporary, 'key.pem'), '-out', path.join(temporary, 'cert.pem'),
      '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
      '-addext', 'extendedKeyUsage=serverAuth', '-addext', `subjectAltName=${hostnames.map(host => `${net.isIP(host) ? 'IP' : 'DNS'}:${host}`).join(',')}`],
      { stdio: 'pipe', timeout: 30000, windowsHide: true })
    const validated = validateBundle({ certificatePem: fs.readFileSync(path.join(temporary, 'cert.pem'), 'utf8'), privateKeyPem: fs.readFileSync(path.join(temporary, 'key.pem'), 'utf8') })
    storeBundle(directory, validated.bundle)
    return validated
  } catch (error) {
    if (error instanceof TlsSettingsError) throw error
    throw new TlsSettingsError('Could not generate the initial certificate. Install OpenSSL 1.1.1 or later, or set OPENSSL_BIN to its executable path.', 500)
  } finally {
    // This exact directory was created above beneath the configured TLS directory.
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left), b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function createCertificateController(server, initial, directory, { persist = stageBundle, commit = fs.renameSync } = {}) {
  let active = initial
  return {
    getMetadata: () => metadata(new crypto.X509Certificate(active.bundle.certificatePem)),
    install(input, hostname) {
      const next = validateBundle(input, { hostname })
      let staged
      try {
        staged = persist(directory, next.bundle)
        server.setSecureContext(next.options)
        commit(staged.temporary, staged.target)
      } catch {
        // Validation and the private staging write happen before changing the listener.
        // If the final rename fails, restore the old context as well as its disk state.
        server.setSecureContext(active.options)
        if (staged) fs.rmSync(staged.temporary, { force: true })
        throw new TlsSettingsError('The certificate could not be activated. The previous certificate is still in use.', 500)
      }
      active = next
      server.setTicketKeys(crypto.randomBytes(48))
      return metadata(new crypto.X509Certificate(active.bundle.certificatePem))
    },
  }
}

async function readJsonBody(stream) {
  const declared = Number(stream.headers['content-length'] || 0)
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) throw new TlsSettingsError('Certificate upload exceeds the 256 KiB request limit.', 413)
  const chunks = []
  let length = 0
  for await (const chunk of stream) {
    length += chunk.length
    if (length > MAX_BODY_BYTES) throw new TlsSettingsError('Certificate upload exceeds the 256 KiB request limit.', 413)
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new TlsSettingsError('The certificate request must be valid JSON.') }
}

module.exports = { MAX_BODY_BYTES, MAX_CERT_BYTES, MAX_KEY_BYTES, TlsSettingsError, validateBundle, metadata, privateDirectory, storeBundle, loadBundle, selfSignedNames, generateSelfSigned, safeEqual, createCertificateController, readJsonBody }
