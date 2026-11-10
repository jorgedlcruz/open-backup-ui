'use client'
// Open Backup UI v1.2.0

import { useI18n } from '@/components/providers/i18n-provider'
import { enumLabel } from '@/lib/i18n/presentation'
import { days, profileEnvelope, type Guest, type ProfileKind, type Retention, type Schedule } from '@/lib/job-builder/model'
import { builderDiagnostic } from './diagnostics'

/** Presentation only: policy settings and the native VBR payload retain their values. */
export function usePolicyPresentation() {
  const { t, locale, formatNumber } = useI18n()
  const dayLabel = (day: typeof days[number], short = false) => new Intl.DateTimeFormat(locale, { weekday: short ? 'short' : 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + days.indexOf(day))))
  function summary(kind: ProfileKind, value: Retention | Guest | Schedule): string {
    if (kind === 'retention') {
      const v = value as Retention
      const quantity = t(v.type === 'Days' ? '{count} days' : '{count} restore points', { count: formatNumber(v.quantity) })
      const cadence = t(v.synthetic ? 'Synthetic full backups' : v.active ? 'Active full backups' : 'Incremental forever')
      return [quantity, cadence, ...(v.gfsWeeks || v.gfsMonths || v.gfsYears ? ['GFS'] : [])].join(' · ')
    }
    if (kind === 'guest') {
      const v = value as Guest
      return [t(v.applicationAware ? 'Application-aware' : 'Crash-consistent'), ...(v.indexing ? [t('Guest file indexing')] : [])].join(' · ')
    }
    const v = value as Schedule
    if (v.mode === 'manual') return t('Run manually')
    if (v.mode === 'periodic') return t(v.unit === 'Hours' ? 'Every {count} hours' : 'Every {count} minutes', { count: formatNumber(v.interval) })
    const label = v.days.length === 7 ? t('Every day') : v.days.length === 5 && v.days.every(day => !['saturday', 'sunday'].includes(day)) ? t('Weekdays') : new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(v.days.map(day => dayLabel(day, true)))
    return t('{days} at {time}', { days: label, time: v.time })
  }
  function validationIssue(message: string): string {
    switch (message) {
      case 'Give this profile a name.': return t('Enter a profile name.')
      case 'Enter a job name.': return t('Enter a job name.')
      case 'Choose each day once.': return t('Choose each day once.')
      case 'Select at least one day.': case 'Select at least one run day.': return t('Select at least one day.')
      case 'Choose a full-backup cadence for GFS retention.': return t('Choose full-backup days for GFS retention.')
      case 'Select a guest OS credential stored in VBR.': return t('Select guest OS credentials from VBR.')
      case 'Use a valid local time.': return t('Enter a valid local time.')
      case 'Select at least one workload or container.': return t('Select at least one workload or container.')
      case 'Choose a backup repository.': return t('Choose a backup repository.')
      case 'This object does not match the selected platform or supported object types.': return t('Choose objects supported by the selected platform.')
      case 'An object cannot be duplicated or both included and excluded.': return t('An object cannot be duplicated or both included and excluded.')
      case 'Select at least one backup proxy.': return t('Select at least one backup proxy.')
      case 'On-host processing is only available for Hyper-V.': return t('On-host processing is only available for Hyper-V.')
      default: return t('Check required fields and allowed values.')
    }
  }
  function fieldLabel(field: string): string {
    const labels: Record<string, string> = {
      includes: t('Protected scope'), excludes: t('Exclusions'), repositoryId: t('Repository'), name: t('Job name'),
      sourceKey: t('VBR source'), proxyIds: t('Backup proxies'), proxyMode: t('Proxy selection'), platform: t('Platform'),
      description: t('Description'), highPriority: t('High-priority job'),
      retention: t('Retention & full backups'), guest: t('Guest processing'), schedule: t('Schedule & retries'),
    }
    return labels[field.split('.')[0]] || t('Protection plan')
  }
  function decodeProfileImport(text: string) {
    let value: unknown
    try { value = JSON.parse(text) } catch { throw new Error(t('This file is not valid JSON. Choose an exported policy profile.')) }
    const result = profileEnvelope.safeParse(value)
    if (!result.success) throw new Error(t('This file is not a supported policy profile. Export a profile from this application and try again.'))
    return result.data.profile
  }
  return { summary, dayLabel, validationIssue, fieldLabel, decodeProfileImport, diagnostic: (text: string) => builderDiagnostic(t, text), enumText: (value: string) => enumLabel(t, value) }
}
