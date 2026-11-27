'use client'
// Open Backup UI v1.3.0
import { ChevronRight } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import type { JsonRecord } from '@/lib/vbm-recovery/model'
import css from './workspace.module.css'
import styles from './session-events.module.css'

const text = (value: unknown) => typeof value === 'string' ? value : ''

export function recoveryStatusTone(status: string) {
  if (/fail|error/i.test(status)) return 'error'
  if (/warn|unknown|unconfirmed/i.test(status)) return 'warning'
  if (/success|succeed/i.test(status)) return 'success'
  if (/running|working|starting/i.test(status)) return 'active'
  return 'neutral'
}

export function RecoveryEventLog({ events }: { events: JsonRecord[] }) {
  const { t, formatDate } = useI18n()
  if (!events.length) return <p className={css.notice}>{t('No events have been reported yet.')}</p>

  return <div className={css.eventScroll}>
    <table className={styles.table} aria-label={t('Session log')}>
      <thead><tr><th scope="col">{t('Time')}</th><th scope="col">{t('Event')}</th><th scope="col">{t('Status')}</th></tr></thead>
      <tbody>{events.map((event, index) => {
        const title = text(event.title)
        const item = text(event.itemName)
        const message = text(event.message)
        const date = text(event.startTime)
        const status = text(event.status) || text(event.result)
        const headline = title || item || message || t('Recovery event')
        const details = [
          [t('Description'), message !== headline && message !== item ? message : ''],
          [t('Source'), text(event.source)],
          [t('Target'), text(event.target)],
          [t('Duration'), text(event.duration)],
        ].filter(([, value]) => value)
        const summary = <span className={styles.summaryText}>
          <strong>{headline}</strong>
          {item && !headline.includes(item) && <span className={styles.item}> · {item}</span>}
        </span>
        const key = event.id !== undefined ? `id:${event.id}` : event.order !== undefined ? `order:${event.order}` : index

        return <tr key={key}>
          <td className={styles.time}>
            {date && Number.isFinite(Date.parse(date))
              ? <time dateTime={date}>{formatDate(date, { dateStyle: 'medium', timeStyle: 'medium' })}</time>
              : '—'}
          </td>
          <td>
            {details.length ? <details className={styles.disclosure}>
              <summary><ChevronRight size={14} aria-hidden="true"/>{summary}</summary>
              <dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            </details> : <div className={styles.plain}>{summary}</div>}
          </td>
          <td><span className={css.status} data-tone={recoveryStatusTone(status)}><i />{status ? t(status) : '—'}</span></td>
        </tr>
      })}</tbody>
    </table>
  </div>
}
