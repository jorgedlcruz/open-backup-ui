'use client'
// Open Backup UI v1.0.2

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Copy, ExternalLink, Link2, LockKeyhole, Share2, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useThemeConfig } from '@/components/active-theme'
import { useI18n } from '@/components/providers/i18n-provider'
import type { Board } from '@/lib/labs/model'
import type { SharedLink } from '@/lib/labs/sharing'
import { RefreshControls } from './refresh-controls'
import styles from './labs.module.css'

export function ShareDialog({ board, onClose, onRefresh }: { board: Board; onClose: () => void; onRefresh: (refresh: Board['refresh']) => void }) {
  const { t } = useI18n(), { theme } = useThemeConfig(), { resolvedTheme } = useTheme()
  const [shares, setShares] = useState<SharedLink[]>([]), [selected, setSelected] = useState(''), [access, setAccess] = useState<'public' | 'password'>('password'), [password, setPassword] = useState('')
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirmRevoke, setConfirmRevoke] = useState(false)
  const current = shares.find(s => s.id === selected)
  useEffect(() => { const controller = new AbortController(); fetch('/api/labs/shares', { cache: 'no-store', signal: controller.signal }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); setShares(result.shares) }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setBusy(false) }); return () => controller.abort() }, [])
  function select(id: string) { setSelected(id); setAccess(shares.find(s => s.id === id)?.protected === false ? 'public' : 'password'); setPassword(''); setNotice(''); setConfirmRevoke(false) }
  async function publish() {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/labs/shares${current ? `/${current.id}` : ''}`, { method: current ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board, theme, mode: resolvedTheme === 'light' ? 'light' : 'dark', access, ...(password ? { password } : {}) }) })
      const result = await response.json(); if (!response.ok) throw new Error(result.error)
      setShares(list => [result.share, ...list.filter(s => s.id !== result.share.id)]); setSelected(result.share.id); setPassword(''); setNotice('Shared view published. Copy the link below.')
    } catch (error) { setError(error instanceof Error ? error.message : 'Sharing is unavailable. Please retry.') } finally { setBusy(false) }
  }
  async function revoke() {
    if (!current) return
    setBusy(true); setError('')
    try { const response = await fetch(`/api/labs/shares/${current.id}`, { method: 'DELETE' }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setShares(list => list.filter(s => s.id !== current.id)); select(''); setNotice('Link revoked. It can no longer load this kiosk.') }
    catch (error) { setError(error instanceof Error ? error.message : 'Sharing is unavailable. Please retry.') } finally { setBusy(false) }
  }
  async function copy() { if (!current) return; try { await navigator.clipboard.writeText(current.url); setNotice('Link copied.') } catch { setNotice('Select and copy the link below.') } }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className={`${styles.chooser} ${styles.shareDialog}`}><div className={styles.shareHeading}><Share2 size={22} /><div><DialogTitle>{t('Share kiosk')}</DialogTitle><DialogDescription>{t('Publish a read-only view with live data and your current branding.')}</DialogDescription></div></div>
    <label className={styles.field}><span>{t('Shared views from this browser')}</span><select value={selected} disabled={busy} onChange={e => select(e.target.value)}><option value="">{t('Create a new link')}</option>{shares.map(s => <option key={s.id} value={s.id}>{s.name} · {new Date(s.updatedAt).toLocaleString()}</option>)}</select></label>
    <div className={styles.shareAccess}>{(['password', 'public'] as const).map(mode => <button type="button" key={mode} aria-pressed={access === mode} disabled={busy} onClick={() => setAccess(mode)}>{mode === 'password' ? <LockKeyhole size={18} /> : <Link2 size={18} />}<strong>{t(mode === 'password' ? 'Password protected' : 'Anyone with the link')}</strong><span>{t(mode === 'password' ? 'The link and password are both required.' : 'Anyone who receives the link can view it.')}</span></button>)}</div>
    {access === 'password' && <label className={styles.field}><span>{t(current?.protected ? 'New password (leave empty to keep current)' : 'Sharing password')}</span><input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /><small>{t('Use 10 to 128 characters. Changing it signs out existing viewers.')}</small></label>}
    <div className={styles.shareRefresh}><span>{t('Default refresh for viewers')}</span><RefreshControls value={board.refresh} onChange={onRefresh} /><small>{t('Viewers can adjust their own refresh interval without changing the published view.')}</small></div>
    <p className={styles.shareNote}>{t('Only displayed widget data is shared. Filters and hidden columns stay private. Later layout, filter, or branding changes require Update shared view. Live data continues to refresh.')}</p>
    {current && <div className={styles.sharedLink}><label className={styles.field}><span>{t('Read-only link')}</span><input aria-label={t('Read-only link')} readOnly value={current.url} onFocus={e => e.target.select()} /></label><div><button type="button" onClick={() => void copy()}><Copy size={15} />{t('Copy link')}</button><a href={current.url} target="_blank" rel="noreferrer"><ExternalLink size={15} />{t('Open shared view')}</a></div></div>}
    {error && <p role="alert" className={styles.shareError}>{t(error)}</p>}{notice && <p role="status">{t(notice)}</p>}
    <div className={styles.shareActions}>{current && <button className={styles.textButton} disabled={busy} onClick={() => setConfirmRevoke(!confirmRevoke)}><Trash2 size={15} />{t('Revoke link')}</button>}<button className={styles.primaryButton} disabled={busy || !board.widgets.length || access === 'password' && (!current?.protected || !!password) && password.length < 10} onClick={() => void publish()}>{busy ? t('Working…') : t(current ? 'Update shared view' : 'Publish read-only link')}</button></div>
    {confirmRevoke && <div className={styles.revokeConfirm}><p>{t('Revoke this link for all viewers? This cannot be undone.')}</p><button disabled={busy} onClick={() => void revoke()}>{t('Yes, revoke link')}</button></div>}
    <small className={styles.hint}>{t('Keep this browser’s cookies to manage its links. The separate kiosk URL serves shared views only. Keep the editor on your trusted network.')}</small>
  </DialogContent></Dialog>
}
