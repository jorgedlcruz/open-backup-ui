'use client'
// Open Backup UI v1.0.2

import { useI18n } from './i18n-provider'
import { enumLabel } from '@/lib/i18n/presentation'

export function useDisplayFormat() {
  const { t, formatNumber, formatDate } = useI18n()
  return {
    label: (value: string) => enumLabel(t, value),
    date: (value?: string | null) => value && Number.isFinite(Date.parse(value))
      ? formatDate(value, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : t('Not reported'),
    bytes: (value?: number | null) => {
      if (value == null || !Number.isFinite(value) || value < 0) return t('Unknown')
      const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
      const index = value ? Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))) : 0
      return `${formatNumber(value / 1024 ** index, { maximumFractionDigits: 1 })} ${units[index]}`
    },
  }
}
