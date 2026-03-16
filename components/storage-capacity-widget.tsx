"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Database, ArrowDownToLine, Zap } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { veeamApi } from "@/lib/api/veeam-client"

interface StorageCapacityData {
    totalBackupSize: number
    totalDataSize: number
    avgDedupRatio: number
    avgCompressRatio: number
    fileCount: number
    backupCount: number
}

function formatBytes(bytes: number, decimals = 2) {
    if (!+bytes) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function StorageCapacityWidget() {
    const [data, setData] = useState<StorageCapacityData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true)
                const json = await veeamApi.getStorageCapacity()
                if (!json) throw new Error('Failed to fetch storage data')
                setData(json as StorageCapacityData)
            } catch (err) {
                console.error(err)
                setError("Failed to load storage capacity")
            } finally {
                setLoading(false)
            }
        }

        fetchData()
    }, [])

    if (error) {
        return (
            <Card className="col-span-1">
                <CardHeader>
                    <CardTitle className="text-sm font-medium">Storage Capacity</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-sm text-red-500">{error}</div>
                </CardContent>
            </Card>
        )
    }

    if (loading || !data) {
        return (
            <Card className="col-span-1">
                <CardHeader>
                    <CardTitle className="text-sm font-medium">Storage Efficiency</CardTitle>
                    <CardDescription>Capacity usage and optimization</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="col-span-1 row-span-2">
            <CardHeader>
                <CardTitle className="text-lg font-medium flex items-center gap-2">
                    <Database className="h-5 w-5 text-primary" />
                    Storage Efficiency
                </CardTitle>
                <CardDescription>
                    Across {data.backupCount} backups with {data.fileCount} restore points
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">Total Backup Size</span>
                        <span className="text-sm font-bold">{formatBytes(data.totalBackupSize)}</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: '100%' }}></div>
                    </div>
                    <p className="text-xs text-muted-foreground text-right">
                        Original Data: {formatBytes(data.totalDataSize)}
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-secondary/20 p-4 rounded-lg border border-secondary">
                        <div className="flex items-center gap-2 mb-2">
                            <ArrowDownToLine className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium">Deduplication</span>
                        </div>
                        <div className="text-2xl font-bold">{data.avgDedupRatio}%</div>
                        <div className="text-xs text-muted-foreground">Average ratio</div>
                    </div>
                    <div className="bg-secondary/20 p-4 rounded-lg border border-secondary">
                        <div className="flex items-center gap-2 mb-2">
                            <Zap className="h-4 w-4 text-yellow-500" />
                            <span className="text-sm font-medium">Compression</span>
                        </div>
                        <div className="text-2xl font-bold">{data.avgCompressRatio}%</div>
                        <div className="text-xs text-muted-foreground">Average ratio</div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
