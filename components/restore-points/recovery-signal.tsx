'use client'

import { useEffect, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import styles from './recovery-signal.module.css'

type Stage = 'options' | 'request' | 'accepted' | 'session'

const captions: Record<Stage, string[]> = {
  options: ['One moment. The past has a menu.', 'Dusting off the time machine’s keyboard.', 'The cursor got here first.'],
  request: ['A few dots are doing the talking.', 'Knock, knock. It’s the backup.', 'The cursor has taken the night shift.'],
  accepted: ['VBR signed for the delivery.', 'Receipt in hand. Next stop, the log.'],
  session: ['Saving you a seat in the log.', 'Giving the log the floor.', 'One cursor, front-row seat.'],
}

const keyboards = ['[  ] ', '[> ] ', '[>_] ', '[>_]_']
const dots = ['.     ', '..    ', '...   ', ' ...  ', '  ... ', '   ..>', '    .>', '     >']
const pauseKey = 'open-backup-ui.recovery-animation-paused'

export function RecoverySignal({stage, acknowledged = false}: {stage: Stage; acknowledged?: boolean}) {
  const { t } = useI18n()
  const [motionAllowed, setMotionAllowed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      setMotionAllowed(!preference.matches)
      setVisible(!document.hidden)
    }
    try { setPaused(sessionStorage.getItem(pauseKey) === 'true') } catch { /* The local control still works. */ }
    sync()
    preference.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      preference.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  const moving = motionAllowed && !paused && visible
  const buildingKeyboard = stage === 'options' && tick < keyboards.length - 1
  const frameMs = buildingKeyboard ? 140 : 400
  useEffect(() => {
    if (!moving) return
    const timer = window.setInterval(() => setTick(current => current + 1), frameMs)
    return () => window.clearInterval(timer)
  }, [moving, frameMs])

  function togglePause() {
    setPaused(!paused)
    try { sessionStorage.setItem(pauseKey, String(!paused)) } catch { /* Optional tab preference. */ }
  }
  const accepted = stage === 'accepted' || (stage === 'session' && acknowledged)
  const assembling = moving && buildingKeyboard
  const workstation = assembling ? keyboards[tick] : '[>_]_'
  const wire = assembling ? '      ' : accepted ? '----->' : moving ? dots[tick % dots.length] : ' ... >'
  const phrases = captions[stage]
  const caption = phrases[Math.floor(tick / 15) % phrases.length]
  const status = stage === 'options' ? t('Loading recovery options…') : stage === 'request' ? t('Waiting for the recovery session from VBR.')
    : stage === 'accepted' ? t('VBR accepted the request.') : t('Waiting for VBR to report this session.')

  return <div className={styles.signal} data-session={stage === 'session' || undefined}>
    <div className={styles.heading}><span role="status" aria-atomic="true">{status}</span>
      {motionAllowed && <button type="button" className={styles.motion} onClick={togglePause}
        aria-label={paused ? t('Resume animation') : t('Pause animation')} title={paused ? t('Resume animation') : t('Pause animation')}>
        {paused ? <Play aria-hidden size={13}/> : <Pause aria-hidden size={13}/>}
      </button>}
    </div>
    <div className={styles.story} aria-hidden="true">
      <samp className={styles.terminal} dir="ltr"><span>{workstation}</span><b>{wire}</b><span>[=VBR=]</span>
        {accepted && <><b className={styles.ack}> ✓ </b><span>{moving && tick % 10 === 8 ? '|o/' : '\\o/'}</span></>}
      </samp>
      <span key={caption} className={styles.caption} data-moving={moving || undefined}>{t(caption)}</span>
    </div>
  </div>
}
