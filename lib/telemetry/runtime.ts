import posthog from 'posthog-js'
import { readTelemetryPreference, TELEMETRY_CONFIG } from '../telemetry'
import { captureSetting, configured, destination, type Snapshot } from './model'

export const TELEMETRY_STATUS_EVENT = 'open-backup-ui:telemetry-status'
let runtimeError = false
let lastRequestError: Snapshot['lastRequestError'] = null
const notify = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(TELEMETRY_STATUS_EVENT)) }

/** Synchronize collection in this browser; ordinary refresh never overrides SDK opt-out. */
export function synchronizeTelemetry(explicit = false) {
  runtimeError = false
  try {
    const preference = readTelemetryPreference()
    if (!configured(TELEMETRY_CONFIG.POSTHOG_KEY, TELEMETRY_CONFIG.POSTHOG_HOST) || preference.enabled !== true) {
      if (posthog.__loaded && !posthog.has_opted_out_capturing()) posthog.opt_out_capturing()
    } else if (posthog.__loaded) {
      if (explicit) posthog.opt_in_capturing({ captureEventName: false })
    } else {
      posthog.init(TELEMETRY_CONFIG.POSTHOG_KEY, {
        api_host: TELEMETRY_CONFIG.POSTHOG_HOST,
        person_profiles: 'identified_only',
        capture_pageview: false,
        disable_session_recording: true,
        loaded: client => {
          try {
            // A preference may change while SDK initialization is completing.
            if (readTelemetryPreference().enabled !== true) client.opt_out_capturing()
            else if (explicit) posthog.opt_in_capturing({ captureEventName: false })
          } catch { runtimeError = true }
          notify()
        },
        on_request_error: response => {
          lastRequestError = { at: new Date().toISOString(), status: Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599 ? response.statusCode : null }
          notify()
        },
      })
    }
  } catch { runtimeError = true }
  notify()
}

/** Reads a small allowlist of local evidence. Does not call capture, fetch or init. */
export function telemetrySnapshot(): Snapshot {
  const initialized = posthog.__loaded === true
  let optedOut: boolean | null = null, recording: boolean | null = null
  let readError = false
  if (initialized) {
    try { optedOut = posthog.has_opted_out_capturing(); recording = posthog.sessionRecordingStarted() }
    catch { readError = true }
  }
  const config = initialized ? posthog.config : null
  return {
    checkedAt: new Date().toISOString(), configured: configured(TELEMETRY_CONFIG.POSTHOG_KEY, TELEMETRY_CONFIG.POSTHOG_HOST), destination: destination(TELEMETRY_CONFIG.POSTHOG_HOST),
    preference: readTelemetryPreference(), initialized, optedOut, online: typeof navigator === 'undefined' ? null : navigator.onLine,
    sdkVersion: typeof posthog.version === 'string' && /^\d+\.\d+\.\d+[\w.+-]*$/.test(posthog.version) ? posthog.version : null,
    runtimeError: runtimeError || readError, lastRequestError,
    pageViews: config ? captureSetting(config.capture_pageview) : 'disabled',
    interactions: config ? captureSetting(config.autocapture) : 'unknown',
    exceptions: config ? captureSetting(config.capture_exceptions, 'project-managed') : 'project-managed',
    sessionReplay: config ? config.disable_session_recording === true ? 'disabled' : 'unknown' : 'disabled', recording,
  }
}
