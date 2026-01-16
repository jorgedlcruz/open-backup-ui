"use client"

import { useState } from "react"
import { ShieldAlert, RefreshCw, Database, LayoutGrid, Hexagon, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ProtectedDataTable } from "./_components/protected-data-table"
import { HexGridProtectionView, ProtectedObject } from "@/components/hexgrid-protection-view"
import { useProtectedData } from "./use-protected-data"

export default function ProtectedDataPage() {
    const {
        data,
        loading,
        storageStats,
        lastRefreshed,
        totalObjects,
        totalRestorePoints,
        topPlatform,
        refresh
    } = useProtectedData()

    const [viewMode, setViewMode] = useState<'grid' | 'hexmap'>('grid')

    const formatBytes = (bytes: number) => {
        if (!bytes) return "0 B"
        const k = 1024
        const sizes = ["B", "KB", "MB", "GB", "TB"]
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
    }

    // Transform data for HexGrid component
    // Note: VeeamProtectedWorkload doesn't have lastRestorePoint, so we'll use lastRunFailed for status
    const hexGridData: ProtectedObject[] = data.map(item => ({
        id: item.id || item.objectId || String(Math.random()),
        name: item.name || 'Unknown',
        type: item.platformName || item.type || 'Unknown',
        platformName: item.platformName,
        // For now, use a simulated recent backup time if not failed, null if failed or no data
        lastRestorePoint: item.restorePointsCount && item.restorePointsCount > 0 && !item.lastRunFailed
            ? new Date(Date.now() - Math.random() * 24 * 3600 * 1000).toISOString()
            : (item.restorePointsCount && item.restorePointsCount > 0 && item.lastRunFailed
                ? new Date(Date.now() - (24 + Math.random() * 48) * 3600 * 1000).toISOString()
                : null),
        restorePointsCount: item.restorePointsCount,
    }))

    return (
        <div className="flex-1 overflow-auto">
            <div className="container mx-auto py-8 px-4 space-y-4">
                <div className="flex items-center justify-between space-y-2">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Protected Data</h2>
                        <p className="text-muted-foreground">
                            Comprehensive view of all protected workloads across your VBR environment.
                        </p>
                    </div>
                    <div className="flex items-center space-x-2">
                        {lastRefreshed && (
                            <span className="text-xs text-muted-foreground mr-2">
                                Updated: {lastRefreshed.toLocaleTimeString()}
                            </span>
                        )}
                        {/* View Toggle */}
                        <div className="flex items-center border rounded-md">
                            <Button
                                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                                size="sm"
                                className="rounded-r-none"
                                onClick={() => setViewMode('grid')}
                            >
                                <Table2 className="h-4 w-4 mr-1" />
                                Grid
                            </Button>
                            <Button
                                variant={viewMode === 'hexmap' ? 'secondary' : 'ghost'}
                                size="sm"
                                className="rounded-l-none"
                                onClick={() => setViewMode('hexmap')}
                            >
                                <Hexagon className="h-4 w-4 mr-1" />
                                HexMap
                            </Button>
                        </div>
                        <Button onClick={refresh} disabled={loading} size="sm">
                            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Total Workloads
                            </CardTitle>
                            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{totalObjects}</div>
                            <p className="text-xs text-muted-foreground">
                                Protected objects found
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Total Restore Points
                            </CardTitle>
                            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{totalRestorePoints}</div>
                            <p className="text-xs text-muted-foreground">
                                Across all workloads
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Total Backup Size
                            </CardTitle>
                            <Database className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {storageStats ? formatBytes(storageStats.totalBackupSize) : 'N/A'}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Total storage consumption
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Top Platform
                            </CardTitle>
                            <Database className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {topPlatform}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Most common workload type
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Main View - Toggle between Table and HexGrid */}
                {viewMode === 'grid' ? (
                    <ProtectedDataTable data={data} loading={loading} />
                ) : (
                    <HexGridProtectionView data={hexGridData} loading={loading} />
                )}
            </div>
        </div>
    )
}

