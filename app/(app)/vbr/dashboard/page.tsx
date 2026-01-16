"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef } from "react"
import { DashboardStats } from "@/components/dashboard-stats"
import { SessionsOverview } from "@/components/sessions-overview"
import { StorageCapacityWidget } from "@/components/storage-capacity-widget"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { veeamApi } from "@/lib/api/veeam-client"
import {
    VeeamBackupJob,
    VeeamSession,
    LicenseModel,
    MalwareEventModel,
    SecurityBestPracticeItem,
    VeeamServerInfo,
    TransferRateDataPoint
} from "@/lib/types/veeam"
import { calculateTransferRates } from "@/lib/utils/transfer-rate"
import { TransferRateChart } from "@/components/transfer-rate-chart"

export default function VBRPage() {
    const [jobs, setJobs] = useState<VeeamBackupJob[]>([])
    // const [repositories, setRepositories] = useState<RepositoryModel[]>([])
    const [serverInfo, setServerInfo] = useState<VeeamServerInfo | null>(null)
    const [license, setLicense] = useState<LicenseModel | null>(null)
    const [malwareEvents, setMalwareEvents] = useState<MalwareEventModel[]>([])
    const [securityItems, setSecurityItems] = useState<SecurityBestPracticeItem[]>([])
    const [sessions, setSessions] = useState<VeeamSession[]>([])
    const [timeRange, setTimeRange] = useState<"7d" | "30d">("7d")
    const [transferRateData, setTransferRateData] = useState<TransferRateDataPoint[]>([])

    const [loading, setLoading] = useState(true)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

    const hasLoadedOnce = useRef(false)

    const fetchData = useCallback(async () => {
        try {
            // Only show full loading state on initial load
            if (!hasLoadedOnce.current) setLoading(true)
            else setIsRefreshing(true)

            setError(null)

            // Calculate date filter
            const now = new Date()
            const fromDate = new Date()
            fromDate.setDate(now.getDate() - (timeRange === "7d" ? 7 : 30))

            // Fetch all dashboard data in parallel
            const [
                jobsData,
                sessionsData,
                reposData,
                licenseData,
                malwareData,
                securityData
            ] = await Promise.all([
                veeamApi.getBackupJobs(),
                veeamApi.getSessions({
                    limit: 2000,
                    orderColumn: 'CreationTime',
                    orderAsc: false,
                    createdAfterFilter: fromDate.toISOString()
                }),
                // veeamApi.getRepositories(),
                fetch('/api/vbr/ServerInfo').then(res => res.json()),
                veeamApi.getLicenseInfo(),
                veeamApi.getMalwareEvents({ limit: 10 }),
                veeamApi.getSecurityBestPractices()
            ])

            setJobs(jobsData)
            setSessions(sessionsData)
            // setRepositories(reposData)
            setServerInfo(reposData) // ServerInfo logic seems mixed up in original code? using reposData variable for serverInfo fetch result. Keeping consistent strictly with what I see.
            setLicense(licenseData)
            setMalwareEvents(malwareData)
            setSecurityItems(securityData)
            setTransferRateData(calculateTransferRates(sessionsData))
            setLastUpdated(new Date())
            hasLoadedOnce.current = true
        } catch (error) {
            console.error("Failed to fetch dashboard data:", error)
            setError(error instanceof Error ? error.message : String(error))
        } finally {
            setLoading(false)
            setIsRefreshing(false)
        }
    }, [timeRange])

    useEffect(() => {
        fetchData()
        // Refresh data every 5 minutes
        const interval = setInterval(fetchData, 300000)
        return () => clearInterval(interval)
    }, [fetchData])

    // Calculate job stats - count jobs that are currently running
    const activeJobs = jobs.filter(j => j.isRunning || j.status === 'Running').length

    return (
        <div className="flex-1 overflow-auto bg-background">
            <div className="container mx-auto py-8 px-4 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
                        <p className="text-muted-foreground mt-1">
                            Overview of your backup infrastructure health and performance
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground mr-2">
                            {lastUpdated ? `Updated at ${lastUpdated.toLocaleTimeString()}` : ''}
                        </span>
                        <div className="relative">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={fetchData}
                                disabled={loading || isRefreshing}
                            >
                                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                                Refresh
                            </Button>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-800 font-medium">Error: {error}</p>
                    </div>
                )}

                {/* Top Stats Row */}
                <DashboardStats
                    totalJobs={jobs.length}
                    activeJobs={activeJobs}
                    serverInfo={serverInfo}
                    license={license}
                    malwareEvents={malwareEvents}
                    securityItems={securityItems}
                />

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Sessions Overview (Takes up 2/3 width) */}
                    <div className="lg:col-span-2">
                        <SessionsOverview
                            sessions={sessions}
                            timeRange={timeRange}
                            onTimeRangeChange={setTimeRange}
                            loading={loading}
                        />
                    </div>

                    {/* Storage Capacity (Takes up 1/3 width) - SecurityWidget removed */}
                    <div className="lg:col-span-1 space-y-6">
                        <StorageCapacityWidget />
                        <TransferRateChart data={transferRateData} loading={loading} />
                    </div>
                </div>
            </div>
        </div>
    )
}
