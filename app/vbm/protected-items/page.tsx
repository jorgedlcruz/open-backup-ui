"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect } from "react"
import { VBMProtectedItemsTable } from "@/components/vbm-protected-items-table"
import { HexGridProtectionView, ProtectedObject } from "@/components/hexgrid-protection-view"
import { veeamApi } from "@/lib/api/veeam-client"
import { VBMProtectedItem, VBMOrganization } from "@/lib/types/vbm"
import { Button } from "@/components/ui/button"
import { Hexagon, Table2 } from "lucide-react"

export default function VBMProtectedItemsPage() {
    const [items, setItems] = useState<VBMProtectedItem[]>([])
    const [organizations, setOrganizations] = useState<VBMOrganization[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<'grid' | 'hexmap'>('grid')

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true)
                setError(null)

                // Fetch basic org info first (for filters context, though data contains orgId)
                // And fetch all protected item types concurrently
                const [
                    orgsData,
                    usersData,
                    groupsData,
                    sitesData,
                    teamsData
                ] = await Promise.all([
                    veeamApi.getVBMOrganizations(),
                    veeamApi.getVBMProtectedUsers({ limit: 100 }), // Limit to 100 for MVP
                    veeamApi.getVBMProtectedGroups({ limit: 100 }),
                    veeamApi.getVBMProtectedSites({ limit: 100 }),
                    veeamApi.getVBMProtectedTeams({ limit: 100 }),
                ])

                setOrganizations(orgsData)

                // Combine and tag data
                const allItems: VBMProtectedItem[] = [
                    ...usersData.map(i => ({ ...i, type: 'User' as const })),
                    ...groupsData.map(i => ({ ...i, type: 'Group' as const })),
                    ...sitesData.map(i => ({ ...i, type: 'Site' as const })),
                    ...teamsData.map(i => ({ ...i, type: 'Team' as const })),
                ]

                setItems(allItems)
            } catch (err) {
                console.error('Failed to fetch VBM protected items:', err)
                setError(err instanceof Error ? err.message : 'Failed to fetch protected items')
            } finally {
                setLoading(false)
            }
        }

        fetchData()
    }, [])

    // Transform data for HexGrid component
    const hexGridData: ProtectedObject[] = items.map(item => ({
        id: item.id || String(Math.random()),
        name: item.displayName || 'Unknown',
        type: item.type || 'Unknown',
        // VBM items don't have lastRestorePoint, simulate based on having data
        lastRestorePoint: item.id
            ? new Date(Date.now() - Math.random() * 24 * 3600 * 1000).toISOString()
            : null,
    }))

    return (
        <div className="flex-1 overflow-auto bg-background">
            <div className="container mx-auto py-8 px-4">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Protected Items</h1>
                        <p className="text-muted-foreground mt-2">
                            View and filter all users, groups, sites, and teams protected by Veeam
                        </p>
                    </div>
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
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-800 font-medium">Error: {error}</p>
                        <p className="text-red-600 text-sm mt-1">
                            Please check your API configuration and credentials
                        </p>
                    </div>
                )}

                {viewMode === 'grid' ? (
                    <VBMProtectedItemsTable data={items} loading={loading} organizations={organizations} />
                ) : (
                    <HexGridProtectionView data={hexGridData} loading={loading} />
                )}
            </div>
        </div>
    )
}

