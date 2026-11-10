'use client'
// Open Backup UI v1.2.0

import { useI18n } from '@/components/providers/i18n-provider'

/** Formatting is derived from the selected interface language, not the browser language. */
export function usePlanningFormat() {
  const { t, formatDate, formatNumber } = useI18n()
  const date = (value: string | number | null | undefined) => value == null || !Number.isFinite(new Date(value).getTime())
    ? t('Not reported') : formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
  const shortDate = (value: number) => formatDate(value, { month: 'short', day: 'numeric' })
  const bytes = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return t('Not measured')
    const amount = Math.max(0, value), units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
    const index = amount === 0 ? 0 : Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(amount) / Math.log(1024))))
    return `${formatNumber(amount / 1024 ** index, { maximumFractionDigits: index ? 2 : 0 })} ${units[index]}`
  }
  return { date, shortDate, bytes, number: formatNumber }
}
