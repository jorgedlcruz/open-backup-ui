// Open Backup UI v1.0.2
import { enumLabel, type Translator } from '@/lib/i18n/presentation'
import { vbrError } from '@/lib/i18n/vbr-errors'
import { knownSize } from '@/lib/restore-points/model'

export function recoveryBytes(t: Translator, value: unknown, locale: string) {
  const bytes = knownSize(value)
  if (bytes === null) return t('Unknown')
  const unit = bytes === 0 ? 0 : Math.min(5, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bytes / 1024 ** unit)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'][unit]}`
}

export function recoveryGB(t: Translator, value: number | null | undefined, locale: string) {
  return value != null && Number.isFinite(value) && value >= 0
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} GB` : t('Not reported')
}

export function recoveryDate(t: Translator, value: string | number | null | undefined, locale: string) {
  const time = value == null ? NaN : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(time) ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time) : t('Unknown')
}

export function recoveryAge(t: Translator, hours: number | null, locale: string) {
  if (hours === null) return t('Unknown')
  const n = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)
  return hours < 1 ? t('{count} min', { count: n(Math.floor(hours * 60)) }) : hours < 48 ? t('{count} hours', { count: n(hours) }) : t('{count} days', { count: n(hours / 24) })
}

/** Only application-owned labels and known API enums; identifiers and unknown values stay intact. */
export function recoveryLabel(t: Translator, value: string, locale = 'en'): string {
  const days = value.match(/^(\d+) days$/)
  if (days) return t('{count} days', { count: new Intl.NumberFormat(locale).format(Number(days[1])) })
  switch (value) {
    case 'StartViVMInstantRecovery': return t('VMware Instant Recovery')
    case 'StartHvVMInstantRecovery': return t('Hyper-V Instant Recovery')
    case 'StartEntireVmRestore': return t('Entire VM restore')
    case 'StartEntireVmRestoreCloudDirector': return t('Cloud Director VM restore')
    case 'StartEntireVmRestoreHyperV': return t('Hyper-V VM restore')
    case 'StartFCDInstantRecovery': return t('First Class Disk recovery')
    case 'StartFlrRestore': return t('Guest file restore')
    case 'BrowseActiveDirectory': return t('Microsoft Active Directory')
    case 'BrowseSql': return t('Microsoft SQL Server')
    case 'StartDiskPublish': return t('Publish disks')
    case 'Increment': case 'Incremental': return t('Incremental')
    case 'Full': return t('Full')
    case 'Rollback': return t('Rollback')
    case 'Snapshot': return t('Snapshot')
    case 'Reverse incremental': return t('Reverse incremental')
    case 'Different': return t('Different')
    case 'Weekly': return t('Weekly')
    case 'Monthly': return t('Monthly')
    case 'Yearly': return t('Yearly')
    case 'Clean': return t('Reported clean')
    case 'Infected': return t('Infected')
    case 'Suspicious': return t('Suspicious')
    case 'Reported by VBR': return t('Reported by VBR')
    case 'Inferred from file extension': return t('Inferred from file extension')
    case 'Restore point': return t('Restore point')
    case 'Backup file': return t('Backup file')
    case 'Performance': return t('Performance')
    case 'Capacity': return t('Capacity')
    case 'Archive': return t('Archive')
    case 'Capacity (disabled)': return t('Capacity (disabled)')
    case 'Archive (disabled)': return t('Archive (disabled)')
    case 'Normal': return t('Normal')
    case 'Maintenance': return t('Maintenance')
    case 'Sealed': return t('Sealed')
    case 'Evacuating': return t('Evacuating')
    case 'Low space': return t('Low space')
    case 'Outdated': return t('Outdated')
    case 'Configured': return t('Configured')
    case 'Hardened repository': return t('Hardened repository')
    case 'Governance': return t('Governance')
    case 'Follows backup retention': return t('Follows backup retention')
    case 'Backup retention': return t('Backup retention')
    case 'Repository period': return t('Repository period')
    case 'No immutability setting returned for this repository.': return t('No immutability setting returned for this repository.')
    case 'Recent-backup immutability period reported by VBR.': return t('Recent-backup immutability period reported by VBR.')
    case 'Linux repository governance-mode setting.': return t('Linux repository governance-mode setting.')
    case 'Bucket immutability configuration.': return t('Bucket immutability configuration.')
    case 'Container immutability configuration.': return t('Container immutability configuration.')
    case 'Configured target': return t('Configured target')
    case 'Via scale-out parent': return t('Via scale-out parent')
    case 'Retained backup': return t('Retained backup')
    case 'ExtendableRepository': case 'ScaleOut': return t('Scale-out repository')
    case 'Smb': case 'SmbShare': return t('SMB share')
    case 'Nfs': return t('NFS share')
    default: return enumLabel(t, value)
  }
}

/** Known collector diagnostics only. Unknown provider messages are never rewritten. */
export function recoveryDiagnostic(t: Translator, value: string, locale = 'en'): string {
  switch (value) {
    case 'Choose one recovery method for the batch.':
    case 'Choose one restore point per virtual machine.':
    case 'Confirm the original VM location before starting this recovery.':
    case 'VBR returned a different restore-point page.':
    case 'The restore point no longer belongs to this virtual machine and backup.':
    case 'Select a current virtual machine on the same VBR platform.':
    case 'The selected recovery is unavailable for this VM platform.':
    case 'Two selected VMs would use the same destination name. Rename one of them or change its destination.':
    case 'Another VM failed validation. This VM was not submitted.':
    case 'VBR could not verify this recovery request.':
    case 'VBR submission could not be confirmed. Check Sessions before starting another recovery.':
    case 'The server stopped before this VM was submitted.':
    case 'This batch is being updated. Refresh its status.':
    case 'Recovery batch not found.':
    case 'This batch ID already belongs to a different recovery request.':
    case 'This recovery worker is no longer active.':
    case 'Invalid recovery batch.':
    case 'Review the selected VMs and restore settings.':
    case 'Some restore points could not be associated with a virtual machine. Open the workload to select its restore point.':
    case 'Application recovery requires a configured VBR web console connection.':
    case 'Some backups could not be checked. Only verified recovery options are shown.':
    case 'The restore-point list is partial.':
    case 'Some requested VMs or restore points are unavailable. Review the selection.':
    case 'VBR could not check the recovery options for this source.':
    case 'This VM is unavailable for the selected recovery.':
    case 'Compression applies only to a SQL backup file.':
    case 'This SQL browse page expired. Refresh the page.':
    case 'Reopen the SQL browse page.':
    case 'VBR returned a different SQL browse view. Refresh the page.':
    case 'VBR returned an unreadable SQL browse item.':
    case 'VBR returned a database for a different SQL instance. Refresh the page.':
    case 'VBR returned files for a different database. Refresh the page.':
    case 'VBR returned an incomplete SQL browse page. Refresh the page.':
    case 'VBR returned an invalid SQL browse page.':
    case 'Use distinct database names on the target instance.':
      return t(value)
    case 'Restore-point evidence could not be loaded.': return t('Restore-point evidence could not be loaded.')
    case 'Select a valid backup object or backup ID.': return t('Select a valid backup object or backup ID.')
    case 'Select a valid repository ID.': return t('Select a valid repository ID.')
    case 'This repository is unavailable. Check its ID, source, and read permissions.': return t('This repository is unavailable. Check its ID, source, and read permissions.')
    case 'Your account cannot read these records.': return t('Your account cannot read these records.')
    case 'The response did not match the expected fields.': return t('The response did not match the expected fields.')
    case 'The source could not return these records.': return t('The source could not return these records.')
    case 'Server version unavailable. Using API 1.3-rev1; newer settings may not be reported.': return t('Server version unavailable. Using API 1.3-rev1; newer settings may not be reported.')
    case 'Extent configuration is limited to 30 repositories. Remaining settings are not reported.': return t('Extent configuration is limited to 30 repositories. Remaining settings are not reported.')
    case 'No file inventory returned; consumption is unmeasured.': return t('No file inventory returned; consumption is unmeasured.')
    case 'File inventory is limited to 30 backups per refresh. Other backups remain listed with unmeasured consumption.': return t('File inventory is limited to 30 backups per refresh. Other backups remain listed with unmeasured consumption.')
    case 'File inventory not loaded within this refresh limit.': return t('File inventory not loaded within this refresh limit.')
    case 'Workload identity details are unavailable. The selected ID remains the scope of this view.': return t('Workload identity details are unavailable. The selected ID remains the scope of this view.')
    case 'Repository online status is unavailable.': return t('Repository online status is unavailable.')
    case 'VBR returned restore points outside the selected backup. No results were displayed.': return t('VBR returned restore points outside the selected backup. No results were displayed.')
    case 'Restore-point collection is partial. Counts and dates describe loaded records only.': return t('Restore-point collection is partial. Counts and dates describe loaded records only.')
    case 'Repository states are partial. Missing online states remain unknown.': return t('Repository states are partial. Missing online states remain unknown.')
    case 'Backup enrichment reached its limit. Some file and destination evidence is unavailable.': return t('Backup enrichment reached its limit. Some file and destination evidence is unavailable.')
    case 'Some restore-point dates are missing, invalid, or in the future. Freshness excludes those dates.': return t('Some restore-point dates are missing, invalid, or in the future. Freshness excludes those dates.')
  }
  const number = (value: string) => new Intl.NumberFormat(locale).format(Number(value))
  let match: RegExpMatchArray | null
  if ((match = value.match(/^Backup (.+): destination and job details unavailable\.$/))) return t('Backup {id}: destination and job details unavailable.', { id: match[1] })
  if ((match = value.match(/^Backup (.+): file evidence unavailable\. File sizes remain unknown\.$/))) return t('Backup {id}: file evidence unavailable. File sizes remain unknown.', { id: match[1] })
  if ((match = value.match(/^Backup (.+): file collection is partial\.$/))) return t('Backup {id}: file collection is partial.', { id: match[1] })
  if ((match = value.match(/^(\d+) restore point\(s\) have no unambiguous file mapping\. Storage totals cover matched files only\.$/))) return t('{count} restore points have no unambiguous file mapping. Storage totals cover matched files only.', { count: number(match[1]) })
  if ((match = value.match(/^(\d+) conflicting file IDs excluded from the combined consumption subtotal\.$/))) return t('{count} conflicting file IDs excluded from the combined consumption subtotal.', { count: number(match[1]) })
  if ((match = value.match(/^Files for (.+): unrelated records were excluded\.$/))) return t('Files for {name}: unrelated records were excluded.', { name: match[1] })
  const label = (source: string): string | null => {
    switch (source) {
      case 'Repository configuration': return t('Repository configuration')
      case 'Repository states': return t('Repository states')
      case 'Scale-out repositories': return t('Scale-out repositories')
      case 'Backup inventory': return t('Backup inventory')
      case 'Job states': return t('Job states')
      default: return source.startsWith('Files for ') ? t('Files for {name}', { name: source.slice(10) }) : null
    }
  }
  if ((match = value.match(/^(.+): partial collection\. Only loaded records are included\.$/))) {
    const section = label(match[1]); if (section) return t('{section}: partial collection. Only loaded records are included.', { section })
  }
  if ((match = value.match(/^(.+) unavailable\. (Your account cannot read these records\.|The response did not match the expected fields\.|The source could not return these records\.)$/))) {
    const section = label(match[1]); if (section) return t('{section} unavailable. {reason}', { section, reason: recoveryDiagnostic(t, match[2], locale) })
  }
  return vbrError(t, value)
}
