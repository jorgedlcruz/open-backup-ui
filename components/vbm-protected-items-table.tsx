"use client"

import * as React from "react"
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
    getFacetedUniqueValues
} from "@tanstack/react-table"
import Link from "next/link"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { VBMProtectedItem, VBMOrganization } from "@/lib/types/vbm"
import { Skeleton } from "@/components/ui/skeleton"
import {
    User,
    Users,
    Globe,
    MessageSquare,
    ArrowUpDown,
    Building2,
    Columns
} from "lucide-react"
import { DataTableFacetedFilter } from "@/components/data-table-faceted-filter"

interface VBMProtectedItemsTableProps {
    data: VBMProtectedItem[]
    loading?: boolean
    organizations: VBMOrganization[]
}

const getTypeIcon = (type: string) => {
    switch (type) {
        case 'User': return <User className="h-4 w-4 mr-2 text-blue-500" />
        case 'Group': return <Users className="h-4 w-4 mr-2 text-orange-500" />
        case 'Site': return <Globe className="h-4 w-4 mr-2 text-green-500" />
        case 'Team': return <MessageSquare className="h-4 w-4 mr-2 text-indigo-500" />
        default: return <User className="h-4 w-4 mr-2" />
    }
}

const cleanOrgName = (fullOrgId: string) => {
    // Extracts "domain.com" from "domain.com:GUID:..."
    if (!fullOrgId) return "Unknown"
    return fullOrgId.split(':')[0]
}

export const columns: ColumnDef<VBMProtectedItem>[] = [
    {
        accessorKey: "displayName",
        header: ({ column }) => (
            <Button
                variant="ghost"
                onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                className="!p-0 hover:!bg-transparent"
            >
                Name
                <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        ),
        cell: ({ row }) => (
            <div className="flex items-center font-medium">
                {getTypeIcon(row.original.type)}
                <Link
                    href={`/vbm/protected-items/restore-points?type=${row.original.type}&id=${row.original.id}&name=${encodeURIComponent(row.original.displayName)}`}
                    className="hover:underline text-primary"
                >
                    {row.original.displayName}
                </Link>
            </div>
        ),
    },
    {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => <div className="text-sm">{row.getValue("type")}</div>,
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        accessorKey: "backedUpOrganizationId",
        header: "Organization",
        cell: ({ row }) => {
            const orgName = cleanOrgName(row.getValue("backedUpOrganizationId"))
            return (
                <div className="flex items-center text-sm text-muted-foreground">
                    <Building2 className="h-3 w-3 mr-2" />
                    {orgName}
                </div>
            )
        },
        filterFn: (row, id, value) => {
            // value is array of selected filter values (which are clean org names)
            // row value is the full ID
            const clean = cleanOrgName(row.getValue(id))
            return value.includes(clean)
        }
    },
    {
        id: "details",
        header: "Details",
        cell: ({ row }) => {
            const item = row.original;
            if (item.type === 'User') {
                // Try to find email from mailboxes if available
                const email = item.mailboxes?.[0]?.email || "No email"
                return <div className="text-sm text-muted-foreground truncate max-w-[300px]" title={email}>{email}</div>
            }
            if (item.type === 'Site') {
                return <div className="text-sm text-muted-foreground truncate max-w-[300px]" title={item.url}>{item.url}</div>
            }
            if (item.type === 'Group') {
                const email = item.mailboxes?.[0]?.email || "No email"
                return <div className="text-sm text-muted-foreground truncate max-w-[300px]" title={email}>{email}</div>
            }
            if (item.type === 'Team') {
                return <div className="text-sm text-muted-foreground truncate max-w-[300px]" title={item.description}>{item.description}</div>
            }
            return null
        }
    }
]

export function VBMProtectedItemsTable({ data, loading, /* organizations */ }: VBMProtectedItemsTableProps) {
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})

    // Note: Removed useSearchParams for build compatibility with Next.js 15
    // URL parameter filtering can be re-added by wrapping in Suspense

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
        state: {
            sorting,
            columnFilters,
            columnVisibility,
        },
    })

    if (loading) {
        return (
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Organization</TableHead>
                            <TableHead>Details</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        )
    }

    // Prepare filter options
    const uniqueOrgs = Array.from(new Set(data.map(item => cleanOrgName(item.backedUpOrganizationId)))).sort()

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex flex-1 items-center space-x-2">
                    <Input
                        placeholder="Filter protected items..."
                        value={(table.getColumn("displayName")?.getFilterValue() as string) ?? ""}
                        onChange={(event) =>
                            table.getColumn("displayName")?.setFilterValue(event.target.value)
                        }
                        className="h-8 w-[150px] lg:w-[250px]"
                    />
                    {table.getColumn("type") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("type")}
                            title="Type"
                            options={[
                                { label: "User", value: "User", icon: User },
                                { label: "Group", value: "Group", icon: Users },
                                { label: "Site", value: "Site", icon: Globe },
                                { label: "Team", value: "Team", icon: MessageSquare },
                            ]}
                        />
                    )}
                    {table.getColumn("backedUpOrganizationId") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("backedUpOrganizationId")}
                            title="Organization"
                            options={uniqueOrgs.map(org => ({
                                label: org,
                                value: org,
                                icon: Building2
                            }))}
                        />
                    )}
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="ml-auto hidden h-8 lg:flex">
                            <Columns className="mr-2 h-4 w-4" />
                            Columns
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
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
                                    No results.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="text-xs text-muted-foreground">
                Showing {table.getRowModel().rows.length} protected items
            </div>
        </div>
    )
}
