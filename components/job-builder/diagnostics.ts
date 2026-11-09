// Open Backup UI v1.0.2
import type { MessageValues } from '@/lib/i18n/model'
import { vbrError } from '@/lib/i18n/vbr-errors'

type Translator = (source: string, values?: MessageValues) => string

export function credentialTypeLabel(t: Translator, type: string): string {
  switch (type) {
    case 'Standard': return t('Standard credentials')
    case 'ManagedService': return t('Managed service account')
    case 'Linux': return 'Linux'
    default: return type
  }
}

/** Known application messages only. Provider diagnostics and captured names stay literal. */
export function builderDiagnostic(t: Translator, text: string): string {
  const exact: Record<string, string> = {
    'Select an inventory server from this VBR source.': t('Select an inventory server from this VBR source.'),
    'A job with this name already exists. Choose a unique name.': t('A job with this name already exists. Choose a unique name.'),
    'The selected repository is no longer available in this source.': t('The selected repository is no longer available in this source.'),
    'The selected repository is offline.': t('The selected repository is offline.'),
    'A selected proxy is unavailable or does not support this platform.': t('A selected proxy is unavailable or does not support this platform.'),
    'The guest credential is no longer available in this source.': t('The guest credential is no longer available in this source.'),
    'Limit this job to 20 inventory servers.': t('Limit this job to 20 inventory servers.'),
    'Reconnect the VBR data source.': t('Reconnect the VBR data source.'),
    'This profile changed or was removed. Reload the library before saving.': t('This profile changed or was removed. Reload the library before saving.'),
    'A profile’s category cannot be changed.': t('A profile’s category cannot be changed.'),
    'A profile with this name already exists in this category.': t('A profile with this name already exists in this category.'),
    'This source already has 200 profiles.': t('This source already has 200 profiles.'),
    'The profile library is busy. Try saving again.': t('The profile library is busy. Try saving again.'),
    'The request could not be completed.': t('The request could not be completed.'),
    'Renew your browser access session, then check selections again.': t('Renew your browser access session, then check selections again.'),
    'Validation must come from this application.': t('Validation must come from this application.'),
    'Job creation must come from this application.': t('Job creation must come from this application.'),
    'Profile changes must come from this application.': t('Profile changes must come from this application.'),
    'Select a supported platform and inventory server.': t('Select a supported platform and inventory server.'),
    'Your browser access session needs to be renewed. Reopen this page using HTTPS and complete the access sign-in, then retry. Your saved Veeam connections are still on the application server.': t('Your browser access session needs to be renewed. Reopen this page using HTTPS and complete the access sign-in, then retry. Your saved Veeam connections are still on the application server.'),
    'Unable to reach the application. Check your connection, or reopen this page to renew browser access, then retry. Saved connections have not been changed.': t('Unable to reach the application. Check your connection, or reopen this page to renew browser access, then retry. Saved connections have not been changed.'),
    'The application returned an unreadable response. Please retry.': t('The application returned an unreadable response. Please retry.'),
  }
  if (Object.hasOwn(exact, text)) return exact[text]
  switch (text) {
    case 'Failed to fetch backup jobs': return t('Job inventory is unavailable. Refresh to try again.')
    case 'No refresh token available': return vbrError(t, 'Your VBR session has expired. Reconnect your data source.')
    case 'The selected VBR source changed. Reload the job builder.':
    case 'The VBR source changed. Reload and validate again.':
    case 'The source changed. Refresh the job builder.': return t('The source changed. Refresh the job builder.')
    case 'The selected VBR source changed. Reload the library.':
    case 'The selected source changed. Refresh to load its profiles.': return t('The selected source changed. Refresh to load its profiles.')
    case 'Select a valid VBR source.': case 'Select a valid VBR data source.': return t('Select a valid VBR data source.')
    case 'Connect a VBR source.': case 'Load a VBR source first.': case 'Connect a VBR data source to explore protection.': return t('Connect a VBR data source to explore protection.')
    case 'VBR could not confirm creation. Check Jobs & Policies before trying again.':
    case 'VBR accepted the request but returned no confirmed job identity. Check Jobs & Policies.':
    case 'The connection ended before creation could be confirmed. Check Jobs & Policies before creating another job.':
    case 'Creation was not confirmed. Check Jobs & Policies before trying again.': return t('Creation was not confirmed. Check Jobs & Policies before trying again.')
  }
  let match = text.match(/^Some selected objects on (.+) could not be verified\. Re-select them from inventory\.$/)
  if (match) return t('Some selected objects on {host} could not be verified. Re-select them from inventory.', { host: match[1] })
  match = text.match(/^Inventory on (.+) could not be verified\. Refresh and try again\.$/)
  if (match) return t('Inventory on {host} could not be verified. Refresh and try again.', { host: match[1] })
  const sections: Record<string, string> = {
    Repositories: t('Repositories'), Proxies: t('Proxies'), 'Proxy availability': t('Proxy availability'),
    'Guest credentials': t('Guest credentials'), 'Job names': t('Job names'), 'Inventory servers': t('Inventory servers'),
  }
  match = text.match(/^(.+): only part of the inventory was returned\.$/)
  if (match && Object.hasOwn(sections, match[1])) return t('{section}: only part of the inventory was returned.', { section: sections[match[1]] })
  match = text.match(/^(.+) could not be loaded\. Refresh the source or check permissions\.$/)
  if (match && Object.hasOwn(sections, match[1])) return t('{section} could not be loaded. Refresh the source or check permissions.', { section: sections[match[1]] })
  match = text.match(/^The application returned an unexpected response \(HTTP (\d{3})\)\. Please retry\.$/)
  if (match) return t('The application returned an unexpected response (HTTP {status}). Please retry.', { status: match[1] })
  match = text.match(/^Application request failed \(HTTP (\d{3})\)\.$/)
  if (match) return t('Application request failed (HTTP {status}).', { status: match[1] })
  match = text.match(/^(?:API request failed|Authentication failed|Token refresh failed): (\d{3})(?: [A-Za-z ]+)?$/)
  if (match) return t('Application request failed (HTTP {status}).', { status: match[1] })
  match = text.match(/^VBR rejected the job \(HTTP (\d{3})\)\. Review the settings and permissions\.$/)
  if (match) return t('VBR rejected the job (HTTP {status}). Review the settings and permissions.', { status: match[1] })
  // The create route joins validation messages. Translate the whole result only
  // if every sentence is recognized; mixed vendor diagnostics remain unchanged.
  const prefixes = Object.keys(exact).sort((a, b) => b.length - a.length)
  let rest = text
  const translated: string[] = []
  while (rest) {
    const known = prefixes.find(source => rest === source || rest.startsWith(`${source} `))
    if (!known) break
    translated.push(exact[known]); rest = rest.slice(known.length).trimStart()
  }
  if (!rest && translated.length > 1) return translated.join(' ')
  return vbrError(t, text)
}
