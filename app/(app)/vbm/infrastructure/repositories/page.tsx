"use client"

import { useState, useEffect, useCallback } from "react"
import { veeamApi } from "@/lib/api/veeam-client"
import { VB365Repository } from "@/lib/types/vbm"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    Loader2,
    RefreshCw,
    Database,
    HardDrive,
    Lock,
    Cloud,
    AlertTriangle,
    CheckCircle
} from "lucide-react"
import { toast } from "sonner"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export default function VB365RepositoriesPage() {
    const [repositories, setRepositories] = useState<VB365Repository[]>([])
    const [loading, setLoading] = useState(true)

    const fetchRepositories = useCallback(async () => {
        try {
            setLoading(true)
            const data = await veeamApi.getVB365Repositories({ limit: 100 })
            setRepositories(data)
        } catch (error) {
            toast.error("Failed to load repositories")
            console.error(error)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchRepositories()
    }, [fetchRepositories])

    // Calculate summary stats
    const totalCapacity = repositories.reduce((sum, r) => sum + (r.capacityBytes || 0), 0)
    const totalFree = repositories.reduce((sum, r) => sum + (r.freeSpaceBytes || 0), 0)
    const totalUsed = totalCapacity - totalFree
    const immutableCount = repositories.filter(r => r.objectStorage?.enableImmutability).length

    const getUsagePercent = (repo: VB365Repository) => {
        if (!repo.capacityBytes) return 0
        const used = repo.capacityBytes - (repo.freeSpaceBytes || 0)
        return (used / repo.capacityBytes) * 100
    }

    const getRetentionLabel = (repo: VB365Repository) => {
        if (repo.retentionPeriodType === 'Yearly') {
            return repo.yearlyRetentionPeriod?.replace('Year', '') + ' Year'
        }
        if (repo.retentionPeriodType === 'Monthly') {
            return repo.monthlyRetentionPeriod?.replace('Month', '') + ' Month'
        }
        if (repo.retentionPeriodType === 'Daily') {
            return repo.dailyRetentionPeriod?.replace('Day', '') + ' Day'
        }
        return repo.retentionPeriodType || 'N/A'
    }

    return (
        <div className="flex-1 overflow-auto">
            <div className="container mx-auto py-8 px-4 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Backup Repositories</h1>
                        <p className="text-muted-foreground">
                            Manage your VB365 backup storage locations and capacity
                        </p>
                    </div>
                    <Button onClick={fetchRepositories} disabled={loading}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>

                {/* Summary Cards */}
                <div className="grid gap-4 md:grid-cols-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Repositories</CardTitle>
                            <Database className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{repositories.length}</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Capacity</CardTitle>
                            <HardDrive className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{formatBytes(totalCapacity)}</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Used / Free</CardTitle>
                            <div className="flex items-center gap-1 text-xs">
                                <span className="text-blue-500">{formatBytes(totalUsed)}</span>
                                <span className="text-muted-foreground">/</span>
                                <span className="text-green-500">{formatBytes(totalFree)}</span>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Progress value={totalCapacity > 0 ? (totalUsed / totalCapacity) * 100 : 0} className="h-2" />
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Immutable</CardTitle>
                            <Lock className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{immutableCount}</div>
                        </CardContent>
                    </Card>
                </div>

                {/* Repositories Table */}
                <Card>
                    <CardHeader>
                        <CardTitle>Repository Details</CardTitle>
                        <CardDescription>View storage capacity, retention settings, and status</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex items-center justify-center h-32">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Repository</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead>Capacity</TableHead>
                                            <TableHead>Usage</TableHead>
                                            <TableHead>Retention</TableHead>
                                            <TableHead>Immutability</TableHead>
                                            <TableHead>Encryption</TableHead>
                                            <TableHead>Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {repositories.map((repo) => {
                                            const usagePercent = getUsagePercent(repo)
                                            const usedBytes = repo.capacityBytes - (repo.freeSpaceBytes || 0)

                                            return (
                                                <TableRow key={repo.id}>
                                                    <TableCell>
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{repo.name}</span>
                                                            <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={repo.path}>
                                                                {repo.path}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-1">
                                                            {repo.objectStorage ? (
                                                                <>
                                                                    <Cloud className="h-4 w-4 text-sky-500" />
                                                                    <span className="text-sm">{repo.objectStorage.type || 'Object'}</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <HardDrive className="h-4 w-4 text-slate-500" />
                                                                    <span className="text-sm">Local</span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col text-sm">
                                                            <span className="font-medium">{formatBytes(repo.capacityBytes)}</span>
                                                            <span className="text-xs text-muted-foreground">
                                                                {formatBytes(repo.freeSpaceBytes || 0)} free
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2 min-w-[120px]">
                                                            <Progress
                                                                value={usagePercent}
                                                                className={`h-2 flex-1 ${usagePercent > 90 ? '[&>div]:bg-red-500' : usagePercent > 75 ? '[&>div]:bg-yellow-500' : ''}`}
                                                            />
                                                            <span className="text-xs text-muted-foreground w-16">
                                                                {formatBytes(usedBytes)}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className="text-xs">
                                                            {getRetentionLabel(repo)}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        {repo.objectStorage?.enableImmutability ? (
                                                            <Badge variant="default" className="bg-purple-600">
                                                                <Lock className="h-3 w-3 mr-1" />
                                                                {repo.objectStorage.immutabilityPeriodDays}d
                                                            </Badge>
                                                        ) : (
                                                            <span className="text-muted-foreground text-sm">—</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        {repo.objectStorageEncryptionEnabled ? (
                                                            <Badge variant="secondary">
                                                                <Lock className="h-3 w-3 mr-1" /> Enabled
                                                            </Badge>
                                                        ) : (
                                                            <span className="text-muted-foreground text-sm">—</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col gap-1">
                                                            {repo.isOutOfSync && (
                                                                <Badge variant="destructive" className="text-xs">
                                                                    <AlertTriangle className="h-3 w-3 mr-1" /> Out of Sync
                                                                </Badge>
                                                            )}
                                                            {repo.isOutOfOrder && (
                                                                <Badge variant="destructive" className="text-xs">
                                                                    <AlertTriangle className="h-3 w-3 mr-1" /> Out of Order
                                                                </Badge>
                                                            )}
                                                            {repo.isOutdated && (
                                                                <Badge variant="secondary" className="text-xs">
                                                                    <AlertTriangle className="h-3 w-3 mr-1" /> Outdated
                                                                </Badge>
                                                            )}
                                                            {!repo.isOutOfSync && !repo.isOutOfOrder && !repo.isOutdated && (
                                                                <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                                                                    <CheckCircle className="h-3 w-3 mr-1" /> Healthy
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                        {repositories.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={8} className="h-24 text-center">
                                                    No repositories found.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
