// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAudit } = require('../scripts/audit-i18n.cjs')
const root = path.resolve(__dirname, '..')

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename)
const filename = path.join(root, 'components/restore-points/presentation.ts')
const compiled = new Module(filename, module)
compiled.filename = filename
compiled.paths = module.paths
compiled.require = request => request.startsWith('@/') ? require(path.join(root, request.slice(2))) : require(request)
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename)
const { recoveryLabel, recoveryDiagnostic, recoveryBytes, recoveryGB, recoveryDate, recoveryAge } = compiled.exports
const { translate } = require('../lib/i18n/model.ts')
const spanish = require('../lib/i18n/messages/es.json')
const t = (key, values) => translate(spanish, key, values)

test('recovery and repository evidence labels translate known values without rewriting unknown provider values', () => {
  assert.equal(recoveryLabel(t, 'Retained backup'), spanish['Retained backup'])
  assert.equal(recoveryLabel(t, 'StartFlrRestore'), spanish['Guest file restore'])
  assert.equal(recoveryLabel(t, '14 days', 'es'), '14 días')
  assert.equal(recoveryLabel(t, 'UnknownVendorOperation'), 'UnknownVendorOperation')
  assert.equal(recoveryLabel(t, 'custom-provider-state'), 'custom-provider-state')
  assert.equal(recoveryDiagnostic(t, 'Backup Backup {name} $&: file collection is partial.'), t('Backup {id}: file collection is partial.', { id: 'Backup {name} $&' }))
  assert.equal(recoveryDiagnostic(t, 'Files for Host.Name$&: unrelated records were excluded.'), t('Files for {name}: unrelated records were excluded.', { name: 'Host.Name$&' }))
  const upstream = 'Veeam: file collection is partial; inspect server 301.'
  assert.equal(recoveryDiagnostic(t, upstream), upstream)
})

test('recovery capacity, age and date formatting use the selected locale and preserve unknown measurements', () => {
  assert.equal(recoveryBytes(t, 1536, 'de'), '1,5 KiB')
  assert.equal(recoveryGB(t, 1234.5, 'de'), '1.234,5 GB')
  assert.equal(recoveryGB(t, -1, 'de'), t('Not reported'))
  assert.equal(recoveryBytes(t, null, 'de'), t('Unknown'))
  assert.equal(recoveryAge(t, 1.5, 'de'), t('{count} hours', { count: '1,5' }))
  assert.equal(recoveryDate(t, 'invalid', 'es'), t('Unknown'))
  const timestamp = Date.parse('2026-10-27T10:15:00Z')
  assert.equal(recoveryDate(t, timestamp, 'es'), new Intl.DateTimeFormat('es', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp))
})

test('Explorer startup and destination browsing diagnostics translate without rewriting upstream messages', () => {
  const keys = [
    'Explorer was not started. Open Backup UI could not finish preparing this request. Review the selected restore point and try again.',
    'Explorer was not started because Open Backup UI could not save the recovery request. Check that its data folder is writable, then review the selected restore point and try again.',
    'Open Backup UI could not save the VBR response. Check the recovery status before submitting another request.',
    'This destination browser is unavailable. Open the folder browser again.',
    'Choose a folder within the selected destination.',
  ]
  for (const locale of ['de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'zh-CN']) {
    const messages = require(`../lib/i18n/messages/${locale}.json`)
    const localized = (key, values) => translate(messages, key, values)
    for (const key of keys) {
      assert.notEqual(messages[key], key, `${locale}: ${key}`)
      assert.equal(recoveryDiagnostic(localized, key, locale), messages[key])
    }
    const provider = 'VBR error 1705: target folder is unavailable.'
    assert.equal(recoveryDiagnostic(localized, provider, locale), provider)
  }
})

test('repository detail and recovery explorer, calendar and table register all static UI copy', () => {
  const files = ['components/repositories/repository-investigation.tsx', 'components/restore-points/restore-point-explorer.tsx', 'components/restore-points/presentation.ts', 'components/vbr-restore-points-table.tsx', 'components/vbr-restore-points-calendar.tsx', 'app/(app)/vbr/protected-data/restore-points/page.tsx']
  const audit = createAudit(root, files.map(file => [path.join(root, file), fs.readFileSync(path.join(root, file), 'utf8')]))
  assert.deepEqual(audit.findings, [])
  const keys = new Set(audit.registrations.map(item => item.key))
  for (const key of ['Backup repository', 'File lock verification', 'Recovery readiness', 'Unknown file sizes', 'Inspect recovery point {id}', '{count} points have unknown dates. Inspect them in List view.']) assert.ok(keys.has(key), key)
})
