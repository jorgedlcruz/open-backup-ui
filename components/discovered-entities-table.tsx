"use client"

import * as React from "react"
import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    VisibilityState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table"
import { ArrowUpDown, ChevronDown, MoreHorizontal, Search, RefreshCw, Server, Download, Trash } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { VeeamDiscoveredEntity } from "@/lib/types/veeam"
import { veeamApi } from "@/lib/api/veeam-client"
import { toast } from "sonner"
import { useParams } from "next/navigation"

export function DiscoveredEntitiesTable() {
    const params = useParams()
    const groupId = params.id as string

    const [data, setData] = React.useState<VeeamDiscoveredEntity[]>([])
    const [loading, setLoading] = React.useState(true)
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
    const [rowSelection, setRowSelection] = React.useState({})

    const fetchData = React.useCallback(async () => {
        if (!groupId) return
        try {
            setLoading(true)
            const result = await veeamApi.getDiscoveredEntities(groupId)
            setData(result)
        } catch (error) {
            console.error("Failed to fetch discovered entities", error)
            toast.error("Failed to fetch discovered entities")
        } finally {
            setLoading(false)
        }
    }, [groupId])

    React.useEffect(() => {
        fetchData()
    }, [fetchData])

    const handleAction = async (action: string, entityIds: string[]) => {
        try {
            if (action === 'rescan') {
                toast.info(`Rescanning ${entityIds.length} entities...`)
                await veeamApi.rescanDiscoveredEntities(groupId, entityIds)
                toast.success(`Rescan started`)
            } else if (action === 'installAgent') {
                toast.info(`Installing agent on ${entityIds.length} entities...`)
                await veeamApi.installAgent(groupId, entityIds)
                toast.success(`Installation started`)
            } else if (action === 'uninstallAgent') {
                toast.info(`Uninstalling agent from ${entityIds.length} entities...`)
                await veeamApi.uninstallAgent(groupId, entityIds)
                toast.success(`Uninstallation started`)
            }
            // Add other actions
        } catch (error) {
            console.error(`Failed to perform ${action}`, error)
            toast.error(`Failed to perform ${action}`)
        }
    }

    const columns: ColumnDef<VeeamDiscoveredEntity>[] = [
        {
            accessorKey: "name",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        Name
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                )
            },
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{row.getValue("name")}</span>
                </div>
            ),
        },
        {
            accessorKey: "state",
            header: "Last Seen",
            cell: ({ row }) => (
                <div className="text-sm">{row.original.state}</div>
            ),
        },
        {
            accessorKey: "agentStatus",
            header: "Backup Agent",
            cell: ({ row }) => {
                const status = row.original.agentStatus
                return (
                    <Badge variant={status === "Installed" ? "default" : "secondary"} className={status === "Installed" ? "bg-green-500 hover:bg-green-600" : ""}>
                        {status || "Unknown"}
                    </Badge>
                )
            },
        },
        {
            accessorKey: "driverStatus",
            header: "CBT Driver",
            cell: ({ row }) => {
                const status = row.original.driverStatus
                return (
                    <div className="text-sm text-muted-foreground">
                        {status || "Unknown"}
                    </div>
                )
            },
        },
        {
            id: "plugins",
            header: "Application Plug-in",
            cell: ({ row }) => {
                const plugins = row.original.plugins || []
                const installedPlugins = plugins.filter(p => p.status !== 'NotInstalled')

                if (installedPlugins.length === 0) {
                    return <span className="text-sm text-muted-foreground">Not Installed</span>
                }

                return (
                    <div className="flex flex-wrap gap-1">
                        {installedPlugins.map((p, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                                {p.type}
                            </Badge>
                        ))}
                    </div>
                )
            },
        },
        {
            accessorKey: "operatingSystemVersion",
            header: "OS",
            cell: ({ row }) => <div className="text-sm truncate max-w-[200px]" title={row.original.operatingSystemVersion}>{row.original.operatingSystemVersion}</div>,
        },
        {
            accessorKey: "lastConnected",
            header: "Last Connection",
            cell: ({ row }) => {
                const dateStr = row.original.lastConnected
                if (!dateStr) return <span className="text-muted-foreground">-</span>
                const date = new Date(dateStr)
                return <div className="text-sm">{date.toLocaleString()}</div>
            }
        },
        {
            id: "actions",
            enableHiding: false,
            cell: ({ row }) => {
                const entity = row.original

                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => handleAction('rescan', [entity.id])}>
                                <RefreshCw className="mr-2 h-4 w-4" /> Rescan
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAction('installAgent', [entity.id])}>
                                <Download className="mr-2 h-4 w-4" /> Install Agent
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleAction('uninstallAgent', [entity.id])} className="text-red-600">
                                <Trash className="mr-2 h-4 w-4" /> Uninstall Agent
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            },
        },
    ]

    const table = useReactTable({
        data,
        columns,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onColumnVisibilityChange: setColumnVisibility,
        onRowSelectionChange: setRowSelection,
        state: {
            sorting,
            columnFilters,
            columnVisibility,
            rowSelection,
        },
    })

    // Batch actions handler can be added here using table.getSelectedRowModel()

    if (loading) {
        return <div className="p-8 text-center bg-muted/20 rounded-lg animate-pulse">Loading discovered entities...</div>
    }

    return (
        <div className="w-full space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Filter entities..."
                        value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
                        onChange={(event) =>
                            table.getColumn("name")?.setFilterValue(event.target.value)
                        }
                        className="max-w-sm h-8"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => fetchData()}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="ml-auto">
                                Columns <ChevronDown className="ml-2 h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {table
                                .getAllColumns()
                                .filter((column) => column.getCanHide())
                                .map((column) => {
                                    return (
                                        <DropdownMenuCheckboxItem
                                            key={column.id}
                                            className="capitalize"
                                            checked={column.getIsVisible()}
                                            onCheckedChange={(value) =>
                                                column.toggleVisibility(!!value)
                                            }
                                        >
                                            {column.id}
                                        </DropdownMenuCheckboxItem>
                                    )
                                })}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            <div className="rounded-md border bg-card">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => {
                                    return (
                                        <TableHead key={header.id}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </TableHead>
                                    )
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={columns.length}
                                    className="h-24 text-center"
                                >
                                    No entities found in this group.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="flex items-center justify-end space-x-2 py-4">
                <div className="flex-1 text-sm text-muted-foreground">
                    {table.getFilteredSelectedRowModel().rows.length} of{" "}
                    {table.getFilteredRowModel().rows.length} row(s) selected.
                </div>
                <div className="space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                    >
                        Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                    >
                        Next
                    </Button>
                </div>
            </div>
        </div>
    )
}
