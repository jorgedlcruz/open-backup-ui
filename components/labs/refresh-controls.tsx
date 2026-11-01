'use client'

import type { Board } from '@/lib/labs/model'
import { useI18n } from '@/components/providers/i18n-provider'
import styles from './labs.module.css'

export function RefreshControls({ value, onChange }: { value: Board['refresh']; onChange: (value: Board['refresh']) => void }) {
  const { t } = useI18n()
  return <div className={styles.refreshControls}><label><input type="checkbox" checked={value.enabled} onChange={e => onChange({ ...value, enabled: e.target.checked })} />{t('Auto refresh')}</label><select aria-label={t('Refresh interval')} value={value.seconds} onChange={e => onChange({ ...value, seconds: Number(e.target.value) as Board['refresh']['seconds'] })}>{([30, 60, 120, 300, 600] as const).map(s => <option key={s} value={s}>{s < 60 ? `${s} ${t('seconds')}` : `${s / 60} ${t(s === 60 ? 'minute' : 'minutes')}`}</option>)}</select></div>
}
