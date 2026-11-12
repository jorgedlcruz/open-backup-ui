// Open Backup UI v1.2.0
export const CANVAS_WIDTH = 1440
export const CANVAS_HEIGHT = 2400
export const MAX_CANVAS_HEIGHT = 100000
export const GRID = 20
export type Box = { x: number; y: number; w: number; h: number }
export type Guide = { axis: 'x' | 'y'; position: number }
const snap = (v: number) => Math.round(v / GRID) * GRID
export function boundedBox(box: Box, gap: number): Box {
  const w = Math.max(240, Math.min(CANVAS_WIDTH - gap * 2, snap(box.w))), h = Math.max(200, Math.min(CANVAS_HEIGHT, snap(box.h)))
  return { x: Math.max(gap, Math.min(CANVAS_WIDTH - gap - w, snap(box.x))), y: Math.max(gap, Math.min(MAX_CANVAS_HEIGHT - gap - h, snap(box.y))), w, h }
}
export function overlaps(a: Box, b: Box, gap: number) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}
export function canPlace(box: Box, others: Box[], gap: number) {
  return box.x >= gap && box.y >= gap && box.x + box.w <= CANVAS_WIDTH - gap && box.y + box.h <= MAX_CANVAS_HEIGHT - gap && !others.some(other => overlaps(box, other, gap))
}
/** Nearest free slot, with stable tie-breaking. Existing widgets are never pushed. */
export function placeBox(requested: Box, others: Box[], gap = 20): Box {
  const box = boundedBox(requested, gap)
  if (canPlace(box, others, gap)) return box
  const xs = [...new Set([box.x, gap, CANVAS_WIDTH - gap - box.w, ...others.flatMap(o => [o.x, o.x + o.w - box.w, o.x + o.w + gap, o.x - box.w - gap])])].filter(x => x >= gap && x + box.w <= CANVAS_WIDTH - gap)
  const ys = [...new Set([box.y, gap, ...others.flatMap(o => [o.y, o.y + o.h - box.h, o.y + o.h + gap, o.y - box.h - gap])])].filter(y => y >= gap && y + box.h <= MAX_CANVAS_HEIGHT - gap)
  let best: Box | null = null, distance = Infinity
  for (const y of ys) for (const x of xs) {
    const score = (x - box.x) ** 2 + (y - box.y) ** 2
    if (score > distance || !canPlace({ ...box, x, y }, others, gap)) continue
    if (score === distance && best && (y > best.y || y === best.y && x >= best.x)) continue
    best = { ...box, x, y }; distance = score
  }
  if (!best) throw new Error('There is no free space for this widget.')
  return best
}
/** Sticky edges and equal gutters engage close to a neighbour, at any zoom. */
export function magnetBox(requested: Box, others: Box[], gap: number, threshold = 14, avoidCollisions = true) {
  let box = boundedBox(requested, gap)
  const nearest = (value: number, anchors: number[]) => anchors.reduce((best, v) => Math.abs(value - v) < Math.abs(value - best) ? v : best, value + threshold + 1)
  const x = nearest(box.x, [gap, CANVAS_WIDTH - gap - box.w, ...others.flatMap(o => [o.x, o.x + o.w - box.w, o.x + o.w + gap, o.x - box.w - gap])])
  const y = nearest(box.y, [gap, ...others.flatMap(o => [o.y, o.y + o.h - box.h, o.y + o.h + gap, o.y - box.h - gap])])
  if (Math.abs(x - box.x) <= threshold) box.x = x
  if (Math.abs(y - box.y) <= threshold) box.y = y
  box = avoidCollisions ? placeBox(box, others, gap) : boundedBox(box, gap)
  const guides: Guide[] = []
  for (const other of others) {
    if (box.x === other.x) guides.push({ axis: 'x', position: box.x })
    if (box.y === other.y) guides.push({ axis: 'y', position: box.y })
    if (box.x + box.w === other.x + other.w) guides.push({ axis: 'x', position: box.x + box.w })
    if (box.y + box.h === other.y + other.h) guides.push({ axis: 'y', position: box.y + box.h })
  }
  return { box, guides }
}
type Direction = 'right' | 'down' | 'left' | 'up'
/** Keep the edited widget anchored; move its neighbours, then their neighbours.
 * Resolve from the gesture's original layout on every frame, so shrinking back
 * restores displaced cards without drift. Stable ordering prevents oscillation. */
