'use client'
// Open Backup UI v1.2.0

import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Play } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import { nextWorkshopCaption } from '@/lib/restore-points/workshop-animation'
import styles from './recovery-signal.module.css'

type Stage = 'options' | 'request' | 'accepted' | 'session' | 'data' | 'guest'

const pauseKey = 'open-backup-ui.recovery-animation-paused'
const motionOverrideKey = 'open-backup-ui.recovery-animation-enabled'
const pauseEvent = 'recovery-animation-pause'
type MotionPreference = {paused: boolean; override: boolean}

export function RecoverySignal({stage, status, compact = false}: {
  stage: Stage; status?: string; compact?: boolean
}) {
  const { t } = useI18n()
  const [motionAllowed, setMotionAllowed] = useState<boolean | null>(null)
  const [motionOverride, setMotionOverride] = useState(false)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(true)
  const [caption, setCaption] = useState('')
  const assignedStage = useRef<Stage | undefined>(undefined)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      setMotionAllowed(!preference.matches)
      setVisible(!document.hidden)
    }
    const pause = (event: Event) => {
      const preference = (event as CustomEvent<MotionPreference>).detail
      setPaused(preference.paused)
      setMotionOverride(preference.override)
    }
    try {
      setPaused(sessionStorage.getItem(pauseKey) === 'true')
      setMotionOverride(sessionStorage.getItem(motionOverrideKey) === 'true')
    } catch { /* The local control still works. */ }
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

  const animationEnabled = !paused && (motionAllowed !== false || motionOverride)
  const moving = animationEnabled && visible
  useEffect(() => {
    if (!moving) return
    const captionTimer = window.setInterval(() => setCaption(nextWorkshopCaption()), 6500)
    return () => window.clearInterval(captionTimer)
  }, [moving, stage])

  function togglePause() {
    const next: MotionPreference = animationEnabled
      ? {paused: true, override: motionOverride}
      : {paused: false, override: motionOverride || motionAllowed === false}
    try {
      sessionStorage.setItem(pauseKey, String(next.paused))
      sessionStorage.setItem(motionOverrideKey, String(next.override))
    } catch { /* Optional tab preference. */ }
    window.dispatchEvent(new CustomEvent<MotionPreference>(pauseEvent, {detail:next}))
  }

  const message = status ?? (stage === 'options' ? t('Loading recovery options…') : stage === 'request' ? t('Waiting for the recovery session from VBR.')
    : stage === 'accepted' ? t('VBR accepted the request.') : stage === 'session' ? t('Waiting for VBR to report this session.')
    : stage === 'guest' ? t('Reading the guest folder…') : t('Loading…'))

  return <div className={styles.signal} data-session={stage === 'session' || undefined} data-compact={compact || undefined}
    data-paused={paused || undefined} data-hidden={!visible || undefined} data-motion-override={motionOverride || undefined}>
    <div className={styles.row}>
      <button type="button" className={styles.indicator} onClick={togglePause}
        aria-label={animationEnabled ? t('Pause animation') : t('Resume animation')}
        title={animationEnabled ? t('Pause animation') : t('Resume animation')}>
        <LoaderCircle aria-hidden="true" className={styles.spinning}/>
        <Play aria-hidden="true" size={18} className={styles.play}/>
      </button>
      <div className={styles.copy}>
        <span className={styles.status} role="status" aria-atomic="true">{message}</span>
        <span className={styles.caption} aria-hidden="true">{caption && t(caption)}</span>
      </div>
    </div>
  </div>
}
