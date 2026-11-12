// Open Backup UI v1.2.0
import type { Translator } from '@/lib/i18n/presentation'
import { vbrError } from '@/lib/i18n/vbr-errors'

/** Local wizard messages are translated; provider errors remain reported evidence. */
export function backupCopyMessage(t: Translator, value: string): string {
  switch (value) {
    case 'Job name cannot be empty': return t('Job name cannot be empty')
    case 'A job with this name already exists': return t('A job with this name already exists')
    case 'Failed to create Backup Copy Job': return t('Failed to create Backup Copy Job')
    case 'Failed to load source jobs.': return t('Failed to load source jobs.')
    default: return vbrError(t, value)
  }
}
