'use client'
// Open Backup UI v1.2.0

import { useI18n } from '@/components/providers/i18n-provider'
import { m365Label } from '@/lib/i18n/m365'
import { knownSize } from '@/lib/restore-points/model'
import type { Snapshot } from '@/lib/vbm-dashboard/model'

/** Display helpers only: source names, IDs, diagnostics and payloads stay intact. */
export function useDashboardPresentation() {
  const { t, locale, formatNumber, formatDate } = useI18n()
  const number = (value?: number | null) => value == null || !Number.isFinite(value) ? t('Unknown') : formatNumber(value)
  const date = (value?: string | null) => !value || !Number.isFinite(Date.parse(value)) ? t('Not reported') : formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
  const bytes = (value: unknown) => {
    const size = knownSize(value)
    if (size === null) return t('Unknown')
    const unit = size === 0 ? 0 : Math.max(0, Math.min(5, Math.floor(Math.log(size) / Math.log(1024))))
    return `${formatNumber(size / 1024 ** unit, { maximumFractionDigits: 2 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'][unit]}`
  }
  const label = (value?: string | null) => value ? m365Label(t, value, locale) : t('Not reported')
  const value = (text?: string | null) => text || t('Not reported')
  const orgName = (data: Snapshot, id?: string | null) => data.organizations.data.find(row => row.id === id)?.name || id || t('Organization not reported')
  const repoName = (data: Snapshot, id?: string | null) => data.repositories.data.find(row => row.id === id)?.name || id || t('Repository not reported')
  return { t, locale, formatNumber, formatDate, number, date, bytes, label, value, orgName, repoName }
}
