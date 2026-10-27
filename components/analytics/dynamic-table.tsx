"use client"
import { GridColumnChoice,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableTableHead } from '@/components/ui/sortable-table-head'
import { sortableColumns } from '@/lib/table-sort'
import * as React from "react"

import {
ColumnDef,
SortingState,
flexRender,
getCoreRowModel,
getFilteredRowModel,
getPaginationRowModel,
getSortedRowModel,
useReactTable,
} from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table,TableBody,TableCell,TableHeader,TableRow } from "@/components/ui/table"
import { TableColumnDef,TableSectionData,VeeamOneTableItem } from "@/lib/types/veeam-one"
import { cn } from "@/lib/utils"

interface DynamicTableProps {
    sectionData: TableSectionData
    tableData: VeeamOneTableItem[]
}

// Format value based on formatter configuration
function formatValue(value: unknown, formatter?: TableColumnDef['formatter']): string {
    if (value === null || value === undefined) {
        const nullStrategy = formatter?.configuration?.nullReplaceStrategy
        if (nullStrategy === 'Dash') return '-'
        if (nullStrategy === 'Zero') return '0'
        return ''
    }

    const strValue = String(value)

    if (!formatter) return strValue

    switch (formatter.formatterType) {
        case 'DateTime': {
            try {
                const date = new Date(strValue)
                if (isNaN(date.getTime())) return strValue
                const part = formatter.configuration?.dateTimePart
                if (part === 'DateOnly') return date.toLocaleDateString()
                if (part === 'TimeOnly') return date.toLocaleTimeString()
                return date.toLocaleString()
            } catch {
                return strValue
            }
        }
        case 'DateOnly': {
            try {
                const date = new Date(strValue)
                if (isNaN(date.getTime())) return strValue
                return date.toLocaleDateString()
            } catch {
                return strValue
            }
        }
        case 'Number': {
            const num = Number(value)
            if (isNaN(num)) return strValue
            const decimals = formatter.configuration?.decimalPlaces ?? 0
            return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        }
        case 'Size': {
            const bytes = Number(value)
            if (isNaN(bytes)) return strValue
            const units = ['B', 'KB', 'MB', 'GB', 'TB']
            let unitIndex = 0
            let size = bytes
            while (size >= 1024 && unitIndex < units.length - 1) {
                size /= 1024
                unitIndex++
            }
            return `${size.toFixed(2)} ${units[unitIndex]}`
        }
        case 'Percent': {
            const num = Number(value)
            if (isNaN(num)) return strValue
            return `${(num * 100).toFixed(1)}%`
        }
        case 'Duration': {
            // Assuming value is in seconds or a time string
            return strValue
        }
        default:
            return strValue
    }
}

export function DynamicTable({ sectionData, tableData }: DynamicTableProps) {
    const [sorting, setSorting] = React.useState<SortingState>(() => {
        // Initialize with default sorting from metadata
        if (sectionData.defaultSorting && sectionData.defaultSorting.length > 0) {
            return sectionData.defaultSorting.map(s => ({
                id: s.column,
                desc: s.direction === 'descending'
            }))
        }
        return []
    })
    const [globalFilter, setGlobalFilter] = React.useState("")
    const [columnVisibility, setColumnVisibility] = React.useState({})

    // Build columns from metadata
    const columns = React.useMemo<ColumnDef<VeeamOneTableItem>[]>(() => {
        return sectionData.columns.map(col => ({
            accessorKey: col.field,
            header: ()=><>{col.label}</>,
            cell: ({ row }) => {
                const value = row.getValue(col.field)
                const formatted = formatValue(value, col.formatter)
                return (
                    <div className={cn(col.align === 'right' && 'text-right', col.align === 'center' && 'text-center')}>
                        {formatted}
                    </div>
                )
            },
            size: col.width
        }))
    }, [sectionData.columns])

    const table = useReactTable({
        data: tableData,
        columns: sortableColumns(columns, sorting, tableData),
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onColumnVisibilityChange: setColumnVisibility,
        state: {
            sorting,
            globalFilter,
            columnVisibility,
        },
        onGlobalFilterChange: setGlobalFilter,
        initialState: {
            pagination: { pageSize: 25 }
        }
    })

    if (tableData.length === 0) {
        return <div className="text-center p-8 text-muted-foreground">No data available</div>
    }

    return (
        <div className="w-full space-y-4">
            <FilterWorkspace label="Grid filters" search={<><Input
                    placeholder="Filter data..."
                    value={globalFilter}
                    onChange={(event) => setGlobalFilter(event.target.value)}
                    className="max-w-sm"
                /></>} onClear={()=>{table.resetColumnFilters();table.setGlobalFilter('')}} filters={null} actions={<><GridViewMenu><fieldset className="grid-column-fields"><legend>Visible columns</legend>
                        {table.getAllColumns()
                            .filter((column) => column.getCanHide())
                            .map((column) => {
                                const colDef = sectionData.columns.find(c => c.field === column.id)
                                return (
                                    <GridColumnChoice
                                        key={column.id}
                                        checked={column.getIsVisible()}
                                        onCheckedChange={(value) => column.toggleVisibility(!!value)}
                                    >
                                        {colDef?.label || column.id}
                                    </GridColumnChoice>
                                )
                            })}
                    </fieldset></GridViewMenu></>}>
<div className="rounded-md border bg-card">
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
                                <TableRow key={row.id}>
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
                                <TableCell colSpan={columns.length} className="h-24 text-center">
                                    No results.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
<div className="flex items-center justify-between py-4">
                <div className="text-sm text-muted-foreground">
                    Showing {table.getRowModel().rows.length} of {tableData.length} rows
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
