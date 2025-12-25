"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect } from "react"
import { ManagedServersTable } from "@/components/managed-servers-table"
import { veeamApi } from "@/lib/api/veeam-client"
import { ManagedServer } from "@/lib/types/veeam"

export default function ManagedServersPage() {
    const [servers, setServers] = useState<ManagedServer[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // const { searchQuery } = useSearch() // Global search disabled in favor of table-local search

    useEffect(() => {
        const fetchServers = async () => {
            try {
                setLoading(true)
                setError(null)
                const data = await veeamApi.getManagedServers()
                setServers(data)
            } catch (err) {
                console.error('Failed to fetch managed servers:', err)
                setError(err instanceof Error ? err.message : 'Failed to fetch managed servers')
            } finally {
                setLoading(false)
            }
        }

        fetchServers()

        // Refresh data every 30 seconds
        const interval = setInterval(fetchServers, 30000)
        return () => clearInterval(interval)
    }, [])

    return (
        <div className="flex-1 overflow-auto">
            <div className="container mx-auto py-8 px-4">
                <div className="mb-6">
                    <h1 className="text-3xl font-bold tracking-tight">Managed Servers</h1>
                    <p className="text-muted-foreground mt-2">
                        View and manage your backup infrastructure servers
                    </p>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-800 font-medium">Error: {error}</p>
                        <p className="text-red-600 text-sm mt-1">
                            Please check your API configuration and credentials
                        </p>
                    </div>
                )}

                <ManagedServersTable data={servers} loading={loading} />
            </div>
        </div>
    )
}