export function repelLayout<T extends Box & { id: string }>(widgets: T[], id: string, requested: Box, gap: number, mode: 'move' | 'resize' = 'move'): T[] {
  const original = widgets.find(w => w.id === id)
  if (!original) return widgets
  let box = boundedBox(requested, gap)
  if (mode === 'resize') box = { ...box, x: original.x, y: original.y, w: Math.min(box.w, CANVAS_WIDTH - gap - original.x), h: Math.min(box.h, MAX_CANVAS_HEIGHT - gap - original.y) }
  const active = { ...original, ...box }, originals = new Map(widgets.map(w => [w.id, w]))
  const settled: T[] = [active]
  const direction = (item: Box, blocker: Box): Direction => {
    if (item.x >= blocker.x + blocker.w + gap) return 'right'
    if (item.x + item.w + gap <= blocker.x) return 'left'
    if (item.y >= blocker.y + blocker.h + gap) return 'down'
    if (item.y + item.h + gap <= blocker.y) return 'up'
    return 'down'
  }
  const slide = (item: T, toward: Direction): T | null => {
    const next = { ...item }
    for (let step = 0; step <= settled.length; step++) {
      const blockers = settled.filter(other => overlaps(next, other, gap))
      if (!blockers.length) return canPlace(next, [], gap) ? next : null
      if (toward === 'right') next.x = Math.max(...blockers.map(w => w.x + w.w + gap))
      if (toward === 'left') next.x = Math.min(...blockers.map(w => w.x - next.w - gap))
      if (toward === 'down') next.y = Math.max(...blockers.map(w => w.y + w.h + gap))
      if (toward === 'up') next.y = Math.min(...blockers.map(w => w.y - next.h - gap))
      if (!canPlace(next, [], gap)) return null
    }
    return null
  }
  const pending = widgets.filter(w => w.id !== id).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  for (const item of pending) {
    const blockers = settled.filter(other => overlaps(item, other, gap))
    if (!blockers.length) { settled.push(item); continue }
    const primary = blockers.find(w => w.id === id) ?? blockers[0]
    const preferred = direction(item, originals.get(primary.id)!)
    const directions = [...new Set<Direction>([preferred, 'down', 'right', 'left', 'up'])]
    let moved: T | null = null
    for (const direction of directions) { moved = slide(item, direction); if (moved) break }
    moved ??= { ...item, ...placeBox(item, settled, gap) }
    settled.push(moved)
  }
  const positions = new Map(settled.map(w => [w.id, w]))
  return widgets.map(w => positions.get(w.id)!)
}
export function normalizeLayout<T extends Box>(widgets: T[], gap: number): T[] {
  const placed: T[] = []
  for (const widget of widgets) placed.push({ ...widget, ...placeBox(widget, placed, gap) })
  return placed
}
export function tidyLayout<T extends Box>(widgets: T[], gap: number): T[] {
  let x = gap, y = gap, rowHeight = 0
  return [...widgets].sort((a, b) => a.y - b.y || a.x - b.x).map(widget => {
    const box = boundedBox(widget, gap)
    if (x + box.w > CANVAS_WIDTH - gap) { x = gap; y += rowHeight + gap; rowHeight = 0 }
    const placed = { ...widget, ...box, x, y }
    if (y + box.h > MAX_CANVAS_HEIGHT - gap) throw new Error('There is no free space for this widget.')
    x += box.w + gap; rowHeight = Math.max(rowHeight, box.h)
    return placed
  })
}
export const canvasHeight = (widgets: Box[], gap: number) => Math.max(CANVAS_HEIGHT, ...widgets.map(w => Math.min(MAX_CANVAS_HEIGHT, w.y + w.h + gap * 2 + 200)))
