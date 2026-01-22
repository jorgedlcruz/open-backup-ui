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

/**
 * Checks if telemetry is explicitly disabled by the user.
 * Returns true if disabled, false otherwise.
 */
export const isTelemetryDisabled = (): boolean => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
}

/**
 * Disables telemetry.
 */
export const disableTelemetry = () => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, 'true')
}

/**
 * Enables telemetry.
 */
export const enableTelemetry = () => {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(STORAGE_KEY)
}
