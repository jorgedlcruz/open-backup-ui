"use client"

import { useState } from "react"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, isToday, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays, subDays } from "date-fns"
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Mail, Globe, Users, Database, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { VBMRestorePoint } from "@/lib/types/vbm"
import { cn } from "@/lib/utils"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface VbmRestorePointsCalendarProps {
    data: VBMRestorePoint[]
    lookupData?: {
        organizations: Record<string, string>,
        repositories: Record<string, string>,
        jobs: Record<string, string>
    }
}

export function VbmRestorePointsCalendar({ data, lookupData }: VbmRestorePointsCalendarProps) {
    const [currentDate, setCurrentDate] = useState(new Date())
    const [view, setView] = useState<"month" | "week" | "day">("month")

    const next = () => {
        if (view === "month") setCurrentDate(addMonths(currentDate, 1))
        if (view === "week") setCurrentDate(addWeeks(currentDate, 1))
        if (view === "day") setCurrentDate(addDays(currentDate, 1))
    }

    const prev = () => {
        if (view === "month") setCurrentDate(subMonths(currentDate, 1))
        if (view === "week") setCurrentDate(subWeeks(currentDate, 1))
        if (view === "day") setCurrentDate(subDays(currentDate, 1))
    }

    const goToToday = () => setCurrentDate(new Date())

    const getPointsForDay = (date: Date) => {
        return data.filter(rp => isSameDay(new Date(rp.backupTime), date))
            .sort((a, b) => new Date(a.backupTime).getTime() - new Date(b.backupTime).getTime())
    }

    // Helper to get header label
    const getHeaderLabel = () => {
        if (view === "month") return format(currentDate, 'MMMM yyyy')
        if (view === "week") {
            const start = startOfWeek(currentDate)
            const end = endOfWeek(currentDate)
            return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`
        }
        if (view === "day") return format(currentDate, 'MMMM d, yyyy')
        return ""
    }



    const getContentTypeConfig = (item: VBMRestorePoint) => {
        if (item.isExchange) return { label: 'Exchange', icon: Mail, className: "bg-blue-100 text-blue-800 border-blue-200 hover:border-blue-300" }
        if (item.isSharePoint) return { label: 'SharePoint', icon: Globe, className: "bg-teal-100 text-teal-800 border-teal-200 hover:border-teal-300" }
        if (item.isOneDrive) return { label: 'OneDrive', icon: Database, className: "bg-sky-100 text-sky-800 border-sky-200 hover:border-sky-300" }
        if (item.isTeams) return { label: 'Teams', icon: Users, className: "bg-indigo-100 text-indigo-800 border-indigo-200 hover:border-indigo-300" }
        return { label: 'Unknown', icon: Database, className: "bg-gray-100 text-gray-800 border-gray-200" }
    }

    const getCopyTypeBadge = (item: VBMRestorePoint) => {
        if (item.isLongTermCopy) return <Badge variant="outline" className="text-[9px] h-4 px-1 bg-amber-50 text-amber-700 border-amber-200">Archive</Badge>
        if (item.isCopy) return <Badge variant="outline" className="text-[9px] h-4 px-1 bg-purple-50 text-purple-700 border-purple-200">Copy</Badge>
        return null
    }

    const RestorePointCard = ({ item }: { item: VBMRestorePoint }) => {
        const config = getContentTypeConfig(item)
        const date = new Date(item.backupTime)

        return (
            <div className={cn(
                "group flex flex-col gap-1 rounded border p-1.5 text-xs shadow-sm hover:shadow-md transition-all w-full overflow-hidden",
                config.className
            )}>
                <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1 min-w-0">
                        <config.icon className="h-3 w-3 shrink-0" />
                        <span className="font-semibold truncate text-[10px]">
                            {format(date, 'HH:mm')}
                        </span>
                    </div>
                    {getCopyTypeBadge(item)}
                </div>

                <div className="flex flex-col gap-0.5">
                    {lookupData?.jobs[item.jobId] && (
                        <div className="truncate text-[9px] opacity-80 font-medium" title={lookupData.jobs[item.jobId]}>
                            {lookupData.jobs[item.jobId]}
                        </div>
                    )}
                    {lookupData?.repositories[item.repositoryId] && (
                        <div className="truncate text-[9px] opacity-70" title={lookupData.repositories[item.repositoryId]}>
                            {lookupData.repositories[item.repositoryId]}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="outline" size="sm" onClick={goToToday}>
                        Today
                    </Button>
                    <div className="flex items-center rounded-md border bg-background">
                        <Button variant="ghost" size="icon" onClick={prev} className="rounded-r-none h-8 w-8">
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={next} className="rounded-l-none h-8 w-8">
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                    <h2 className="text-lg font-semibold flex items-center gap-2 min-w-[140px]">
                        {getHeaderLabel()}
                    </h2>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="min-w-[80px]">
                            {view.charAt(0).toUpperCase() + view.slice(1)}
                            <ChevronRight className="ml-2 h-4 w-4 rotate-90" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setView("month")}>Month</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setView("week")}>Week</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setView("day")}>Day</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {view === "month" && (
                <div className="grid grid-cols-7 gap-px bg-muted rounded-lg overflow-hidden border">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                        <div key={day} className="bg-muted/50 p-2 text-center text-xs font-medium text-muted-foreground">
                            {day}
                        </div>
                    ))}

                    {Array(startOfMonth(currentDate).getDay()).fill(null).map((_, i) => (
                        <div key={`pad-${i}`} className="bg-background min-h-[120px] p-2 opacity-50" />
                    ))}

                    {eachDayOfInterval({
                        start: startOfMonth(currentDate),
                        end: endOfMonth(currentDate)
                    }).map((date, i) => {
                        const points = getPointsForDay(date)
                        const isTodayDate = isToday(date)
                        const MAX_VISIBLE = 2
                        const visiblePoints = points.slice(0, MAX_VISIBLE)
                        const hiddenCount = points.length - MAX_VISIBLE

                        return (
                            <div
                                key={i}
                                className={cn(
                                    "bg-background min-h-[140px] p-2 transition-colors hover:bg-muted/5 flex flex-col",
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
                                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                                            {points.length}
                                        </Badge>
                                    )}
                                </div>

                                <div className="space-y-1.5 flex-1">
                                    {visiblePoints.map((rp) => (
                                        <RestorePointCard key={rp.id} item={rp} />
                                    ))}

                                    {hiddenCount > 0 && (
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="w-full text-xs h-7 font-medium text-muted-foreground hover:text-foreground"
                                                >
                                                    + {hiddenCount} more
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-64 p-0" align="start">
                                                <div className="p-3 border-b bg-muted/30">
                                                    <h4 className="font-semibold text-sm flex items-center gap-2">
                                                        <CalendarIcon className="h-4 w-4" />
                                                        {format(date, 'MMMM d, yyyy')}
                                                    </h4>
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        {points.length} restore points available
                                                    </p>
                                                </div>
                                                <ScrollArea className="h-[300px] p-2">
                                                    <div className="space-y-1.5">
                                                        {points.map((rp) => (
                                                            <RestorePointCard key={rp.id} item={rp} />
                                                        ))}
                                                    </div>
                                                </ScrollArea>
                                            </PopoverContent>
                                        </Popover>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {(view === "week" || view === "day") && (
                <div className="flex flex-col border rounded-lg bg-background overflow-hidden">
                    {/* Header Row */}
                    <div className="flex border-b">
                        <div className="w-16 flex-shrink-0 border-r bg-muted/30 p-2" /> {/* Time Axis Header */}
                        {view === "week" ? (
                            eachDayOfInterval({
                                start: startOfWeek(currentDate),
                                end: endOfWeek(currentDate)
                            }).map((date, i) => (
                                <div key={i} className={cn(
                                    "flex-1 p-2 text-center border-r last:border-r-0 bg-muted/30",
                                    isToday(date) && "bg-primary/5 text-primary"
                                )}>
                                    <div className="text-xs font-medium opacity-70">{format(date, 'EEE')}</div>
                                    <div className={cn(
                                        "text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full mx-auto mt-1",
                                        isToday(date) && "bg-primary text-primary-foreground"
                                    )}>
                                        {format(date, 'd')}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="flex-1 p-2 text-center bg-muted/30">
                                <div className="text-xs font-medium opacity-70">{format(currentDate, 'EEEE')}</div>
                                <div className="text-sm font-bold">{format(currentDate, 'MMMM d, yyyy')}</div>
                            </div>
                        )}
                    </div>

                    {/* Time Grid */}
                    <div className="flex divide-x">
                        {/* Time Axis */}
                        <div className="w-16 flex-shrink-0 bg-background border-r">
                            {Array.from({ length: 24 }).map((_, hour) => (
                                <div key={hour} className="h-24 relative border-b last:border-b-0 border-border">
                                    {hour > 0 && (
                                        <span className="absolute -top-3 right-2 bg-background px-1 text-xs text-muted-foreground/70">{format(new Date().setHours(hour), 'h a')}</span>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Days Columns */}
                        {(view === "week"
                            ? eachDayOfInterval({ start: startOfWeek(currentDate), end: endOfWeek(currentDate) })
                            : [currentDate]
                        ).map((date, dayIdx) => (
                            <div key={dayIdx} className="flex-1 relative min-w-0">
                                {Array.from({ length: 24 }).map((_, hour) => {
                                    const points = getPointsForDay(date).filter(p => new Date(p.backupTime).getHours() === hour);
                                    const MAX_VISIBLE = 1
                                    const visiblePoints = points.slice(0, MAX_VISIBLE)
                                    const hiddenCount = points.length - MAX_VISIBLE

                                    return (
                                        <div key={hour} className="h-24 p-1 hover:bg-muted/5 transition-colors relative border-b last:border-b-0 border-border">
                                            <div className="space-y-1">
                                                {visiblePoints.map(rp => (
                                                    <RestorePointCard key={rp.id} item={rp} />
                                                ))}

                                                {hiddenCount > 0 && (
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="w-full text-xs h-6 font-medium text-muted-foreground hover:text-foreground p-0"
                                                            >
                                                                + {hiddenCount} more
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-64 p-0" align="start">
                                                            <div className="p-3 border-b bg-muted/30">
                                                                <h4 className="font-semibold text-sm flex items-center gap-2">
                                                                    <Clock className="h-4 w-4" />
                                                                    {format(date, 'MMMM d')} - {format(new Date().setHours(hour), 'h a')}
                                                                </h4>
                                                                <p className="text-xs text-muted-foreground mt-1">
                                                                    {points.length} restore points available
                                                                </p>
                                                            </div>
                                                            <ScrollArea className="h-[200px] p-2">
                                                                <div className="space-y-1.5">
                                                                    {points.map((rp) => (
                                                                        <RestorePointCard key={rp.id} item={rp} />
                                                                    ))}
                                                                </div>
                                                            </ScrollArea>
                                                        </PopoverContent>
                                                    </Popover>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
