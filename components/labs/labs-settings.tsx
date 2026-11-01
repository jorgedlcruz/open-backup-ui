'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FlaskConical, ArrowUpRight } from 'lucide-react'
import { applicationRequest } from '@/lib/api/application-request'
import { useI18n } from '@/components/providers/i18n-provider'
import { Button } from '@/components/ui/button'
import styles from './labs.module.css'

export function LabsSettings() {
  const { t } = useI18n(), router = useRouter()
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    applicationRequest<{ enabled: boolean }>('/api/settings/labs', { signal: abort.signal })
      .then(value => { if (!abort.signal.aborted) setEnabled(value.enabled) })
      .catch(e => { if (!abort.signal.aborted) setError(e.message) })
      .finally(() => { if (!abort.signal.aborted) setBusy(false) })
    return () => abort.abort()
  }, [])
  async function toggle() {
    setBusy(true); setError('')
    try {
      const result = await applicationRequest<{ enabled: boolean }>('/api/settings/labs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled }) })
      setEnabled(result.enabled); router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Labs settings could not be saved.') }
    finally { setBusy(false) }
  }
  return <section className={styles.settingsCard}>
    <div className={styles.eyebrow}><FlaskConical size={17} />{t('Experimental by design')}</div>
    <h2>{t('Kiosk')} <em>{t('Builder.')}</em></h2>
    <p>{t('Turn your backup data into a canvas. Draw a space, connect a source, and shape a view that is entirely yours.')}</p>
    <div className={styles.settingsAction}><Button onClick={toggle} disabled={busy} role="switch" aria-checked={enabled}>{t(busy ? 'Saving / loading…' : enabled ? 'Disable Kiosk Builder' : 'Enable Kiosk Builder')}</Button>
      {enabled && <Link href="/labs">{t('Open Kiosk Builder')} <ArrowUpRight size={16} /></Link>}</div>
    <small>{t('Enabled for this browser. Canvas layouts are saved locally per VBR source; backup data is fetched live and is never saved in the canvas file.')}</small>
    {error && <p role="alert">{t(error)}</p>}
  </section>
}
