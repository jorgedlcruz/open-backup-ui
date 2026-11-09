// Open Backup UI v1.0.2
import type { Box } from './layout'

/** Fit the occupied composition, including portrait/tall layouts, without distortion.
 * Outer padding stays in screen pixels; gaps inside the composition scale with it.
 * The published widget geometry is never modified.
 */
export function fitKioskToScreen(widgets: Box[], viewport: { width: number; height: number }, gap: number) {
  const width = Math.max(0, viewport.width), height = Math.max(0, viewport.height)
  const padding = Math.max(0, Math.min(gap, width / 4, height / 4))
  const x = widgets.length ? Math.min(...widgets.map(w => w.x)) : 0
  const y = widgets.length ? Math.min(...widgets.map(w => w.y)) : 0
  const contentWidth = widgets.length ? Math.max(...widgets.map(w => w.x + w.w)) - x : 1
  const contentHeight = widgets.length ? Math.max(...widgets.map(w => w.y + w.h)) - y : 1
  const scale = Math.min((width - 2 * padding) / Math.max(1, contentWidth), (height - 2 * padding) / Math.max(1, contentHeight))
  return { x, y, width: contentWidth, height: contentHeight, scale,
    left: (width - contentWidth * scale) / 2, top: (height - contentHeight * scale) / 2 }
}

/** Read-only TV arrangement: use the screen's aspect ratio, preserve reading order,
 * and share leftover space across the last row. Gutters remain screen pixels.
 */
export function tileKioskToScreen(widgets: Box[], viewport: { width: number; height: number }, gap: number) {
  const width = Math.max(1, viewport.width), height = Math.max(1, viewport.height), count = widgets.length
  const padding = Math.max(0, Math.min(gap, width / 4, height / 4))
  if (!count) return { width, height, scale: 1, left: 0, top: 0, widgets: [] as Box[] }
  const ratios = widgets.map(w => w.w / Math.max(1, w.h)).sort((a, b) => a - b)
  const preferredRatio = Math.max(1, Math.min(2.4, ratios[Math.floor(count / 2)]))
  let columns = 1, best = Infinity
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols), cellWidth = (width - padding * (cols + 1)) / cols, cellHeight = (height - padding * (rows + 1)) / rows
    if (cellWidth <= 0 || cellHeight <= 0) continue
    const score = Math.abs(Math.log(cellWidth / cellHeight / preferredRatio)) + (rows * cols - count) / count * .2
    if (score < best) { columns = cols; best = score }
  }
  const rows = Math.ceil(count / columns)
  // Very small viewports still retain a positive drawing area and visible gutters.
  const gutter = Math.min(padding, width / (columns * 2 + 1), height / (rows * 2 + 1))
  const cellHeight = (height - gutter * (rows + 1)) / rows
  const cellWidth = (width - gutter * (columns + 1)) / columns
  const comfortableScale = Math.max(1, Math.min(cellWidth / 600, cellHeight / 400))
  const scale = Math.min(comfortableScale, cellWidth / 240, cellHeight / 200)
  const placements: Box[] = []
  widgets.map((widget, index) => ({ widget, index })).sort((a, b) => a.widget.y - b.widget.y || a.widget.x - b.widget.x || a.index - b.index).forEach(({ index }, order) => {
    const row = Math.floor(order / columns), col = order % columns, rowCount = Math.min(columns, count - row * columns)
    const w = (width - gutter * (rowCount + 1)) / rowCount
    placements[index] = { x: (gutter + col * (w + gutter)) / scale, y: (gutter + row * (cellHeight + gutter)) / scale, w: w / scale, h: cellHeight / scale }
  })
  return { width: width / scale, height: height / scale, scale, left: 0, top: 0, widgets: placements }
}
