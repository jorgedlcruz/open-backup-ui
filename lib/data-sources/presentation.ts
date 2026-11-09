// Open Backup UI v1.0.2
import type { MessageValues } from '@/lib/i18n/model'

type Translate = (source: string, values?: MessageValues) => string

// These messages are authored by this application, not returned by a backup
// platform. Keep unexpected upstream diagnostics intact rather than guessing.
export const sourceMessages = [
  'Run a connection check to verify API access.',
  'Live API checks are not implemented for this connector. Connection actions remain available.',
  'The API rejected the current token. Reconnect this source.',
  'The API is reachable and requires authentication.',
  'The API denied access to the check resource. Review account permissions.',
  'The configured API check is unavailable or rejected. Review the endpoint and API compatibility.',
  'The endpoint responded, but its API response could not be verified.',
  'Authenticated read succeeded. This check does not assert backup health or access to every API resource.',
  'API response verified without an authenticated token; authentication remains unverified.',
  'The endpoint responded but did not return a readable API response.',
  'No API response received. Check the endpoint, network, TLS and service availability.',
  'The connection check could not complete. Retry this source.',
  'The data-source request could not be completed. Check the connection details and try again.',
  'Data-source changes must originate from this application.',
  'Invalid data-source ID.',
  'This data source no longer exists. Refresh the list.',
  'Configuration changed during the check. Refresh to retry.',
  'Configuration changed during authentication. Refresh to retry.',
  'Data source not found.',
  'Enter a username and password to connect this source.',
  'The source did not return an authentication token.',
  'Enter a valid platform, display name and server URL.',
  'This platform and endpoint are already configured.',
  'This source is managed by environment configuration. Update it on the server.',
  'Enter a valid display name and server URL.',
  'Provide both a username and password, or use the saved credentials.',
  'Environment credentials must be updated on the server.',
  'This source changed during authentication. Refresh and reconnect.',
  'Unknown data-source action.',
  'Enter a hostname or IP address and a port between 1 and 65535.',
  'Use an HTTP or HTTPS server URL with a port and no path, credentials or query string.',
  'Enter a server URL without credentials, path or query parameters.',
  'The application did not return a data-source inventory. Please retry.',
  'The application returned an invalid data source. Please retry.',
  'Unable to reach the application. Check your connection, or reopen this page to renew browser access, then retry. Saved connections have not been changed.',
  'Your browser access session needs to be renewed. Reopen this page using HTTPS and complete the access sign-in, then retry. Your saved Veeam connections are still on the application server.',
  'The application returned an unreadable response. Please retry.',
  'Check failed.',
  'Action failed.',
] as const

const exactMessages = new Set<string>(sourceMessages)
const templates = [
  [/^The source returned HTTP (\d{3})\. It is reachable, but API access could not be verified\.$/, 'The source returned HTTP {status}. It is reachable, but API access could not be verified.'],
  [/^Authentication was not accepted \(HTTP (\d{3})\)\. Check credentials, permissions and any MFA requirements\.$/, 'Authentication was not accepted (HTTP {status}). Check credentials, permissions and any MFA requirements.'],
  [/^The application returned an unexpected response \(HTTP (\d{3})\)\. Please retry\.$/, 'The application returned an unexpected response (HTTP {status}). Please retry.'],
  [/^Application request failed \(HTTP (\d{3})\)\.$/, 'Application request failed (HTTP {status}).'],
] as const

function knownMessage(t: Translate, value: string): string | null {
  if (exactMessages.has(value)) return t(value)
  for (const [pattern, message] of templates) {
    const match = value.match(pattern)
    if (match) return t(message, { status: match[1] })
  }
  return null
}

export function sourceMessage(t: Translate, value: string): string {
  const exact = knownMessage(t, value)
  if (exact !== null) return exact
  // The health service can append a separate authentication failure to its
  // probe explanation. Translate only when both fragments are known copy.
  for (let boundary = value.indexOf('. '); boundary >= 0; boundary = value.indexOf('. ', boundary + 2)) {
    const first = knownMessage(t, value.slice(0, boundary + 1))
    const second = knownMessage(t, value.slice(boundary + 2))
    if (first !== null && second !== null) return `${first} ${second}`
  }
  return value
}
