'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Activity, Shield, AlertTriangle, CloudOff, Cloud } from 'lucide-react'
import { isTelemetryDisabled, disableTelemetry, enableTelemetry, TELEMETRY_CONFIG } from '@/lib/telemetry'
import { toast } from 'sonner'
import posthog from 'posthog-js'

export default function TelemetryPage() {
    const [enabled, setEnabled] = useState(true)
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
        setEnabled(!isTelemetryDisabled())
    }, [])

    const handleToggle = (checked: boolean) => {
        if (checked) {
            enableTelemetry()
            setEnabled(true)
            toast.success('Telemetry enabled. Thank you!', {
                description: 'Usage data will be shared to help improve the application.'
            })
            // If posthog is loaded, ensure it starts capturing
            if (posthog.__loaded) {
                posthog.opt_in_capturing()
            } else {
                window.location.reload() // Reload to initialize if it wasn't loaded
            }
        } else {
            disableTelemetry()
            setEnabled(false)
            toast.info('Telemetry disabled', {
                description: 'Usage data collection has been stopped.'
            })
            if (posthog.__loaded) {
                posthog.opt_out_capturing()
            }
        }
    }

    if (!mounted) return null

    const isConfigured = TELEMETRY_CONFIG.POSTHOG_KEY && !TELEMETRY_CONFIG.POSTHOG_KEY.includes('REPLACE')

    return (
        <div className="container max-w-4xl mx-auto py-8 px-4 space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight mb-2">Telemetry Settings</h1>
                <p className="text-muted-foreground">
                    Manage how usage data is collected and shared.
                </p>
            </div>

            {!isConfigured && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900 p-4 rounded-lg flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
                    <div className="space-y-1">
                        <h3 className="font-semibold text-yellow-900 dark:text-yellow-500">Telemetry Not Configured</h3>
                        <p className="text-sm text-yellow-800 dark:text-yellow-400">
                            The application is currently missing the PostHog API Key. Telemetry is inactive regardless of the settings below.
                            <br />
                            Please update <code>lib/telemetry.ts</code> with your key.
                        </p>
                    </div>
                </div>
            )}

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <CardTitle className="text-xl flex items-center gap-2">
                                <Activity className="h-5 w-5 text-primary" />
                                Usage Data Collection
                            </CardTitle>
                            <CardDescription>
                                Help us improve by sharing anonymous usage statistics.
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            {enabled ? (
                                <BadgeActive />
                            ) : (
                                <BadgeInactive />
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between space-x-4 rounded-lg border p-4 shadow-sm">
                        <div className="space-y-0.5">
                            <Label htmlFor="telemetry-mode" className="text-base font-semibold">
                                Share Usage Data
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                When enabled, we collect anonymous statistics about page views and feature usage.
                            </p>
                        </div>
                        <Switch
                            id="telemetry-mode"
                            checked={enabled}
                            onCheckedChange={handleToggle}
                            disabled={!isConfigured}
                        />
                    </div>

                    <div className="grid md:grid-cols-2 gap-6 pt-4">
                        <div className="space-y-3">
                            <h4 className="font-medium flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
                                <Shield className="h-4 w-4" /> What we collect
                            </h4>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li className="flex items-start gap-2">
                                    <span className="text-green-500">✓</span>
                                    <span><strong>Page Views:</strong> Which pages are visited most often.</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-green-500">✓</span>
                                    <span><strong>Device Info:</strong> Browser type, OS, and screen size to optimize UI.</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-green-500">✓</span>
                                    <span><strong>General Location:</strong> Country/Region level only (derived from IP).</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-green-500">✓</span>
                                    <span><strong>Errors:</strong> JavaScript errors to help us fix bugs.</span>
                                </li>
                            </ul>
                        </div>

                        <div className="space-y-3">
                            <h4 className="font-medium flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
                                <CloudOff className="h-4 w-4" /> What we DO NOT collect
                            </h4>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li className="flex items-start gap-2">
                                    <span className="text-red-500">✕</span>
                                    <span><strong>No API Data:</strong> We never see your backup jobs, server names, or IP addresses of your infrastructure.</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-red-500">✕</span>
                                    <span><strong>No Credentials:</strong> Passwords and API tokens stay on your server.</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-red-500">✕</span>
                                    <span><strong>No Personal Info:</strong> No names, emails, or phone numbers.</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </CardContent>
            </Card>


        </div>
    )
}

function BadgeActive() {
    return (
        <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-green-500/15 text-green-700 dark:text-green-400 hover:bg-green-500/25">
            <Cloud className="mr-1 h-3 w-3" />
            Active
        </div>
    )
}

function BadgeInactive() {
    return (
        <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-muted text-muted-foreground hover:bg-muted/80">
            <CloudOff className="mr-1 h-3 w-3" />
            Disabled
        </div>
    )
}
