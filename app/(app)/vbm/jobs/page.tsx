"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect } from "react"
import { VBMJobsTable } from "@/components/vbm-jobs-table"
import { veeamApi } from "@/lib/api/veeam-client"
import { VBMJob } from "@/lib/types/vbm"

export default function VBMJobsPage() {
    const [jobs, setJobs] = useState<VBMJob[]>([])
    const [orgLookup, setOrgLookup] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // const { searchQuery } = useSearch() // Global search removed

    const fetchJobs = async () => {
        try {
            setLoading(true)
            setError(null)

            const [jobsData, orgsData] = await Promise.all([
                veeamApi.getVBMJobs(),
                veeamApi.getVBMOrganizations({ limit: 1000 })
            ])

            // Build lookup map
            const lookup: Record<string, string> = {}
            orgsData.forEach(org => lookup[org.id] = org.name)
            setOrgLookup(lookup)

            setJobs(jobsData)
        } catch (err) {
            console.error('Failed to fetch VBM jobs:', err)
            setError('Failed to load VBM jobs. Please check your connection and try again.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchJobs()
    }, [])

    return (
        <div className="flex-1 overflow-auto bg-background">
            <div className="container mx-auto py-8 px-4">
                <div className="flex flex-col gap-6">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Backup Jobs</h1>
                        <p className="text-muted-foreground">
                            Manage your Microsoft 365 backup policies
                        </p>
                    </div>

                    {error && (
                        <div className="bg-destructive/15 border border-destructive/20 text-destructive px-4 py-3 rounded relative" role="alert">
                            <span className="block sm:inline">{error}</span>
                        </div>
                    )}

                    <VBMJobsTable data={jobs} loading={loading} onRefresh={fetchJobs} orgLookup={orgLookup} />
                </div>
            </div>
        </div>
    )
}
