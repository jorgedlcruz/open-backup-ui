// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(relative, imports = {}) {
  const filename = path.join(root, relative)
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = module.paths
  loaded.require = id => Object.hasOwn(imports, id) ? imports[id] : require(id)
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename)
  return loaded.exports
}

const model = load('lib/i18n/model.ts')
const enums = load('lib/i18n/presentation.ts')
const policies = load('lib/job-builder/model.ts')
const vbrErrors = load('lib/i18n/vbr-errors.ts')
const diagnostics = load('components/job-builder/diagnostics.ts', { '@/lib/i18n/vbr-errors': vbrErrors })
function presentation(locale) {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, `lib/i18n/messages/${locale}.json`), 'utf8'))
  return load('components/job-builder/presentation.ts', {
    '@/components/providers/i18n-provider': { useI18n: () => ({
      locale,
      t: (key, values) => model.translate(catalog, key, values),
      formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
    }) },
    '@/lib/i18n/presentation': enums,
    '@/lib/job-builder/model': policies,
    './diagnostics': diagnostics,
  }).usePolicyPresentation()
}

test('policy cards translate live settings and weekdays while preserving the native payload', () => {
  const settings = structuredClone(policies.defaults)
  settings.retention.quantity = 14
  settings.schedule.days = ['monday', 'wednesday']
  const before = policies.compileRetention(settings.retention)
  const schedule = policies.compileSchedule(settings.schedule)
  const es = presentation('es')
  assert.match(es.summary('retention', settings.retention), /14 días/)
  assert.match(es.summary('retention', settings.retention), /sintéticos/i)
  assert.equal(es.dayLabel('monday'), 'lunes')
  assert.equal(es.dayLabel('sunday'), 'domingo')
  assert.match(es.summary('schedule', settings.schedule), / a las 22:00$/)
  assert.equal(es.summary('schedule', { ...settings.schedule, mode: 'periodic', interval: 4, unit: 'Hours' }), 'Cada 4 horas')
  assert.equal(es.summary('schedule', { ...settings.schedule, mode: 'periodic', interval: 10, unit: 'Minutes' }), 'Cada 10 minutos')
  assert.equal(es.validationIssue('Give this profile a name.'), 'Introduce un nombre de perfil.')
  assert.equal(es.validationIssue('Too small: expected number to be >=1'), 'Comprueba los campos obligatorios y los valores permitidos.')
  assert.deepEqual(policies.compileRetention(settings.retention), before)
  assert.deepEqual(policies.compileSchedule(settings.schedule), schedule)
  assert.deepEqual(settings.schedule.days, ['monday', 'wednesday'])
})

test('builder diagnostics translate known messages without altering host names or vendor evidence', () => {
  const trace = (source, values = {}) => `translated:${source.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`))}`
  const t = source => diagnostics.builderDiagnostic(trace, source)
  assert.equal(t('The selected repository is offline.'), 'translated:The selected repository is offline.')
  assert.equal(t('The selected repository is offline. Limit this job to 20 inventory servers.'), 'translated:The selected repository is offline. translated:Limit this job to 20 inventory servers.')
  assert.equal(t('Some selected objects on host {section} $& could not be verified. Re-select them from inventory.'), 'translated:Some selected objects on host {section} $& could not be verified. Re-select them from inventory.')
  assert.equal(t('Proxy availability: only part of the inventory was returned.'), 'translated:translated:Proxy availability: only part of the inventory was returned.')
  assert.equal(t('VBR rejected the job (HTTP 403). Review the settings and permissions.'), 'translated:VBR rejected the job (HTTP 403). Review the settings and permissions.')
  for (const value of ['VendorError 8442 on server prod-01', 'Custom inventory: only part of the inventory was returned.', 'The selected repository is offline. VendorError 8442']) assert.equal(t(value), value)
  assert.equal(diagnostics.credentialTypeLabel(trace, 'ManagedService'), 'translated:Managed service account')
  assert.equal(diagnostics.credentialTypeLabel(trace, 'VendorCredential'), 'VendorCredential')
})

test('profile imports localize parse failures and preserve accepted profile values', () => {
  const ui = presentation('es')
  const profile = { name: 'English customer profile', description: 'Keep this description verbatim', kind: 'retention', settings: structuredClone(policies.defaults.retention) }
  const serialized = JSON.stringify({ schemaVersion: 1, profile })
  assert.deepEqual(ui.decodeProfileImport(serialized), profile)
  assert.throws(() => ui.decodeProfileImport('{'), /JSON/)
  assert.throws(() => ui.decodeProfileImport('{'), error => error.message !== 'This file is not valid JSON. Choose an exported policy profile.')
  assert.throws(() => ui.decodeProfileImport('{}'), error => !error.message.includes('Invalid input') && !error.message.includes('schemaVersion'))
  assert.equal(ui.fieldLabel('retention.syntheticDays.0'), ui.fieldLabel('retention.quantity'))
  assert.notEqual(ui.fieldLabel('retention.syntheticDays.0'), 'retention › syntheticDays › 0')
  assert.deepEqual(JSON.parse(serialized).profile, profile)
})

test('policy summaries use each selected locale and do not translate unknown source values', () => {
  const english = presentation('en').summary('retention', policies.defaults.retention)
  for (const locale of ['es', 'de', 'fr', 'it', 'pt-BR', 'ru', 'zh-CN', 'ja', 'ko', 'hi']) {
    const ui = presentation(locale)
    assert.notEqual(ui.summary('retention', policies.defaults.retention), english, locale)
    assert.equal(ui.enumText('Customer backup East'), 'Customer backup East')
    assert.equal(ui.enumText('UnrecognizedVendorEnum'), 'UnrecognizedVendorEnum')
  }
})
