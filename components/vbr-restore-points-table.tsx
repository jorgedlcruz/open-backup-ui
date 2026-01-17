"use client"

import * as React from "react"
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    getSortedRowModel,
    SortingState,
    getFilteredRowModel,
    getPaginationRowModel,
} from "@tanstack/react-table"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { VeeamRestorePoint } from "@/lib/types/veeam"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowUpDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface VBRRestorePointsTableProps {
    data: VeeamRestorePoint[]
    loading?: boolean
}

const formatBytes = (bytes: number) => {
    if (!bytes) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export const columns: ColumnDef<VeeamRestorePoint>[] = [
    {
        accessorKey: "creationTime",
        header: ({ column }) => (
            <Button
                variant="ghost"
                onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                className="!p-0 hover:!bg-transparent"
            >
                Created
                <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        ),
        cell: ({ row }) => {
            const date = new Date(row.getValue("creationTime"));
            return (
                <div className="flex flex-col">
                    <span className="font-medium text-sm">{date.toLocaleDateString()}</span>
                    <span className="text-muted-foreground text-xs">{date.toLocaleTimeString()}</span>
                </div>
            )
        },
    },
    {
        accessorKey: "jobName",
        header: "Job Name",
        cell: ({ row }) => <div className="text-sm font-medium truncate max-w-[200px]" title={row.getValue("jobName") as string}>{row.getValue("jobName") || '-'}</div>
    },
    {
        accessorKey: "pointType",
        header: "Type",
        cell: ({ row }) => {
            const type = row.original.pointType;
            if (type) return <Badge variant="outline" className="font-normal">{type}</Badge>

            const isGfs = (row.original as unknown as { isGfs?: boolean }).isGfs
            return <Badge variant={isGfs ? "default" : "secondary"} className="font-normal whitespace-nowrap">{isGfs ? "Full (GFS)" : "Incremental"}</Badge>
        }
    },
    {
        accessorKey: "dataSize",
        header: ({ column }) => (
            <div className="text-right">
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="!p-0 hover:!bg-transparent justify-end"
                >
                    Data Size
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            </div>
        ),
        cell: ({ row }) => <div className="text-right font-mono text-xs">{formatBytes(row.getValue("dataSize"))}</div>
    },
    {
        accessorKey: "backupSize",
        header: ({ column }) => (
            <div className="text-right">
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="!p-0 hover:!bg-transparent justify-end"
                >
                    Backup Size
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            </div>
        ),
        cell: ({ row }) => <div className="text-right font-mono text-xs">{formatBytes(row.getValue("backupSize"))}</div>
    },
    {
        accessorKey: "dedupRatio",
        header: "Ratio",
        cell: ({ row }) => {
            const dedup = row.original.dedupRatio
            const comp = row.original.compressRatio
            if (!dedup && !comp) return <span className="text-muted-foreground">-</span>;
            return <div className="text-xs text-muted-foreground whitespace-nowrap">{dedup}% / {comp}%</div>
        }
    },
    {
        accessorKey: "fileName",
        header: "File Name",
        cell: ({ row }) => <div className="text-xs text-muted-foreground truncate max-w-[150px]" title={row.getValue("fileName") as string}>{row.getValue("fileName") || '-'}</div>
    },
    {
        accessorKey: "repositoryName",
        header: "Repository",
        cell: ({ row }) => <div className="text-xs text-muted-foreground truncate max-w-[120px]" title={row.getValue("repositoryName") as string}>{row.getValue("repositoryName") || '-'}</div>
    },
]

export function VBRRestorePointsTable({ data, loading }: VBRRestorePointsTableProps) {
    const [sorting, setSorting] = React.useState<SortingState>([])

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        onSortingChange: setSorting,
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        state: {
            sorting,
        },
        initialState: {
            pagination: {
                pageSize: 10
            }
        }
    })

    if (loading) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-10 w-[200px]" />
                </div>
                <div className="rounded-md border p-4 space-y-4">
                    {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="h-12 w-full bg-muted/50 animate-pulse rounded-md" />
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="rounded-md border bg-card shadow-sm">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id} className="hover:bg-transparent">
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
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"} className="hover:bg-muted/50">
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className="py-3">
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                                    No restore points found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="flex items-center justify-end space-x-2 py-4">
                <div className="flex-1 text-sm text-muted-foreground">
                    {table.getFilteredRowModel().rows.length} restore points found
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
