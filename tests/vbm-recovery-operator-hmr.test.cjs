// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const { NextRequest } = require('next/server')

require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(
  fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }
).outputText, file)

function loadRoute(run) {
  const source = { id: 'source', platform: 'vb365', protocol: 'https', host: 'backup.example.test', port: 4443 }
  const routeFile = require.resolve('../lib/server/vbm-recovery.ts')
  const overrides = new Map([
    ['next/headers', { cookies: async () => ({ get: () => undefined }) }],
    ['./config-store', { configStore: { getAll: () => [source], getById: () => source } }],
    ['./token-manager', { tokenManager: { getToken: async () => 'fixture' } }],
    ['./read-cache-scope', { readCacheScope: () => 'test-scope' }],
    ['./vb365-helper', {}],
    ['../vbm-recovery/load', { recoveryPost: run }],
  ])
  const originalRequire = Module.prototype.require
  try {
    Module.prototype.require = function (id) {
      if (this.filename === routeFile && overrides.has(id)) return overrides.get(id)
      return originalRequire.call(this, id)
    }
    delete require.cache[routeFile]
    return require(routeFile).handleVbmRecovery
  } finally {
    Module.prototype.require = originalRequire
  }
}

const origin = 'http://127.0.0.1:3124'
function recoveryRequest(requestOrigin = origin) {
  return new NextRequest(origin + '/api/vbm/recovery', {
    method: 'POST', headers: { host: '127.0.0.1:3124', origin: requestOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'restore' }),
  })
}

test('a pending recovery reports its original error and outcome across a route reload', async () => {
  const modelFile = require.resolve('../lib/vbm-recovery/model.ts')
  const oldModel = require(modelFile)
  delete require.cache[modelFile]
  assert.notEqual(oldModel.RecoveryError, require(modelFile).RecoveryError)
  for (const error of [new oldModel.RecoveryError('Sign-in expired.', 401), new oldModel.RecoveryError('The request timed out.', 504, true)]) {
    const route = loadRoute(async () => { throw error })
    const response = await route(recoveryRequest())
    assert.equal(response.status, error.status)
    assert.deepEqual(await response.json(), { error: error.message, outcomeUnknown: error.outcomeUnknown })
    assert.match(response.headers.get('cache-control'), /no-store/)
  }
})

test('the route sanitizes unbranded exceptions and rejects a foreign origin before dispatch', async () => {
  const untrusted = Object.assign(new Error('upstream response body'), { name: 'RecoveryError', status: 403, outcomeUnknown: false })
  const route = loadRoute(async () => { throw untrusted })
  const response = await route(recoveryRequest())
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'Microsoft 365 recovery data could not be loaded.', outcomeUnknown: true })

  const guarded = loadRoute(async () => assert.fail('cross-origin recovery callback'))
  const forbidden = await guarded(recoveryRequest('https://other.example.test'))
  assert.equal(forbidden.status, 403)
  assert.deepEqual(await forbidden.json(), { error: 'Recovery actions must originate from this application.', outcomeUnknown: false })
})

test('stale delegated requests receive a definitive response without starting a restore', async () => {
  const { POST } = require('../app/api/vbm/recovery/operator/route.ts')
  const response = await POST()
  assert.equal(response.status, 410)
  const body = await response.json()
  assert.equal(body.outcomeUnknown, false)
  assert.match(body.error, /Veeam Restore Portal/)
  assert.match(response.headers.get('cache-control'), /no-store/)
})
