"use client"

import { useState } from "react"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, isToday } from "date-fns"
import { ChevronLeft, ChevronRight, HardDrive, Database, Calendar as CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { VeeamRestorePoint } from "@/lib/types/veeam"
import { cn } from "@/lib/utils"

interface VBRRestorePointsCalendarProps {
    data: VeeamRestorePoint[]
}

export function VBRRestorePointsCalendar({ data }: VBRRestorePointsCalendarProps) {
    const [currentMonth, setCurrentMonth] = useState(new Date())

    const daysInMonth = eachDayOfInterval({
        start: startOfMonth(currentMonth),
        end: endOfMonth(currentMonth)
    })

    // Pad the start of the month to align with the correct day of week
    const startDay = startOfMonth(currentMonth).getDay()
    const paddingDays = Array(startDay).fill(null)

    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1))
    const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1))
    const goToToday = () => setCurrentMonth(new Date())

    const getPointsForDay = (date: Date) => {
        return data.filter(rp => isSameDay(new Date(rp.creationTime), date))
            .sort((a, b) => new Date(a.creationTime).getTime() - new Date(b.creationTime).getTime())
    }

    const formatBytes = (bytes: number) => {
        if (!bytes) return "0 B"
        const k = 1024
        const sizes = ["B", "KB", "MB", "GB", "TB"]
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
    }

    const getBadgeVariant = (type?: string) => {
        if (!type) return "secondary"
        const t = type.toLowerCase()
        if (t.includes('full')) return "default"
        if (t.includes('reverse')) return "outline"
        return "secondary"
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <CalendarIcon className="h-5 w-5 text-muted-foreground" />
                        {format(currentMonth, 'MMMM yyyy')}
                    </h2>
                    <div className="flex items-center rounded-md border bg-background">
                        <Button variant="ghost" size="icon" onClick={prevMonth} className="rounded-r-none h-8 w-8">
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={nextMonth} className="rounded-l-none h-8 w-8">
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                {!isSameMonth(currentMonth, new Date()) && (
                    <Button variant="outline" size="sm" onClick={goToToday}>
                        Today
                    </Button>
                )}
            </div>

            <div className="grid grid-cols-7 gap-px bg-muted rounded-lg overflow-hidden border">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <div key={day} className="bg-muted/50 p-2 text-center text-xs font-medium text-muted-foreground">
                        {day}
                    </div>
                ))}

                {paddingDays.map((_, i) => (
                    <div key={`pad-${i}`} className="bg-background min-h-[120px] p-2 opacity-50" />
                ))}

                {daysInMonth.map((date, i) => {
                    const points = getPointsForDay(date)
                    const isTodayDate = isToday(date)

                    return (
                        <div
                            key={i}
                            className={cn(
                                "bg-background min-h-[140px] p-2 transition-colors hover:bg-muted/5",
                                isTodayDate && "bg-accent/5 ring-1 ring-inset ring-primary/20"
                            )}
                        >
                            <div className="flex justify-between items-start mb-2">
                                <span className={cn(
                                    "text-sm font-medium h-6 w-6 flex items-center justify-center rounded-full",
                                    isTodayDate ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                                )}>
                                    {format(date, 'd')}
                                </span>
                                {points.length > 0 && (
                                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                                        {points.length}
                                    </Badge>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                {points.map((rp) => (
                                    <div
                                        key={rp.id}
                                        className="group flex flex-col gap-1 rounded border bg-card p-1.5 text-xs shadow-sm hover:shadow-md hover:border-primary/50 transition-all"
                                    >
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="font-semibold truncate text-[10px] text-primary">
                                                {format(new Date(rp.creationTime), 'HH:mm')}
                                            </span>
                                            <Badge variant={getBadgeVariant(rp.pointType)} className="h-4 px-1 text-[9px] pointer-events-none">
                                                {rp.pointType || 'Inc'}
                                            </Badge>
                                        </div>

                                        {(rp.backupSize || rp.dataSize) && (
                                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                                {rp.dataSize && (
                                                    <span className="flex items-center gap-0.5" title="Data Size">
                                                        <Database className="h-2.5 w-2.5" />
                                                        {formatBytes(rp.dataSize)}
                                                    </span>
                                                )}
                                                {rp.backupSize && (
                                                    <span className="flex items-center gap-0.5" title="Backup Size">
                                                        <HardDrive className="h-2.5 w-2.5" />
                                                        {formatBytes(rp.backupSize)}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {rp.jobName && (
                                            <div className="truncate text-[9px] text-muted-foreground font-medium" title={rp.jobName}>
                                                {rp.jobName}
                                            </div>
                                        )}

                                        {rp.repositoryName && (
                                            <div className="truncate text-[9px] text-muted-foreground/80" title={rp.repositoryName}>
                                                {rp.repositoryName}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
