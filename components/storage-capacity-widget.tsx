"use client"
// Open Backup UI v1.0.2

import { useI18n } from "@/components/providers/i18n-provider"
import { useDisplayFormat } from "@/components/providers/use-display-format"
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



export function StorageCapacityWidget() {
    const { t, formatNumber } = useI18n()
    const { bytes: formatBytes } = useDisplayFormat()
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
                    <CardTitle className="text-sm font-medium">{t('Storage Capacity')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-sm text-red-500">{t('Failed to load storage capacity')}</div>
                </CardContent>
            </Card>
        )
    }

    if (loading || !data) {
        return (
            <Card className="col-span-1">
                <CardHeader>
                    <CardTitle className="text-sm font-medium">{t('Storage Efficiency')}</CardTitle>
                    <CardDescription>{t('Capacity usage and optimization')}</CardDescription>
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
                    {t('Storage Efficiency')}
                </CardTitle>
                <CardDescription>
                    {t('Across {backups} backups with {points} restore points', { backups: formatNumber(data.backupCount), points: formatNumber(data.fileCount) })}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">{t('Total Backup Size')}</span>
                        <span className="text-sm font-bold">{formatBytes(data.totalBackupSize)}</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: '100%' }}></div>
                    </div>
                    <p className="text-xs text-muted-foreground text-right">
                        {t('Original data: {size}', { size: formatBytes(data.totalDataSize) })}
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-secondary/20 p-4 rounded-lg border border-secondary">
                        <div className="flex items-center gap-2 mb-2">
                            <ArrowDownToLine className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium">{t('Deduplication')}</span>
                        </div>
                        <div className="text-2xl font-bold">{formatNumber(data.avgDedupRatio / 100, { style: 'percent', maximumFractionDigits: 2 })}</div>
                        <div className="text-xs text-muted-foreground">{t('Average ratio')}</div>
                    </div>
                    <div className="bg-secondary/20 p-4 rounded-lg border border-secondary">
                        <div className="flex items-center gap-2 mb-2">
                            <Zap className="h-4 w-4 text-yellow-500" />
                            <span className="text-sm font-medium">{t('Compression')}</span>
                        </div>
                        <div className="text-2xl font-bold">{formatNumber(data.avgCompressRatio / 100, { style: 'percent', maximumFractionDigits: 2 })}</div>
                        <div className="text-xs text-muted-foreground">{t('Average ratio')}</div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
