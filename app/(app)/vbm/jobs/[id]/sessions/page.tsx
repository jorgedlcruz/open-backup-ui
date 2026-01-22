"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import { veeamApi } from "@/lib/api/veeam-client"
import { VBMJobSession } from "@/lib/types/vbm"
import { Button } from "@/components/ui/button"
import { ArrowLeft, AlertCircle, Clock, Database, Info, Activity, ChevronUp, ChevronDown, X } from "lucide-react"
import Link from "next/link"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
    Sheet,
    SheetContent,
    SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"

export default function VBMJobSessionsPage() {
    const params = useParams()
    const jobId = params.id as string
    const [sessions, setSessions] = useState<VBMJobSession[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Sheet state with index tracking
    const [selectedSession, setSelectedSession] = useState<VBMJobSession | null>(null)
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const [isSheetOpen, setIsSheetOpen] = useState(false)

    useEffect(() => {
        const fetchSessions = async () => {
            try {
                setLoading(true)
                const data = await veeamApi.getVBMJobSessions(jobId)
                setSessions(data)
            } catch (err) {
                console.error("Failed to fetch sessions", err)
                setError("Failed to load sessions. Please try again.")
            } finally {
                setLoading(false)
            }
        }

        if (jobId) {
            fetchSessions()
        }
    }, [jobId])

    const handleSessionClick = (session: VBMJobSession, index: number) => {
        setSelectedSession(session)
        setSelectedIndex(index)
        setIsSheetOpen(true)
    }

    const navigateToPrevious = useCallback(() => {
        if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1
            setSelectedIndex(newIndex)
            setSelectedSession(sessions[newIndex])
        }
    }, [selectedIndex, sessions])

    const navigateToNext = useCallback(() => {
        if (selectedIndex < sessions.length - 1) {
            const newIndex = selectedIndex + 1
            setSelectedIndex(newIndex)
            setSelectedSession(sessions[newIndex])
        }
    }, [selectedIndex, sessions])

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'Success':
                return <Badge className="bg-green-100 text-green-800 border-green-200">Success</Badge>
            case 'Warning':
                return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Warning</Badge>
            case 'Failed':
                return <Badge className="bg-red-100 text-red-800 border-red-200">Failed</Badge>
            case 'Running':
                return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Running</Badge>
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    const formatRate = (bytesPerSec: number) => {
        return formatBytes(bytesPerSec) + '/s';
    }

    const calculateDuration = (startTime?: string, endTime?: string) => {
        if (!startTime || !endTime) return "N/A"
        const start = new Date(startTime).getTime()
        const end = new Date(endTime).getTime()
        const diff = Math.max(0, end - start)
        const minutes = Math.floor(diff / 60000)
        const seconds = Math.floor((diff % 60000) / 1000)
        return `${minutes}m ${seconds}s`
    }

    return (
        <div className="flex-1 overflow-auto bg-background">
            <div className="container mx-auto py-8 px-4">
                <div className="mb-6">
                    <Button variant="ghost" asChild className="mb-4 pl-0 hover:bg-transparent">
                        <Link href="/vbm/jobs" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
                            <ArrowLeft className="h-4 w-4" />
                            Back to Jobs
                        </Link>
                    </Button>
                    <div className="flex justify-between items-center">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">Job Sessions</h1>
                            <p className="text-muted-foreground text-sm mt-1">
                                History of job sessions for ID: <code className="bg-muted px-1 py-0.5 rounded text-xs text-foreground font-mono">{jobId}</code>
                            </p>
                        </div>
                        <Button variant="outline" onClick={() => window.location.reload()}>Refresh</Button>
                    </div>
                </div>

                {error && (
                    <div className="bg-destructive/15 border border-destructive/20 text-destructive px-4 py-3 rounded mb-6 flex items-center gap-2">
                        <AlertCircle className="h-5 w-5" />
                        {error}
                    </div>
                )}

                <div className="bg-card rounded-lg border shadow-sm">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Status</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Start Time</TableHead>
                                <TableHead>End Time</TableHead>
                                <TableHead>Duration</TableHead>
                                <TableHead>Transferred</TableHead>
                                <TableHead>Details</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                        Loading sessions...
                                    </TableCell>
                                </TableRow>
                            ) : sessions.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                        No sessions found for this job.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                sessions.map((session, index) => (
                                    <TableRow
                                        key={session.id}
                                        className={`cursor-pointer transition-colors ${isSheetOpen && selectedIndex === index ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted/50'}`}
                                        onClick={() => handleSessionClick(session, index)}
                                    >
                                        <TableCell>{getStatusBadge(session.status)}</TableCell>
                                        <TableCell>{session.jobType}</TableCell>
                                        <TableCell>
                                            {session.creationTime
                                                ? new Date(session.creationTime).toLocaleString()
                                                : "-"}
                                        </TableCell>
                                        <TableCell>
                                            {session.endTime
                                                ? new Date(session.endTime).toLocaleString()
                                                : "-"}
                                        </TableCell>
                                        <TableCell>
                                            {calculateDuration(session.creationTime, session.endTime)}
                                        </TableCell>
                                        <TableCell>
                                            {session.statistics?.transferredDataBytes
                                                ? formatBytes(session.statistics.transferredDataBytes)
                                                : "0 B"}
                                        </TableCell>
                                        <TableCell className="max-w-xs truncate text-muted-foreground" title={session.details}>
                                            {session.details || "No details"}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetContent className="w-[600px] sm:w-[800px] overflow-y-auto p-0 gap-0 border-l border-border bg-background">
                    {selectedSession && (
                        <div className="flex flex-col h-full">
                            {/* Sticky Header with Navigation */}
                            <div className="sticky top-0 z-10 border-b border-border bg-background p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <SheetTitle className="text-lg font-semibold truncate text-left">
                                        Session {selectedIndex + 1} of {sessions.length}
                                    </SheetTitle>
                                    <div className="flex h-7 items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            disabled={selectedIndex <= 0}
                                            onClick={navigateToPrevious}
                                        >
                                            <ChevronUp className="h-5 w-5" />
                                            <span className="sr-only">Previous</span>
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            disabled={selectedIndex >= sessions.length - 1}
                                            onClick={navigateToNext}
                                        >
                                            <ChevronDown className="h-5 w-5" />
                                            <span className="sr-only">Next</span>
                                        </Button>
                                        <Separator orientation="vertical" className="mx-1 h-4" />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => setIsSheetOpen(false)}
                                        >
                                            <X className="h-5 w-5" />
                                            <span className="sr-only">Close</span>
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Session Info Header */}
                            <div className="p-6 border-b border-border bg-muted/10">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium">Session ID</div>
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
                                            <span>{selectedSession.id}</span>
                                        </div>
                                    </div>
                                    <div className="scale-100">
                                        {getStatusBadge(selectedSession.status)}
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-4 mt-6">
                                    <div className="space-y-1">
                                        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Duration</span>
                                        <div className="text-sm font-mono font-medium text-foreground">
                                            {calculateDuration(selectedSession.creationTime, selectedSession.endTime)}
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Processed</span>
                                        <div className="text-sm font-mono font-medium text-foreground">
                                            {selectedSession.statistics?.processedObjects || 0} objects
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Bottleneck</span>
                                        <div className="text-sm font-mono font-medium text-foreground">
                                            {selectedSession.statistics?.bottleneck || 'N/A'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Main Properties List */}
                            <div className="flex-1 overflow-y-auto">
                                <section className="py-2">
                                    <div className="px-6 py-2 text-xs font-semibold text-muted-foreground bg-muted/20 border-y border-border flex items-center gap-2">
                                        <Clock className="w-3 h-3" /> TIMING
                                    </div>
                                    <div className="px-6 py-3 space-y-3">
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-muted-foreground w-1/3">Start Time</span>
                                            <span className="font-mono text-foreground text-right">
                                                {selectedSession.creationTime ? new Date(selectedSession.creationTime).toLocaleString() : 'N/A'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-muted-foreground w-1/3">End Time</span>
                                            <span className="font-mono text-foreground text-right">
                                                {selectedSession.endTime ? new Date(selectedSession.endTime).toLocaleString() : 'Running'}
                                            </span>
                                        </div>
                                    </div>
                                </section>

                                <section className="py-2">
                                    <div className="px-6 py-2 text-xs font-semibold text-muted-foreground bg-muted/20 border-y border-border flex items-center gap-2">
                                        <Database className="w-3 h-3" /> DATA TRANSFER
                                    </div>
                                    <div className="px-6 py-3 space-y-3">
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-muted-foreground w-1/3">Total Transferred</span>
                                            <span className="font-mono text-foreground text-right">{formatBytes(selectedSession.statistics?.transferredDataBytes || 0)}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-muted-foreground w-1/3">Write Rate</span>
                                            <span className="font-mono text-foreground text-right">{formatRate(selectedSession.statistics?.writeRateBytesPS || 0)}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-muted-foreground w-1/3">Read Rate</span>
                                            <span className="font-mono text-foreground text-right">{formatRate(selectedSession.statistics?.readRateBytesPS || 0)}</span>
                                        </div>
                                    </div>
                                </section>

                                <section className="py-2">
                                    <div className="px-6 py-2 text-xs font-semibold text-muted-foreground bg-muted/20 border-y border-border flex items-center gap-2">
                                        <Info className="w-3 h-3" /> LOG DETAILS
                                    </div>
                                    <div className="px-6 py-4">
                                        {selectedSession.details ? (
                                            <div className="rounded-md bg-muted/50 p-4 font-mono text-xs text-foreground overflow-x-auto whitespace-pre-wrap border border-border">
                                                {selectedSession.details}
                                            </div>
                                        ) : (
                                            <span className="text-sm text-muted-foreground italic">No details available</span>
                                        )}
                                    </div>
                                </section>

                                <section className="py-2 pb-8">
                                    <div className="px-6 py-2 text-xs font-semibold text-muted-foreground bg-muted/20 border-y border-border flex items-center gap-2">
                                        <Activity className="w-3 h-3" /> SYSTEM
                                    </div>
                                    <div className="px-6 py-3 space-y-3">
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-muted-foreground w-1/3">Proxy ID</span>
                                            <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono text-foreground">{selectedSession.proxyId}</code>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-muted-foreground w-1/3">Repository ID</span>
                                            <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono text-foreground">{selectedSession.repositoryId}</code>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    )
}
