// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const ts = require('typescript')
const { test } = require('node:test')
const assert = require('node:assert/strict')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename)
const { translate } = require('../lib/i18n/model.ts')
const { investigationAttempt, investigationDiagnostic, investigationDuration, investigationLabel, investigationRate } = require('../lib/investigation/presentation.ts')
const { recordStatus } = require('../lib/investigation/model.ts')
const render = (key, values) => `localized:${translate({}, key, values)}`
const number = value => new Intl.NumberFormat('de').format(value)

test('investigation statuses translate only known UI enums without changing native states', () => {
  const row = { id: '00000000-0000-4000-8000-000000000001', state: 'WaitingRepository' }
  const before = JSON.stringify(row)
  assert.equal(investigationLabel(render, recordStatus(row)), 'localized:Waiting for repository')
  assert.equal(recordStatus(row), 'WaitingRepository')
  for (const value of ['VendorState', 'server-Success', 'job-{name}']) assert.equal(investigationLabel(render, value), value)
  assert.equal(investigationLabel(render, 'VSphere'), 'VMware vSphere')
  assert.equal(investigationLabel(render, 'Finished'), 'localized:Completed')
  assert.equal(investigationLabel(render, 'SqlLogBackup'), 'localized:SQL log backup')
  assert.equal(investigationLabel(render, 'Incremental'), 'localized:Incremental')
  assert.equal(investigationLabel(render, 'NotDefined'), 'localized:Not defined')
  assert.equal(investigationLabel(render, null), 'localized:Not reported')
  assert.equal(JSON.stringify(row), before)
})

test('processing rates translate exact absence sentinels and preserve provider measurements', () => {
  assert.equal(investigationRate(render, 'N/A'), 'localized:Not applicable')
  assert.equal(investigationRate(render, 'NotDefined'), 'localized:Not defined')
  assert.equal(investigationRate(render, null), 'localized:Not reported')
  for (const rate of ['120.5 MB/s', '120,5 MB/s', 'Vendor N/A: rate unavailable', 'Success', '0 B/s']) assert.equal(investigationRate(render, rate), rate)
})

test('retry and computed duration labels use translated templates and locale numbers', () => {
  const session = { id: '00000000-0000-4000-8000-000000000001', retryInfo: { isRecheckRetry: true, retryNumber: 12345 }, creationTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T01:02:03Z' }
  const before = JSON.stringify(session)
  assert.equal(investigationAttempt(render, session, number), 'localized:localized:Health-check retry 12.345')
  assert.equal(investigationAttempt(render, { ...session, retryInfo: {} }), 'localized:localized:Retry (kind not reported) · unnumbered')
  assert.equal(investigationAttempt(render, { id: session.id, originalSessionId: session.id }), 'localized:Original run')
  assert.equal(investigationDuration(render, session), 'localized:1h 2m 3s')
  assert.equal(investigationDuration(render, { ...session, endTime: null }), 'localized:Not reported')
  assert.equal(investigationDuration(render, { ...session, progress: { duration: 'vendor-duration' } }), 'vendor-duration')
  assert.equal(JSON.stringify(session), before)
})

test('investigation errors translate exact loader messages and preserve embedded vendor evidence', () => {
  const native = 'Vendor warning 123: Success {name} $&'
  assert.equal(investigationDiagnostic(render, native), native)
  assert.equal(investigationDiagnostic(render, `Original run unavailable. ${native}`), `localized:Original run unavailable. ${native}`)
  assert.equal(investigationDiagnostic(render, 'Select a valid session.'), 'localized:Select a valid session.')
  assert.equal(investigationDiagnostic(render, 'prefix Select a valid session.'), 'prefix Select a valid session.')
  const message = 'VBR returned records outside the requested scope. Those records were excluded.'
  assert.equal(investigationDiagnostic(render, message), `localized:${message}`)
})

test('VBR investigation UI registers every static source string', () => {
  const { auditProject } = require('../scripts/audit-i18n.cjs')
  const scope = /^(components\/investigation\/|app\/\(app\)\/vbr\/(jobs|sessions)\/\[id\]\/)/
  const findings = auditProject().findings.filter(item => scope.test(item.path))
  assert.deepEqual(findings, [])
})
