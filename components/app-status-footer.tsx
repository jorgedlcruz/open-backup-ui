'use client'
// Open Backup UI v1.2.0

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useI18n } from '@/components/providers/i18n-provider'
import { applicationRequest } from '@/lib/api/application-request'
import type { ConnectionSummary } from '@/lib/data-sources/connection-summary'
import { APP_VERSION } from '@/lib/version'
import styles from './app-status-footer.module.css'

export function AppStatusFooter() {
  const {t, formatNumber} = useI18n()
  const [summary, setSummary] = useState<ConnectionSummary>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>, reading = false, validUntil = 0, invalidated = false
    async function refresh(invalidate = false) {
      clearTimeout(timer)
      if (invalidate) { validUntil = 0; invalidated = true; setSummary(undefined) }
      if (document.hidden || reading || controller.signal.aborted) return
      if (Date.now() >= validUntil) setSummary(undefined)
      reading = true
      invalidated = false
      try {
        const result = await applicationRequest<ConnectionSummary>('/api/data-sources/health', {signal:controller.signal})
        if (controller.signal.aborted || invalidated) return
        if (!['ok','warning','error','empty','unverified'].includes(result.status) || !Number.isInteger(result.total) ||
          !Number.isFinite(result.validForMs) || result.validForMs <= 0) throw Error('Invalid connection summary')
        setSummary(result); setFailed(false)
        validUntil = Date.now() + result.validForMs
        timer = setTimeout(refresh, result.pending ? Math.min(5000,result.validForMs) : result.validForMs)
      } catch {
        if (!controller.signal.aborted && !invalidated) {
          setSummary(undefined); setFailed(true); validUntil = 0
          timer = setTimeout(refresh, 60_000)
        }
      } finally {
        reading = false
        if (invalidated && !controller.signal.aborted) void refresh()
      }
    }
    function visible() { if (!document.hidden) void refresh() }
    function changed() { void refresh(true) }
    void refresh()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('source-connections-updated', changed)
    return () => {
      controller.abort(); clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('source-connections-updated', changed)
    }
  }, [])

  const status = summary?.status ?? (failed ? 'unverified' : 'checking')
  const label = {ok:t('OK'), warning:t('Warning'), error:t('Error'), empty:t('Not configured'),
    unverified:t('Not verified'), checking:t('Checking…')}[status]
  const detail = summary && t('{verified} of {total} connections verified', {verified:formatNumber(summary.verified), total:formatNumber(summary.total)})
  return <footer className={styles.footer}>
    <div className={styles.strip}>
      <Link href="/administration/data-sources" className={styles.link} title={detail}>
        {t('Data sources')} <span role="status" className={styles.state} data-status={status}><i aria-hidden="true"/>{label}</span>
        {detail && <span className="sr-only"> · {detail}</span>}
      </Link>
      <span className={styles.version}>{t('Open Backup UI v{version}', {version:APP_VERSION})}</span>
    </div>
  </footer>
}
