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
    ColumnFiltersState,
    getFacetedRowModel,
    getFacetedUniqueValues,
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
import { VBMRestorePoint } from "@/lib/types/vbm"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowUpDown, Mail, Globe, Users, Database } from "lucide-react"

interface VBMRestorePointsTableProps {
    data: VBMRestorePoint[]
    loading?: boolean
    lookupData?: {
        organizations: Record<string, string>,
        repositories: Record<string, string>,
        jobs: Record<string, string>
    }
}

export const columns: ColumnDef<VBMRestorePoint>[] = [
    {
        accessorKey: "backupTime",
        header: ({ column }) => (
            <Button
                variant="ghost"
                onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                className="-ml-4"
            >
                Backup Time
                <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        ),
        cell: ({ row }) => {
            const date = new Date(row.getValue("backupTime"));
            return <div className="font-medium">{date.toLocaleString()}</div>
        },
    },
    {
        id: "type",
        accessorFn: (row) => {
            if (row.isExchange) return "Exchange";
            if (row.isSharePoint) return "SharePoint";
            if (row.isOneDrive) return "OneDrive";
            if (row.isTeams) return "Teams";
            return "Unknown";
        },
        header: ({ /* column */ }) => {
            return (
                <div className="flex items-center space-x-2">
                    <span>Content Type</span>
                </div>
            )
        },
        cell: ({ row }) => {
            const item = row.original;
            const types = [];
            if (item.isExchange) types.push({ icon: Mail, label: 'Exchange' });
            if (item.isSharePoint) types.push({ icon: Globe, label: 'SharePoint' });
            if (item.isOneDrive) types.push({ icon: Database, label: 'OneDrive' });
            if (item.isTeams) types.push({ icon: Users, label: 'Teams' });

            return (
                <div className="flex gap-2">
                    {types.map((t, i) => (
                        <div key={i} className="flex items-center text-xs bg-muted px-2 py-1 rounded-md" title={t.label}>
                            <t.icon className="h-3 w-3 mr-1" />
                            {t.label}
                        </div>
                    ))}
                    {types.length === 0 && <span className="text-muted-foreground text-xs">Unknown</span>}
                </div>
            )
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: "organizationId",
        header: "Organization",
        cell: ({ row, table }) => {
            // @ts-expect-error - meta property is not directly typed on table
            const lookup = table.options.meta?.lookupData?.organizations;
            const id = row.getValue("organizationId") as string;
            return <div className="text-sm">{lookup?.[id] || id}</div>
        }
    },
    {
        accessorKey: "repositoryId",
        header: "Repository",
        cell: ({ row, table }) => {
            // @ts-expect-error - meta property is not directly typed on table
            const lookup = table.options.meta?.lookupData?.repositories;
            const id = row.getValue("repositoryId") as string;
            return <div className="text-sm">{lookup?.[id] || id}</div>
        }
    },
    {
        accessorKey: "jobId",
        header: "Job",
        cell: ({ row, table }) => {
            // @ts-expect-error - meta property is not directly typed on table
            const lookup = table.options.meta?.lookupData?.jobs;
            const id = row.getValue("jobId") as string;
            return <div className="text-sm">{lookup?.[id] || id}</div>
        }
    },
    {
        accessorKey: "isCopy",
        header: "Type",
        cell: ({ row }) => {
            const isCopy = row.original.isCopy;
            const isLongTerm = row.original.isLongTermCopy;
            if (isLongTerm) return <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Archive</span>
            if (isCopy) return <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">Copy</span>
            return <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Primary</span>
        }
    }
]

export function VBMRestorePointsTable({ data, loading, lookupData }: VBMRestorePointsTableProps) {
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        getFilteredRowModel: getFilteredRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        state: {
            sorting,
            columnFilters,
        },
        meta: {
            lookupData
        }
    })

    if (loading) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-10 w-[200px]" />
                </div>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Backup Time</TableHead>
                                <TableHead>Content Type</TableHead>
                                <TableHead>Organization</TableHead>
                                <TableHead>Repository</TableHead>
                                <TableHead>Job</TableHead>
                                <TableHead>Type</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4">

            <div className="rounded-md border">
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
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
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
                                    No restore points found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="text-xs text-muted-foreground">
                Showing {table.getRowModel().rows.length} restore points
            </div>
        </div>
    )
}




