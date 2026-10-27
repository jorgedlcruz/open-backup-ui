/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm')
const compile = filename => ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
require.extensions['.ts'] = (module, filename) => module._compile(compile(filename), filename)
const { test } = require('node:test'), assert = require('node:assert/strict')
const m = require('../lib/ai-integrations/model.ts'), c = require('../lib/ai-integrations/credentials.ts'), p = require('../lib/ai-integrations/probe.ts')
const reply = (status, value) => ({ status, ok: status >= 200 && status < 300, json: async () => value })
const catalog = (...ids) => ({ data: ids.map(id => ({ id })) })
const saved = { provider: 'openai', modelName: 'gpt-4o-mini', apiKey: 'stored-secret', encryptedApiKey: 'ciphertext' }
const config = patch => ({ provider: 'openai', modelName: 'gpt-4o-mini', revision: 'a'.repeat(64), ...patch })

test('configuration accepts existing and custom model IDs without silently upgrading them', () => {
  for (const provider of Object.keys(m.providers)) for (const modelName of m.providers[provider].models) assert.equal(m.configurationInput.parse(config({ provider, modelName })).modelName, modelName)
  assert.equal(m.configurationInput.parse(config({ modelName: 'ft:gpt-4o-mini:org:custom:123' })).modelName, 'ft:gpt-4o-mini:org:custom:123')
})
test('configuration rejects injected endpoints, ciphertext, masked keys and invalid model paths', () => {
  for (const patch of [{ baseUrl: 'https://other.test' }, { encryptedApiKey: 'injected' }, { apiKey: 'sk-••••' }, { apiKey: 'secret\r\nheader' }, { modelName: 'models/../admin' }, { modelName: '' }, { provider: 'other' }, { revision: 'wrong' }]) assert.equal(m.configurationInput.safeParse(config(patch)).success, false)
})
test('credentials remain bound to their provider with no OpenAI fallback for Gemini or Anthropic', () => {
  assert.equal(c.resolveCredential('openai', saved, '', {}).key, 'stored-secret')
  for (const provider of ['gemini', 'anthropic']) assert.deepEqual(c.resolveCredential(provider, saved, '', { OPENAI_API_KEY: 'openai-env' }), { key: '', source: 'missing' })
  assert.deepEqual(c.resolveCredential('gemini', saved, '', { GEMINI_API_KEY: 'google-env' }), { key: 'google-env', source: 'environment' })
  assert.deepEqual(c.resolveCredential('anthropic', saved, 'new-key', {}), { key: 'new-key', source: 'new' })
})
test('unreadable saved credentials are reported rather than silently replaced by environment keys', () => assert.deepEqual(c.resolveCredential('openai', { ...saved, apiKey: undefined }, '', { OPENAI_API_KEY: 'env' }), { key: '', source: 'unreadable' }))
test('model choices preserve saved custom IDs and deduplicate API entries', () => {
  const models = m.modelOptions('openai', 'private-model', [{ id: 'gpt-4o-mini', name: 'Discovered model' }, { id: 'new-model', name: 'New' }])
  assert.equal(models.filter(item => item.id === 'gpt-4o-mini').length, 1)
  assert.equal(models.find(item => item.id === 'gpt-4o-mini').name, 'Discovered model')
  assert.ok(models.some(item => item.id === 'private-model'))
})
test('missing credentials make no outbound request', async () => {
  for (const source of ['missing', 'unreadable']) {
    const result = await p.probeProvider('openai', 'model', '', source, () => assert.fail('outbound request'))
    assert.equal(result.httpStatus, null); assert.equal(result.complete, false); assert.equal(m.modelEvidence(result, 'model'), 'unknown')
  }
})
test('OpenAI discovery only reads model metadata with a header-bound key', async () => {
  const calls = [], result = await p.probeProvider('openai', 'gpt-4o-mini', 'secret', 'saved', async (url, headers) => { calls.push({ url, headers }); return reply(200, catalog('gpt-4o-mini')) })
  assert.deepEqual(calls, [{ url: 'https://api.openai.com/v1/models', headers: { Authorization: 'Bearer secret' } }])
  assert.equal(result.connection, 'verified'); assert.equal(m.modelEvidence(result, 'gpt-4o-mini'), 'listed'); assert.equal(m.modelEvidence(result, 'other'), 'not-listed')
  assert.doesNotMatch(JSON.stringify(result), /secret/)
})
test('Gemini follows encoded page tokens and limits choices to generateContent models', async () => {
  const calls = [], result = await p.probeProvider('gemini', 'gemini-model', 'secret', 'saved', async (url, headers) => {
    calls.push({ url, headers }); return calls.length === 1 ? reply(200, { models: [{ name: 'models/embed', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'a&key=bad' }) : reply(200, { models: [{ name: 'models/gemini-model', displayName: 'Gemini', supportedGenerationMethods: ['generateContent'] }] })
  })
  assert.equal(calls.length, 2); assert.equal(new URL(calls[1].url).searchParams.get('pageToken'), 'a&key=bad'); assert.equal(new URL(calls[1].url).searchParams.has('key'), false)
  assert.equal(calls[0].headers['x-goog-api-key'], 'secret'); assert.deepEqual(result.models, [{ id: 'gemini-model', name: 'Gemini' }]); assert.equal(result.complete, true)
})
test('Anthropic pagination uses the installed SDK API version and detects incomplete catalogs', async () => {
  let count = 0
  const result = await p.probeProvider('anthropic', 'claude-test', 'secret', 'saved', async (url, headers) => {
    assert.equal(headers['anthropic-version'], '2023-06-01'); assert.equal(headers['x-api-key'], 'secret'); count++
    if (count === 2) assert.equal(new URL(url).searchParams.get('after_id'), 'claude-test')
    return reply(200, { data: [{ id: 'claude-test', display_name: 'Claude' }], has_more: true, last_id: 'claude-test' })
  })
  assert.equal(count, 2); assert.equal(result.complete, false); assert.equal(m.modelEvidence(result, 'missing'), 'unknown')
})
test('provider failures preserve authentication, permission, rate-limit and service distinctions without raw errors', async () => {
  for (const [status, expected] of [[401, 'rejected'], [403, 'forbidden'], [429, 'rate-limited'], [500, 'service-error'], [302, 'service-error']]) {
    const result = await p.probeProvider('openai', 'model', 'secret', 'saved', async () => ({ status, ok: false, json: () => assert.fail('raw provider error must not be read') }))
    assert.equal(result.connection, expected); assert.equal(result.httpStatus, status); assert.doesNotMatch(JSON.stringify(result), /secret/)
  }
})
test('unreachable and malformed model responses never appear verified', async () => {
  assert.equal((await p.probeProvider('openai', 'model', 'secret', 'saved', async () => { throw Error('secret network trace') })).connection, 'unreachable')
  for (const data of [{}, { data: [{ id: '../bad' }] }, { data: 'invalid' }]) assert.equal((await p.probeProvider('openai', 'model', 'secret', 'saved', async () => reply(200, data))).connection, 'invalid-response')
})
test('network failure after a catalog page retains partial evidence without claiming completion', async () => {
  let count = 0
  const result = await p.probeProvider('anthropic', 'model', 'secret', 'saved', async () => { if (count++) throw Error('timeout'); return reply(200, { ...catalog('model'), has_more: true, last_id: 'model' }) })
  assert.equal(result.connection, 'unreachable'); assert.equal(result.complete, false); assert.equal(result.models.length, 1); assert.equal(result.httpStatus, null)
})
test('pagination is bounded even when a provider keeps returning new cursors', async () => {
  let count = 0
  const result = await p.probeProvider('anthropic', 'absent', 'secret', 'saved', async () => reply(200, { ...catalog(`model-${++count}`), has_more: true, last_id: `model-${count}` }))
  assert.equal(count, 10); assert.equal(result.complete, false); assert.equal(m.modelEvidence(result, 'absent'), 'unknown')
})
test('check evidence expires after five minutes and handles invalid or future dates', () => {
  const now = Date.parse('2026-10-24T12:00:00Z'), check = { checkedAt: new Date(now).toISOString() }
  assert.equal(m.staleCheck(check, now + 300000), false); assert.equal(m.staleCheck(check, now + 300001), true)
  assert.equal(m.staleCheck({ checkedAt: 'invalid' }, now), true); assert.equal(m.staleCheck(check, now - 60001), true)
})

function harness(options = {}) {
  let settings = { ...saved, ...options.settings }
  const calls = [], writes = []
  class Response { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.headers = init.headers } static json(body, init) { return new Response(body, init) } }
  const store = { get: () => ({ ai: { ...settings } }), save: ({ ai }) => { writes.push(ai); const same = settings.provider === ai.provider; settings = { ...settings, ...ai, apiKey: ai.apiKey || (same ? settings.apiKey : undefined), encryptedApiKey: ai.apiKey ? 'new-cipher' : same ? settings.encryptedApiKey : undefined } } }
  const deps = { 'node:crypto': require('node:crypto'), 'next/server': { NextResponse: Response }, './settings-store': { settingsStore: store }, '../ai-integrations/model': m, '../ai-integrations/credentials': c, '../ai-integrations/probe': p }
  const exports = {}
  vm.runInNewContext(compile(require.resolve('../lib/server/ai-integrations.ts')), { exports, require: name => { if (!(name in deps)) throw Error(name); return deps[name] }, process: { env: options.env || {} }, AbortSignal, fetch: async (url, init) => { calls.push({ url, ...init }); return options.fetch ? options.fetch(url, init) : reply(200, catalog('gpt-4o-mini')) } })
  const request = (patch = {}, origin = 'http://localhost:3000') => ({ nextUrl: new URL('http://localhost:3000/api/settings/ai'), headers: new Headers({ origin }), signal: new AbortController().signal, json: async () => ({ ...config({ revision: exports.configurationRevision(settings) }), ...patch }) })
  return { exports, request, calls, writes, mutate: patch => { settings = { ...settings, ...patch } } }
}
test('configuration reads expose credential presence, never plaintext or ciphertext', async () => {
  const h = harness(), result = await h.exports.readConfiguration()
  assert.equal(result.body.hasSavedKey, true); assert.equal(result.body.credentialSource, 'saved'); assert.equal(result.headers['Cache-Control'], 'private, no-store'); assert.doesNotMatch(JSON.stringify(result), /stored-secret|ciphertext|apiKey/)
})
test('draft checks do not persist settings or send inference requests', async () => {
  const h = harness(), result = await h.exports.updateConfiguration(h.request(), 'check')
  assert.equal(result.status, 200); assert.equal(result.body.connection, 'verified'); assert.equal(h.writes.length, 0)
  assert.equal(h.calls[0].method, 'GET'); assert.equal(h.calls[0].redirect, 'error'); assert.equal(h.calls[0].cache, 'no-store'); assert.equal(h.calls[0].body, undefined); assert.ok(h.calls[0].signal)
})
test('foreign origins, invalid payloads and stale revisions cannot save or transmit credentials', async () => {
  const h = harness()
  assert.equal((await h.exports.updateConfiguration(h.request({}, 'https://foreign.test'), 'check')).status, 403)
  assert.equal((await h.exports.updateConfiguration(h.request({ revision: 'b'.repeat(64) }), 'save')).status, 409)
  assert.equal((await h.exports.updateConfiguration(h.request({ baseUrl: 'https://foreign.test' }), 'check')).status, 400)
  assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0)
})
test('switching provider without its own key cannot transmit the current provider key', async () => {
  const h = harness({ env: { OPENAI_API_KEY: 'openai-env' } }), result = await h.exports.updateConfiguration(h.request({ provider: 'gemini', modelName: 'gemini-model' }), 'check')
  assert.equal(result.body.connection, 'missing-key'); assert.equal(h.calls.length, 0)
})
test('checks use provider-specific environment credentials without exposing them', async () => {
  const h = harness({ env: { ANTHROPIC_API_KEY: 'anthropic-env' }, fetch: async () => reply(200, { ...catalog('claude-test'), has_more: false }) }), result = await h.exports.updateConfiguration(h.request({ provider: 'anthropic', modelName: 'claude-test' }), 'check')
  assert.equal(h.calls[0].headers['x-api-key'], 'anthropic-env'); assert.equal(result.body.credentialSource, 'environment'); assert.doesNotMatch(JSON.stringify(result), /anthropic-env/)
})
test('concurrent configuration changes invalidate connection evidence', async () => {
  let h
  h = harness({ fetch: async () => { h.mutate({ apiKey: 'changed-secret' }); return reply(200, catalog('model')) } })
  assert.equal((await h.exports.updateConfiguration(h.request(), 'check')).status, 409); assert.equal(h.writes.length, 0)
})
test('saving configuration returns redacted state and performs no provider request', async () => {
  const h = harness(), result = await h.exports.updateConfiguration(h.request({ modelName: 'custom-model', apiKey: 'replacement-secret' }), 'save')
  assert.equal(result.body.modelName, 'custom-model'); assert.equal(h.writes.length, 1); assert.equal(h.calls.length, 0); assert.doesNotMatch(JSON.stringify(result), /replacement-secret|new-cipher/)
})

