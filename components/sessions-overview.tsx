"use client"

import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts" // Added YAxis
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
// Tabs imports removed
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    getSortedRowModel,
    SortingState,
    ColumnFiltersState,
    getFilteredRowModel,
    VisibilityState,
    getFacetedRowModel,
    getFacetedUniqueValues,
    getPaginationRowModel // Added
} from "@tanstack/react-table"
import { VeeamSession } from "@/lib/types/veeam"
import { ArrowUpDown, CheckCircle2, AlertTriangle, XCircle, HelpCircle, Columns, ChevronLeft, ChevronRight, ChevronDown, FolderUp, FileJson, FileSpreadsheet, CalendarDays } from "lucide-react" // Added icons
import { DataTableFacetedFilter } from "@/components/data-table-faceted-filter"
import { Skeleton } from "@/components/ui/skeleton"

interface SessionsOverviewProps {
    sessions: VeeamSession[]
    loading?: boolean
    onSessionSelect?: (session: VeeamSession) => void
    selectedSessionId?: string | null
    timeRange: "7d" | "30d"
    onTimeRangeChange: (range: "7d" | "30d") => void
    defaultFilterType?: string[]
}

interface DailyStats {
    date: string
    success: number
    warning: number
    failed: number
    total: number
}

// ... Columns definition (unchanged) ...
export const columns: ColumnDef<VeeamSession>[] = [
    {
        accessorKey: "result.result",
        id: "status",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="!p-0 hover:!bg-transparent"
                >
                    Status
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => {
            const result = row.original.result?.result
            return (
                <Badge
                    variant="outline"
                    className={
                        result === 'Success' ? 'bg-green-50 text-green-700 border-green-200 gap-1' :
                            result === 'Warning' ? 'bg-yellow-50 text-yellow-700 border-yellow-200 gap-1' :
                                result === 'Failed' ? 'bg-red-50 text-red-700 border-red-200 gap-1' :
                                    'text-gray-500 gap-1'
                    }
                >
                    {result === 'Success' && <CheckCircle2 className="w-3 h-3" />}
                    {result === 'Warning' && <AlertTriangle className="w-3 h-3" />}
                    {result === 'Failed' && <XCircle className="w-3 h-3" />}
                    {(!result || result === 'None') && <HelpCircle className="w-3 h-3" />}
                    {result || 'Unknown'}
                </Badge>
            )
        },
        filterFn: (row, id, value) => {
            return value.includes(row.original.result?.result || "None")
        },
    },
    {
        accessorKey: "name",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="!p-0 hover:!bg-transparent"
                >
                    Job Name
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>,
    },
    {
        accessorKey: "sessionType", // Using sessionType as 'Type'
        id: "type",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="!p-0 hover:!bg-transparent"
                >
                    Type
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => <div className="text-sm text-muted-foreground">{row.getValue("type")}</div>,
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: "creationTime",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="!p-0 hover:!bg-transparent"
                >
                    Time
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => {
            const date = new Date(row.getValue("creationTime"))
            return (
                <div className="text-sm">
                    <span>{date.toLocaleDateString()}</span>
                    <span className="text-muted-foreground ml-2">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            )
        },
    },

]

