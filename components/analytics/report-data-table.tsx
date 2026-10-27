"use client"
import { FilterFields,GridColumnChoice,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableTableHead } from '@/components/ui/sortable-table-head'
import { sortableColumns } from '@/lib/table-sort'
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

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { DataTableFacetedFilter } from "@/components/data-table-faceted-filter"
import { Table,TableBody,TableCell,TableHeader,TableRow } from "@/components/ui/table"
import { VeeamOneTableItem } from "@/lib/types/veeam-one"

interface ReportDataTableProps {
    data: VeeamOneTableItem[]
}

export function ReportDataTable({ data }: ReportDataTableProps) {
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
    const [rowSelection, setRowSelection] = React.useState({})
    const [globalFilter, setGlobalFilter] = React.useState("")

    // Dynamically generate columns from data keys
    const columns = React.useMemo<ColumnDef<VeeamOneTableItem>[]>(() => {
        if (data.length === 0) return []

        // Exclude row_id from columns
        const keys = Object.keys(data[0]).filter(k => k !== 'row_id')

        return keys.map(key => ({
            accessorKey: key,
            header: ()=><>{key.replace(/_/g, ' ')}</>,
            cell: ({ row }) => <div>{row.getValue(key)}</div>,
        }))
    }, [data])

    const table = useReactTable({
        data,
        columns: sortableColumns(columns, sorting, data),
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
            globalFilter,
        },
        onGlobalFilterChange: setGlobalFilter,
    })

    // Helper to get unique values for filters
    const getUniqueValues = (key: string) => {
        const unique = new Set(data.map(item => item[key as keyof VeeamOneTableItem] as string));
        return Array.from(unique).filter(Boolean).map(val => ({ label: val, value: val }));
    }

    if (data.length === 0) {
        return <div className="text-center p-8 text-muted-foreground">No data available</div>
    }

    return (
        <div className="w-full space-y-4">
            <FilterWorkspace label="Grid filters" search={<><Input
                    placeholder="Filter data..."
                    value={(table.getState().globalFilter as string) ?? ""}
                    onChange={(event) =>
                        table.setGlobalFilter(event.target.value)
                    }
                    className="max-w-sm"
                /></>} onClear={()=>{table.resetColumnFilters();table.setGlobalFilter('')}} filters={<FilterFields>{table.getColumn("status") && <><DataTableFacetedFilter
                        column={table.getColumn("status")}
                        title="Status"
                        options={getUniqueValues("status")}
                    /></>}
{table.getColumn("job_name") && <><DataTableFacetedFilter
                        column={table.getColumn("job_name")}
                        title="Job Name"
                        options={getUniqueValues("job_name")}
                    /></>}
{table.getColumn("protection_type") && <><DataTableFacetedFilter
                        column={table.getColumn("protection_type")}
                        title="Protection Type"
                        options={getUniqueValues("protection_type")}
                    /></>}
{table.getColumn("platform") && <><DataTableFacetedFilter
                        column={table.getColumn("platform")}
                        title="Platform"
                        options={getUniqueValues("platform")}
                    /></>}</FilterFields>} actions={<><GridViewMenu><fieldset className="grid-column-fields"><legend>Visible columns</legend>
                        {table.getAllColumns()
                            .filter((column) => column.getCanHide())
                            .map((column) => {
                                return (
                                    <GridColumnChoice
                                        key={column.id}
                                        className="capitalize"
                                        checked={column.getIsVisible()}
                                        onCheckedChange={(value) =>
                                            column.toggleVisibility(!!value)
                                        }
                                    >
                                        {column.id.replace(/_/g, ' ')}
                                    </GridColumnChoice>
                                )
                            })}
                    </fieldset></GridViewMenu></>}>
<div className="rounded-md border bg-card">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => {
                                    return (
                                        <SortableTableHead key={header.id} header={header}/>
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
                                    No results.
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
</FilterWorkspace></div>
    )
}
