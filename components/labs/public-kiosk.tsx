'use client'
// Open Backup UI v1.2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LockKeyhole, Maximize, Minimize, RefreshCw } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import { CANVAS_WIDTH, type Board } from '@/lib/labs/model'
import type { PublicKiosk as Kiosk } from '@/lib/labs/sharing'
import { fitKioskToScreen, tileKioskToScreen } from '@/lib/labs/screen-layout'
import { themeOverrides, THEME_COOKIES } from '@/lib/themes'
import { WidgetView } from './widget-view'
import { RefreshControls } from './refresh-controls'
import { SourceIcon } from './icons'
import styles from './labs.module.css'

export function PublicKiosk({ id }: { id: string }) {
  const { t } = useI18n()
  const [kiosk, setKiosk] = useState<Kiosk | null>(null), [locked, setLocked] = useState(false), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tick, setTick] = useState(0), [updated, setUpdated] = useState<Date | null>(null)
  const [refresh, setRefresh] = useState<Board['refresh']>({ enabled: false, seconds: 60 }), customized = useRef(false)
  const [size, setSize] = useState({ width: CANVAS_WIDTH, height: 0 }), pane = useRef<HTMLDivElement>(null)
  const [tv, setTv] = useState(false), [controlsVisible, setControlsVisible] = useState(true), [screenNotice, setScreenNotice] = useState('')
  const [screenLayout, setScreenLayout] = useState<'screen' | 'saved'>('screen')
  const hideControls = useRef<ReturnType<typeof setTimeout> | null>(null), nativeScreen = useRef(false)
  const hasKiosk = !!kiosk
  const revealControls = useCallback(() => {
    setControlsVisible(true)
    if (hideControls.current) clearTimeout(hideControls.current)
    hideControls.current = setTimeout(() => setControlsVisible(false), 3500)
  }, [])
  const exitScreen = useCallback(() => {
    setTv(false)
    if (document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {})
  }, [])
  async function enterScreen() {
    setTv(true); setScreenNotice(''); customized.current = true
    setRefresh(value => ({ ...value, enabled: true }))
    // Invoke during the button gesture. Embedded browsers can deny native fullscreen;
    // viewport-fitted TV mode still works there, and on LAN HTTP origins.
    try {
      if (!document.documentElement.requestFullscreen) throw new Error('Unsupported')
      await document.documentElement.requestFullscreen()
    } catch { setScreenNotice('TV mode is active in this window. Browser full screen is unavailable.') }
  }
  useEffect(() => {
    const changed = () => {
      if (document.fullscreenElement === document.documentElement) nativeScreen.current = true
      else if (nativeScreen.current) { nativeScreen.current = false; setTv(false) }
    }
    document.addEventListener('fullscreenchange', changed)
    return () => {
      document.removeEventListener('fullscreenchange', changed)
      if (nativeScreen.current && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])
  useEffect(() => {
    if (!tv) return
    if (!hasKiosk) { exitScreen(); return }
    const root = document.documentElement, overflow = root.style.overflow
    root.style.overflow = 'hidden'; revealControls()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') exitScreen(); else revealControls() }
    document.addEventListener('keydown', key)
    return () => {
      root.style.overflow = overflow; document.removeEventListener('keydown', key)
      if (hideControls.current) clearTimeout(hideControls.current)
    }
  }, [tv, hasKiosk, revealControls, exitScreen])
  useEffect(() => {
    if (!kiosk) return
    const body = document.body, root = document.documentElement
    const attributes = [...body.attributes].filter(a => a.name.startsWith('data-theme-')).map(a => [a.name, a.value])
    const dark = root.classList.contains('dark'), light = root.classList.contains('light')
    for (const key of Object.keys(THEME_COOKIES) as (keyof typeof kiosk.theme)[]) if (key !== 'accentColor' && key !== 'chartColor') body.setAttribute(`data-theme-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, kiosk.theme[key])
    const overrides = themeOverrides(kiosk.theme), previous = body.getAttribute('style')
    body.removeAttribute('style')
    for (const [key, value] of Object.entries(overrides)) body.style.setProperty(key, value)
    root.classList.toggle('dark', kiosk.mode === 'dark'); root.classList.toggle('light', kiosk.mode === 'light')
    return () => {
      if (previous) body.setAttribute('style', previous); else body.removeAttribute('style')
      for (const [name, value] of attributes) body.setAttribute(name, value)
      root.classList.toggle('dark', dark); root.classList.toggle('light', light)
    }
  }, [kiosk])
  useEffect(() => { const element = pane.current; if (!element) return; const observer = new ResizeObserver(([entry]) => setSize(previous => previous.width === entry.contentRect.width && previous.height === entry.contentRect.height ? previous : { width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(element); return () => observer.disconnect() }, [hasKiosk])
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError('')
    fetch(`/api/public/kiosks/${id}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json()
      if (response.status === 401 && result.passwordRequired) { setLocked(true); setKiosk(null); return }
      if (!response.ok) { if ([401, 404, 409].includes(response.status)) setKiosk(null); throw new Error(result.error) }
      setLocked(false); setKiosk(result); setUpdated(new Date()); if (!customized.current) setRefresh(result.refresh)
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'The shared view could not refresh.') }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [id, tick])
  useEffect(() => {
    if (!refresh.enabled || busy || !kiosk || locked) return
    const timer = setInterval(() => { if (document.visibilityState === 'visible') setTick(value => value + 1) }, refresh.seconds * 1000)
    return () => clearInterval(timer)
  }, [refresh, busy, kiosk, locked])
  async function unlock(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { const response = await fetch(`/api/public/kiosks/${id}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setPassword(''); setTick(value => value + 1) }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to open this kiosk.'); setBusy(false) }
  }
  const fit = useMemo(() => fitKioskToScreen(kiosk?.widgets.map(item => item.widget) ?? [], size, kiosk?.gap ?? 20), [kiosk, size])
  const tiles = useMemo(() => tileKioskToScreen(kiosk?.widgets.map(item => item.widget) ?? [], size, kiosk?.gap ?? 20), [kiosk, size])
  const screen = screenLayout === 'screen' ? tiles : fit
  const scale = Math.min(1, size.width / CANVAS_WIDTH), compact = !tv && size.width < 720
  const height = kiosk ? Math.max(240, ...kiosk.widgets.map(({ widget: w }) => w.y + w.h)) + kiosk.gap : 240
  const refreshControls = <><RefreshControls value={refresh} onChange={value => { customized.current = true; setRefresh(value) }} /><button className={styles.iconButton} aria-label={t('Refresh data')} disabled={busy} onClick={() => setTick(value => value + 1)}><RefreshCw size={17} className={busy ? styles.spinning : ''} /></button><small role="status">{busy ? t('Refreshing…') : updated && `${t('Last refreshed')} ${updated.toLocaleTimeString()}`}</small></>
  return <main className={`${styles.labs} ${styles.publicKiosk}`} data-tv={tv} onPointerMove={tv ? revealControls : undefined} onPointerDown={tv ? revealControls : undefined}>
    {!tv && <header className={styles.publicHeader}><div><span><LockKeyhole size={13} />{t('Read-only kiosk')}</span><h1>{kiosk?.name ?? t('Shared kiosk')}</h1></div>{kiosk && <div className={styles.publicRefresh}>{refreshControls}<button className={styles.shareButton} onClick={() => void enterScreen()} title={t('Arrange widgets to fill the screen and start auto refresh.')}><Maximize size={16} />{t('Full screen')}</button></div>}</header>}
    {tv && <div className={styles.tvControls} data-visible={controlsVisible} role="toolbar" aria-label={t('TV controls')} onFocus={revealControls}>
      <div className={styles.tvIdentity}><strong>{kiosk?.name}</strong><span>{t('Move the pointer or press a key to show controls. Esc exits.')}</span></div>
      <div className={styles.publicRefresh}><div className={styles.refreshControls}><label>{t('Screen layout')}<select value={screenLayout} onChange={event => setScreenLayout(event.target.value as 'screen' | 'saved')}><option value="screen">{t('Fit to TV')}</option><option value="saved">{t('Saved arrangement')}</option></select></label></div>{refreshControls}<button className={styles.shareButton} onClick={exitScreen}><Minimize size={16} />{t('Exit full screen')}</button></div>
      {screenNotice && <p role="status">{t(screenNotice)}</p>}
    </div>}
    {error && <div role="alert" className={styles.publicError}><span>{t(error)}{kiosk && ` ${t('The previous readings remain visible.')}`}</span>{!locked && <button disabled={busy} onClick={() => setTick(value => value + 1)}>{t('Retry')}</button>}</div>}
    {locked ? <form className={styles.unlockCard} onSubmit={event => void unlock(event)}><LockKeyhole size={30} /><h2>{t('This kiosk is password protected')}</h2><p>{t('Enter the sharing password to open the read-only view.')}</p><label className={styles.field}><span>{t('Sharing password')}</span><input type="password" required maxLength={128} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button className={styles.primaryButton} disabled={busy}>{busy ? t('Opening…') : t('Open kiosk')}</button></form>
      : kiosk ? <div ref={pane} className={styles.publicPane} style={tv || compact ? undefined : { height: height * scale }}>{!kiosk.widgets.length ? <div className={styles.dataState}>{t('This shared kiosk has no widgets yet.')}</div> : <div className={styles.publicStage} data-compact={compact} style={tv ? { width: screen.width, height: screen.height, left: screen.left, top: screen.top, transform: `scale(${screen.scale})` } : compact ? { gap: kiosk.gap } : { width: CANVAS_WIDTH, height, transform: `scale(${scale})` }}>{kiosk.widgets.map(({ widget, presentation, error }, index) => {
        const box = tv && screenLayout === 'screen' ? tiles.widgets[index] : { ...widget, x: widget.x - (tv ? fit.x : 0), y: widget.y - (tv ? fit.y : 0) }
        return <section key={widget.id} className={styles.widget} style={compact ? { position: 'relative', height: Math.max(320, widget.h) } : { left: box.x, top: box.y, width: box.w, height: box.h }}><header className={styles.widgetHead}><span className={styles.widgetSourceIcon}><SourceIcon source={widget.source} /></span><div><h3>{widget.title}</h3></div></header><div className={styles.widgetBody}><WidgetView widget={widget} prepared={presentation} data={error ? new Error(error) : undefined} readOnly refreshing={busy} /></div></section>
      })}</div>}</div>
        : busy && <div className={styles.loadingPage} role="status">{t('Opening shared kiosk…')}</div>}
  </main>
}