function storeHarness(initial = { ai: saved }) {
  let file = initial === null ? null : typeof initial === 'string' ? initial : JSON.stringify(initial)
  const fakeFs = { existsSync: name => name.endsWith('settings.json') ? file !== null : true, mkdirSync: () => {}, readFileSync: () => file, writeFileSync: (_, value) => { file = value } }
  const exports = {}, deps = { fs: fakeFs, path: require('node:path'), './encryption': { encrypt: key => `encrypted:${key}`, decrypt: cipher => { if (cipher === 'broken') throw Error('decrypt failed'); return cipher.replace(/^encrypted:/, '') } } }
  vm.runInNewContext(compile(require.resolve('../lib/server/settings-store.ts')), { exports, require: name => deps[name], process: { cwd: () => '/test' } })
  return { store: exports.settingsStore, contents: () => JSON.parse(file) }
}
test('storage preserves encrypted keys on model-only changes and drops old-provider credentials on switches', () => {
  const h = storeHarness({ ai: { provider: 'openai', modelName: 'model', encryptedApiKey: 'encrypted:original' } })
  h.store.save({ ai: { provider: 'openai', modelName: 'new-model', apiKey: '' } }); assert.equal(h.contents().ai.encryptedApiKey, 'encrypted:original'); assert.equal(h.contents().ai.apiKey, undefined)
  h.store.save({ ai: { provider: 'gemini', modelName: 'gemini-model', apiKey: '' } }); assert.equal(h.contents().ai.encryptedApiKey, undefined)
})
test('replacement credentials are encrypted and cannot be overridden with caller-supplied ciphertext', () => {
  const h = storeHarness({ ai: { provider: 'openai' } })
  h.store.save({ ai: { provider: 'anthropic', apiKey: 'replacement', encryptedApiKey: 'injected' } }); assert.equal(h.contents().ai.encryptedApiKey, 'encrypted:replacement'); assert.equal(h.contents().ai.apiKey, undefined)
})
test('unreadable files fail instead of being overwritten with defaults', () => {
  const h = storeHarness('{invalid-json')
  assert.throws(() => h.store.get(), /could not be read/); assert.throws(() => h.store.save({ ai: { provider: 'gemini' } }), /could not be read/)
})
test('unreadable encrypted keys remain visible as unusable saved credentials', () => {
  const h = storeHarness({ ai: { provider: 'openai', encryptedApiKey: 'broken' } }), ai = h.store.get().ai
  assert.equal(ai.encryptedApiKey, 'broken'); assert.equal(ai.apiKey, undefined); assert.equal(c.resolveCredential('openai', ai, '', {}).source, 'unreadable')
})
