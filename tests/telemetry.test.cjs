/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm')
const compile = filename => ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
require.extensions['.ts'] = (module, filename) => module._compile(compile(filename), filename)
const { test } = require('node:test'), assert = require('node:assert/strict')
const m = require('../lib/telemetry/model.ts')
const plain = value => JSON.parse(JSON.stringify(value))
const snapshot = patch => ({ checkedAt: '2026-10-24T12:00:00Z', configured: true, destination: 'https://eu.i.posthog.com', preference: { enabled: true, source: 'default' }, initialized: true, optedOut: false, online: true, sdkVersion: '1.327.0', runtimeError: false, lastRequestError: null, pageViews: 'disabled', interactions: 'enabled', exceptions: 'project-managed', sessionReplay: 'disabled', recording: false, ...patch })

function harness(options = {}) {
  let value = options.preference ?? null
  const events = [], calls = [], store = { getItem: () => { if (options.blockRead) throw Error('private storage error'); return value }, setItem: (_, next) => { if (options.blockWrite) throw Error('private storage error'); value = next }, removeItem: () => { if (options.blockWrite) throw Error('private storage error'); value = null } }
  const window = { localStorage: store, dispatchEvent: event => { events.push(event.type); return true } }
  const preferences = {}
  vm.runInNewContext(compile(require.resolve('../lib/telemetry.ts')), { exports: preferences, require: name => { assert.equal(name, './telemetry/model'); return m }, window, Event })
  if (options.unconfigured) preferences.TELEMETRY_CONFIG.POSTHOG_KEY = 'REPLACE'
  let optedOut = options.optedOut ?? false, initOptions
  const client = {
    __loaded: options.initialized ?? false, version: '1.327.0', config: { capture_pageview: false, disable_session_recording: true, autocapture: true, token: 'secret-token', other: 'secret-context' },
    init: (_, config) => { calls.push('init'); if (options.failInit) throw Error('private initialization error'); client.__loaded = true; initOptions = config; if (!options.defer) config.loaded(client) },
    opt_in_capturing: config => { calls.push(['opt-in', config]); optedOut = false },
    opt_out_capturing: () => { calls.push('opt-out'); if (options.failOptOut) throw Error('private opt out error'); optedOut = true },
    has_opted_out_capturing: () => { if (options.failRead) throw Error('private read error'); return optedOut },
    sessionRecordingStarted: () => false,
  }
  const runtime = {}
  vm.runInNewContext(compile(require.resolve('../lib/telemetry/runtime.ts')), { exports: runtime, require: name => ({ 'posthog-js': client, '../telemetry': preferences, './model': m })[name], window, navigator: { onLine: true }, Event, Date })
  return { preferences, runtime, client, calls, events, value: () => value, config: () => initOptions, complete: () => initOptions.loaded(client) }
}

