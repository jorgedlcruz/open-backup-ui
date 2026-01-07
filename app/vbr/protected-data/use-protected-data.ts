import { useState, useCallback, useEffect } from "react"
import { VeeamProtectedWorkload } from "@/lib/types/veeam"
import { veeamApi } from "@/lib/api/veeam-client"

export interface StorageStats {
    totalBackupSize: number
    fileCount: number
}

export function useProtectedData() {
    const [data, setData] = useState<VeeamProtectedWorkload[]>([])
    const [loading, setLoading] = useState(true)
    const [storageStats, setStorageStats] = useState<StorageStats | null>(null)
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

    const fetchData = useCallback(async () => {
        try {
            setLoading(true)

            // Parallel fetch for stats and data
            const [protectedData, capacityStats] = await Promise.all([
                veeamApi.getProtectedData(),
                veeamApi.getStorageCapacity()
            ])

            setData(protectedData)
            setStorageStats(capacityStats)
            setLastRefreshed(new Date())
        } catch (error) {
            console.error('Failed to fetch protected data:', error)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // Calculate Summary Stats
    const totalObjects = data.length
    // Use storage stats for totals size, but calculate restore points from the workloads themselves to match the grid
    const totalRestorePoints = data.reduce((sum, item) => sum + (item.restorePointsCount || 0), 0)

    const topPlatform = data.length > 0 ?
        Object.entries(data.reduce((acc, curr) => {
            acc[curr.platformName] = (acc[curr.platformName] || 0) + 1;
            return acc;
        }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'
        : 'N/A'

    return {
        data,
        loading,
        storageStats,
        lastRefreshed,
        totalObjects,
        totalRestorePoints,
        topPlatform,
        refresh: fetchData
    }
}
