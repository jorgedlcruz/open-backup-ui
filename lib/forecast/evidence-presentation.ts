// Open Backup UI v1.2.0
import type { MessageValues } from '../i18n/model'
import { vbrError } from '../i18n/vbr-errors'
type Translator = (source: string, values?: MessageValues) => string

const sectionNames = new Set(['Repository states', 'Repository settings', 'Scale-out membership', 'Job policies', 'Workload inventory', 'Backup inventory', 'Workloads', 'Backups', 'Jobs', 'Repositories', 'Job details', 'Repository details', 'Malware events', 'Recent sessions', 'Detection settings'])
function sectionLabel(t: Translator, text: string): string | null {
  if (sectionNames.has(text)) return t(text)
  const match = text.match(/^(Files for|Workloads for|Members of|Tasks for) (.+)$/)
  if (!match) return null
  switch (match[1]) {
    case 'Files for': return t('Files for {name}', { name: match[2] })
    case 'Workloads for': return t('Workloads for {name}', { name: match[2] })
    case 'Members of': return t('Members of {name}', { name: match[2] })
    case 'Tasks for': return t('Tasks for {name}', { name: match[2] })
    default: return null
  }
}

export const evidenceMessages = new Set([
  'Restore-point response did not honor the requested backup scope or limit.',
  'Restore-point pagination was inconsistent.',
  'Latest restore-point time was missing, invalid or in the future.',
  'Latest restore-point evidence could not be read.',
  'Version discovery unavailable; newer policy fields may be missing.',
  'Repository inventory is unavailable. Check the VBR connection and permissions.',
  'File collection was outside this refresh limit',
  'File inventory unavailable',
  'No file inventory reported for this backup type',
  'File inventory is partial',
  'Conflicting file identities excluded',
  'File enrichment is limited to 60 backups per refresh. Other backups remain visible as unmodeled.',
  'Server version unavailable. Using API 1.3-rev1; newer detection settings may not be reported.',
  'Read access was denied.',
  'The response did not match the expected fields.',
  'The source could not return these records.',
  'Malware events and recent sessions are unavailable. Check the source connection and read permissions.',
])

const collectionTemplates = [
  [/^(.+): partial collection\.$/, '{label}: partial collection.'],
  [/^(.+) unavailable; missing evidence is not zero\.$/, '{label} unavailable; missing evidence is not zero.'],
  [/^(.+) reached the view limit; some records are not shown\.$/, '{label} reached the view limit; some records are not shown.'],
  [/^(.+) could not be loaded\. Their status is unknown\.$/, '{label} could not be loaded. Their status is unknown.'],
  [/^(.+): partial collection\. Only loaded records are included\.$/, '{label}: partial collection. Only loaded records are included.'],
] as const

/** Anchored application diagnostics only. Resource names and unfamiliar vendor output stay literal. */
export function evidenceText(t: Translator, text: string | null | undefined): string {
  if (!text) return ''
  if (evidenceMessages.has(text)) return t(text)
  for (const [pattern, key] of collectionTemplates) {
    const match = text.match(pattern)
    if (!match) continue
    const label = sectionLabel(t, match[1])
    if (label !== null) return t(key, { label })
  }
  let match: RegExpMatchArray | null
  if ((match = text.match(/^(.+) unavailable\. (Read access was denied\.|The response did not match the expected fields\.|The source could not return these records\.)$/))) {
    const label = sectionLabel(t, match[1])
    if (label !== null) return t('{section} unavailable. {reason}', { section: label, reason: t(match[2]) })
  }
  if ((match = text.match(/^(\d+) conflicting file identities were excluded\. Affected backup chains cannot be modeled\.$/))) return t('{count} conflicting file identities were excluded. Affected backup chains cannot be modeled.', { count: match[1] })
  if ((match = text.match(/^Workload membership could not be loaded for (\d+) backup\(s\)\. Some connections are unknown\.$/))) return t('Workload membership could not be loaded for {count} backup(s). Some connections are unknown.', { count: match[1] })
  if ((match = text.match(/^Session analysis is limited to the (\d+) most recent loaded sessions; it does not cover the full session history\.$/))) return t('Session analysis is limited to the {count} most recent loaded sessions; it does not cover the full session history.', { count: match[1] })
  if ((match = text.match(/^Tasks for (.+): records from another session were excluded\.$/))) return t('Tasks for {name}: records from another session were excluded.', { name: match[1] })
  return vbrError(t, text)
}

// Exposed for source coverage tests; technical API payload values never enter these registries.
export const evidenceSectionNames = sectionNames
export const evidenceCollectionTemplates = collectionTemplates
