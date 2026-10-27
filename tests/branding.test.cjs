/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_THEME, normalizeTheme, normalizeHex, colorForeground, themeOverrides, THEME_COOKIES } = require('../lib/themes.ts')

test('existing saved appearance survives migration without inventing overrides', () => {
  const old = { preset: 'operations', radius: 'lg', scale: 'sm', contentLayout: 'centered' }
  assert.deepEqual(normalizeTheme(old), { ...DEFAULT_THEME, ...old })
  assert.deepEqual(themeOverrides(old), {})
})
test('missing and malformed preferences safely resolve to defaults', () => {
  for (const input of [undefined, null, 1, [], {}, { preset: 'missing', font: 'url(example)', radius: ';color:red', scale: 'huge', contentLayout: 'other' }]) {
    assert.deepEqual(normalizeTheme(input), DEFAULT_THEME)
  }
})
test('only opaque hex colors are accepted, including short notation', () => {
  assert.equal(normalizeHex(' #AbC '), '#aabbcc')
  assert.equal(normalizeHex('#6C80F5'), '#6c80f5')
  for (const color of [null, 0, '#', '#12', '#00000000', 'red', 'transparent', 'var(--danger)', '#fff;display:none', 'url(https://example.test)']) assert.equal(normalizeHex(color), '')
})
test('saved preferences round-trip through the same cookie fields used by server rendering', () => {
  const selected = normalizeTheme({ preset: 'rose-garden', scale: 'lg', radius: 'none', font: 'manrope', accentColor: '#abcdef', chartColor: '#112233', contentLayout: 'centered' })
  const cookies = new Map(Object.entries(THEME_COOKIES).map(([key, cookie]) => [cookie, selected[key]]))
  const restored = normalizeTheme(Object.fromEntries(Object.entries(THEME_COOKIES).map(([key, cookie]) => [key, cookies.get(cookie)])))
  assert.deepEqual(restored, selected)
  assert.deepEqual(themeOverrides(restored), themeOverrides(selected))
})
test('brand and generic chart accents never overwrite operational result colors', () => {
  const styles = themeOverrides({ accentColor: '#c59af2', chartColor: '#ff8800' })
  assert.equal(styles['--primary'], '#c59af2')
  assert.equal(styles['--chart-2'], '#ff8800')
  for (const semantic of ['--destructive', '--ops-success', '--ops-warning', '--ops-danger', '--ops-active', '--ops-chart-success', '--ops-chart-warning', '--ops-chart-danger', '--ops-chart-active']) assert.equal(styles[semantic], undefined)
})
test('solid brand controls always receive a readable foreground', () => {
  function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    return .2126 * r + .7152 * g + .0722 * b
  }
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const color = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    const a = luminance(color), f = luminance(colorForeground(color))
    assert.ok((Math.max(a, f) + .05) / (Math.min(a, f) + .05) >= 4.5, color)
  }
})
test('reset removes custom font and color declarations so presets regain control', () => {
  const custom = normalizeTheme({ preset: 'operations', font: 'roboto', accentColor: '#fff', chartColor: '#000' })
  assert.ok(Object.keys(themeOverrides(custom)).length > 0)
  assert.deepEqual(themeOverrides(DEFAULT_THEME), {})
  assert.equal(themeOverrides({ ...custom, font: 'preset', accentColor: '', chartColor: '' })['--text-family'], undefined)
})

test('glass presets round-trip with existing appearance controls and reset cleanly', () => {
  for (const preset of ['glass-ocean', 'glass-forest', 'glass-aurora']) {
    const selected = normalizeTheme({ preset, font: 'manrope', scale: 'sm', radius: 'none', contentLayout: 'centered', accentColor: '#ffa', chartColor: '#123' })
    assert.equal(selected.preset, preset)
    assert.equal(selected.radius, 'none')
    assert.equal(selected.accentColor, '#ffffaa')
    const cookies = new Map(Object.entries(THEME_COOKIES).map(([key, cookie]) => [cookie, selected[key]]))
    const restored = normalizeTheme(Object.fromEntries(Object.entries(THEME_COOKIES).map(([key, cookie]) => [key, cookies.get(cookie)])))
    assert.deepEqual(restored, selected)
    assert.equal(themeOverrides(restored)['--primary'], '#ffffaa')
    assert.equal(themeOverrides(restored)['--ops-success'], undefined)
    assert.deepEqual(themeOverrides({ ...restored, font: 'preset', accentColor: '', chartColor: '' }), {})
  }
})
