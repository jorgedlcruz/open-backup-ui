// Open Backup UI v1.2.0
import type { MessageValues } from '../i18n/model'
import { enumLabel } from '../i18n/presentation'
import type { Activity } from './model'
type Translator = (source: string, values?: MessageValues) => string

export function activityName(t: Translator, row: Activity) {
  const reported = row.event ? row.event.machine?.displayName : row.indicator?.task.name
  return reported || t('Workload not reported')
}

export function activitySessionName(t: Translator, row: Activity) {
  return row.indicator?.sessionNameMissing ? t('Session name not reported') : row.indicator?.sessionName || t('Session name not reported')
}

/** Known status and source labels; unknown API enum values remain readable as returned. */
export function ransomwareLabel(t: Translator, value: string) {
  const aliases: Record<string, string> = { FalsePositive: 'False positive', critical: 'Critical', warning: 'Warning', InlineScan: 'Inline scan', GuestIndex: 'Guest indexing', SignatureScan: 'Signature scan', SuspiciousActivity: 'Suspicious activity', MalwareExtensions: 'Malware file extensions', InternalVeeamDetector: 'Internal Veeam detector' }
  return aliases[value] ? t(aliases[value]) : t(enumLabel(t, value))
}

export function ransomwareDescription(t: Translator, row: Activity, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string = (value, options) => new Intl.NumberFormat('en', options).format(value)) {
  if (row.indicator) return t('Low data reduction: transferred {percent}% of bytes read. Review compression, encryption, and workload changes.', { percent: formatNumber(row.indicator.dedupeRatio * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
  // Native event descriptions are vendor diagnostics, not application-authored UI copy.
  return row.event?.details || t('Description not reported')
}
