"use client"

import * as React from "react"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { VeeamTaskSession } from "@/lib/types/veeam"
import { Activity, Server, MonitorDot } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

interface SessionTasksTableProps {
    tasks: VeeamTaskSession[]
    loading?: boolean
}

function formatBytes(bytes: number, decimals = 2) {
    if (!bytes) return '0 B'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function SessionTasksTable({ tasks, loading }: SessionTasksTableProps) {
    if (loading) {
        return <div className="p-4 text-center text-muted-foreground">Loading task details...</div>
    }

    if (!tasks || tasks.length === 0) {
        return (
            <Card className="h-full border-dashed">
                <CardContent className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
                    <Activity className="h-12 w-12 mb-4 opacity-20" />
                    <p>Select a session to view detailed task performance</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="pb-3 border-b">
                <CardTitle className="text-lg font-medium flex items-center">
                    <Activity className="mr-2 h-5 w-5 text-primary" />
                    Session Details ({tasks.length} objects)
                </CardTitle>
            </CardHeader>
            <ScrollArea className="flex-1">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead>Object Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Size</TableHead>
                            <TableHead className="text-right">Rate</TableHead>
                            <TableHead className="text-right">Duration</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tasks.map((task) => {
                            // Assuming 'isVm' can be determined from task.name or another property if available
                            // For this example, we'll assume a simple check based on name or a placeholder.
                            // In a real application, you'd likely have a 'type' property on VeeamTaskSession.
                            const isVm = task.name.toLowerCase().includes('vm'); // Placeholder logic

                            return (
                                <TableRow key={task.id} className="group">
                                    <TableCell className="font-medium">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2">
                                                {isVm ? (
                                                    <MonitorDot className="h-4 w-4 text-blue-500" />
                                                ) : (
                                                    <Server className="h-4 w-4 text-muted-foreground" />
                                                )}
                                                {task.name}
                                            </div>
                                            {task.progress.bottleneck && (
                                                <span className="text-[10px] text-muted-foreground ml-6">
                                                    Bottleneck: {task.progress.bottleneck}
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {task.result.result === 'Success' && <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Success</Badge>}
                                        {task.result.result === 'Warning' && <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Warning</Badge>}
                                        {task.result.result === 'Failed' && <Badge variant="destructive">Failed</Badge>}
                                        {(!task.result.result || task.result.result === 'None') && <Badge variant="secondary">In Progress</Badge>}
                                    </TableCell>
                                    <TableCell className="text-right text-xs">
                                        <div>{formatBytes(task.progress.processedSize)}</div>
                                        <div className="text-muted-foreground text-[10px]">Read: {formatBytes(task.progress.readSize)}</div>
                                    </TableCell>
                                    <TableCell className="text-right text-xs font-mono">
                                        {task.progress.processingRate}
                                    </TableCell>
                                    <TableCell className="text-right text-xs font-mono">
                                        {task.progress.duration}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </ScrollArea>
        </Card >
    )
}
