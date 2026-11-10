// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), ts = require('typescript')
const { test } = require('node:test'), assert = require('node:assert/strict')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename)
const { healthSummaryProblem } = require('../lib/server/health-summary-errors.ts')
const { healthSummaryResponse } = require('../lib/server/health-summary-stream.ts')
const { HEALTH_STREAM_TYPE, HealthSummaryError, readHealthSummaryResponse } = require('../lib/ai-integrations/health-stream.ts')
const parts = async function* (...events) { yield* events }
const finish = { type: 'finish', finishReason: 'stop' }
const failure = (statusCode = 402, message = 'Your prepayment credits are depleted.') => ({ statusCode, message, responseBody: JSON.stringify({ error: { message, status: 'RESOURCE_EXHAUSTED' } }) })
const bytes = new TextEncoder()
const responseFromChunks = chunks => new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close() } }), { headers: { 'Content-Type': HEALTH_STREAM_TYPE } })

test('Gemini billing failures reach the reader before any text and never become an empty summary', async () => {
  let text = ''
  const response = await healthSummaryResponse(parts({ type: 'start' }, { type: 'error', error: failure() }), 'gemini', 'test-key', true)
  await assert.rejects(readHealthSummaryResponse(response, chunk => { text += chunk }), error => {
    assert.ok(error instanceof HealthSummaryError)
    assert.deepEqual(error.problem, { provider: 'gemini', status: 402, kind: 'billing', message: 'Your prepayment credits are depleted.' })
    return true
  })
  assert.equal(text, '')
})

test('a provider error after text is a failure, not a successfully completed partial report', async () => {
  let text = ''
  const response = await healthSummaryResponse(parts({ type: 'text-delta', text: 'Partial report' }, { type: 'error', error: failure(429, 'Rate limit exceeded.') }, finish), 'gemini', '', true)
  await assert.rejects(readHealthSummaryResponse(response, chunk => { text += chunk }), error => error.problem.status === 429 && error.message === 'Rate limit exceeded.')
  assert.equal(text, 'Partial report')
})

test('SDK retry wrappers preserve the last provider status and diagnostic', () => {
  for (const wrapped of [{ lastError: failure(503, 'Provider temporarily unavailable.') }, { errors: [new Error('first'), failure(401, 'Invalid authentication.')] }, { cause: failure(403, 'Model access denied.') }]) {
    const problem = healthSummaryProblem(wrapped, 'openai')
    assert.ok(problem.status >= 400); assert.equal(problem.provider, 'openai')
    assert.notEqual(problem.message, 'Failed to generate AI summary')
  }
})

test('typed provider error events retain their message without fabricating an HTTP status', async () => {
  const response = await healthSummaryResponse(parts({ type: 'error', error: { type: 'overloaded_error', message: 'The provider is overloaded. Please retry later.' } }), 'anthropic', '', true)
  await assert.rejects(readHealthSummaryResponse(response, () => {}), error => {
    assert.equal(error.problem.provider, 'anthropic'); assert.equal(error.problem.status, undefined)
    assert.equal(error.message, 'The provider is overloaded. Please retry later.')
    return true
  })
})

test('error projection redacts credentials and excludes SDK request bodies, headers and stacks', () => {
  const secret = 'secret-with/symbols+and=padding'
  const message = `Invalid key ${secret}; encoded ${encodeURIComponent(secret)}; https://example.test/?key=another-secret&mode=test; Authorization: Bearer bearer-secret; x-api-key: header-secret`
  const problem = healthSummaryProblem({ ...failure(401, message), stack: 'private-stack', requestBodyValues: { prompt: 'private-environment' }, responseHeaders: { cookie: 'private-cookie' } }, 'gemini', secret)
  const serialized = JSON.stringify(problem)
  for (const hidden of [secret, encodeURIComponent(secret), 'another-secret', 'bearer-secret', 'header-secret', 'private-stack', 'private-environment', 'private-cookie']) assert.ok(!serialized.includes(hidden), hidden)
  assert.match(problem.message, /\[redacted\]/)
  assert.equal(healthSummaryProblem(new Error('private internal request details'), 'gemini').message, 'Failed to generate AI summary')
  assert.ok(healthSummaryProblem(failure(400, 'x'.repeat(5000)), 'gemini').message.length <= 1600)
})

test('successful text survives fragmented JSON lines and split UTF-8 characters', async () => {
  const text = '### Overview\nProtected workloads — 日本語 ✓\n'
  const response = await healthSummaryResponse(parts({ type: 'text-delta', text: text.slice(0, 12) }, { type: 'text-delta', text: text.slice(12) }, finish), 'gemini', '', true)
  const wire = new Uint8Array(await response.arrayBuffer())
  let received = ''
  await readHealthSummaryResponse(responseFromChunks([...wire].map(byte => new Uint8Array([byte]))), chunk => { received += chunk })
  assert.equal(received, text)
})

test('model text cannot impersonate a protocol error', async () => {
  const text = '{"type":"error","problem":{"message":"not a real error"}}\n'
  let received = ''
  await readHealthSummaryResponse(await healthSummaryResponse(parts({ type: 'text-delta', text }, finish), 'gemini', '', true), chunk => { received += chunk })
  assert.equal(received, text)
})

test('empty completed generations and interrupted streams have distinct actionable errors', async () => {
  for (const [events, kind] of [[ [finish], 'empty' ], [[{ type: 'text-delta', text: 'unfinished' }], 'interrupted'], [[{ type: 'abort' }], 'interrupted']]) {
    await assert.rejects(readHealthSummaryResponse(await healthSummaryResponse(parts(...events), 'gemini', '', true), () => {}), error => error.problem.kind === kind)
  }
})

test('truncated or malformed framing cannot be accepted as a completed report', async () => {
  for (const content of ['{"type":"text","text":"partial"}\n', '{"type":', '{"type":"error","problem":{"message":"incomplete"}}\n']) {
    await assert.rejects(readHealthSummaryResponse(responseFromChunks([bytes.encode(content)]), () => {}), error => error.problem.kind === 'interrupted')
  }
})

test('legacy open tabs receive an HTTP error with provider details instead of protocol text', async () => {
  const response = await healthSummaryResponse(parts({ type: 'text-delta', text: 'partial' }, { type: 'error', error: failure() }), 'gemini', '', false)
  assert.equal(response.status, 402)
  await assert.rejects(readHealthSummaryResponse(response, () => assert.fail('partial report must not be shown')), error => error.problem.status === 402)
  let text = ''
  await readHealthSummaryResponse(await healthSummaryResponse(parts({ type: 'text-delta', text: 'Legacy summary' }, finish), 'gemini', '', false), chunk => { text += chunk })
  assert.equal(text, 'Legacy summary')
})

test('thrown provider errors are projected and iterator resources close after an error event', async () => {
  let closed = false
  const events = async function* () { try { yield { type: 'error', error: failure() }; throw Error('must stop at error') } finally { closed = true } }
  await assert.rejects(readHealthSummaryResponse(await healthSummaryResponse(events(), 'gemini', '', true), () => {}), /prepayment credits/)
  assert.equal(closed, true)
  const thrown = async function* () { throw failure(403, 'Permission denied.') }
  await assert.rejects(readHealthSummaryResponse(await healthSummaryResponse(thrown(), 'anthropic', '', true), () => {}), error => error.problem.status === 403)
})
