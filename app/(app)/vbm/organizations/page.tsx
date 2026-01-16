"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect } from "react"
import { VBMOrganizationsTable } from "@/components/vbm-organizations-table"
import { veeamApi } from "@/lib/api/veeam-client"
import { VBMOrganization } from "@/lib/types/vbm"

export default function VBMOrganizationsPage() {
    const [organizations, setOrganizations] = useState<VBMOrganization[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const fetchOrgs = async () => {
            try {
                setLoading(true)
                setError(null)
                // Passing extendedView=false as per user example curl, but client method defaults to omit it if not passed
                // The client method we added supports extendedView. Let's send false to match the example, or just let it be.
                const data = await veeamApi.getVBMOrganizations({ extendedView: false })
                setOrganizations(data)
            } catch (err) {
                console.error('Failed to fetch VBM organizations:', err)
                setError(err instanceof Error ? err.message : 'Failed to fetch organizations')
            } finally {
                setLoading(false)
            }
        }

        fetchOrgs()

        // Refresh data every 30 seconds
        const interval = setInterval(fetchOrgs, 30000)
        return () => clearInterval(interval)
    }, [])

    return (
        <div className="flex-1 overflow-auto bg-background">
            <div className="container mx-auto py-8 px-4">
                <div className="mb-6">
                    <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
                    <p className="text-muted-foreground mt-2">
                        View and manage your Microsoft 365 organizations
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

                <VBMOrganizationsTable data={organizations} loading={loading} />
            </div>
        </div>
    )
}
