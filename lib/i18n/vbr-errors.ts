// Open Backup UI v1.0.2
import type { Translator } from './presentation'

/** Exact application-authored errors only; upstream diagnostics pass through unchanged. */
export function vbrError(t: Translator, value: string): string {
  switch (value) {
    case 'Select a valid VBR data source.': return t('Select a valid VBR data source.')
    case 'Connect a VBR data source to explore protection.': return t('Connect a VBR data source to explore protection.')
    case 'Your VBR session has expired. Reconnect your data source.': return t('Your VBR session has expired. Reconnect your data source.')
    case 'Invalid VBR source protocol.': return t('Invalid VBR source protocol.')
    case 'Your VBR account cannot read the required backup records.': return t('Your VBR account cannot read the required backup records.')
    case 'The VBR platform could not return protection data.': return t('The VBR platform could not return protection data.')
    case 'Loading took too long. Retry or narrow the source environment.': return t('Loading took too long. Retry or narrow the source environment.')
    case 'Protection data could not be loaded. Check the connection and retry.': return t('Protection data could not be loaded. Check the connection and retry.')
    case 'Investigation data could not be loaded.': return t('Investigation data could not be loaded.')
    case 'VBR could not confirm the operation. Check Sessions before trying again.':
    case 'The result is unknown. Check Sessions before trying again.':
    case 'VBR accepted the operation but returned no session ID. Check Sessions before trying again.':
    case 'VBR accepted the file restore but its task ID is unavailable. Check Sessions before trying again.':
      return t(value)
    case 'Unauthorized': return t('Authorization required')
    case 'VEEAM_API_URL not configured': return t('VBR API URL is not configured.')
    case 'Internal server error': return t('Internal server error')
    default: return value
  }
}
