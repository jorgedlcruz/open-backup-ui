"use client"
import { FilterFields,GridColumnChoice,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableTableHead } from '@/components/ui/sortable-table-head'
import { sortableColumns } from '@/lib/table-sort'
import * as React from "react"

import { DataTableFacetedFilter } from "@/components/data-table-faceted-filter"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
DropdownMenu,
DropdownMenuContent,
DropdownMenuItem,
DropdownMenuLabel,
DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
Table,
TableBody,
TableCell,
TableHead,
TableHeader,
TableRow,
} from "@/components/ui/table"
import { VBMOrganization } from "@/lib/types/vbm"
import {
ColumnDef,
ColumnFiltersState,
flexRender,
getCoreRowModel,
getFacetedRowModel,
getFacetedUniqueValues,
getFilteredRowModel,
getSortedRowModel,
SortingState,
useReactTable,
VisibilityState
} from "@tanstack/react-table"
import { Briefcase,Building2,Files,Globe,Mail,MessageSquare,MoreHorizontal,Shield } from "lucide-react"
import Link from "next/link"

interface VBMOrganizationsTableProps {
    data: VBMOrganization[]
    loading?: boolean
}

export const columns: ColumnDef<VBMOrganization>[] = [
    {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
            <div className="flex items-center font-medium">
                <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                {row.getValue("name")}
            </div>
        ),
    },
    {
        accessorKey: "region",
        header: "Region",
        cell: ({ row }) => (
            <div className="flex items-center text-sm">
                <Globe className="h-3 w-3 mr-2 text-muted-foreground" />
                {row.getValue("region")}
            </div>
        ),
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => <div className="text-sm">{row.getValue("type")}</div>,
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        id: "services",
        accessorFn: row => [row.isExchangeOnline ? 'Exchange' : '', row.isSharePointOnline ? 'SharePoint' : '', row.isTeamsOnline ? 'Teams' : ''].filter(Boolean).join(', '),
        header: "Services",
        cell: ({ row }) => {
            const org = row.original;
            return (
                <div className="flex gap-1.5">
                    <Badge variant={org.isExchangeOnline ? "outline" : "secondary"} className={org.isExchangeOnline ? "bg-blue-50 text-blue-700 border-blue-200" : "opacity-30"}>
                        <Mail className="h-3 w-3 mr-1" /> EX
                    </Badge>
                    <Badge variant={org.isSharePointOnline ? "outline" : "secondary"} className={org.isSharePointOnline ? "bg-green-50 text-green-700 border-green-200" : "opacity-30"}>
                        <Files className="h-3 w-3 mr-1" /> SP
                    </Badge>
                    <Badge variant={org.isTeamsOnline ? "outline" : "secondary"} className={org.isTeamsOnline ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "opacity-30"}>
                        <MessageSquare className="h-3 w-3 mr-1" /> TM
                    </Badge>
                </div>
            )
        }
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const org = row.original

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
                        <DropdownMenuItem asChild>
                            <Link href={`/vbm/protected-items?organization=${encodeURIComponent(org.name)}`}>
                                <Shield className="mr-2 h-4 w-4" /> See Protected Items
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link href={`/vbm/jobs?organizationId=${org.id}`}>
                                <Briefcase className="mr-2 h-4 w-4" /> See Backup Jobs
                            </Link>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
    }
]

export function VBMOrganizationsTable({ data, loading }: VBMOrganizationsTableProps) {
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})

    const table = useReactTable({
        data,
        columns: sortableColumns(columns, sorting, data),
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

    if (loading && data.length === 0) {
        return (
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Region</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Services</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <FilterWorkspace label="Grid filters" search={<><Input
                        placeholder="Filter organizations..."
                        value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
                        onChange={(event) =>
                            table.getColumn("name")?.setFilterValue(event.target.value)
                        }
                        className="h-8 w-[150px] lg:w-[250px]"
                    /></>} onClear={()=>{table.resetColumnFilters();table.setGlobalFilter('')}} filters={<FilterFields>{table.getColumn("region") && <><DataTableFacetedFilter
                            column={table.getColumn("region")}
                            title="Region"
                            options={
                                Array.from(new Set(data.map(item => item.region))).map(region => ({
                                    label: region,
                                    value: region,
                                    icon: Globe
                                }))
                            }
                        /></>}
{table.getColumn("type") && <><DataTableFacetedFilter
                            column={table.getColumn("type")}
                            title="Type"
                            options={
                                Array.from(new Set(data.map(item => item.type))).map(type => ({
                                    label: type,
                                    value: type,
                                    icon: Building2
                                }))
                            }
                        /></>}</FilterFields>} actions={<><GridViewMenu><fieldset className="grid-column-fields"><legend>Visible columns</legend>
                        {table
                            .getAllColumns()
                            .filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide())
                            .map((column) => {
                                return (
                                    <GridColumnChoice
                                        key={column.id}
                                        className="capitalize"
                                        checked={column.getIsVisible()}
                                        onCheckedChange={(value) => column.toggleVisibility(!!value)}
                                    >
                                        {column.id}
                                    </GridColumnChoice>
                                )
                            })}
                    </fieldset></GridViewMenu></>}>
<div className="rounded-md border">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <SortableTableHead key={header.id} header={header}/>
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
                Showing {table.getRowModel().rows.length} organizations
            </div>
</FilterWorkspace></div>
    )
}
