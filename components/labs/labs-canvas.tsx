'use client'
// Open Backup UI v1.0.2

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, ArrowUpRight, Check, Copy, FlaskConical, Hand, LayoutGrid, LockKeyhole, Magnet, Maximize, MousePointer2, Plus, Redo2, RefreshCw, Share2, SlidersHorizontal, Trash2, Undo2, Unlock, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/components/providers/i18n-provider'
import { dataKey, loadDatasets, type DatasetRequest } from '@/lib/labs/data'
import { CANVAS_WIDTH, createWidget, newWidgetId, emptyBoard, parseBoard, sources, views, type Board, type Dataset, type SourceId, type Widget } from '@/lib/labs/model'
import { boundedBox, canvasHeight, magnetBox, normalizeLayout, placeBox, repelLayout, tidyLayout, type Guide } from '@/lib/labs/layout'
import { WidgetInspector } from './widget-inspector'
import { WidgetView } from './widget-view'
import { ShareDialog } from './share-dialog'
import { RefreshControls } from './refresh-controls'
import { SourceIcon, ViewIcon } from './icons'
import styles from './labs.module.css'

type Box = Pick<Widget, 'x' | 'y' | 'w' | 'h'>
type Gesture = { kind: 'draw' | 'move' | 'resize' | 'pan'; x: number; y: number; original: Box; widget?: Widget; pointer: number }
export function LabsCanvas({ sourceScope }: { sourceScope: string }) {
  const { t } = useI18n()
  const [board, setBoard] = useState<Board>(emptyBoard), [ready, setReady] = useState(false), [saveState, setSaveState] = useState('Loading canvas…')
  const [selected, setSelected] = useState<string | null>(null), [inspector, setInspector] = useState(false)
  const [box, setBox] = useState<Box | null>(null), [source, setSource] = useState<SourceId | null>(null), [chooser, setChooser] = useState(false)
  const [gesture, setGesture] = useState<Gesture | null>(null), [draft, setDraft] = useState<Box | null>(null), [mode, setMode] = useState<'draw' | 'pan'>('draw')
  const [guides, setGuides] = useState<Guide[]>([])
  const [draftWidgets, setDraftWidgets] = useState<Widget[] | null>(null)
  const [datasets, setDatasets] = useState<Record<string, Dataset | Error>>({}), [refresh, setRefresh] = useState(0), [refreshing, setRefreshing] = useState(false), [sharing, setSharing] = useState(false)
  const datasetScope = useRef(sourceScope)
  const [notice, setNotice] = useState(''), [zoom, setZoom] = useState(1), [fit, setFit] = useState(.7)
  const [history, setHistory] = useState<{ past: Board[]; future: Board[] }>({ past: [], future: [] })
  const boardRef = useRef(board), stage = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null)
  const storageKey = `open-backup-ui:labs:v1:${sourceScope}`
  const canSave = useRef(true)
  const scale = zoom
  const gap = board.layout.gap, locked = board.layout.locked
  const visibleWidgets = draftWidgets ?? board.widgets
  const stageHeight = canvasHeight(draft ? [...visibleWidgets, draft] : visibleWidgets, gap)
  boardRef.current = board
  const commit = useCallback((next: Board) => {
    const previous = boardRef.current
    if (JSON.stringify(next) === JSON.stringify(previous)) return
    setHistory(h => ({ past: [...h.past.slice(-49), previous], future: [] })); setBoard(next)
  }, [])
  const update = (id: string, patch: Partial<Widget>) => {
    const widget = board.widgets.find(w => w.id === id)
    if (!widget) return
    const { x, y, w, h, ...configuration } = patch
    const geometry = [x, y, w, h].some(v => v !== undefined)
    const requested = { x: x ?? widget.x, y: y ?? widget.y, w: w ?? widget.w, h: h ?? widget.h }
    try {
      const widgets = geometry && !locked ? repelLayout(board.widgets, id, requested, gap, x !== undefined || y !== undefined ? 'move' : 'resize') : board.widgets
      commit({ ...board, widgets: widgets.map(w => w.id === id ? { ...w, ...configuration } : w) })
    } catch (error) { setNotice(error instanceof Error ? error.message : 'There is no free space for this widget.') }
  }
  function undo() {
    setGesture(null); setDraft(null); setDraftWidgets(null); setGuides([])
    const previous = history.past.at(-1); if (!previous) return
    setHistory({ past: history.past.slice(0, -1), future: [board, ...history.future] }); setBoard(previous)
  }
  function redo() {
    setGesture(null); setDraft(null); setDraftWidgets(null); setGuides([])
    const next = history.future[0]; if (!next) return
    setHistory({ past: [...history.past, board], future: history.future.slice(1) }); setBoard(next)
  }
  useEffect(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) setBoard(parseBoard(raw)) }
    catch { canSave.current = false; setNotice('The saved canvas could not be read. Export or import a canvas before replacing the stored copy.'); setSaveState('Local save unavailable') }
    setReady(true)
  }, [storageKey])
  useEffect(() => {
    if (!ready || !canSave.current) return
    setSaveState('Saving…')
    const timer = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(board)); setSaveState('Saved in this browser') }
      catch { setSaveState('Not saved · browser storage unavailable'); setNotice('Your canvas could not be saved locally. Export it to keep your work.') }
    }, 450)
    return () => clearTimeout(timer)
  }, [board, ready, storageKey])
  useEffect(() => {
    if (!ready) return
    const flush = () => {
      if (!canSave.current) return
      try { localStorage.setItem(storageKey, JSON.stringify(boardRef.current)) }
      catch { /* The visible save status and export path handle storage failures. */ }
    }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [ready, storageKey])
  useEffect(() => {
    const element = viewport.current; if (!element) return
    const observer = new ResizeObserver(entries => setFit(Math.max(.2, (entries[0].contentRect.width - 32) / CANVAS_WIDTH)))
    observer.observe(element); return () => observer.disconnect()
  }, [ready])
  const requestKey = JSON.stringify([...new Map(board.widgets.map(w => [dataKey(w), { source: w.source, range: w.range, repositoryId: w.repositoryId, forecastMode: w.forecastMode, horizon: w.horizon }])).values()])
  useEffect(() => {
    const requests = JSON.parse(requestKey) as DatasetRequest[]
    if (!requests.length) { setDatasets({}); setRefreshing(false); return }
    const controller = new AbortController()
    // Keep dated readings on screen during refresh, but never across source changes.
    const sameSource = datasetScope.current === sourceScope
    datasetScope.current = sourceScope
    setDatasets(current => sameSource ? Object.fromEntries(requests.map(r => [dataKey(r), current[dataKey(r)]]).filter(([, value]) => value)) : {}); setRefreshing(true)
    loadDatasets(requests, controller.signal, (key, value) => { if (!controller.signal.aborted) setDatasets(current => ({ ...current, [key]: value })) })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false) })
    return () => controller.abort()
  }, [requestKey, refresh, sourceScope])
  useEffect(() => {
    if (!board.refresh.enabled) return
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !refreshing) setRefresh(r => r + 1) }, board.refresh.seconds * 1000)
    return () => clearInterval(timer)
  }, [board.refresh, refreshing])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return
      if (event.key === 'Escape') { setGesture(null); setDraft(null); setDraftWidgets(null); setGuides([]); setInspector(false) }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  })
  function point(event: PointerEvent) {
    const rect = stage.current!.getBoundingClientRect()
    return { x: Math.max(0, Math.min(CANVAS_WIDTH, (event.clientX - rect.left) / scale)), y: Math.max(0, Math.min(stageHeight, (event.clientY - rect.top) / scale)) }
  }
  function start(event: PointerEvent<HTMLDivElement>, kind: Gesture['kind'], widget?: Widget) {
    if (event.button !== 0 || chooser) return
    if (locked && kind !== 'pan') return
    if (kind === 'draw' && (event.target as HTMLElement).closest('button,input,a,[data-widget]')) return
    if (kind !== 'pan' && board.widgets.length >= 40 && kind === 'draw') { setNotice('A canvas supports up to 40 widgets.'); return }
    event.preventDefault(); event.stopPropagation(); stage.current!.setPointerCapture(event.pointerId)
    const p = point(event)
    setGesture({ kind, ...p, original: widget ?? { ...p, w: 0, h: 0 }, widget, pointer: event.pointerId }); setDraft(null); setDraftWidgets(null)
    if (widget) setSelected(widget.id)
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!gesture) return
    if (gesture.kind === 'pan') { if (viewport.current) { viewport.current.scrollLeft -= event.movementX; viewport.current.scrollTop -= event.movementY }; return }
    const p = point(event), dx = p.x - gesture.x, dy = p.y - gesture.y, original = gesture.original
    const others = board.widgets.filter(w => w.id !== gesture.widget?.id)
    if (gesture.kind === 'draw') setDraft({ x: Math.min(p.x, gesture.x), y: Math.min(p.y, gesture.y), w: Math.abs(dx), h: Math.abs(dy) })
    else if (gesture.widget) {
      try {
        const result = gesture.kind === 'move' ? magnetBox({ ...original, x: original.x + dx, y: original.y + dy }, others, gap, 24 / scale, false) : { box: { ...original, w: original.w + dx, h: original.h + dy }, guides: [] }
        const widgets = repelLayout(board.widgets, gesture.widget.id, result.box, gap, gesture.kind === 'resize' ? 'resize' : 'move')
        setDraft(widgets.find(w => w.id === gesture.widget!.id)!); setDraftWidgets(widgets); setGuides(result.guides)
      } catch { /* Keep the last valid preview at the finite canvas boundary. */ }
    }
  }
  function end() {
    if (!gesture) return
    if (stage.current?.hasPointerCapture(gesture.pointer)) stage.current.releasePointerCapture(gesture.pointer)
    if (draft && gesture.kind === 'draw' && draft.w > 15 && draft.h > 15) { setBox(boundedBox(draft, gap)); setSource(null); setChooser(true) }
    else if (draftWidgets && gesture.widget) commit({ ...board, widgets: draftWidgets })
    setGesture(null); setDraft(null); setDraftWidgets(null); setGuides([])
  }
  function add() {
    if (locked) return
    if (board.widgets.length >= 40) { setNotice('A canvas supports up to 40 widgets.'); return }
    setBox(placeBox({ x: gap, y: gap, w: 600, h: 400 }, board.widgets, gap)); setSource(null); setChooser(true)
  }
  function create(view: Widget['view']) {
    if (!source || !box) return
    const widget = createWidget(source, view, box, newWidgetId())
    try { commit({ ...board, widgets: repelLayout([...board.widgets, widget], widget.id, box, gap) }) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'There is no free space for this widget.'); return }
    setChooser(false); setSelected(widget.id); setInspector(true)
    if (viewport.current) viewport.current.scrollTop = Math.max(0, box.y * scale - 40)
  }
  function exportBoard() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' })), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${board.name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'labs'}-canvas.json`; anchor.click(); URL.revokeObjectURL(url)
  }
  async function importBoard(upload?: File) {
    if (!upload) return
    try {
      if (upload.size > 500000) throw new Error('This canvas file is too large.')
      const imported = parseBoard(await upload.text()); canSave.current = true; commit(imported); setSelected(null); setInspector(false); setNotice('Canvas imported. Undo restores your previous layout.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'This canvas could not be imported.') }
    if (file.current) file.current.value = ''
  }
  const current = board.widgets.find(w => w.id === selected)
  const iconButton = (label: string, icon: React.ReactNode, action: () => void, disabled = false) => <button className={styles.iconButton} title={t(label)} aria-label={t(label)} onClick={action} disabled={disabled}>{icon}</button>
  if (!ready) return <div className={styles.loadingPage} role="status">{t('Opening your atelier…')}</div>
  return <div className={styles.labs}>
    <header className={styles.masthead}>
      <div><div className={styles.eyebrow}><FlaskConical size={14} />{t('LABS')}<span />{t('YOUR DATA, WITH INTENTION')}</div><h1>{t('Kiosk')} <em>{t('Builder.')}</em></h1><p>{t('Compose a living view of your backup world. Every name, every measure, exactly where it belongs.')}</p></div>
      <div className={styles.mastheadEnd}><span className={styles.edition}>EXPERIMENT № 001</span><div className={styles.orbitMark} aria-hidden="true"><i /><i /><i /><b /></div></div>
    </header>
    <div className={styles.boardBar}>
      <div className={styles.boardIdentity}><input aria-label={t('Canvas name')} value={board.name} maxLength={100} onChange={e => commit({ ...board, name: e.target.value || 'Untitled exploration' })} /><span role="status"><Check size={11} />{t(saveState)}</span></div>
      <div className={styles.boardActions}>{iconButton('Undo', <Undo2 size={16} />, undo, !history.past.length)}{iconButton('Redo', <Redo2 size={16} />, redo, !history.future.length)}<span className={styles.divider} />{iconButton('Import canvas', <ArrowUpFromLine size={16} />, () => file.current?.click())}{iconButton('Export canvas', <ArrowDownToLine size={16} />, exportBoard)}<button className={styles.shareButton} disabled={!board.widgets.length} onClick={() => setSharing(true)}><Share2 size={15} />{t('Share')}</button><button className={styles.primaryButton} disabled={locked} onClick={add}><Plus size={16} />{t('New widget')}</button><input ref={file} type="file" accept=".json,application/json" hidden onChange={e => void importBoard(e.target.files?.[0])} /></div>
    </div>
    {notice && <div className={styles.notice} role="status"><span>{t(notice)}</span><button onClick={() => setNotice('')} aria-label={t('Dismiss notice')}><X size={14} /></button></div>}
    <div className={styles.workspace} data-inspecting={inspector && !!current}>
      <div className={styles.canvasPane}>
        <div className={styles.canvasTools}><div className={styles.toolPill}><button aria-pressed={mode === 'draw'} disabled={locked} onClick={() => setMode('draw')} title={t('Draw a widget')} aria-label={t('Draw a widget')}><MousePointer2 size={16} /></button><button aria-pressed={mode === 'pan'} onClick={() => setMode('pan')} title={t('Pan canvas')} aria-label={t('Pan canvas')}><Hand size={16} /></button><span className={styles.divider} /><button onClick={() => setZoom(Math.max(.25, zoom - .1))} aria-label={t('Zoom out')}>−</button><span>{Math.round(scale * 100)}%</span><button onClick={() => setZoom(Math.min(2, zoom + .1))} aria-label={t('Zoom in')}>+</button>{iconButton('Fit canvas', <Maximize size={14} />, () => { setZoom(fit); viewport.current?.scrollTo({ left: 0, top: 0 }) })}</div>
          <div className={styles.layoutTools}><span title={t('Magnetic alignment')}><Magnet size={13} /></span><label>{t('Spacing')}<select aria-label={t('Widget spacing')} disabled={locked} value={gap} onChange={e => { const gap = Number(e.target.value); commit({ ...board, layout: { ...board.layout, gap }, widgets: normalizeLayout(board.widgets, gap) }) }}>{[20, 40, 60, 80].map(gap => <option key={gap} value={gap}>{gap} px</option>)}</select></label>{iconButton('Tidy layout', <LayoutGrid size={15} />, () => commit({ ...board, widgets: tidyLayout(board.widgets, gap) }), locked || !board.widgets.length)}<button className={styles.layoutLock} aria-pressed={locked} onClick={() => { commit({ ...board, layout: { ...board.layout, locked: !locked } }); setGesture(null); setDraft(null); setDraftWidgets(null); setGuides([]) }}>{locked ? <LockKeyhole size={14} /> : <Unlock size={14} />}{t(locked ? 'Unlock layout' : 'Lock layout')}</button></div></div>
        <div ref={viewport} className={styles.viewport}>
          <div className={styles.stageBounds} style={{ width: CANVAS_WIDTH * scale, height: stageHeight * scale }}>
            <div ref={stage} className={styles.stage} data-locked={locked} style={{ width: CANVAS_WIDTH, height: stageHeight, transform: `scale(${scale})`, cursor: mode === 'pan' || locked ? 'grab' : 'crosshair' }} onPointerDown={e => start(e, mode === 'pan' || locked ? 'pan' : 'draw')} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { setGesture(null); setDraft(null); setDraftWidgets(null); setGuides([]) }}>
              {!board.widgets.length && <div className={styles.empty} style={{ left: fit * CANVAS_WIDTH / (2 * scale), top: 68 / scale, width: Math.min(600, fit * CANVAS_WIDTH), transform: `translateX(-50%) scale(${1 / scale})`, transformOrigin: 'top center' }}>
                <div className={styles.sculpture} aria-hidden="true"><svg viewBox="0 0 360 240"><defs><linearGradient id="labs-ribbon" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--chart-1)" /><stop offset=".5" stopColor="var(--chart-2)" /><stop offset="1" stopColor="var(--chart-3)" /></linearGradient></defs><ellipse cx="180" cy="210" rx="90" ry="8" fill="currentColor" opacity=".04" /><path d="M80 160 C20 40 180 15 214 85 C250 160 115 205 110 122 C104 40 280 30 286 130 C292 207 185 200 184 153" fill="none" stroke="url(#labs-ribbon)" strokeWidth="20" /><path d="M80 160 C20 40 180 15 214 85 C250 160 115 205 110 122 C104 40 280 30 286 130 C292 207 185 200 184 153" fill="none" stroke="var(--foreground)" strokeOpacity=".4" strokeWidth="1" /><circle cx="265" cy="52" r="13" fill="var(--chart-3)" /><path d="M52 198 L75 178 L87 202Z" fill="var(--chart-4)" /></svg></div>
                <div className={styles.emptyEyebrow}>{t('YOUR NEXT PERSPECTIVE STARTS HERE')}</div><h2>{t('What if your data')}<br /><em>{t('had no boundaries?')}</em></h2><p>{t('Draw a rectangle anywhere. Give it data. Watch it become something useful, something unexpected, something yours.')}</p><button className={styles.emptyCta} onClick={add}>{t('Create your first widget')}<span>↗</span></button><div className={styles.emptySteps}><span>01 {t('Draw')}</span><i /><span>02 {t('Connect')}</span><i /><span>03 {t('Shape')}</span></div>
              </div>}
              {visibleWidgets.map((widget, index) => { const geometry = gesture?.widget?.id === widget.id && draft ? draft : widget
                return <section key={widget.id} data-widget className={styles.widget} data-repelled={!!gesture && gesture.widget?.id !== widget.id} data-selected={selected === widget.id} style={{ left: geometry.x, top: geometry.y, width: geometry.w, height: geometry.h, zIndex: selected === widget.id ? 3 : 1 }} aria-label={widget.title} onPointerDown={e => e.stopPropagation()}>
                  <div className={styles.widgetHead} onPointerDown={e => { if (!(e.target as HTMLElement).closest('button')) start(e, 'move', widget) }}><span className={styles.widgetSourceIcon}><SourceIcon source={widget.source} /></span><div><span>{String(index + 1).padStart(2, '0')} / {t(sources.find(s => s.id === widget.source)!.name)}</span><h3>{widget.title || t('Untitled widget')}</h3></div><div className={styles.widgetActions}>
                    {iconButton('Configure widget', <SlidersHorizontal size={15} />, () => { setSelected(widget.id); setInspector(true) })}
                    {iconButton('Duplicate widget', <Copy size={14} />, () => { if (board.widgets.length >= 40) return; const copy = { ...widget, ...placeBox({ ...widget, x: widget.x + 40, y: widget.y + 40 }, board.widgets, gap), id: newWidgetId(), title: `${widget.title.slice(0, 112)} · copy` }; commit({ ...board, widgets: [...board.widgets, copy] }); setSelected(copy.id) }, locked || board.widgets.length >= 40)}
                    {iconButton('Delete widget', <Trash2 size={14} />, () => { commit({ ...board, widgets: board.widgets.filter(w => w.id !== widget.id) }); if (selected === widget.id) setInspector(false) }, locked)}
                  </div></div>
                  <div className={styles.widgetBody}><WidgetView widget={widget} data={datasets[dataKey(widget)]} refreshing={refreshing} onChange={patch => update(widget.id, patch)} /></div>
                  {!locked && <div className={styles.resize} onPointerDown={e => start(e, 'resize', widget)} aria-hidden="true">⌟</div>}
                </section>
              })}
              {gesture?.kind === 'draw' && draft && <div className={styles.selection} style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }}><span>{Math.round(draft.w)} × {Math.round(draft.h)}</span><Plus size={25} /></div>}
              {guides.map((guide, i) => <div aria-hidden="true" key={i} className={styles.alignmentGuide} style={guide.axis === 'x' ? { left: guide.position, top: 0, width: 1, height: stageHeight } : { top: guide.position, left: 0, height: 1, width: CANVAS_WIDTH }} />)}
            </div>
          </div>
        </div>
        <footer className={styles.canvasFooter}><span><i />{t('VBR · DATA SOURCES')}<b>{board.widgets.length} {t(board.widgets.length === 1 ? 'widget' : 'widgets')}</b></span><div><RefreshControls value={board.refresh} onChange={refresh => commit({ ...board, refresh })} />{iconButton('Refresh data', <RefreshCw size={14} className={refreshing ? styles.spinning : ''} />, () => setRefresh(r => r + 1), refreshing || !board.widgets.length)}</div></footer>
      </div>
      {inspector && current && <WidgetInspector key={current.id} widget={current} data={datasets[dataKey(current)]} locked={locked} onChange={patch => update(current.id, patch)} onClose={() => setInspector(false)} />}
    </div>
    {sharing && <ShareDialog board={board} onClose={() => setSharing(false)} onRefresh={refresh => commit({ ...board, refresh })} />}
    <Dialog open={chooser} onOpenChange={setChooser}><DialogContent className={styles.chooser}>
      <DialogHeader><div className={styles.eyebrow}>{t(source ? '02 / GIVE IT A SHAPE' : '01 / FOLLOW YOUR CURIOSITY')}</div><DialogTitle className={styles.chooserTitle}>{t(source ? 'How do you want to see it?' : 'Every perspective starts with data.')}</DialogTitle><DialogDescription>{t(source ? 'Choose a starting form. Every detail is yours to change in the inspector.' : 'Choose a data source from your connected VBR environment.')}</DialogDescription></DialogHeader>
      {!source ? <div className={styles.sourceChoices}>{sources.map(item => <button key={item.id} onClick={() => setSource(item.id)}><span className={styles.sourceBadge}><SourceIcon source={item.id} size={24} /></span><div><small>{t(item.family)}</small><strong>{t(item.name)}</strong><p>{t(item.detail)}</p></div><span aria-hidden="true"><ArrowUpRight size={16} strokeWidth={1.75} /></span></button>)}</div> : <><button className={styles.textButton} onClick={() => setSource(null)}><ArrowLeft size={14} aria-hidden="true" />{t('Change source')} · <SourceIcon source={source} size={16} />{t(sources.find(s => s.id === source)!.name)}</button><div className={styles.viewChoices}>{views.map(view => <button key={view.id} onClick={() => create(view.id)}><span className={styles.viewSymbol}><ViewIcon view={view.id} size={30} /></span><strong>{t(view.name)}</strong></button>)}</div></>}
      <div className={styles.chooserFoot}><span>{box?.w} × {box?.h}</span>{t('Live data. Your composition. Endless perspectives.')}</div>
    </DialogContent></Dialog>
  </div>
}
