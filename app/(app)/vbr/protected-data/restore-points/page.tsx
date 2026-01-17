"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { VBRRestorePointsTable } from "@/components/vbr-restore-points-table"
import { veeamApi } from "@/lib/api/veeam-client"
import { VeeamRestorePoint, VeeamInventoryItem } from "@/lib/types/veeam"
import { Button } from "@/components/ui/button"
import { ChevronLeft, Shield, HardDrive, LayoutGrid, Calendar as CalendarIcon, Server, MonitorCheck, Globe, Cpu, Network, FolderClosed, Layers } from "lucide-react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { VBRRestorePointsCalendar } from "@/components/vbr-restore-points-calendar"
import { Separator } from "@/components/ui/separator"
import { formatDistanceToNow } from "date-fns"

// Helper function to extract metadata
function getMetadata(workload: VeeamInventoryItem | null, field: string): string | null {
    if (!workload?.metadata) return null
    const item = workload.metadata.find(m => m.field === field)
    return item?.data || null
}

// Helper to get all IP addresses
function getAllIPs(workload: VeeamInventoryItem | null): string[] {
    if (!workload?.metadata) return []
    return workload.metadata
        .filter(m => m.field === 'ipAddress')
        .map(m => m.data)
        .filter(ip => !ip.startsWith('fe80')) // Filter out link-local
}

