import { parsePreference, type Preference } from './telemetry/model'

export const TELEMETRY_CONFIG = {
    // SECURITY NOTE:
    // This Key is WRITE-ONLY. It allows the client to send events to PostHog.
    // It CANNOT be used to read data, access user profiles, or modify settings.
    // It is safe to be public in client-side code, similar to a Google Analytics ID.
    // 
    // If you are forking this repo or running your own instance, replace these values
    // with your own from your PostHog project settings.
    POSTHOG_KEY: 'phc_VZsOJdjxdUsdVXQrEDuq17vleGGDoqtitf0xT91RNYF',
    POSTHOG_HOST: 'https://eu.i.posthog.com',
}

export const STORAGE_KEY = 'veeam_telemetry_disabled'
export const TELEMETRY_PREFERENCE_EVENT = 'open-backup-ui:telemetry-preference'

export function readTelemetryPreference(): Preference {
    if (typeof window === 'undefined') return { enabled: null, source: 'unavailable' }
    try { return parsePreference(window.localStorage.getItem(STORAGE_KEY)) }
    catch { return { enabled: null, source: 'unavailable' } }
}

/**
 * Checks if telemetry is explicitly disabled by the user.
 * Returns true if disabled, false otherwise.
 */
export const isTelemetryDisabled = (): boolean => {
    return readTelemetryPreference().enabled !== true
}

function setPreference(enabled: boolean): boolean {
    if (typeof window === 'undefined') return false
    try {
        if (enabled) window.localStorage.removeItem(STORAGE_KEY)
        else window.localStorage.setItem(STORAGE_KEY, 'true')
        window.dispatchEvent(new Event(TELEMETRY_PREFERENCE_EVENT))
        return true
    } catch { return false }
}

/**
 * Disables telemetry.
 */
export const disableTelemetry = () => {
    return setPreference(false)
}

/**
 * Enables telemetry.
 */
export const enableTelemetry = () => {
    return setPreference(true)
}
