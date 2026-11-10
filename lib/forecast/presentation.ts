// Open Backup UI v1.2.0
import type { MessageValues } from '../i18n/model'
import type { Policy } from './model'
import { evidenceText } from './evidence-presentation'

type Translator = (source: string, values?: MessageValues) => string
type NumberFormat = (value: number) => string

/** Translate policy presentation only. Stored job settings remain API identifiers. */
export function localizedPolicy(t: Translator, policy?: Policy, number: NumberFormat = String) {
  const retention = policy?.storage?.retentionPolicy
  if (!retention?.quantity) return t('Retention not reported')
  return retention.type === 'Days' ? t('{count} days', { count: number(retention.quantity) }) : retention.type === 'RestorePoints' ? t('{count} restore points', { count: number(retention.quantity) }) : t('Retention not reported')
}

export function localizedSchedule(t: Translator, policy?: Policy) {
  if (policy?.isDisabled === true || policy?.schedule?.runAutomatically === false) return t('Automatic runs disabled')
  const daily = policy?.schedule?.daily
  if (!daily?.isEnabled) return t('Schedule not modeled')
  return daily.dailyKind === 'Everyday' ? t('Daily') : daily.dailyKind === 'WeekDays' ? t('Weekdays') : daily.days?.map(day => t(day)).join(', ') || t('Schedule not reported')
}

export function localizedFull(t: Translator, policy?: Policy) {
  const settings = policy?.storage?.advancedSettings
  if (!settings) return t('Full schedule not reported')
  const schedules = ([['Synthetic', settings.syntheticFulls], ['Active', settings.activeFulls]] as const).flatMap(([name, schedule]) => schedule?.isEnabled ? [t('{type}: {schedule}', { type: t(name), schedule: schedule.monthly?.isEnabled ? t('Monthly') : schedule.weekly?.days?.map(day => t(day)).join(', ') || t('Schedule unknown') })] : [])
  return schedules.join(' · ') || (settings.syntheticFulls?.isEnabled === false && settings.activeFulls?.isEnabled === false ? t('Forever forward incremental') : t('Full schedule not reported'))
}

/** Only known app-authored templates are interpreted; unrecognized server diagnostics pass through. */
export function planningMessage(t: Translator, text: string | null | undefined): string {
  if (!text) return ''
  let match: RegExpMatchArray | null
  if ((match = text.match(/^(\d+) days · hardened repository$/))) return t('{count} days · hardened repository', { count: match[1] })
  if ((match = text.match(/^(\d+) days · governance$/))) return t('{count} days · governance', { count: match[1] })
  if ((match = text.match(/^(\d+|Unknown) days \+ storage generation rules$/))) return t('{count} days + storage generation rules', { count: match[1] === 'Unknown' ? t('Unknown') : match[1] })
  if ((match = text.match(/^No restore point in (\d+) days$/))) return t('No restore point in {count} days', { count: match[1] })
  if ((match = text.match(/^(\d+) files excluded from the scenario: (.+)\.$/))) return t('{count} files excluded from the scenario: {reason}.', { count: match[1], reason: planningMessage(t, match[2]) })
  if ((match = text.match(/^(\d+) repositories have measured capacity; (\d+) are unmeasured or aggregate records\.$/))) return t('{measured} repositories have measured capacity; {unknown} are unmeasured or aggregate records.', { measured: match[1], unknown: match[2] })
  if ((match = text.match(/^VBR reports (.+) archival flags\. An expiry date is not reported\.$/))) return t('VBR reports {flags} archival flags. An expiry date is not reported.', { flags: match[1].split(', ').map(flag => t(flag)).join(', ') })
  return planningMessages.has(text) ? t(text) : evidenceText(t, text)
}

