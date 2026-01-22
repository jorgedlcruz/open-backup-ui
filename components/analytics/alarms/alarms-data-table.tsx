"use client"

import * as React from "react"
import {
    ColumnDef,
    Row,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

interface DataTableProps<TData> {
    columns: ColumnDef<TData>[]
    data: TData[]
    onRowClick?: (row: Row<TData>) => void
    pageSize?: number
}

export function AlarmsDataTable<TData>({
    columns,
    data,
    onRowClick,
    pageSize = 20
}: DataTableProps<TData>) {
    const table = useReactTable({
        data,
        columns,
        initialState: {
            pagination: {
                pageIndex: 0,
                pageSize: pageSize,
            },
        },
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    })

    const totalRows = table.getFilteredRowModel().rows.length
    const currentPage = table.getState().pagination.pageIndex
    const firstRowIndex = currentPage * pageSize + 1
    const lastRowIndex = Math.min(totalRows, firstRowIndex + pageSize - 1)

    return (
        <div className="space-y-3">
            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full caption-bottom border-b border-border">
                    <thead>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <tr
                                key={headerGroup.id}
                                className="border-y border-border"
                            >
                                {headerGroup.headers.map((header) => (
                                    <th
                                        key={header.id}
                                        className={cn(
                                            "border-b px-4 py-3 text-left text-sm font-semibold",
                                            "text-foreground",
                                            "border-border",
                                            "whitespace-nowrap"
                                        )}
                                    >
                                        {flexRender(
                                            header.column.columnDef.header,
                                            header.getContext()
                                        )}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody className="divide-y divide-border">
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <tr
                                    key={row.id}
                                    className={cn(
                                        "group select-none",
                                        "hover:bg-muted/50 cursor-pointer",
                                        "transition-colors"
                                    )}
                                    onClick={() => onRowClick?.(row)}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <td
                                            key={cell.id}
                                            className={cn(
                                                "px-4 py-2.5 text-sm",
                                                "text-muted-foreground",
                                                "whitespace-nowrap"
                                            )}
                                        >
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td
                                    colSpan={columns.length}
                                    className="h-24 text-center text-muted-foreground"
                                >
                                    No results.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 pb-4">
                <p className="text-sm text-muted-foreground tabular-nums">
                    {totalRows > 0 ? (
                        <>
                            Showing{" "}
                            <span className="font-medium text-foreground">
                                {firstRowIndex}-{lastRowIndex}
                            </span>{" "}
                            of{" "}
                            <span className="font-medium text-foreground">
                                {totalRows.toLocaleString()}
                            </span>
                        </>
                    ) : (
                        "No results"
                    )}
                </p>
                <div className="flex items-center gap-1">
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 hidden sm:flex"
                        onClick={() => table.setPageIndex(0)}
                        disabled={!table.getCanPreviousPage()}
                    >
                        <span className="sr-only">First page</span>
                        <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                    >
                        <span className="sr-only">Previous page</span>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                    >
                        <span className="sr-only">Next page</span>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 hidden sm:flex"
                        onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                        disabled={!table.getCanNextPage()}
                    >
                        <span className="sr-only">Last page</span>
                        <ChevronsRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    )
}
