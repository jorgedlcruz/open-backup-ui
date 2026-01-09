"use client"

import { Activity, ShieldAlert, Key, Server } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LicenseModel, MalwareEventModel, VeeamServerInfo, SecurityBestPracticeItem } from "@/lib/types/veeam"
import { Badge } from "@/components/ui/badge"

// Total Jobs Card - ORIGINAL DESIGN
interface TotalJobsCardProps {
    totalJobs: number
    activeJobs: number
}

export function TotalJobsCard({ totalJobs, activeJobs }: TotalJobsCardProps) {
    return (
        <Card className="h-full">
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
    )
}

// VBR Server Card - ORIGINAL DESIGN
interface VBRServerCardProps {
    serverInfo?: VeeamServerInfo | null
}

export function VBRServerCard({ serverInfo }: VBRServerCardProps) {
    return (
        <Card className="h-full">
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
    )
}

// License Card - ORIGINAL DESIGN with progress bar
interface LicenseCardProps {
    license: LicenseModel | null
}

export function LicenseCard({ license }: LicenseCardProps) {
    const licenseUsed = license?.instanceLicenseSummary?.usedInstancesNumber ??
        ((license?.usedInstances || 0) + (license?.usedSockets || 0))
    const licenseTotal = license?.instanceLicenseSummary?.licensedInstancesNumber ??
        ((license?.licensedInstances || 0) + (license?.licensedSockets || 0))
    const licensePercentage = licenseTotal > 0 ? (licenseUsed / licenseTotal) * 100 : 0

    return (
        <Card className="h-full">
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
    )
}

// Malware Events Card - ORIGINAL DESIGN
interface MalwareEventsCardProps {
    malwareEvents: MalwareEventModel[]
}

export function MalwareEventsCard({ malwareEvents }: MalwareEventsCardProps) {
    const activeMalware = malwareEvents.filter(e => e.status !== 'Resolved').length

    return (
        <Card className="h-full">
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
    )
}

// Security Score Card - ORIGINAL DESIGN with progress bar
interface SecurityScoreCardProps {
    securityItems: SecurityBestPracticeItem[]
}

export function SecurityScoreCard({ securityItems }: SecurityScoreCardProps) {
    const passedChecks = securityItems.filter(i => i.status?.toLowerCase() === 'ok').length
    const totalChecks = securityItems.length
    const securityPercentage = totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 0

    return (
        <Card className="h-full">
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
    )
}
