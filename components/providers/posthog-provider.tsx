'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { useEffect } from 'react'
import { TELEMETRY_CONFIG, isTelemetryDisabled } from '@/lib/telemetry'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        // 1. Check if configured
        if (!TELEMETRY_CONFIG.POSTHOG_KEY || TELEMETRY_CONFIG.POSTHOG_KEY.includes('REPLACE')) {
            console.warn('PostHog is not configured. Telemetry disabled.')
            return
        }

        // 2. Check if user disabled it
        if (isTelemetryDisabled()) {
            console.log('Telemetry is disabled by user preference.')
            return
        }

        // 3. Initialize
        posthog.init(TELEMETRY_CONFIG.POSTHOG_KEY, {
            api_host: TELEMETRY_CONFIG.POSTHOG_HOST,
            person_profiles: 'identified_only',
            capture_pageview: false, // We handle this manually if needed, or let Next.js router handle it - sticking to auto for now usually works better
            disable_session_recording: true // Explicitly disable session recording for privacy 
        })
    }, [])

    return <PHProvider client={posthog}>{children}</PHProvider>
}
