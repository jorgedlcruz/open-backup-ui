"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { VBMRestorePointsTable } from "@/components/vbm-restore-points-table"
import { VbmRestorePointsCalendar } from "@/components/vbm-restore-points-calendar"
import { FacetedFilter } from "@/components/faceted-filter"
import { veeamApi } from "@/lib/api/veeam-client"
import { VBMRestorePoint } from "@/lib/types/vbm"
import { Button } from "@/components/ui/button"
import { ChevronLeft, Grid, Calendar, Mail, Globe, Users, Database } from "lucide-react"
import Link from "next/link"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

function RestorePointsContent() {
    const searchParams = useSearchParams()
    const type = searchParams.get("type")
    const id = searchParams.get("id")
    const name = searchParams.get("name")

    const [items, setItems] = useState<VBMRestorePoint[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [lookupData, setLookupData] = useState<{
        organizations: Record<string, string>,
        repositories: Record<string, string>,
        jobs: Record<string, string>
    }>({ organizations: {}, repositories: {}, jobs: {} })

    // View state
    const [viewMode, setViewMode] = useState<"grid" | "calendar">("grid")

    // Filter state
    const [selectedStructureTypes, setSelectedStructureTypes] = useState<Set<string>>(new Set())

    useEffect(() => {
        const fetchData = async () => {
            if (!id || !type) return

            try {
                setLoading(true)
                setError(null)

                // Fetch lookup data in parallel
                const [restorePoints, orgs, repos, jobs] = await Promise.all([
                    type === 'User' ? veeamApi.getVBMRestorePoints({ userId: id, limit: 100 }) :
                        type === 'Group' ? veeamApi.getVBMRestorePoints({ groupId: id, limit: 100 }) :
                            type === 'Site' ? veeamApi.getVBMRestorePoints({ siteId: id, limit: 100 }) :
                                type === 'Team' ? veeamApi.getVBMRestorePoints({ teamId: id, limit: 100 }) :
                                    Promise.resolve([]),
                    veeamApi.getVBMOrganizations({ limit: 1000 }), // Reasonable limit for now
                    veeamApi.getVBMBackupRepositories({ limit: 1000 }),
                    veeamApi.getVBMJobs({ limit: 1000 })
                ]);

                // Build lookup maps
                const orgMap: Record<string, string> = {};
                orgs.forEach(o => orgMap[o.id] = o.name);

                const repoMap: Record<string, string> = {};
                repos.forEach(r => repoMap[r.id] = r.name);

                const jobMap: Record<string, string> = {};
                jobs.forEach(j => jobMap[j.id] = j.name);

                setLookupData({
                    organizations: orgMap,
                    repositories: repoMap,
                    jobs: jobMap
                });

                setItems(restorePoints)
            } catch (err) {
                console.error('Failed to fetch VBM data:', err)
                setError(err instanceof Error ? err.message : 'Failed to fetch restore points data')
            } finally {
                setLoading(false)
            }
        }

        fetchData()
    }, [type, id])

    const getContentType = (item: VBMRestorePoint) => {
        if (item.isExchange) return "Exchange";
        if (item.isSharePoint) return "SharePoint";
        if (item.isOneDrive) return "OneDrive";
        if (item.isTeams) return "Teams";
        return "Unknown";
    }

    // Filter Logic
    const filteredItems = useMemo(() => {
        if (selectedStructureTypes.size === 0) return items
        return items.filter(item => selectedStructureTypes.has(getContentType(item)))
    }, [items, selectedStructureTypes])

    // Facet Counts
    const typeCounts = useMemo(() => {
        const counts: Record<string, number> = { Exchange: 0, SharePoint: 0, OneDrive: 0, Teams: 0, Unknown: 0 }
        items.forEach(item => {
            const type = getContentType(item)
            counts[type] = (counts[type] || 0) + 1
        })
        return counts
    }, [items])

    if (!type || !id) {
        return <div className="p-8">Invalid parameters. Missing type or ID.</div>
    }

    const contentTypeOptions = [
        { label: "Exchange", value: "Exchange", icon: Mail },
        { label: "SharePoint", value: "SharePoint", icon: Globe },
        { label: "OneDrive", value: "OneDrive", icon: Database },
        { label: "Teams", value: "Teams", icon: Users },
    ]

    return (
        <div className="flex-1 overflow-auto bg-background">
            <div className="container mx-auto py-8 px-4">
                <div className="mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <Link href="/vbm/protected-items">
                            <Button variant="ghost" size="sm" className="-ml-4">
                                <ChevronLeft className="mr-2 h-4 w-4" />
                                Back to Protected Items
                            </Button>
                        </Link>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight">Restore Points</h1>
                            <p className="text-muted-foreground mt-2">
                                Viewing restore points for <span className="font-medium text-foreground">{name || id}</span>
                            </p>
                        </div>
                        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "grid" | "calendar")} className="w-[200px]">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="grid" className="flex items-center gap-2">
                                    <Grid className="h-4 w-4" />
                                    Grid
                                </TabsTrigger>
                                <TabsTrigger value="calendar" className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4" />
                                    Calendar
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-800 font-medium">Error: {error}</p>
                    </div>
                )}

                <div className="space-y-4">
                    <div className="flex items-center">
                        <FacetedFilter
                            title="Content Type"
                            options={contentTypeOptions}
                            selectedValues={selectedStructureTypes}
                            onSelect={setSelectedStructureTypes}
                            counts={typeCounts}
                        />
                    </div>

                    {viewMode === 'grid' ? (
                        <VBMRestorePointsTable
                            data={filteredItems}
                            loading={loading}
                            lookupData={lookupData}
                        />
                    ) : (
                        <VbmRestorePointsCalendar
                            data={filteredItems}
                            lookupData={lookupData}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}

export default function VBMRestorePointsPage() {
    return (
        <Suspense fallback={<div className="p-8">Loading...</div>}>
            <RestorePointsContent />
        </Suspense>
    )
}