function RestorePointsContent() {
    const searchParams = useSearchParams()
    const backupId = searchParams.get("backupId")
    const objectId = searchParams.get("objectId")
    const name = searchParams.get("name")

    const [restorePoints, setRestorePoints] = useState<VeeamRestorePoint[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<"grid" | "calendar">("grid")

    // Workload details from inventory
    const [workloadDetails, setWorkloadDetails] = useState<VeeamInventoryItem | null>(null)
    const [vCenterHost, setVCenterHost] = useState<string | null>(null)
    const [datacenterName, setDatacenterName] = useState<string | null>(null)
    const [clusterName, setClusterName] = useState<string | null>(null)
    const [esxHostName, setEsxHostName] = useState<string | null>(null)
    const [loadingDetails, setLoadingDetails] = useState(false)



    useEffect(() => {
        const fetchRestorePoints = async () => {
            if (!objectId && !backupId) return

            try {
                setLoading(true)
                const data = await veeamApi.getVBRRestorePoints({
                    objectId: objectId || undefined,
                    backupId: backupId || undefined
                });
                setRestorePoints(data)
            } catch (err) {
                console.error("Failed to load restore points", err)
                setError("Failed to load restore points. Please try again.")
            } finally {
                setLoading(false)
            }
        }

        fetchRestorePoints()
    }, [backupId, objectId])

    // Fetch workload details from inventory by name
    useEffect(() => {
        const fetchWorkloadDetails = async () => {
            if (!name) return

            try {
                setLoadingDetails(true)
                const result = await veeamApi.getInventoryWorkloadDetails({ name })
                setWorkloadDetails(result.workload)
                setVCenterHost(result.vCenter)
                setDatacenterName(result.datacenterName || null)
                setClusterName(result.clusterName || null)
                setEsxHostName(result.esxHostName || null)
            } catch (err) {
                console.error("Failed to load workload details", err)
            } finally {
                setLoadingDetails(false)
            }
        }

        fetchWorkloadDetails()
    }, [name])

    if (!backupId && !objectId) {
        return (
            <div className="flex flex-col items-center justify-center p-8 h-full">
                <div className="text-center space-y-4">
                    <Shield className="h-12 w-12 text-muted-foreground mx-auto" />
                    <h2 className="text-xl font-semibold">No Workload Selected</h2>
                    <p className="text-muted-foreground">Please select a protected workload to view restore points.</p>
                    <Link href="/vbr/protected-data">
                        <Button variant="outline">Back to Protected Data</Button>
                    </Link>
                </div>
            </div>
        )
    }

    // Calculate totals and stats
    const totalDataSize = restorePoints.reduce((acc, curr) => acc + (curr.dataSize || 0), 0)
    const totalBackupSize = restorePoints.reduce((acc, curr) => acc + (curr.backupSize || 0), 0)
    const totalSnapshots = restorePoints.length

    // Calculate oldest and latest restore points
    const sortedByDate = [...restorePoints].sort((a, b) =>
        new Date(a.creationTime).getTime() - new Date(b.creationTime).getTime()
    )
    const oldestRP = sortedByDate[0]?.creationTime
    const latestRP = sortedByDate[sortedByDate.length - 1]?.creationTime

    // Calculate data reduction
    const dataReduction = totalDataSize > 0
        ? Math.round((1 - (totalBackupSize / totalDataSize)) * 100)
        : 0

    const formatBytes = (bytes: number) => {
        if (!bytes) return "0 B"
        const k = 1024
        const sizes = ["B", "KB", "MB", "GB", "TB"]
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
    }

    const formatDate = (dateStr: string | undefined) => {
        if (!dateStr) return "N/A"
        const date = new Date(dateStr)
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    // Extract workload metadata
    const guestOs = getMetadata(workloadDetails, 'guestOsName')
    const dnsName = getMetadata(workloadDetails, 'dnsName')
    const ipAddresses = getAllIPs(workloadDetails)

    return (
        <div className="flex-1 overflow-auto bg-background animate-in fade-in duration-500">
            <div className="container mx-auto py-8 px-4 space-y-6">
                <div>
                    <Link href="/vbr/protected-data">
                        <Button variant="ghost" size="sm" className="mb-4 -ml-4">
                            <ChevronLeft className="mr-2 h-4 w-4" />
                            Back to Protected Data
                        </Button>
                    </Link>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <div className="flex flex-wrap items-center gap-3">
                                <h1 className="text-3xl font-bold tracking-tight">{name || 'Unknown Workload'}</h1>
                                {workloadDetails?.type && (
                                    <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground py-1">
                                        <MonitorCheck className="h-3.5 w-3.5" />
                                        {workloadDetails.type}
                                    </Badge>
                                )}
                                {workloadDetails?.platform && (
                                    <Badge variant="secondary" className="font-normal py-1">
                                        {workloadDetails.platform}
                                    </Badge>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1 rounded-md border bg-muted/50 p-1">
                            <Button
                                variant={viewMode === "grid" ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => setViewMode("grid")}
                                className="h-7 px-2 text-xs"
                            >
                                <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
                                Grid
                            </Button>
                            <Button
                                variant={viewMode === "calendar" ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => setViewMode("calendar")}
                                className="h-7 px-2 text-xs"
                            >
                                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                                Calendar
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Two-column layout */}
                <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
                    {/* Left Sidebar - Status Panel */}
                    <div className="space-y-4">
                        {/* Protection Section */}
                        <Card className="rounded-xl border bg-card text-card-foreground shadow-sm">
                            <CardHeader className="px-5 pt-2 pb-0">
                                <div className="flex items-center gap-2">
                                    <Shield className="h-5 w-5 text-primary" />
                                    <CardTitle className="leading-none font-semibold text-lg">Data Resilience</CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent className="px-5 pb-2 pt-0 space-y-2">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Total Points</p>
                                        <p className="text-sm font-semibold font-mono">{totalSnapshots}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Reduction</p>
                                        <p className="text-sm font-semibold font-mono">{dataReduction}%</p>
                                    </div>
                                </div>
                                <Separator />
                                <div className="space-y-4">
                                    <div>
                                        <p className="text-xs text-muted-foreground font-medium mb-1">Oldest Restore Point</p>
                                        <p className="text-sm font-mono text-foreground/80">{formatDate(oldestRP)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground font-medium mb-1">Latest Restore Point</p>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-sm font-mono text-foreground/80">{formatDate(latestRP)}</p>
                                            {latestRP && (
                                                <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] font-normal tracking-wide">
                                                    {formatDistanceToNow(new Date(latestRP), { addSuffix: true })}
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Capacity Section */}
                        <Card className="rounded-xl border bg-card text-card-foreground shadow-sm">
                            <CardHeader className="px-5 pt-2 pb-0">
                                <div className="flex items-center gap-2">
                                    <HardDrive className="h-5 w-5 text-primary" />
                                    <CardTitle className="leading-none font-semibold text-lg">Storage</CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent className="px-5 pb-2 pt-0 space-y-2">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Logical</p>
                                        <p className="text-sm font-semibold font-mono">{formatBytes(totalDataSize)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Total Backup Size</p>
                                        <p className="text-sm font-semibold font-mono">{formatBytes(totalBackupSize)}</p>
                                    </div>
                                </div>
                                {workloadDetails?.size && (
                                    <>
                                        <Separator />
                                        <div>
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Provisioned (VM)</p>
                                            <p className="text-sm font-semibold font-mono">{workloadDetails.size}</p>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>

                        {/* Object Details Section */}
                        <Card className="rounded-xl border bg-card text-card-foreground shadow-sm">
                            <CardHeader className="px-5 pt-2 pb-0">
                                <div className="flex items-center gap-2">
                                    <Server className="h-5 w-5 text-primary" />
                                    <CardTitle className="leading-none font-semibold text-lg">Workload Details</CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent className="px-5 pb-2 pt-0 space-y-2">
                                {loadingDetails ? (
                                    <div className="py-4 space-y-2">
                                        <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
                                        <div className="h-4 w-1/2 bg-muted animate-pulse rounded" />
                                    </div>
                                ) : workloadDetails ? (
                                    <div className="space-y-4">
                                        {guestOs && (
                                            <div className="flex items-start gap-3">
                                                <Cpu className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                                <div>
                                                    <p className="text-xs text-muted-foreground font-medium mb-0.5">Guest OS</p>
                                                    <p className="text-sm font-mono text-foreground/80">{guestOs}</p>
                                                </div>
                                            </div>
                                        )}
                                        {dnsName && (
                                            <div className="flex items-start gap-3">
                                                <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                                <div>
                                                    <p className="text-xs text-muted-foreground font-medium mb-0.5">DNS Name</p>
                                                    <p className="text-sm font-mono text-foreground/80">{dnsName}</p>
                                                </div>
                                            </div>
                                        )}
                                        {ipAddresses.length > 0 && (
                                            <div className="flex items-start gap-3">
                                                <Network className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                                <div>
                                                    <p className="text-xs text-muted-foreground font-medium mb-0.5">IP Address</p>
                                                    <div className="space-y-0.5">
                                                        {ipAddresses.map((ip, i) => (
                                                            <p key={i} className="text-sm font-mono text-foreground/80">{ip}</p>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {(vCenterHost || datacenterName || clusterName || esxHostName) && <Separator />}

                                        {vCenterHost && (
                                            <div className="flex items-start gap-3">
                                                <Layers className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                                <div>
                                                    <p className="text-xs text-muted-foreground font-medium mb-0.5">vCenter</p>
                                                    <p className="text-sm font-mono text-foreground/80">{vCenterHost}</p>
                                                </div>
                                            </div>
                                        )}
                                        {datacenterName && (
                                            <div className="flex items-start gap-3">
                                                <FolderClosed className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                                <div>
                                                    <p className="text-xs text-muted-foreground font-medium mb-0.5">Datacenter</p>
                                                    <p className="text-sm font-mono text-foreground/80">{datacenterName}</p>
                                                </div>
                                            </div>
                                        )}
                                        {clusterName && (
                                            <div className="flex items-start gap-3">
                                                <Layers className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                                <div>
                                                    <p className="text-xs text-muted-foreground font-medium mb-0.5">Cluster</p>
                                                    <p className="text-sm font-mono text-foreground/80">{clusterName}</p>
                                                </div>
                                            </div>
                                        )}
                                        {esxHostName && (
                                            <div className="flex items-start gap-3">
                                                <Server className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                                <div>
                                                    <p className="text-xs text-muted-foreground font-medium mb-0.5">ESXi Host</p>
                                                    <p className="text-sm font-mono text-foreground/80">{esxHostName}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="py-8 text-center">
                                        <p className="text-sm text-muted-foreground italic">
                                            Inventory details unavailable
                                        </p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right Main Area - Snapshots */}
                    <div className="space-y-4 min-w-0">

                        {error && (
                            <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg">
                                {error}
                            </div>
                        )}

                        {viewMode === "grid" ? (
                            <VBRRestorePointsTable data={restorePoints} loading={loading} />
                        ) : (
                            <div className="animate-in fade-in zoom-in-95 duration-200">
                                <VBRRestorePointsCalendar data={restorePoints} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default function VBRRestorePointsPage() {
    return (
        <Suspense fallback={<div className="p-8">Loading...</div>}>
            <RestorePointsContent />
        </Suspense>
    )
}
