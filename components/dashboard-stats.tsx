"use client"

import { Activity, ShieldAlert, Key, Server } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LicenseModel, MalwareEventModel, VeeamServerInfo } from "@/lib/types/veeam"
import { Badge } from "@/components/ui/badge"

interface DashboardStatsProps {
    serverInfo?: VeeamServerInfo | null
    license: LicenseModel | null
    malwareEvents: MalwareEventModel[]
    totalJobs: number
    activeJobs: number
    securityItems?: import("@/lib/types/veeam").SecurityBestPracticeItem[]
}

export function DashboardStats({
    serverInfo,
    license,
    malwareEvents,
    totalJobs,
    activeJobs,
    securityItems
}: DashboardStatsProps) {
    // Calculate repository stats
    // const totalCapacity = repositories?.reduce((acc, repo) => acc + (repo.capacity || 0), 0) ?? 0
    // const totalFree = repositories?.reduce((acc, repo) => acc + (repo.freeSpace || 0), 0) ?? 0
    // const usedSpace = totalCapacity - totalFree
    // const usedPercentage = totalCapacity > 0 ? (usedSpace / totalCapacity) * 100 : 0

    // License stats
    // Use instanceLicenseSummary if available (newer API), otherwise fall back to top-level fields
    const licenseUsed = license?.instanceLicenseSummary?.usedInstancesNumber ??
        ((license?.usedInstances || 0) + (license?.usedSockets || 0))

    const licenseTotal = license?.instanceLicenseSummary?.licensedInstancesNumber ??
        ((license?.licensedInstances || 0) + (license?.licensedSockets || 0))

    const licensePercentage = licenseTotal > 0 ? (licenseUsed / licenseTotal) * 100 : 0

    // Security stats
    const passedChecks = securityItems ? securityItems.filter(i => i.status?.toLowerCase() === 'ok').length : 0
    const totalChecks = securityItems ? securityItems.length : 0
    const securityPercentage = totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 0

    // Malware stats
    const activeMalware = malwareEvents.filter(e => e.status !== 'Resolved').length

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Total Jobs
                    </CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{totalJobs}</div>
                    <p className="text-xs text-muted-foreground">
                        {activeJobs} active now
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        VBR Server
                    </CardTitle>
                    <Server className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold truncate" title={serverInfo?.name || "Unknown"}>
                        {serverInfo?.name || "Unknown"}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-muted-foreground">
                            v{serverInfo?.buildVersion || "0.0.0"}
                        </p>
                        {serverInfo?.platform && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1">
                                {serverInfo.platform}
                            </Badge>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        License Usage
                    </CardTitle>
                    <Key className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{licenseUsed} / {licenseTotal}</div>
                    <p className="text-xs text-muted-foreground">
                        {license?.type || 'Unknown'} License
                    </p>
                    <div className="mt-2 h-1 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                            className={`h-full ${licensePercentage > 90 ? 'bg-destructive' : 'bg-primary'}`}
                            style={{ width: `${licensePercentage}%` }}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Malware Events
                    </CardTitle>
                    <ShieldAlert className={`h-4 w-4 ${activeMalware > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{malwareEvents.length}</div>
                    <p className="text-xs text-muted-foreground">
                        {activeMalware} unresolved
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Security Score
                    </CardTitle>
                    <ShieldAlert className={`h-4 w-4 ${securityPercentage < 50 ? 'text-destructive' : 'text-primary'}`} />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{passedChecks} / {totalChecks}</div>
                    <p className="text-xs text-muted-foreground">
                        Passed Checks
                    </p>
                    <div className="mt-2 h-1 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                            className={`h-full ${securityPercentage < 50 ? 'bg-destructive' : 'bg-primary'}`}
                            style={{ width: `${securityPercentage}%` }}
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