// Populated from the explicit planning descriptions; no workload names or upstream error text.
export const planningMessages = new Set<string>(["An in-window increment still depends on this full/incremental chain.","This is the latest retained chain. Its baseline/merge dependencies need review in VBR before removal.","Forecasts cover loaded backup consumers only. New jobs or workloads have no file-size baseline.","Scale-out group file totals include its loaded extents. Files assigned to the parent are not guessed onto individual extents; no aggregate physical runway is calculated.","Parent-assigned scale-out backups cannot be attributed to this extent. Inspect the scale-out group for its file consumers.","Forecast evidence is unavailable.",
  "restore points",
  "Retention not reported",
  "Automatic runs disabled",
  "Schedule not modeled",
  "Schedule not reported",
  "Full schedule not reported",
  "schedule unknown",
  "Forever forward incremental",
  "Complete, unambiguous file sizes are required",
  "Job policy unavailable or job no longer exists",
  "Automatic runs disabled; manual runs and background retention are not predictable",
  "This job type is not yet modeled",
  "Requires one daily or selected-weekday schedule",
  "Daily schedule is incomplete",
  "Requires forward incremental backup mode",
  "Full-backup settings are incomplete",
  "Monthly or incomplete full schedules are not yet modeled",
  "Retention policy is incomplete",
  "Repository deletion eligibility is not fully reported; no expiry credit is applied.",
  "GFS is enabled or unknown; chains are held through the horizon instead of inventing archive expiry dates.",
  "Fast Clone is configured. File footprint does not equal separately allocated disk blocks.",
  "File-to-workload membership is missing",
  "Only full .vbk and forward incremental .vib files are modeled",
  "File dates are missing, invalid or in the future",
  "An incremental file has no retained full baseline",
  "At least two retained increments per workload chain are required",
  "File evidence is older than 14 days",
  "One successful run per scheduled day; UTC day buckets, fixed full size and recent median increment size. Retries, new workloads and intra-day timing are excluded.",
  "The daily peak sums per-chain sizes before expiry. Different job start times may reduce the simultaneous footprint.",
  "Overlapping workload membership prevents independent chain sizing",
  "Within short-term window",
  "Chain dependency",
  "Configured hold window",
  "Past window · review",
  "Evidence unresolved",
  "Repository governance disabled",
  "Object immutability disabled",
  "Object lock follows retention · expiry not reported",
  "File lock expiry not reported",
  "File membership, dates, job type or retention policy cannot establish a short-term window.",
  "File creation is inside the current short-term retention window.",
  "The last file in this chain plus the current hardened-repository period reaches beyond today. This is a planning estimate; actual lock attributes and earlier policy settings are not returned.",
  "Every loaded file in this inactive chain is outside the short-term window. Review GFS, file locks, background retention and storage placement in VBR; this is not a deletion recommendation.",
  "The latest scoped restore-point query returned this recovery time. Archive-only or intentionally stopped backups may be expected.",
  "No restore points returned",
  "The scoped endpoint returned no points. Verify the backup type and VBR inventory; files are not assumed safe to remove.",
  "Recovery age unknown",
  "Latest restore-point evidence is unavailable.",
  "No job reference",
  "This backup has no usable job reference. Imported or detached backups may be intentional.",
  "Job not in inventory",
  "The referenced job is absent from the complete returned job inventory. Treat this as an orphan candidate, not confirmed deletion eligibility.",
  "Job linkage unresolved",
  "Job inventory is partial or unavailable. This backup cannot be classified as orphaned.",
  "Current job settings disable automatic runs. Manual backup and retention behavior may still apply.",
  "File evidence incomplete",
  "Some file sizes or identities are unresolved.",
  "Unmapped workload files",
  "Some files have no explicit workload membership. Their bytes remain in the backup subtotal.",
  "Full baseline not reported",
  "A complete file listing has increments without a reported .vbk for that membership. Investigate storage tiers and chain metadata in VBR.",
  "Waiting for the first scheduled collection.",
  "Background collection is disabled by CAPACITY_COLLECTOR_ENABLED=false.",
  "Unattended collection requires a VBR source with saved server credentials. Browser-only sessions still record during refresh.",
  "The next collection is overdue. Check the app server and its data-directory access.",
  "Invalid collector scope",
  "Unsupported source protocol",
  "Reading repository capacity from VBR.",
  "Source configuration changed during collection. This reading was discarded.",
  "Saved credentials could not authenticate. Review this data source.",
  "Unsupported collector request.",
  "VBR authentication failed. Review the saved source credentials.",
  "The source account cannot read repository capacity.",
  "VBR repository capacity could not be read. The collector will retry on its next schedule.",
  "Repository inventory was partial. Only returned measurements were saved.",
  "Collection timed out. The next scheduled attempt will retry.",
  "Collection could not complete. Check source connectivity and app data-directory access.",
  "A collection could not be scheduled. Check app data-directory access.",
  "Collector could not read saved source configuration.",
  "Collector status could not be read. Check app data-directory access."
])
