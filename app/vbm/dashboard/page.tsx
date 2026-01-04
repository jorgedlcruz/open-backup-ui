"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect } from "react"
import { veeamApi } from "@/lib/api/veeam-client"
import { VBMLicense, VBMHealth, VBMServiceInstance } from "@/lib/types/vbm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, ShieldCheck, Mail, Server, AlertCircle, CheckCircle2 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { SessionsOverview } from "@/components/sessions-overview"
import { VeeamSession, SessionResult } from "@/lib/types/veeam"

export default function VBMDashboardPage() {
    const [stats, setStats] = useState<{
        jobs: number;
        storage?: number;
        license?: VBMLicense;
        health?: VBMHealth;
        version?: VBMServiceInstance;
    }>({ jobs: 0 })

    // Sessions State
    const [sessions, setSessions] = useState<VeeamSession[]>([])
    const [timeRange, setTimeRange] = useState<"7d" | "30d">("7d")

    // Loading states
    const [loadingStats, setLoadingStats] = useState(true)
    const [loadingSessions, setLoadingSessions] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // 1. Fetch Static Stats (Run once)
    useEffect(() => {
        const fetchStats = async () => {
            try {
                setLoadingStats(true)
                const [jobsData, license, health, version] = await Promise.all([
                    veeamApi.getVBMJobs(),
                    veeamApi.getVBMLicense(),
                    veeamApi.getVBMHealth(),
                    veeamApi.getVBMServiceInstance(),
                ])

                // Calculate Storage Usage from all Organizations
                let totalStorage = 0
                try {
                    const organizations = await veeamApi.getVBMOrganizations()
                    // Fetch storage for each org concurrently
                    const storagePromises = organizations.map(org =>
                        veeamApi.getVBMOrganizationUsedRepositories(org.id)
                            .catch(() => []) // Handle individual failures gracefully
                    )
                    const results = await Promise.all(storagePromises)

                    // Sum up all usage
                    results.flat().forEach(repo => {
                        totalStorage += (repo.localCacheUsedSpaceBytes || 0) + (repo.objectStorageUsedSpaceBytes || 0)
                    })
                } catch (e) {
                    console.error("Failed to calculate storage usage", e)
                }

                setStats({
                    jobs: jobsData.length,
                    storage: totalStorage,
                    license,
                    health,
                    version
                })
            } catch (err) {
                console.error("Failed to load dashboard stats", err)
                // Don't block UI on stats failure, just show error toast effectively? 
                // For now, minimal error handling on top level
            } finally {
                setLoadingStats(false)
            }
        }
        fetchStats()
    }, [])

    // 2. Fetch Sessions (Run on timeRange change)
    useEffect(() => {
        const fetchSessions = async () => {
            try {
                setLoadingSessions(true)

                // Calculate date filter
                const days = timeRange === '7d' ? 7 : 30
                const date = new Date()
                date.setDate(date.getDate() - days)
                const endTimeLowerBound = date.toISOString()

                // Fetch jobs to map names (we could cache this more efficiently, but it's fast enough)
                const jobsData = await veeamApi.getVBMJobs()
                const jobNameMap = new Map(jobsData.map(j => [j.id, j.name]))

                // Fetch filtered sessions with higher limit
                const sessionsData = await veeamApi.getVBMJobSessions(undefined, {
                    limit: 1000,
                    endTimeLowerBound
                })

                // Map VBM sessions to VeeamSession format
                const mappedSessions: VeeamSession[] = sessionsData.map(s => {
                    let resultType: SessionResult = 'None'
                    if (s.status === 'Success') resultType = 'Success'
                    else if (s.status === 'Warning') resultType = 'Warning'
                    else if (s.status === 'Failed') resultType = 'Failed'
                    else if (s.status === 'Running') resultType = 'None'

                    return {
                        id: s.id,
                        name: jobNameMap.get(s.jobId) || `Job ${s.jobId.substring(0, 8)}...`,
                        jobId: s.jobId,
                        sessionType: s.jobType,
                        creationTime: s.creationTime,
                        endTime: s.endTime,
                        state: s.status === 'Running' ? 'Working' : 'Stopped',
                        result: {
                            result: resultType,
                            message: s.details
                        },
                        usn: 0
                    }
                })

                setSessions(mappedSessions)

            } catch (err) {
                console.error("Failed to load sessions", err)
                setError("Failed to load sessions data")
            } finally {
                setLoadingSessions(false)
            }
        }

        fetchSessions()
    }, [timeRange])

    return (
        <div className="flex-1 overflow-auto bg-background">
            <div className="container mx-auto py-8 px-4 space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
                    <p className="text-muted-foreground mt-1">
                        Overview of your Microsoft 365 backup environment
                    </p>
                </div>

                {error && (
                    <div className="bg-destructive/15 border border-destructive/20 text-destructive px-4 py-3 rounded flex items-center gap-2">
                        <AlertCircle className="h-5 w-5" />
                        {error}
                    </div>
                )}

                {/* Top Stats Row */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
                            <Mail className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            {loadingStats ? <Skeleton className="h-8 w-16" /> : (
                                <div className="text-2xl font-bold">{stats.jobs}</div>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">Configured policies</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Storage Capacity</CardTitle>
                            <Server className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.storage !== undefined ? (stats.storage / 1024 / 1024 / 1024).toFixed(2) + ' GB' : <Skeleton className="h-8 w-24" />}</div>
                            <p className="text-xs text-muted-foreground mt-1">Total Used Space</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">License Usage</CardTitle>
                            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            {stats.license ? (
                                <>
                                    <div className="text-2xl font-bold">
                                        {stats.license.usedNumber} <span className="text-sm font-normal text-muted-foreground">/ {stats.license.totalNumber}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">{stats.license.type} License</p>
                                </>
                            ) : <Skeleton className="h-8 w-24" />}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">System Version</CardTitle>
                            <Activity className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            {stats.version ? (
                                <div className="text-2xl font-bold truncate" title={stats.version.version}>
                                    {stats.version.version}
                                </div>
                            ) : <Skeleton className="h-8 w-24" />}
                            <p className="text-xs text-muted-foreground mt-1">Build Number</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Main Content Grid */}
                <div className="grid gap-6 md:grid-cols-7 lg:grid-cols-7">

                    {/* Left Column: Sessions Overview (Takes 5 cols to match VBR ratio roughly) */}
                    <div className="col-span-4 lg:col-span-5">
                        <SessionsOverview
                            sessions={sessions}
                            loading={loadingSessions}
                            timeRange={timeRange}
                            onTimeRangeChange={setTimeRange}
                            defaultFilterType={["Backup"]}
                        />
                    </div>

                    {/* Right Column: Component Status & License Details (Takes 2 cols) */}
                    <div className="col-span-3 lg:col-span-2 space-y-6">

                        {/* 1. Component Status (Health) */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Component Status</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {loadingStats && !stats.health ? (
                                    <div className="space-y-2">
                                        <Skeleton className="h-10 w-full" />
                                        <Skeleton className="h-10 w-full" />
                                    </div>
                                ) : stats.health ? (
                                    <>
                                        <div className="flex items-center justify-between p-3 border rounded-lg bg-card/50">
                                            <div className="space-y-0.5">
                                                <p className="font-medium text-sm">Config DB</p>
                                                <p className="text-xs text-muted-foreground">Database</p>
                                            </div>
                                            {stats.health.entries.configurationDb.status === 'Healthy' ? (
                                                <CheckCircle2 className="h-5 w-5 text-green-500" />
                                            ) : (
                                                <AlertCircle className="h-5 w-5 text-destructive" />
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between p-3 border rounded-lg bg-card/50">
                                            <div className="space-y-0.5">
                                                <p className="font-medium text-sm">NATS</p>
                                                <p className="text-xs text-muted-foreground">Messaging</p>
                                            </div>
                                            {stats.health.entries.nats.status === 'Healthy' ? (
                                                <CheckCircle2 className="h-5 w-5 text-green-500" />
                                            ) : (
                                                <AlertCircle className="h-5 w-5 text-destructive" />
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-sm text-muted-foreground">Status unavailable</div>
                                )}
                            </CardContent>
                        </Card>

                        {/* 2. License Details (Moved here) */}
                        <Card>
                            <CardHeader>
                                <CardTitle>License Information</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {loadingStats && !stats.license ? (
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-full" />
                                        <Skeleton className="h-4 w-3/4" />
                                        <Skeleton className="h-20 w-full" />
                                    </div>
                                ) : stats.license ? (
                                    <>
                                        <div className="space-y-1">
                                            <p className="text-xs font-medium text-muted-foreground">Licensed To</p>
                                            <p className="text-sm font-medium truncate" title={stats.license.licensedTo}>{stats.license.licensedTo}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs font-medium text-muted-foreground">Email</p>
                                            <p className="text-sm truncate" title={stats.license.email}>{stats.license.email}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs font-medium text-muted-foreground">Support ID</p>
                                            <p className="text-sm">{stats.license.supportID}</p>
                                        </div>
                                        <div className="pt-2 border-t mt-2">
                                            <div className="flex justify-between text-sm mb-1.5">
                                                <span>Consumption</span>
                                                <span className="font-medium">{stats.license.usedNumber} / {stats.license.totalNumber}</span>
                                            </div>
                                            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-primary transition-all"
                                                    style={{ width: `${Math.min((stats.license.usedNumber / stats.license.totalNumber) * 100, 100)}% ` }}
                                                />
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-sm text-muted-foreground">License info unavailable</div>
                                )}
                            </CardContent>
                        </Card>

                    </div>
                </div>
            </div>
        </div>
    )
}
