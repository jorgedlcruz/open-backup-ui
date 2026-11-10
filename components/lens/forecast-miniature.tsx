'use client'
// Open Backup UI v1.2.0
import { useI18n } from '@/components/providers/i18n-provider'
import { usePlanningFormat } from '@/components/forecast/localized-format'
import type { ForecastPreview } from '@/lib/lens/forecast-preview'
import styles from './lens-switcher.module.css'

export function ForecastMiniature({ data }: { data: ForecastPreview }) {
  const { t } = useI18n(), { bytes } = usePlanningFormat()
  const points = [...data.history, ...data.future], now = Date.parse(data.fetchedAt)
  const start = Math.min(now - 86400000, ...points.map(point => point.at)), end = Math.max(now + 86400000, ...points.map(point => point.at))
  const maximum = Math.max(1, ...points.map(point => point.bytes)) * 1.08
  const x = (at: number) => 3 + (at - start) / (end - start) * 174, y = (value: number) => 55 - value / maximum * 50
  const path = (values: typeof points) => values.map((point, index) => `${index ? 'L' : 'M'}${x(point.at).toFixed(2)},${y(point.bytes).toFixed(2)}`).join(' ')
  const description = data.projected === null
    ? t('Cached usage for {name}: {current}. More history is needed for a trend.', { name: data.name, current: bytes(data.current) })
    : t('Cached forecast for {name}: {current} now, {projected} in 30 days.', { name: data.name, current: bytes(data.current), projected: bytes(data.projected) })
  return <>
    <div className={`${styles.figure} ${styles.forecastFigure}`}>
      <strong>{bytes(data.current)}</strong>
      <small>{data.mode === 'files' ? t('Modeled footprint') : t('Recorded usage')}</small>
      <small className={styles.forecastValue}>{data.projected === null ? t('Learning trend') : t('30 days → {value}', { value: bytes(data.projected) })}</small>
    </div>
    <svg className={styles.activity} viewBox="0 0 180 60" preserveAspectRatio="none" role="img" aria-label={description}>
      <title>{description}</title>
      <line x1="0" x2="180" y1="55" y2="55" stroke="var(--border)"/>
      {data.future.length > 0 && <rect x={x(now)} y="0" width={180 - x(now)} height="55" fill="var(--ops-chart-active)" opacity=".06"/>}
      <path d={path(data.history)} fill="none" stroke="var(--ops-accent)" strokeWidth="2"/>
      {data.history.length === 1 && <circle cx={x(data.history[0].at)} cy={y(data.history[0].bytes)} r="3" fill="var(--ops-accent)"/>}
      {data.future.length > 0 && <><line x1={x(now)} x2={x(now)} y1="0" y2="55" stroke="var(--muted-foreground)" opacity=".5" strokeDasharray="2 3"/><path d={path(data.future)} fill="none" stroke="var(--ops-chart-active)" strokeWidth="2" strokeDasharray="3 3"/></>}
    </svg>
  </>
}
