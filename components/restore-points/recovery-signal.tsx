'use client'
// Open Backup UI v1.0.2

import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import { nextWorkshopCaption, nextWorkshopDevice, workshopFrame, type WorkshopDevice } from '@/lib/restore-points/workshop-animation'
import styles from './recovery-signal.module.css'

type Stage = 'options' | 'request' | 'accepted' | 'session' | 'data' | 'guest'

const pauseKey = 'open-backup-ui.recovery-animation-paused'
const pauseEvent = 'recovery-animation-pause'

export function RecoverySignal({stage, acknowledged = false, status, compact = false}: {
  stage: Stage; acknowledged?: boolean; status?: string; compact?: boolean
}) {
  const { t } = useI18n()
  const [motionAllowed, setMotionAllowed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  const [tick, setTick] = useState(0)
  const [device, setDevice] = useState<WorkshopDevice>('computer')
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
    setDevice(nextWorkshopDevice())
    setCaption(nextWorkshopCaption())
    setTick(0)
  }, [stage])

  const moving = motionAllowed && !paused && visible
  useEffect(() => {
    if (!moving) return
    const frameTimer = window.setInterval(() => setTick(frame => (frame + 1) % 8), 420)
    const captionTimer = window.setInterval(() => {
      setCaption(nextWorkshopCaption())
      setDevice(nextWorkshopDevice())
    }, 6500)
    return () => { window.clearInterval(frameTimer); window.clearInterval(captionTimer) }
  }, [moving, stage])

  function togglePause() {
    const next = !paused
    try { sessionStorage.setItem(pauseKey, String(next)) } catch { /* Optional tab preference. */ }
    window.dispatchEvent(new CustomEvent(pauseEvent, {detail:next}))
  }

  const accepted = stage === 'accepted' || (stage === 'session' && acknowledged)
  const frame = workshopFrame(device, tick, accepted)
  const message = status ?? (stage === 'options' ? t('Loading recovery options…') : stage === 'request' ? t('Waiting for the recovery session from VBR.')
    : stage === 'accepted' ? t('VBR accepted the request.') : stage === 'session' ? t('Waiting for VBR to report this session.')
    : stage === 'guest' ? t('Reading the guest folder…') : t('Loading…'))

  return <div className={styles.signal} data-session={stage === 'session' || undefined} data-compact={compact || undefined}>
    <div className={styles.row}>
      <div className={styles.art} aria-hidden="true" dir="ltr">
        <pre>{frame.source}</pre><pre className={styles.wire}>{frame.link}</pre><pre>{frame.server}</pre>
      </div>
      <div className={styles.copy}>
        <span className={styles.status} role="status" aria-atomic="true">{message}</span>
        <span className={styles.caption} aria-hidden="true">{caption && t(caption)}</span>
      </div>
      {motionAllowed && <button type="button" className={styles.motion} onClick={togglePause}
        aria-label={paused ? t('Resume animation') : t('Pause animation')} title={paused ? t('Resume animation') : t('Pause animation')}>
        {paused ? <Play aria-hidden size={13}/> : <Pause aria-hidden size={13}/>}
      </button>}
    </div>
  </div>
}
