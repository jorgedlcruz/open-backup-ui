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
import { ArrowUpDown, MoreHorizontal, RefreshCw, Play, Ban, Columns } from "lucide-react"
import Link from "next/link"

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
import { VeeamProtectionGroup } from "@/lib/types/veeam"
import { veeamApi } from "@/lib/api/veeam-client"
import { toast } from "sonner"

export function ProtectionGroupsTable() {
    const [data, setData] = React.useState<VeeamProtectionGroup[]>([])
    const [loading, setLoading] = React.useState(true)
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
    const [rowSelection, setRowSelection] = React.useState({})

    const fetchData = React.useCallback(async () => {
        try {
            setLoading(true)
            const result = await veeamApi.getProtectionGroups()
            setData(result)
        } catch (error) {
            console.error("Failed to fetch protection groups", error)
            toast.error("Failed to fetch protection groups")
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => {
        fetchData()
    }, [fetchData])

    const handleAction = async (action: string, group: VeeamProtectionGroup) => {
        try {
            if (action === 'rescan') {
                toast.info(`Rescanning ${group.name}...`)
                await veeamApi.rescanProtectionGroup(group.id)
                toast.success(`Rescan started for ${group.name}`)
            } else if (action === 'enable') {
                toast.info(`Enabling ${group.name}...`)
                await veeamApi.enableProtectionGroup(group.id)
                toast.success(`${group.name} enabled`)
                fetchData()
            } else if (action === 'disable') {
                toast.info(`Disabling ${group.name}...`)
                await veeamApi.disableProtectionGroup(group.id)
                toast.success(`${group.name} disabled`)
                fetchData()
            }
        } catch (error) {
            console.error(`Failed to ${action} group`, error)
            toast.error(`Failed to ${action} ${group.name}`)
        }
    }

    const columns: ColumnDef<VeeamProtectionGroup>[] = [
        {
            accessorKey: "name",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                        className="!p-0 hover:!bg-transparent"
                    >
                        Name
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                )
            },
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <Link href={`/vbr/inventory/protection-groups/${row.original.id}`} className="font-medium hover:underline text-primary">
                        {row.getValue("name")}
                    </Link>
                    <span className="text-xs text-muted-foreground truncate max-w-[300px]" title={row.original.description}>
                        {row.original.description}
                    </span>
                </div>
            ),
        },
        {
            accessorKey: "type",
            header: "Type",
            cell: ({ row }) => <div className="text-sm">{row.getValue("type")}</div>,
        },
        {
            accessorKey: "status",
            header: "Status",
            cell: ({ row }) => {
                const isDisabled = row.original.isDisabled
                return (
                    <Badge variant={isDisabled ? "secondary" : "default"} className={isDisabled ? "text-muted-foreground" : "bg-green-500 hover:bg-green-600"}>
                        {isDisabled ? "Disabled" : "Active"}
                    </Badge>
                )
            },
        },
        {
            id: "actions",
            enableHiding: false,
            cell: ({ row }) => {
                const group = row.original

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
                            <DropdownMenuItem onClick={() => navigator.clipboard.writeText(group.id)}>
                                Copy ID
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleAction('rescan', group)}>
                                <RefreshCw className="mr-2 h-4 w-4" /> Rescan
                            </DropdownMenuItem>
                            {group.isDisabled ? (
                                <DropdownMenuItem onClick={() => handleAction('enable', group)}>
                                    <Play className="mr-2 h-4 w-4" /> Enable
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuItem onClick={() => handleAction('disable', group)}>
                                    <Ban className="mr-2 h-4 w-4" /> Disable
                                </DropdownMenuItem>
                            )}
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

    if (loading) {
        return <div className="p-8 text-center bg-muted/20 rounded-lg animate-pulse">Loading protection groups...</div>
    }

    return (
        <div className="w-full space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Input
                        placeholder="Filter protection groups..."
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
                                <Columns className="mr-2 h-4 w-4" />
                                Columns
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
                                    No protection groups found.
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