test('legacy default and opt-out preferences are preserved; malformed state is never consent', () => {
  assert.deepEqual(m.parsePreference(null), { enabled: true, source: 'default' })
  assert.deepEqual(m.parsePreference('true'), { enabled: false, source: 'saved' })
  assert.deepEqual(m.parsePreference('false'), { enabled: true, source: 'saved' })
  for (const value of ['', 'yes', '{}', 'undefined']) assert.equal(m.parsePreference(value).enabled, null)
})
test('browser storage failures are explicit and cannot silently enable collection', () => {
  const h = harness({ blockRead: true, blockWrite: true })
  assert.deepEqual(plain(h.preferences.readTelemetryPreference()), { enabled: null, source: 'unavailable' })
  assert.equal(h.preferences.isTelemetryDisabled(), true)
  assert.equal(h.preferences.enableTelemetry(), false)
  assert.equal(h.preferences.disableTelemetry(), false)
  assert.equal(h.events.length, 0)
  h.runtime.synchronizeTelemetry(); assert.equal(h.calls.length, 0)
})
test('preference writes preserve the existing storage key and publish same-tab updates', () => {
  const h = harness()
  assert.equal(h.preferences.STORAGE_KEY, 'veeam_telemetry_disabled')
  assert.equal(h.preferences.disableTelemetry(), true); assert.equal(h.value(), 'true')
  assert.equal(h.preferences.enableTelemetry(), true); assert.equal(h.value(), null)
  assert.deepEqual(h.events, [h.preferences.TELEMETRY_PREFERENCE_EVENT, h.preferences.TELEMETRY_PREFERENCE_EVENT])
})
test('configured state validates both token presence and a supported destination', () => {
  assert.equal(m.configured('project-token', 'https://eu.i.posthog.com'), true)
  for (const key of ['', '  ', 'REPLACE_ME', null]) assert.equal(m.configured(key, 'https://eu.i.posthog.com'), false)
  for (const host of ['javascript:alert(1)', 'https://user:secret@example.test', '', null]) assert.equal(m.configured('token', host), false)
  assert.equal(m.destination('https://example.test/path?token=secret#private'), 'https://example.test')
})
test('collection readiness requires SDK evidence, not just an enabled preference', () => {
  assert.equal(m.collectionState(snapshot()).label, 'Ready locally')
  for (const patch of [{ initialized: false }, { optedOut: true }, { optedOut: null }, { runtimeError: true }, { online: false }, { configured: false }, { preference: { enabled: null, source: 'invalid' } }]) assert.notEqual(m.collectionState(snapshot(patch)).tone, 'success')
  assert.equal(m.collectionState(snapshot({ preference: { enabled: false, source: 'saved' } })).label, 'Disabled')
  assert.match(m.collectionState(snapshot()).detail, /Delivery is not verified/)
})
test('disabled sharing is an expected state, not a health failure', () => {
  const s = snapshot({ preference: { enabled: false, source: 'saved' }, initialized: false, optedOut: null, online: false })
  assert.equal(m.diagnostics(s).filter(row => row.tone === 'warning').length, 0)
})
test('diagnostics flag SDK preference drift and unexpected recording', () => {
  for (const patch of [{ optedOut: true }, { preference: { enabled: false, source: 'saved' } }, { recording: true }, { runtimeError: true }]) assert.ok(m.diagnostics(snapshot(patch)).some(row => row.tone === 'warning'))
  const delivery = m.diagnostics(snapshot()).find(row => row.id === 'delivery')
  assert.equal(delivery.status, 'Not verified'); assert.equal(delivery.tone, 'neutral')
})
test('capture flags distinguish disabled, enabled, configured objects and remote control', () => {
  assert.equal(m.captureSetting(false), 'disabled'); assert.equal(m.captureSetting(true), 'enabled')
  assert.equal(m.captureSetting('history_change'), 'enabled'); assert.equal(m.captureSetting({ capture_unhandled_errors: true }), 'custom')
  assert.equal(m.captureSetting(undefined, 'project-managed'), 'project-managed'); assert.equal(m.captureSetting(null), 'unknown')
})
test('diagnostics exports use an allowlist and strip destination path/query/userinfo', () => {
  const report = m.diagnosticReport(snapshot({ destination: 'https://example.test/path?secret=hidden', token: 'private-key', distinct_id: 'private-user', rawError: 'private-error', lastRequestError: { at: '2026-10-24T12:00:00Z', status: 403, text: 'private-body' } }))
  assert.equal(report.destination, 'https://example.test')
  assert.doesNotMatch(JSON.stringify(report), /private|hidden|distinct_id|rawError|path\?/)
  assert.equal(m.diagnosticReport(snapshot({ destination: 'https://user:secret@example.test' })).destination, null)
})
test('disabled, invalid and unconfigured preferences do not initialize the SDK', () => {
  for (const options of [{ preference: 'true' }, { preference: 'corrupt' }, { unconfigured: true }]) {
    const h = harness(options); h.runtime.synchronizeTelemetry(); assert.equal(h.calls.length, 0)
  }
})
test('initialization retains page-view, recording and person-profile configuration', () => {
  const h = harness(); h.runtime.synchronizeTelemetry()
  assert.deepEqual(h.calls, ['init'])
  assert.equal(h.config().capture_pageview, false); assert.equal(h.config().disable_session_recording, true); assert.equal(h.config().person_profiles, 'identified_only')
  assert.equal(h.config().autocapture, undefined); assert.equal(h.config().capture_exceptions, undefined)
})
test('normal initialization and refresh never override an SDK opt-out', () => {
  const h = harness({ optedOut: true }); h.runtime.synchronizeTelemetry(); h.runtime.synchronizeTelemetry()
  assert.deepEqual(h.calls, ['init']); assert.equal(h.runtime.telemetrySnapshot().optedOut, true)
})
test('explicit enable initializes when needed and suppresses the synthetic opt-in event', () => {
  const h = harness({ optedOut: true }); h.runtime.synchronizeTelemetry(true)
  assert.deepEqual(plain(h.calls), ['init', ['opt-in', { captureEventName: false }]])
  assert.equal(h.runtime.telemetrySnapshot().optedOut, false)
})
test('explicit enable resumes an initialized SDK without reinitializing it', () => {
  const h = harness({ initialized: true, optedOut: true }); h.runtime.synchronizeTelemetry(true)
  assert.deepEqual(plain(h.calls), [['opt-in', { captureEventName: false }]])
})
test('disable immediately opts out an existing SDK; repeated sync does not reapply it', () => {
  const h = harness({ initialized: true, preference: 'true' }); h.runtime.synchronizeTelemetry(); h.runtime.synchronizeTelemetry()
  assert.deepEqual(h.calls, ['opt-out']); assert.equal(h.runtime.telemetrySnapshot().optedOut, true)
})
test('preference changed during initialization wins over the earlier enable request', () => {
  const h = harness({ defer: true }); h.runtime.synchronizeTelemetry(true); h.preferences.disableTelemetry(); h.complete()
  assert.deepEqual(h.calls, ['init', 'opt-out']); assert.equal(h.runtime.telemetrySnapshot().optedOut, true)
})
test('runtime failures remain visible without exposing raw error messages', () => {
  for (const options of [{ failInit: true }, { initialized: true, preference: 'true', failOptOut: true }, { initialized: true, failRead: true }, { defer: true, failOptOut: true }]) {
    const h = harness(options); h.runtime.synchronizeTelemetry()
    if (options.defer) { h.preferences.disableTelemetry(); h.complete() }
    const s = h.runtime.telemetrySnapshot(); assert.equal(s.runtimeError, true); assert.doesNotMatch(JSON.stringify(s), /private/)
  }
})
test('request failure observation keeps only timestamp and bounded HTTP status', () => {
  const h = harness(); h.runtime.synchronizeTelemetry()
  h.config().on_request_error({ statusCode: 403, text: 'private-token', json: { secret: 'hidden' } })
  assert.equal(h.runtime.telemetrySnapshot().lastRequestError.status, 403)
  assert.doesNotMatch(JSON.stringify(h.runtime.telemetrySnapshot()), /private-token|hidden|secret/)
  h.config().on_request_error({ statusCode: 0 }); assert.equal(h.runtime.telemetrySnapshot().lastRequestError.status, null)
})
test('refresh and report generation neither initialize nor capture nor clear historical failures', () => {
  const h = harness(); h.runtime.telemetrySnapshot(); assert.equal(h.calls.length, 0)
  h.runtime.synchronizeTelemetry(); h.config().on_request_error({ statusCode: 429 })
  h.calls.length = 0
  for (let i = 0; i < 3; i++) assert.equal(m.diagnosticReport(h.runtime.telemetrySnapshot()).lastRequestError.status, 429)
  assert.equal(h.calls.length, 0)
})
