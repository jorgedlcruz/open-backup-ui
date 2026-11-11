'use client'
// Open Backup UI v1.2.0

import { useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import { nextWorkshopCaption } from '@/lib/restore-points/workshop-animation'
import styles from './recovery-signal.module.css'

type Stage = 'options' | 'request' | 'accepted' | 'session' | 'data' | 'guest'

export function RecoverySignal({stage, status, compact = false}: {
  stage: Stage; status?: string; compact?: boolean
}) {
  const { t } = useI18n()
  const [visible, setVisible] = useState(true)
  const [caption, setCaption] = useState('')
  const assignedStage = useRef<Stage | undefined>(undefined)

  useEffect(() => {
    const sync = () => setVisible(!document.hidden)
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  useEffect(() => {
    // Only choose the first caption after hydration. A Strict Mode effect replay retains its original choice.
    if (assignedStage.current === stage) return
    assignedStage.current = stage
    setCaption(nextWorkshopCaption())
  }, [stage])

  useEffect(() => {
    if (!visible) return
    const captionTimer = window.setInterval(() => setCaption(nextWorkshopCaption()), 6500)
    return () => window.clearInterval(captionTimer)
  }, [visible, stage])

  const message = status ?? (stage === 'options' ? t('Loading recovery options…') : stage === 'request' ? t('Waiting for the recovery session from VBR.')
    : stage === 'accepted' ? t('VBR accepted the request.') : stage === 'session' ? t('Waiting for VBR to report this session.')
    : stage === 'guest' ? t('Reading the guest folder…') : t('Loading…'))

  return <div className={styles.signal} data-session={stage === 'session' || undefined} data-compact={compact || undefined}
    data-hidden={!visible || undefined}>
    <div className={styles.row}>
      <span className={styles.indicator} aria-hidden="true"><LoaderCircle className={styles.spinning}/></span>
      <div className={styles.copy}>
        <span className={styles.status} role="status" aria-atomic="true">{message}</span>
        <span className={styles.caption} aria-hidden="true">{caption && t(caption)}</span>
      </div>
    </div>
  </div>
}
