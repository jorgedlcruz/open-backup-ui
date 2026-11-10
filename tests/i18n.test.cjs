// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { LOCALES, normalizeLocale, normalizePreference, detectLocale, resolveLocale, translate } = require('../lib/i18n/model.ts')
const { enumLabel } = require('../lib/i18n/presentation.ts')

test('Spanish presentation translates job and inventory enums without changing model values or unknown diagnostics', () => {
  const messages = require('../lib/i18n/messages/es.json')
  const t = (source, values) => translate(messages, source, values)
  const row = { status: 'Stopped', type: 'FileBackup', name: 'Success', providerMessage: 'Vendor status 8442' }
  const before = JSON.stringify(row)
  assert.equal(enumLabel(t, row.status), 'Detenido')
  assert.equal(enumLabel(t, row.type), messages['File backup'])
  assert.notEqual(enumLabel(t, row.type), row.type)
  assert.equal(enumLabel(t, 'PoweredOff'), messages.Stopped)
  assert.equal(enumLabel(t, 'VirtualMachine'), messages['Virtual machine'])
  assert.equal(enumLabel(t, row.providerMessage), row.providerMessage)
  assert.equal(enumLabel(t, 'FutureProviderState'), 'FutureProviderState')
  assert.equal(JSON.stringify(row), before)
})

test('browser language negotiation honors quality, regional variants, exclusions, and unsupported fallbacks', () => {
  assert.equal(detectLocale('fr-CA;q=0.7,de-DE;q=0.9,en;q=0.5'), 'de')
  assert.equal(detectLocale('fr;q=0,ja;q=0.8'), 'ja')
  assert.equal(detectLocale('es;q=invalid,ru;q=0.5'), 'ru')
  assert.equal(detectLocale(['pt-PT', 'en']), 'pt-BR')
  assert.equal(detectLocale(['zh-Hans-SG']), 'zh-CN')
  assert.equal(detectLocale('xx;q=1,*;q=0.5'), 'en')
  assert.equal(detectLocale(null), 'en')
  assert.equal(normalizeLocale('DE_de'), 'de')
})

test('the explicit cookie preference wins over browser language and malformed input is never persisted as a locale', () => {
  assert.equal(resolveLocale('es', 'de-DE'), 'es')
  assert.equal(resolveLocale('auto', 'de-DE'), 'de')
  assert.equal(resolveLocale('unknown', 'ru-RU'), 'ru')
  for (const invalid of ['es; Secure', '../en', '<script>', '', undefined, {}, ['de']]) assert.equal(normalizePreference(invalid), 'auto')
  for (const { code } of LOCALES) assert.equal(normalizePreference(code), code)
})

test('missing translations retain English and interpolation treats supplied values as literal data', () => {
  const messages = { 'Connect to {name}': 'Mit {name} verbinden', 'Empty': '' }
  assert.equal(translate(messages, 'Unknown UI label'), 'Unknown UI label')
  assert.equal(translate(messages, 'Empty'), 'Empty')
  assert.equal(translate(messages, 'Connect to {name}', { name: 'VM {other} $& <b>' }), 'Mit VM {other} $& <b> verbinden')
  assert.equal(translate(messages, 'Connect to {name}'), 'Mit {name} verbinden')
  assert.equal(translate(messages, '{count}', { count: 0 }), '0')
  assert.equal(translate(messages, 'toString'), 'toString')
})

test('every shipped language has the complete English catalog and preserves interpolation names', () => {
  const folder = path.join(__dirname, '../lib/i18n/messages')
  const english = JSON.parse(fs.readFileSync(path.join(folder, 'en.json'), 'utf8'))
  const keys = Object.keys(english).sort()
  assert.ok(keys.length > 100, 'Core interface translations should be bundled, not downloaded at runtime')
  const placeholders = value => [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match => match[1]).sort()
  for (const { code } of LOCALES) {
    const catalog = JSON.parse(fs.readFileSync(path.join(folder, `${code}.json`), 'utf8'))
    assert.deepEqual(Object.keys(catalog).sort(), keys, `${code} key coverage`)
    for (const key of keys) {
      assert.equal(typeof catalog[key], 'string', `${code}: ${key}`)
      assert.ok(catalog[key].trim(), `${code}: ${key} must not be empty`)
      assert.deepEqual(placeholders(catalog[key]), placeholders(key), `${code}: ${key} placeholders`)
    }
  }
})