// Custom Tooltip Component
interface TooltipPayload {
    name: string
    value: number
    color?: string
    payload?: unknown
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean, payload?: TooltipPayload[], label?: string }) => {
    if (active && payload && payload.length) {
        return (
            <div className="border border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
                <div className="font-medium text-foreground">{new Date(label || "").toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                <div className="grid gap-1.5">
                    {payload.map((entry: TooltipPayload, index: number) => {
                        if (entry.value === 0) return null; // Hide if value is 0
                        const colorMap: Record<string, string> = {
                            "Success": "#22c55e",
                            "Warning": "#eab308",
                            "Failed": "#ef4444"
                        }
                        const color = colorMap[entry.name] || entry.color || "#888888"

                        return (
                            <div key={index} className="flex w-full flex-wrap gap-2 items-center">
                                <div
                                    className="shrink-0 rounded-[2px] h-2.5 w-2.5 border"
                                    style={{
                                        backgroundColor: color,
                                        borderColor: color
                                    }}
                                />
                                <div className="flex flex-1 justify-between leading-none items-center gap-4">
                                    <span className="text-muted-foreground">{entry.name}</span>
                                    <span className="text-foreground font-mono font-medium tabular-nums">{entry.value}</span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }
    return null
}


export function SessionsOverview({
    sessions,
    onSessionSelect,
    selectedSessionId,
    loading,
    timeRange,
    onTimeRangeChange,
    defaultFilterType = ["BackupJob"]
}: SessionsOverviewProps) {
    // Table State
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([{ id: "type", value: defaultFilterType }])
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})

    // Filter State
    const [selectedDate, setSelectedDate] = React.useState<string | null>(null)

    // --- Chart Logic ---
    const chartData = React.useMemo(() => {
        // Apply column filters to sessions for the chart
        let filteredSessions = sessions;
        if (columnFilters.length > 0) {
            filteredSessions = sessions.filter(session => {
                return columnFilters.every(filter => {
                    if (filter.id === 'name') {
                        return (session.name || '').toLowerCase().includes((filter.value as string).toLowerCase());
                    }
                    if (filter.id === 'status') {
                        const filterValues = filter.value as string[];
                        return filterValues.includes(session.result?.result || 'None');
                    }
                    if (filter.id === 'type') {
                        const filterValues = filter.value as string[];
                        return filterValues.includes(session.sessionType);
                    }
                    return true;
                });
            });
        }

        const validSessions = filteredSessions.filter(s => s.creationTime && !isNaN(new Date(s.creationTime).getTime()))
        const statsMap = new Map<string, DailyStats>()
        const daysToShow = timeRange === "7d" ? 7 : 30
        const now = new Date()

        // Initialize days
        for (let i = 0; i < daysToShow; i++) {
            const d = new Date()
            d.setDate(now.getDate() - i)
            const key = d.toISOString().split('T')[0]
            statsMap.set(key, { date: key, success: 0, warning: 0, failed: 0, total: 0 })
        }

        validSessions.forEach(session => {
            const dateKey = new Date(session.creationTime).toISOString().split('T')[0]
            if (statsMap.has(dateKey)) {
                const stat = statsMap.get(dateKey)!
                stat.total++
                if (session.result?.result === 'Success') stat.success++
                else if (session.result?.result === 'Warning') stat.warning++
                else if (session.result?.result === 'Failed') stat.failed++
            }
        })

        return Array.from(statsMap.values()).reverse()
    }, [sessions, timeRange, columnFilters])

    const handleChartClick = (data: { activeLabel?: string } | null) => {
        if (data && data.activeLabel) {
            // Toggle filter if clicking the same date
            if (selectedDate === data.activeLabel) {
                setSelectedDate(null)
            } else {
                setSelectedDate(data.activeLabel)
            }
        }
    }

    // --- Table Logic ---
    // Filter sessions based on selection BEFORE passing to table
    const tableData = React.useMemo(() => {
        if (!selectedDate) return sessions;
        return sessions.filter(session => {
            if (!session.creationTime) return false;
            return session.creationTime.startsWith(selectedDate);
        });
    }, [sessions, selectedDate]);

    const table = useReactTable({
        data: tableData,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        getPaginationRowModel: getPaginationRowModel(),
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
        state: {
            sorting,
            columnFilters,
            columnVisibility,
        },
        initialState: {
            pagination: {
                pageSize: 8,
            }
        }
    })

    // Basic stats for the header
    const totalSessions = sessions.length
    const successRate = totalSessions > 0
        ? Math.round((sessions.filter(s => s.result?.result === 'Success').length / totalSessions) * 100)
        : 0

    // Export Functions
    const getExportData = () => {
        return table.getFilteredRowModel().rows.map(row => {
            const session = row.original;
            const dateObj = session.creationTime ? new Date(session.creationTime) : null;
            return {
                status: session.result?.result || 'None',
                jobName: session.name || '',
                type: session.sessionType || '',
                date: dateObj ? dateObj.toLocaleDateString() : '',
                time: dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '',
            };
        });
    };

    const exportToCSV = () => {
        const data = getExportData();
        if (data.length === 0) return;

        const headers = ['Status', 'Job Name', 'Type', 'Date', 'Time'];
        const csvContent = [
            headers.join(','),
            ...data.map(row =>
                [row.status, `"${row.jobName}"`, row.type, row.date, row.time].join(',')
            )
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `sessions_export_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    };

    const exportToJSON = () => {
        const data = getExportData();
        if (data.length === 0) return;

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `sessions_export_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
    };

    return (
        <Card className="h-[835px] flex flex-col overflow-hidden">
            <CardHeader className="pb-2 shrink-0">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Sessions Overview</CardTitle>
                        <CardDescription>
                            {loading ? (
                                <Skeleton className="h-4 w-[250px]" />
                            ) : (
                                <span>
                                    {totalSessions} sessions processed • {successRate}% success rate
                                </span>
                            )}
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Time Range Dropdown */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7" disabled={loading}>
                                    <CalendarDays className="h-4 w-4 mr-2" />
                                    {timeRange === "7d" ? "Last 7 Days" : "Last 30 Days"}
                                    <ChevronDown className="h-4 w-4 ml-2" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuCheckboxItem
                                    checked={timeRange === "7d"}
                                    onCheckedChange={() => onTimeRangeChange("7d")}
                                >
                                    Last 7 Days
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuCheckboxItem
                                    checked={timeRange === "30d"}
                                    onCheckedChange={() => onTimeRangeChange("30d")}
                                >
                                    Last 30 Days
                                </DropdownMenuCheckboxItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {/* Export Dropdown */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7" disabled={loading}>
                                    <FolderUp className="h-4 w-4" />
                                    <span className="hidden lg:inline ml-2">Export</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={exportToCSV}>
                                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                                    Export as CSV
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={exportToJSON}>
                                    <FileJson className="mr-2 h-4 w-4" />
                                    Export as JSON
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="flex flex-col flex-1 gap-4">
                {/* 1. Controls / Filters for Table AND Chart (Moved to Top) */}
                <div className="flex items-center justify-between shrink-0">
                    <div className="flex flex-1 items-center space-x-2">
                        <Input
                            placeholder="Filter jobs..."
                            value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
                            onChange={(event) =>
                                table.getColumn("name")?.setFilterValue(event.target.value)
                            }
                            className="h-8 w-[150px] lg:w-[250px]"
                            disabled={loading}
                        />

                        {table.getColumn("status") && (
                            <DataTableFacetedFilter
                                column={table.getColumn("status")}
                                title="Status"
                                options={[
                                    { label: "Success", value: "Success", icon: CheckCircle2 },
                                    { label: "Warning", value: "Warning", icon: AlertTriangle },
                                    { label: "Failed", value: "Failed", icon: XCircle },
                                ]}
                            />
                        )}

                        {table.getColumn("type") && (
                            <DataTableFacetedFilter
                                column={table.getColumn("type")}
                                title="Type"
                                options={
                                    Array.from(new Set(sessions.map(s => s.sessionType))).map(type => ({
                                        label: type,
                                        value: type
                                    }))
                                }
                            />
                        )}
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="ml-auto hidden h-8 lg:flex" disabled={loading}>
                                <Columns className="mr-2 h-4 w-4" />
                                Columns
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[150px]">
                            {table
                                .getAllColumns()
                                .filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide())
                                .map((column) => {
                                    return (
                                        <DropdownMenuCheckboxItem
                                            key={column.id}
                                            className="capitalize"
                                            checked={column.getIsVisible()}
                                            onCheckedChange={(value) => column.toggleVisibility(!!value)}
                                        >
                                            {column.id}
                                        </DropdownMenuCheckboxItem>
                                    )
                                })}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {/* 2. Bar Chart Section */}
                <div className="h-[250px] w-full cursor-pointer shrink-0">
                    {loading ? (
                        <div className="flex items-end justify-between h-full w-full gap-2 px-4 pb-2">
                            {[...Array(7)].map((_, i) => (
                                <Skeleton key={i} className="w-full" style={{ height: `${[40, 60, 35, 80, 50, 70, 45][i % 7]}%` }} />
                            ))}
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={chartData}
                                margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
                                onClick={handleChartClick}
                            >
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                                <XAxis
                                    dataKey="date"
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    fontSize={12}
                                    minTickGap={30}
                                />
                                <YAxis
                                    stroke="#888888"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={(value) => `${value}`}
                                />
                                <Tooltip
                                    content={<CustomTooltip />}
                                    cursor={{ fill: "transparent" }}
                                />
                                <Bar dataKey="success" name="Success" stackId="a" radius={[0, 0, 4, 4]}>
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-success-${index}`} fill="#22c55e" fillOpacity={selectedDate && selectedDate !== entry.date ? 0.3 : 1} />
                                    ))}
                                </Bar>
                                <Bar dataKey="warning" name="Warning" stackId="a" radius={[0, 0, 0, 0]}>
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-warning-${index}`} fill="#eab308" fillOpacity={selectedDate && selectedDate !== entry.date ? 0.3 : 1} />
                                    ))}
                                </Bar>
                                <Bar dataKey="failed" name="Failed" stackId="a" radius={[4, 4, 0, 0]}>
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-failed-${index}`} fill="#ef4444" fillOpacity={selectedDate && selectedDate !== entry.date ? 0.3 : 1} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* 3. Data Table */}
                <div className="rounded-md border flex-1 overflow-auto min-h-0">
                    <Table>
                        <TableHeader>
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow key={headerGroup.id}>
                                    {headerGroup.headers.map((header) => (
                                        <TableHead key={header.id}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(header.column.columnDef.header, header.getContext())}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                // Skeleton Loader Rows
                                [...Array(10)].map((_, i) => (
                                    <TableRow key={`skeleton-${i}`}>
                                        {columns.map((_, colIndex) => (
                                            <TableCell key={`col-${colIndex}`}>
                                                <Skeleton className="h-6 w-full" />
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))
                            ) : (
                                table.getRowModel().rows?.length ? (
                                    table.getRowModel().rows.map((row) => (
                                        <TableRow
                                            key={row.id}
                                            data-state={row.original.id === selectedSessionId ? "selected" : undefined}
                                            className={onSessionSelect ? "cursor-pointer hover:bg-muted/50" : ""}
                                            onClick={() => onSessionSelect && onSessionSelect(row.original)}
                                        >
                                            {row.getVisibleCells().map((cell) => (
                                                <TableCell key={cell.id}>
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={columns.length} className="h-24 text-center">
                                            No results.
                                        </TableCell>
                                    </TableRow>
                                )
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* 4. Pagination */}
                <div className="flex items-center justify-between px-2 pb-2 shrink-0">
                    <div className="flex-1 text-sm text-muted-foreground">
                        {loading ? <Skeleton className="h-4 w-24" /> : `${table.getFilteredRowModel().rows.length} sessions`}
                    </div>
                    <div className="flex items-center space-x-6 lg:space-x-8">
                        <div className="flex items-center space-x-2">
                            {loading ? <Skeleton className="h-4 w-32" /> : <p className="text-sm font-medium">Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</p>}
                        </div>
                        <div className="flex items-center space-x-2">
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={() => table.previousPage()}
                                disabled={!table.getCanPreviousPage() || loading}
                            >
                                <span className="sr-only">Go to previous page</span>
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={() => table.nextPage()}
                                disabled={!table.getCanNextPage() || loading}
                            >
                                <span className="sr-only">Go to next page</span>
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>

            </CardContent>
        </Card>
    )
}
