"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { VBRRestorePointsTable } from "@/components/vbr-restore-points-table"
import { veeamApi } from "@/lib/api/veeam-client"
import { VeeamRestorePoint } from "@/lib/types/veeam"
import { Button } from "@/components/ui/button"
import { ChevronLeft, Database, Shield, HardDrive } from "lucide-react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { LayoutGrid, Calendar as CalendarIcon } from "lucide-react"
import { VBRRestorePointsCalendar } from "@/components/vbr-restore-points-calendar"

function RestorePointsContent() {
    const searchParams = useSearchParams()
    const backupId = searchParams.get("backupId")
    const objectId = searchParams.get("objectId")
    const name = searchParams.get("name")

    const [restorePoints, setRestorePoints] = useState<VeeamRestorePoint[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<"grid" | "calendar">("grid")

    useEffect(() => {
        const fetchRestorePoints = async () => {
            if (!objectId && !backupId) return

            try {
                setLoading(true)
                // Use the new BFF endpoint logic via client wrapper
                // We prioritize objectId for checking restore points of a specific VM/Workload
                const data = await veeamApi.getVBRRestorePoints({
                    objectId: objectId || undefined,
                    backupId: backupId || undefined
                });

                setRestorePoints(data)
            } catch (err) {
                console.error("Failed to load restore points", err)
                setError("Failed to load restore points. Please try again.")
            } finally {
                setLoading(false)
            }
        }

        fetchRestorePoints()
    }, [backupId, objectId])

    if (!backupId && !objectId) {
        return (
            <div className="flex flex-col items-center justify-center p-8 h-full">
                <div className="text-center space-y-4">
                    <Shield className="h-12 w-12 text-muted-foreground mx-auto" />
                    <h2 className="text-xl font-semibold">No Workload Selected</h2>
                    <p className="text-muted-foreground">Please select a protected workload to view restore points.</p>
                    <Link href="/vbr/protected-data">
                        <Button variant="outline">Back to Protected Data</Button>
                    </Link>
                </div>
            </div>
        )
    }

    // Calculate totals safely
    const totalDataSize = restorePoints.reduce((acc, curr) => acc + (curr.dataSize || 0), 0)
    const totalBackupSize = restorePoints.reduce((acc, curr) => acc + (curr.backupSize || 0), 0)

    const formatBytes = (bytes: number) => {
        if (!bytes) return "0 B"
        const k = 1024
        const sizes = ["B", "KB", "MB", "GB", "TB"]
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
    }

    return (
        <div className="flex-1 overflow-auto bg-background animate-in fade-in duration-500">
            <div className="container mx-auto py-8 px-4 space-y-6">
                <div>
                    <Link href="/vbr/protected-data">
                        <Button variant="ghost" size="sm" className="mb-4 -ml-4">
                            <ChevronLeft className="mr-2 h-4 w-4" />
                            Back to Protected Data
                        </Button>
                    </Link>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight">Restore Points</h1>
                            <p className="text-muted-foreground mt-2">
                                Viewing restore points for <span className="font-medium text-foreground">{name || 'Unknown Workload'}</span>
                            </p>
                        </div>
                        <div className="flex items-center gap-1 rounded-md border bg-muted/50 p-1">
                            <Button
                                variant={viewMode === "grid" ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => setViewMode("grid")}
                                className="h-7 px-2 text-xs"
                            >
                                <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
                                Grid
                            </Button>
                            <Button
                                variant={viewMode === "calendar" ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => setViewMode("calendar")}
                                className="h-7 px-2 text-xs"
                            >
                                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                                Calendar
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                        <CardContent className="p-6 flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Total Data Size</p>
                                <p className="text-2xl font-bold">{formatBytes(totalDataSize)}</p>
                            </div>
                            <Database className="h-8 w-8 text-primary/20" />
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-6 flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Total Backup Size</p>
                                <p className="text-2xl font-bold">{formatBytes(totalBackupSize)}</p>
                            </div>
                            <HardDrive className="h-8 w-8 text-primary/20" />
                        </CardContent>
                    </Card>
                </div>

                {error && (
                    <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg">
                        {error}
                    </div>
                )}

                {viewMode === "grid" ? (
                    <VBRRestorePointsTable data={restorePoints} loading={loading} />
                ) : (
                    <div className="animate-in fade-in zoom-in-95 duration-200">
                        <VBRRestorePointsCalendar data={restorePoints} />
                    </div>
                )}
            </div>
        </div>
    )
}

export default function VBRRestorePointsPage() {
    return (
        <Suspense fallback={<div className="p-8">Loading...</div>}>
            <RestorePointsContent />
        </Suspense>
    )
}
