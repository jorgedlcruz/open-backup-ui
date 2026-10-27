export type Preference = { enabled: boolean | null; source: 'default' | 'saved' | 'unavailable' | 'invalid' }
export type CaptureSetting = 'enabled' | 'disabled' | 'custom' | 'project-managed' | 'unknown'
export type Snapshot = {
  checkedAt: string; configured: boolean; destination: string | null; preference: Preference;
  initialized: boolean; optedOut: boolean | null; online: boolean | null; sdkVersion: string | null;
  runtimeError: boolean; lastRequestError: { at: string; status: number | null } | null;
  pageViews: CaptureSetting; interactions: CaptureSetting; exceptions: CaptureSetting;
  sessionReplay: CaptureSetting; recording: boolean | null;
}
export type Diagnostic = { id: string; name: string; status: string; tone: 'success' | 'warning' | 'neutral'; detail: string }

export function parsePreference(value: string | null): Preference {
  if (value === null) return { enabled: true, source: 'default' }
  if (value === 'true' || value === 'false') return { enabled: value === 'false', source: 'saved' }
  return { enabled: null, source: 'invalid' }
}
export function destination(host: unknown): string | null {
  try {
    if (typeof host !== 'string') return null
    const url = new URL(host)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    return url.origin
  } catch { return null }
}
export function configured(key: unknown, host: unknown) {
  return typeof key === 'string' && !!key.trim() && !key.includes('REPLACE') && !!destination(host)
}
export function captureSetting(value: unknown, fallback: CaptureSetting = 'unknown'): CaptureSetting {
  if (value === false) return 'disabled'
  if (value === true || value === 'history_change') return 'enabled'
  if (value && typeof value === 'object') return 'custom'
  return fallback
}
export function collectionState(s: Snapshot): { label: string; detail: string; tone: Diagnostic['tone'] } {
  if (!s.configured) return { label: 'Not configured', detail: 'A project token and destination are required.', tone: 'warning' }
  if (s.runtimeError) return { label: 'Runtime issue', detail: 'The SDK could not apply or read the local collection state.', tone: 'warning' }
  if (s.preference.enabled === null) return { label: 'Preference unavailable', detail: 'The sharing preference cannot be read. Inspect SDK capture permission below.', tone: 'warning' }
  if (!s.preference.enabled) return { label: 'Disabled', detail: 'Usage sharing is turned off in this browser.', tone: 'neutral' }
  if (!s.initialized) return { label: 'Not initialized', detail: 'Sharing is allowed, but the SDK has not initialized.', tone: 'warning' }
  if (s.optedOut === null) return { label: 'State unavailable', detail: 'The SDK capture preference could not be read.', tone: 'warning' }
  if (s.optedOut) return { label: 'SDK opted out', detail: 'The SDK opt-out blocks collection despite the browser setting.', tone: 'warning' }
  if (s.online === false) return { label: 'Browser offline', detail: 'The browser reports no network connection. Delivery is not verified.', tone: 'warning' }
  return { label: 'Ready locally', detail: 'The SDK is initialized and permits capture. Delivery is not verified.', tone: 'success' }
}
export function diagnostics(s: Snapshot): Diagnostic[] {
  const optedOut = s.optedOut === true
  return [
    { id: 'configuration', name: 'Project configuration', status: s.configured ? 'Configured' : 'Needs configuration', tone: s.configured ? 'success' : 'warning', detail: s.configured ? 'A project token and supported destination are present. Token validity is not tested.' : 'Set the application’s PostHog project token and destination before enabling collection.' },
    { id: 'preference', name: 'Browser preference', status: s.preference.enabled === null ? 'Cannot read preference' : s.preference.source === 'default' ? 'Default · allowed' : s.preference.enabled ? 'Saved · allowed' : 'Saved · disabled', tone: s.preference.enabled === null ? 'warning' : 'success', detail: s.preference.source === 'unavailable' ? 'Browser storage is unavailable. Allow local storage and reload to reapply the preference.' : s.preference.source === 'invalid' ? 'The stored preference is invalid. Use the sharing switch to replace it.' : 'This preference belongs to this browser and site. It is not a server-wide policy.' },
    { id: 'sdk', name: 'SDK initialization', status: s.runtimeError ? 'Runtime issue' : s.initialized ? 'Initialized' : s.preference.enabled && s.configured ? 'Not initialized' : 'Not started', tone: s.runtimeError || (!s.initialized && s.preference.enabled === true && s.configured) ? 'warning' : s.initialized ? 'success' : 'neutral', detail: s.runtimeError ? 'Reload the page to retry initialization. No exception text or request payload is included here.' : 'Initialization confirms local SDK readiness, not access to the analytics service.' },
    { id: 'consent', name: 'SDK capture permission', status: !s.initialized ? 'Not initialized' : s.optedOut === null ? 'Unavailable' : optedOut ? 'Opted out' : 'Permitted locally', tone: s.initialized && (s.optedOut === null || (s.preference.enabled === true && optedOut) || (s.preference.enabled !== true && !optedOut)) ? 'warning' : 'neutral', detail: s.preference.enabled && optedOut ? 'To resume sharing, turn the switch off and on. A refresh does not override an SDK opt-out.' : 'The application preference and SDK opt-out are evaluated separately.' },
    { id: 'network', name: 'Browser network signal', status: s.online === null ? 'Unknown' : s.online ? 'Online reported' : 'Offline reported', tone: s.online === false && s.preference.enabled === true ? 'warning' : 'neutral', detail: 'The browser’s online flag cannot detect an ad blocker, firewall or provider outage.' },
    { id: 'recording', name: 'Session recording', status: s.recording === true ? 'Recording active' : s.sessionReplay === 'disabled' ? 'Disabled by application' : 'Unknown', tone: s.recording === true || s.sessionReplay !== 'disabled' ? 'warning' : 'success', detail: s.recording === true ? 'The SDK reports active recording despite the application’s disabled replay policy. Reload and review SDK configuration.' : s.sessionReplay === 'disabled' ? 'The application disables session replay. This control does not enable screenshots or session recording.' : 'The application requests disabled replay, but the current SDK configuration could not confirm it.' },
    { id: 'request', name: 'Last SDK request failure', status: s.lastRequestError ? s.lastRequestError.status ? `HTTP ${s.lastRequestError.status}` : 'Network failure' : 'None observed this visit', tone: s.lastRequestError ? 'warning' : 'neutral', detail: s.lastRequestError ? `Observed ${s.lastRequestError.at}. This may involve configuration or event requests; it is historical evidence, not current reachability.` : 'Only failures reported since this page runtime started are observed. Absence of a failure does not prove delivery.' },
    { id: 'delivery', name: 'Event delivery', status: 'Not verified', tone: 'neutral', detail: 'Refresh reads local state only. No test event is sent and no ingestion acknowledgement or event count is available.' },
  ]
}
/** Explicit allowlist: never export SDK config, tokens, IDs, URLs or raw errors. */
export function diagnosticReport(s: Snapshot) {
  return {
    schemaVersion: 1, checkedAt: s.checkedAt, scope: 'This browser only', provider: 'PostHog',
    destination: destination(s.destination), configured: s.configured, sdkVersion: s.sdkVersion,
    preference: { enabled: s.preference.enabled, source: s.preference.source },
    initialized: s.initialized, optedOut: s.optedOut, online: s.online, runtimeError: s.runtimeError,
    collection: collectionState(s).label, delivery: 'not-verified',
    capture: { pageViews: s.pageViews, interactions: s.interactions, exceptions: s.exceptions, sessionReplay: s.sessionReplay, recording: s.recording },
    lastRequestError: s.lastRequestError ? { at: s.lastRequestError.at, status: s.lastRequestError.status } : null,
  }
}
