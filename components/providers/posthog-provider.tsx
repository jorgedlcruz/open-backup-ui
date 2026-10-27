'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { useEffect } from 'react'
import { STORAGE_KEY, TELEMETRY_PREFERENCE_EVENT } from '@/lib/telemetry'
import { synchronizeTelemetry } from '@/lib/telemetry/runtime'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        synchronizeTelemetry()
        const preferenceChanged = () => synchronizeTelemetry(true)
        const storageChanged = (event: StorageEvent) => {
            if (event.key === STORAGE_KEY || event.key === null) synchronizeTelemetry(event.key === STORAGE_KEY)
        }
        window.addEventListener(TELEMETRY_PREFERENCE_EVENT, preferenceChanged)
        window.addEventListener('storage', storageChanged)
        return () => {
            window.removeEventListener(TELEMETRY_PREFERENCE_EVENT, preferenceChanged)
            window.removeEventListener('storage', storageChanged)
        }
    }, [])

    return <PHProvider client={posthog}>{children}</PHProvider>
}
