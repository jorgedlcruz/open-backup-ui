"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import { veeamApi } from "@/lib/api/veeam-client"
import { VeeamBackupJob, VeeamSession, VeeamTaskSession } from "@/lib/types/veeam"
import { JobDetailsHeader } from "@/components/job-details-header"
import { SessionsOverview } from "@/components/sessions-overview"
import { SessionTasksTable } from "@/components/session-tasks-table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, Calendar, Laptop, Database } from "lucide-react"

export default function JobDetailsPage() {
    const params = useParams()
    const id = params.id as string

    const [job, setJob] = useState<VeeamBackupJob | null>(null)
    const [sessions, setSessions] = useState<VeeamSession[]>([])
    const [timeRange, setTimeRange] = useState<"7d" | "30d">("7d")
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Session Details Stats
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
    const [taskSessions, setTaskSessions] = useState<VeeamTaskSession[]>([])
    const [tasksLoading, setTasksLoading] = useState(false)

    const handleSessionSelect = useCallback(async (session: VeeamSession) => {
        setSelectedSessionId(session.id)
        setTasksLoading(true)
        try {
            // Use the real session ID (job sessions usually have a sessionId field or are themselves the session)
            // In Veeam API, the 'id' of the session in /sessions IS the sessionId used in /sessions/{id}/taskSessions
            const data = await veeamApi.getSessionTasks(session.id)
            setTaskSessions(data)
        } catch (err) {
            console.error('Failed to fetch task sessions:', err)
            setTaskSessions([])
        } finally {
            setTasksLoading(false)
        }
    }, [])

    const fetchData = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)

            // Calculate date filter
            const now = new Date()
            const fromDate = new Date()
            fromDate.setDate(now.getDate() - (timeRange === "7d" ? 7 : 30))

            const [jobData, sessionsData] = await Promise.all([
                veeamApi.getBackupJobById(id),
                // veeamApi.getJobSessions(id, 50) // Old way
                veeamApi.getSessions({
                    jobIdFilter: id,
                    limit: 1000,
                    orderColumn: 'CreationTime',
                    orderAsc: false,
                    createdAfterFilter: fromDate.toISOString()
                })
            ])

            setJob(jobData)
            setSessions(sessionsData)

            // Select the most recent session by default if none selected
            if (!selectedSessionId && sessionsData.length > 0) {
                handleSessionSelect(sessionsData[0])
            }

        } catch (err) {
            console.error('Failed to fetch job or sessions:', err)
            setError(err instanceof Error ? err.message : 'Failed to fetch job details')
        } finally {
            setLoading(false)
        }
    }, [id, timeRange, selectedSessionId, handleSessionSelect])

    useEffect(() => {
        if (id) {
            fetchData()
            const interval = setInterval(fetchData, 60000)
            return () => clearInterval(interval)
        }
    }, [id, fetchData])

    if (loading && !job) {
        return <div className="flex h-screen items-center justify-center">Loading...</div>
    }

    if (error || !job) {
        return (
            <div className="flex flex-col h-screen items-center justify-center space-y-4">
                <div className="text-red-500 font-medium">Error: {error || "Job not found"}</div>
            </div>
        )
    }

    return (
        <div className="flex-1 overflow-auto bg-background">
            <div className="container mx-auto py-8 px-4 space-y-6">

                <JobDetailsHeader job={job} onRefresh={fetchData} />

                <div className="grid gap-6 md:grid-cols-4 lg:grid-cols-4">

                    {/* Job Summary Card - Full width or large */}
                    <Card className="col-span-full">
                        <CardHeader>
                            <CardTitle className="text-lg">One-Glance Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="flex flex-col space-y-1">
                                <span className="text-xs text-muted-foreground flex items-center"><Clock className="w-3 h-3 mr-1" /> Last Run</span>
                                <span className="font-medium text-sm">
                                    {job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never'}
                                </span>
                                <Badge variant="outline" className="w-fit text-xs">{job.lastResult || 'None'}</Badge>
                            </div>
                            <div className="flex flex-col space-y-1">
                                <span className="text-xs text-muted-foreground flex items-center"><Calendar className="w-3 h-3 mr-1" /> Next Run</span>
                                <span className="font-medium text-sm">
                                    {!job.isDisabled && job.nextRun ? new Date(job.nextRun).toLocaleString() : 'Not scheduled'}
                                </span>
                                {job.isDisabled && <Badge variant="secondary" className="w-fit text-xs">Disabled</Badge>}
                            </div>
                            <div className="flex flex-col space-y-1">
                                <span className="text-xs text-muted-foreground flex items-center"><Database className="w-3 h-3 mr-1" /> Repository</span>
                                <span className="font-medium text-sm truncate" title={job.repositoryName}>
                                    {job.repositoryName || 'Unknown'}
                                </span>
                            </div>
                            <div className="flex flex-col space-y-1">
                                <span className="text-xs text-muted-foreground flex items-center"><Laptop className="w-3 h-3 mr-1" /> Job Objects</span>
                                <span className="font-medium text-sm truncate">
                                    {job.objectsCount || 0} objects
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Split View: Sessions List (Left) & Task Details (Right) */}
                    <div className="col-span-full md:col-span-2">
                        <SessionsOverview
                            sessions={sessions}
                            loading={loading}
                            onSessionSelect={handleSessionSelect}
                            selectedSessionId={selectedSessionId}
                            timeRange={timeRange}
                            onTimeRangeChange={setTimeRange}
                        />
                    </div>
                    <div className="col-span-full md:col-span-2 min-h-[600px]">
                        <SessionTasksTable
                            tasks={taskSessions}
                            loading={tasksLoading}
                        />
                    </div>

                </div>
            </div>
        </div>
    )
}
