// Open Backup UI v1.2.0
import { enumLabel, type Translator } from '../i18n/presentation'
import { vbrError } from '../i18n/vbr-errors'
import { time, validId, type Session } from './model'

type NumberFormat = (value: number, options?: Intl.NumberFormatOptions) => string

/** Presentation only: raw values remain available for filtering and API requests. */
export function investigationLabel(t: Translator, value?: string | null) {
  const labels: Record<string, string> = {
    Canceled: t('Canceled'), Scanning: t('Scanning'), Infected: t('Infected'), Clean: t('Clean'),
    Inconclusive: t('Inconclusive'), ActionRequired: t('Action required'), Pausing: t('Pausing'), Resuming: t('Resuming'),
    WaitingTape: t('Waiting for tape'), Postprocessing: t('Postprocessing'), WaitingRepository: t('Waiting for repository'),
    WaitingSlot: t('Waiting for slot'), InProgress: t('In progress'), Antivirus: t('Antivirus'),
    Source: t('Source'), Proxy: t('Proxy'), Network: t('Network'), Target: t('Target'),
    Never: t('Never'), Periodically: t('Periodically'), Continuously: t('Continuously'),
    'State not reported': t('State not reported'), 'Type not reported': t('Type not reported'),
    AgentDiscovery: t('Agent discovery'), BackupJob: t('Backup'), ReplicaJob: t('Replication'), BackupCopyJob: t('Backup copy'),
    AgentBackup: t('Agent backup'), EndpointBackup: t('Agent backup'), FileServerSave: t('File backup'),
    Finished: t('Completed'), Full: t('Full'), Incremental: t('Incremental'),
    UnstructuredDataBackupCopy: t('Unstructured data backup copy'),
    SqlLogBackup: t('SQL log backup'), OracleLogBackup: t('Oracle log backup'), PostgreSqlLogBackup: t('PostgreSQL log backup'),
    PlatformBackupJob: t('Platform backup'), PlatformSnapshotJob: t('Platform snapshot'), PlatformSnapshotCopyJob: t('Platform snapshot copy'),
    AgentOperationBackupNow: t('Agent backup'), AgentOperationActiveFull: t('Active full backup'),
    NotDefined: t('Not defined'), 'N/A': t('Not applicable'),
  }
  return value ? labels[value] ?? enumLabel(t, value) : t('Not reported')
}

/** Rates are provider-formatted measurements; translate only documented absence sentinels. */
export function investigationRate(t: Translator, value?: string | null) {
  if (value == null || value === '') return t('Not reported')
  if (value === 'N/A') return t('Not applicable')
  if (value === 'NotDefined') return t('Not defined')
  return value
}

export function investigationAttempt(t: Translator, session: Session, number: NumberFormat = String) {
  if (session.retryInfo) {
    const kind = session.retryInfo.isRecheckRetry === true ? t('Health-check retry')
      : session.retryInfo.isRecheckRetry === false ? t('Retry') : t('Retry (kind not reported)')
    return session.retryInfo.retryNumber != null ? t('{kind} {number}', { kind, number: number(session.retryInfo.retryNumber) }) : t('{kind} · unnumbered', { kind })
  }
  if (validId(session.originalSessionId)) return session.originalSessionId === session.id ? t('Original run') : t('{kind} · unnumbered', { kind: t('Retry') })
  return t('Run linkage not reported')
}

export function investigationDuration(t: Translator, record: Pick<Session, 'creationTime' | 'endTime' | 'progress'>, number: NumberFormat = String) {
  // VBR may supply an arbitrary formatted duration; retain that provider value.
  if (record.progress?.duration) return record.progress.duration
  const start = time(record.creationTime), end = time(record.endTime)
  if (start === null || end === null || end < start) return t('Not reported')
  const seconds = Math.floor((end - start) / 1000)
  return t('{hours}h {minutes}m {seconds}s', { hours: number(Math.floor(seconds / 3600)), minutes: number(Math.floor(seconds % 3600 / 60)), seconds: number(seconds % 60) })
}

/** Only messages authored by this loader are translated. Vendor diagnostics stay literal. */
export function investigationDiagnostic(t: Translator, value: string): string {
  const messages: Record<string, string> = {
    'The response did not match the expected API fields.': t('The response did not match the expected API fields.'),
    'The source could not return these records. Retry to load them.': t('The source could not return these records. Retry to load them.'),
    'Server version could not be checked. Using API 1.3-rev1; retry metadata may be unavailable.': t('Server version could not be checked. Using API 1.3-rev1; retry metadata may be unavailable.'),
    'VBR returned records outside the requested scope. Those records were excluded.': t('VBR returned records outside the requested scope. Those records were excluded.'),
    'Job configuration is unavailable. Retained sessions can still be investigated.': t('Job configuration is unavailable. Retained sessions can still be investigated.'),
    'Job investigation data could not be loaded.': t('Job investigation data could not be loaded.'),
    'VBR did not report an original-session ID for this run. Retry relationships cannot be established.': t('VBR did not report an original-session ID for this run. Retry relationships cannot be established.'),
    'The original-session record conflicts with this run. The chain could not be verified.': t('The original-session record conflicts with this run. The chain could not be verified.'),
    'The original run has no valid start time. Related attempts could not be searched.': t('The original run has no valid start time. Related attempts could not be searched.'),
    'Partial history. More attempts may exist.': t('Partial history. More attempts may exist.'),
    'Linked by the original-session ID reported by VBR. Covers retained history through this refresh.': t('Linked by the original-session ID reported by VBR. Covers retained history through this refresh.'),
    'VBR returned a different session than requested.': t('VBR returned a different session than requested.'),
    'This task does not belong to the selected session.': t('This task does not belong to the selected session.'),
    'Select a valid job and history range.': t('Select a valid job and history range.'),
    'Select a valid session.': t('Select a valid session.'),
    'Select a valid session and task.': t('Select a valid session and task.'),
    'The job action failed.': t('The job action failed.'),
  }
  if (messages[value]) return messages[value]
  const original = /^Original run unavailable\. ([\s\S]+)$/.exec(value)
  return original ? t('Original run unavailable. {reason}', { reason: investigationDiagnostic(t, original[1]) }) : vbrError(t, value)
}
