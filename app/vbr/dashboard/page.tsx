"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef } from "react"
import { SessionsOverview } from "@/components/sessions-overview"
import { StorageCapacityWidget } from "@/components/storage-capacity-widget"
import { DashboardGrid, GridStackItemLayout } from "@/components/dashboard"
import { TotalJobsCard, VBRServerCard, LicenseCard, MalwareEventsCard, SecurityScoreCard } from "@/components/dashboard/stat-cards"
import { veeamApi } from "@/lib/api/veeam-client"
import {
    VeeamBackupJob,
    VeeamSession,
    LicenseModel,
    MalwareEventModel,
    SecurityBestPracticeItem,
    TransferRateDataPoint,
    VeeamServerInfo
} from "@/lib/types/veeam"
import { calculateTransferRates } from "@/lib/utils/transfer-rate"
import { TransferRateChart } from "@/components/transfer-rate-chart"

// Default VBR Dashboard Layout - 10 column grid
// Row 0-1: 5 stat widgets (each 2 columns wide, filling 10 total)
// Row 2: GAP (empty row forced by spacer)
// Row 3+: Sessions (6 wide), Storage (4 wide), Transfer (4 wide)
const DEFAULT_VBR_LAYOUT: GridStackItemLayout[] = [
    // Row 0: 5 independent stat cards - FULL WIDTH (10 columns)
    { id: 'vbr-total-jobs', x: 0, y: 0, w: 2, h: 14 },
    { id: 'vbr-server', x: 2, y: 0, w: 2, h: 14 },
    { id: 'vbr-license', x: 4, y: 0, w: 2, h: 14 },
    { id: 'vbr-malware', x: 6, y: 0, w: 2, h: 14 },
    { id: 'vbr-security', x: 8, y: 0, w: 2, h: 14 },

    // Row 14: Custom 30px spacer (h=30px, approx)
    // @ts-expect-error - locked/noMove are valid GridStack options
    { id: 'vbr-gap', x: 0, y: 14, w: 10, h: 3, locked: true, noMove: true, noResize: true },

    // Row 17+: Sessions (6 wide, 11 tall x7 = 77 -> +14 = 91) on left
    { id: 'vbr-sessions', x: 0, y: 17, w: 6, h: 91 },

    // Right side: Storage (4 wide) + Transfer (4 wide)
    { id: 'vbr-storage', x: 6, y: 17, w: 4, h: 35 },
    { id: 'vbr-transfer', x: 6, y: 52, w: 4, h: 49 },
]

export default function VBRPage() {
    const [jobs, setJobs] = useState<VeeamBackupJob[]>([])
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
            if (!hasLoadedOnce.current) setLoading(true)
            else setIsRefreshing(true)

            setError(null)

            const now = new Date()
            const fromDate = new Date()
            fromDate.setDate(now.getDate() - (timeRange === "7d" ? 7 : 30))

            const [
                jobsData,
                sessionsData,
                serverData,
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
                fetch('/api/vbr/ServerInfo').then(res => res.json()).catch(() => null),
                veeamApi.getLicenseInfo(),
                veeamApi.getMalwareEvents({ limit: 10 }),
                veeamApi.getSecurityBestPractices()
            ])

            setJobs(jobsData)
            setSessions(sessionsData)
            setServerInfo(serverData)
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
        const interval = setInterval(fetchData, 300000)
        return () => clearInterval(interval)
    }, [fetchData])

    const activeJobs = jobs.filter(j => j.isRunning || j.status === 'Running').length

    // Render each widget INDEPENDENTLY with original designs
    const renderWidget = useCallback((widgetId: string, widgetLoading: boolean) => {
        switch (widgetId) {
            case 'vbr-total-jobs':
                return <TotalJobsCard totalJobs={jobs.length} activeJobs={activeJobs} />
            case 'vbr-server':
                return <VBRServerCard serverInfo={serverInfo} />
            case 'vbr-license':
                return <LicenseCard license={license} />
            case 'vbr-malware':
                return <MalwareEventsCard malwareEvents={malwareEvents} />
            case 'vbr-security':
                return <SecurityScoreCard securityItems={securityItems} />
            case 'vbr-sessions':
                return (
                    <SessionsOverview
                        sessions={sessions}
                        timeRange={timeRange}
                        onTimeRangeChange={setTimeRange}
                        loading={widgetLoading}
                    />
                )
            case 'vbr-storage':
                return <StorageCapacityWidget />
            case 'vbr-transfer':
                return <TransferRateChart data={transferRateData} loading={widgetLoading} />
            default:
                return <div className="p-4 text-muted-foreground">Unknown widget: {widgetId}</div>
        }
    }, [jobs, activeJobs, serverInfo, license, malwareEvents, securityItems, sessions, timeRange, transferRateData])

    if (error) {
        return (
            <div className="flex-1 overflow-auto bg-background">
                <div className="container mx-auto py-8 px-4">
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-800 font-medium">Error: {error}</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 overflow-auto bg-background">
            <div className="container mx-auto py-8 px-4">
                <DashboardGrid
                    productId="vbr"
                    defaultLayout={DEFAULT_VBR_LAYOUT}
                    renderWidget={renderWidget}
                    loading={loading}
                    onRefresh={fetchData}
                    lastUpdated={lastUpdated}
                    isRefreshing={isRefreshing}
                />
            </div>
        </div>
    )
}
