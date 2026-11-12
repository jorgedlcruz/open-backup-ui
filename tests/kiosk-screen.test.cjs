// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict'), { test } = require('node:test')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file)
const { fitKioskToScreen, tileKioskToScreen } = require('../lib/labs/screen-layout.ts')
const box = (x, y, w = 600, h = 400) => ({ x, y, w, h })
const screenBox = (widget, fit) => ({ x: fit.left + (widget.x - fit.x) * fit.scale, y: fit.top + (widget.y - fit.y) * fit.scale, w: widget.w * fit.scale, h: widget.h * fit.scale })
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`)

test('TV fit includes every widget on landscape, portrait and 4K screens without overlap or clipping', () => {
  const widgets = [box(20, 20), box(640, 20, 540), box(20, 440, 600, 320), box(640, 440, 540, 320), box(20, 780, 1160, 660)]
  const original = JSON.stringify(widgets)
  for (const size of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }, { width: 1080, height: 1920 }, { width: 600, height: 900 }]) {
    const fit = fitKioskToScreen(widgets, size, 20), projected = widgets.map(w => screenBox(w, fit))
    for (const w of projected) {
      assert.ok(w.x >= 20 - 1e-8 && w.y >= 20 - 1e-8)
      assert.ok(w.x + w.w <= size.width - 20 + 1e-8 && w.y + w.h <= size.height - 20 + 1e-8)
    }
    close(projected[1].x - projected[0].x - projected[0].w, 20 * fit.scale)
    close(projected[2].y - projected[0].y - projected[0].h, 20 * fit.scale)
    close(projected[4].y - projected[2].y - projected[2].h, 20 * fit.scale)
    close(projected[0].w / projected[0].h, widgets[0].w / widgets[0].h)
  }
  assert.equal(JSON.stringify(widgets), original)
})

test('unused canvas margins do not make a single widget needlessly small on a TV', () => {
  const widgets = [box(780, 10000, 600, 400)], fit = fitKioskToScreen(widgets, { width: 3840, height: 2160 }, 40)
  const projected = screenBox(widgets[0], fit)
  assert.ok(fit.scale > 1); close(projected.y, 40); close(projected.h, 2080)
  close(projected.x, (3840 - projected.w) / 2)
})

test('a resized display refits both dimensions and preserves deliberately wider gutters', () => {
  const widgets = [box(80, 80, 560, 360), box(720, 80, 560, 360)]
  for (const size of [{ width: 1920, height: 400 }, { width: 640, height: 1080 }]) {
    const fit = fitKioskToScreen(widgets, size, 80), a = screenBox(widgets[0], fit), b = screenBox(widgets[1], fit)
    close(b.x - a.x - a.w, 80 * fit.scale)
    assert.ok(a.x >= 80 - 1e-8 && a.y >= 80 - 1e-8)
    close(a.y, (size.height - a.h) / 2)
  }
})

test('empty kiosks and a temporarily unmeasured viewport never produce invalid transforms', () => {
  for (const widgets of [[], [box(20, 20)]]) for (const size of [{ width: 0, height: 0 }, { width: 16, height: 8 }, { width: 1920, height: 1080 }]) {
    const fit = fitKioskToScreen(widgets, size, 80)
    assert.ok(Object.values(fit).every(Number.isFinite)); assert.ok(fit.scale >= 0)
    assert.ok(fit.left >= 0 && fit.top >= 0)
  }
})

test('a newly published lower widget is fitted instead of falling below the screen', () => {
  const widgets = [box(20, 20)], size = { width: 1920, height: 1080 }, before = fitKioskToScreen(widgets, size, 20)
  widgets.push(box(20, 8000))
  const after = fitKioskToScreen(widgets, size, 20), bottom = screenBox(widgets[1], after)
  assert.ok(after.scale < before.scale); close(bottom.y + bottom.h, 1060)
})

test('automatic TV arrangement fills landscape and portrait displays with exact screen gutters', () => {
  for (const count of [1, 5, 10, 40]) for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }, { width: 1080, height: 1920 }, { width: 600, height: 900 }]) {
    const widgets = Array.from({ length: count }, (_, i) => box(i % 2 * 620 + 20, Math.floor(i / 2) * 420 + 20)), original = JSON.stringify(widgets)
    const result = tileKioskToScreen(widgets, viewport, 20)
    const visible = result.widgets.map(w => ({ x: w.x * result.scale, y: w.y * result.scale, w: w.w * result.scale, h: w.h * result.scale }))
    assert.equal(result.widgets.length, count)
    for (const w of visible) {
      assert.ok(w.x >= 20 - 1e-8 && w.y >= 20 - 1e-8)
      assert.ok(w.x + w.w <= viewport.width - 20 + 1e-8 && w.y + w.h <= viewport.height - 20 + 1e-8)
    }
    for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) {
      const first = visible[a], second = visible[b]
      assert.ok(first.x + first.w + 20 <= second.x + 1e-8 || second.x + second.w + 20 <= first.x + 1e-8 || first.y + first.h + 20 <= second.y + 1e-8 || second.y + second.h + 20 <= first.y + 1e-8)
    }
    close(visible[0].x, 20); close(visible[0].y, 20)
    close(visible.at(-1).x + visible.at(-1).w, viewport.width - 20)
    close(visible.at(-1).y + visible.at(-1).h, viewport.height - 20)
    assert.equal(JSON.stringify(widgets), original)
  }
})

test('TV tiles retain visual reading order instead of creation order and enlarge typography on 4K', () => {
  const widgets = [box(20, 440), box(640, 20), box(20, 20)]
  const hd = tileKioskToScreen(widgets, { width: 1920, height: 1080 }, 40), uhd = tileKioskToScreen(widgets, { width: 3840, height: 2160 }, 40)
  const order = hd.widgets.map((w, index) => ({ w, index })).sort((a, b) => a.w.y - b.w.y || a.w.x - b.w.x).map(item => item.index)
  assert.deepEqual(order, [2, 1, 0]); assert.ok(uhd.scale > hd.scale)
  for (const size of [{ width: 0, height: 0 }, { width: 8, height: 8 }]) for (const list of [[], widgets]) {
    const fit = tileKioskToScreen(list, size, 80)
    assert.ok(Number.isFinite(fit.scale) && fit.scale > 0)
    assert.ok(fit.widgets.every(w => Object.values(w).every(Number.isFinite) && w.w > 0 && w.h > 0))
  }
})
