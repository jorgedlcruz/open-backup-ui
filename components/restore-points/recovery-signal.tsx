'use client'
// Open Backup UI v1.0.2

import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Play } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import { nextWorkshopCaption } from '@/lib/restore-points/workshop-animation'
import styles from './recovery-signal.module.css'

type Stage = 'options' | 'request' | 'accepted' | 'session' | 'data' | 'guest'

const pauseKey = 'open-backup-ui.recovery-animation-paused'
const pauseEvent = 'recovery-animation-pause'

export function RecoverySignal({stage, status, compact = false}: {
  stage: Stage; status?: string; compact?: boolean
}) {
  const { t } = useI18n()
  const [motionAllowed, setMotionAllowed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  const [caption, setCaption] = useState('')
  const assignedStage = useRef<Stage | undefined>(undefined)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      setMotionAllowed(!preference.matches)
      setVisible(!document.hidden)
    }
    const pause = (event: Event) => setPaused((event as CustomEvent<boolean>).detail)
    try { setPaused(sessionStorage.getItem(pauseKey) === 'true') } catch { /* The local control still works. */ }
    sync()
    preference.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener(pauseEvent, pause)
    return () => {
      preference.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener(pauseEvent, pause)
    }
  }, [])

  useEffect(() => {
    // Only choose the first caption after hydration. A Strict Mode effect replay retains its original choice.
    if (assignedStage.current === stage) return
    assignedStage.current = stage
    setCaption(nextWorkshopCaption())
  }, [stage])

  const moving = motionAllowed && !paused && visible
  useEffect(() => {
    if (!moving) return
    const captionTimer = window.setInterval(() => setCaption(nextWorkshopCaption()), 6500)
    return () => window.clearInterval(captionTimer)
  }, [moving, stage])

  function togglePause() {
    const next = !paused
    try { sessionStorage.setItem(pauseKey, String(next)) } catch { /* Optional tab preference. */ }
    window.dispatchEvent(new CustomEvent(pauseEvent, {detail:next}))
  }

  const message = status ?? (stage === 'options' ? t('Loading recovery options…') : stage === 'request' ? t('Waiting for the recovery session from VBR.')
    : stage === 'accepted' ? t('VBR accepted the request.') : stage === 'session' ? t('Waiting for VBR to report this session.')
    : stage === 'guest' ? t('Reading the guest folder…') : t('Loading…'))

  return <div className={styles.signal} data-session={stage === 'session' || undefined} data-compact={compact || undefined}>
    <div className={styles.row}>
      {motionAllowed ? (
        <button type="button" className={styles.indicator} onClick={togglePause}
          aria-label={paused ? t('Resume animation') : t('Pause animation')}
          title={paused ? t('Resume animation') : t('Pause animation')}>
          {paused ? <Play aria-hidden="true" size={18}/> : <LoaderCircle aria-hidden="true" className={moving ? styles.spinning : undefined}/>}
        </button>
      ) : <span className={styles.indicator}><LoaderCircle aria-hidden="true"/></span>}
      <div className={styles.copy}>
        <span className={styles.status} role="status" aria-atomic="true">{message}</span>
        <span className={styles.caption} aria-hidden="true">{caption && t(caption)}</span>
      </div>
    </div>
  </div>
}
