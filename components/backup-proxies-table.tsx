"use client";

import * as React from "react";
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
} from "@tanstack/react-table";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { MoreHorizontal, Power, PowerOff, Trash2, Edit, Search, RefreshCw, ServerCog, Columns } from "lucide-react";
import { VeeamProxy } from "@/lib/types/veeam";
import { toast } from "sonner";
import { veeamApi as veeamApiClient } from "@/lib/api/veeam-client";
import { DataTableFacetedFilter } from "@/components/data-table-faceted-filter";

interface BackupProxiesTableProps {
    data: VeeamProxy[];
    isLoading: boolean;
    onRefresh: () => void;
}

export function BackupProxiesTable({ data, isLoading, onRefresh }: BackupProxiesTableProps) {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
    const [rowSelection, setRowSelection] = React.useState({});
    const [isActionPending, setIsActionPending] = React.useState(false);

    const handleAction = async (action: 'enable' | 'disable' | 'delete', proxy: VeeamProxy) => {
        try {
            setIsActionPending(true);
            if (action === 'enable') {
                toast.promise(veeamApiClient.enableBackupProxy(proxy.id), {
                    loading: `Enabling ${proxy.name}...`,
                    success: `${proxy.name} enabled successfully`,
                    error: `Failed to enable ${proxy.name}`,
                });
            } else if (action === 'disable') {
                toast.promise(veeamApiClient.disableBackupProxy(proxy.id), {
                    loading: `Disabling ${proxy.name}...`,
                    success: `${proxy.name} disabled successfully`,
                    error: `Failed to disable ${proxy.name}`,
                });
            } else if (action === 'delete') {
                if (!confirm(`Are you sure you want to delete proxy ${proxy.name}?`)) {
                    setIsActionPending(false);
                    return;
                }
                toast.promise(veeamApiClient.deleteBackupProxy(proxy.id), {
                    loading: `Deleting ${proxy.name}...`,
                    success: `${proxy.name} deleted successfully`,
                    error: `Failed to delete ${proxy.name}`,
                });
            }
            // Wait a bit for the API to process before refreshing
            setTimeout(() => {
                onRefresh();
                setIsActionPending(false);
            }, 1000);
        } catch (error) {
            console.error(error);
            setIsActionPending(false);
        }
    };

    const columnLabels: Record<string, string> = {
        name: "Name",
        type: "Proxy Type",
        osType: "OS",
        "server_transportMode": "Transport Mode",
        "server_failoverToNetwork": "NBD Failover",
        "server_maxTaskCount": "Max Tasks",
        "Status": "Status", // Since I removed accessorKey for Status, it likely fell back to header name "Status" or I should add ID
        "isDisabled": "State",
        "isOutOfDate": "Updates"
    };

    const columns: ColumnDef<VeeamProxy>[] = [
        {
            accessorKey: "name",
            header: "Name",
            cell: ({ row }) => {
                const description = row.original.description;
                return (
                    <div className="flex flex-col">
                        <span className="font-medium flex items-center gap-2">
                            <ServerCog className="h-4 w-4 text-muted-foreground" />
                            {row.getValue("name")}
                        </span>
                        {description && (
                            <span className="text-xs text-muted-foreground ml-6 truncate max-w-[300px]">
                                {description}
                            </span>
                        )}
                    </div>
                );
            },
        },
        {
            accessorKey: "type",
            header: "Proxy Type",
            cell: ({ row }) => <Badge variant="outline">{row.getValue("type")}</Badge>,
        },
        {
            accessorKey: "osType",
            header: "OS",
            cell: ({ row }) => {
                const os = row.original.osType;
                const isAppliance = row.original.isVBRLinuxAppliance;
                if (!os) return <span className="text-muted-foreground">-</span>;
                return (
                    <div className="flex flex-col">
                        <span>{os}</span>
                        {isAppliance && <Badge variant="secondary" className="text-[10px] mt-1 w-fit">Appliance</Badge>}
                    </div>
                )
            },
        },
        {
            accessorKey: "server.transportMode",
            header: "Transport Mode",
            cell: ({ row }) => <span className="capitalize">{row.original.server.transportMode}</span>,
        },
        {
            accessorKey: "server.failoverToNetwork",
            header: "NBD Failover",
            cell: ({ row }) => {
                const value = row.original.server.failoverToNetwork;
                return (
                    <Badge variant="secondary" className="font-mono font-normal">
                        {value ? "True" : "False"}
                    </Badge>
                );
            },
        },
        {
            accessorKey: "server.maxTaskCount",
            header: "Max Tasks",
            cell: ({ row }) => <span className="font-mono">{row.original.server.maxTaskCount}</span>,
        },
        {
            id: "Status",
            header: "Status",
            cell: ({ row }) => {
                const isOnline = row.original.isOnline;
                return (
                    <Badge variant={isOnline ? "success" : "destructive"}>
                        {isOnline ? "Online" : "Offline"}
                    </Badge>
                );
            },
        },
        {
            accessorKey: "isDisabled",
            header: "State",
            cell: ({ row }) => {
                const isDisabled = row.original.isDisabled;
                return isDisabled ? <Badge variant="secondary">Disabled</Badge> : <Badge variant="outline">Enabled</Badge>;
            }
        },
        {
            accessorKey: "isOutOfDate",
            header: "Updates",
            cell: ({ row }) => {
                const isOutOfDate = row.original.isOutOfDate;
                return isOutOfDate ? <Badge variant="warning">Update Required</Badge> : <Badge variant="success">Up to date</Badge>;
            }
        },
        {
            id: "actions",
            enableHiding: false,
            cell: ({ row }) => {
                const proxy = row.original;
                const isDisabled = proxy.isDisabled;

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
                            <DropdownMenuItem onClick={() => alert("Edit not implemented yet due to lack of endpoint details for PUT body")}>
                                <Edit className="mr-2 h-4 w-4" /> Edit Proxy
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {isDisabled ? (
                                <DropdownMenuItem onClick={() => handleAction('enable', proxy)} disabled={isActionPending}>
                                    <Power className="mr-2 h-4 w-4 text-green-500" /> Enable
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuItem onClick={() => handleAction('disable', proxy)} disabled={isActionPending}>
                                    <PowerOff className="mr-2 h-4 w-4 text-orange-500" /> Disable
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleAction('delete', proxy)} className="text-red-600" disabled={isActionPending}>
                                <Trash2 className="mr-2 h-4 w-4" /> Remove Proxy
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                );
            },
        },
    ];

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
    });

    const isFiltered = table.getState().columnFilters.length > 0;

    const typeOptions = [
        { label: "General Purpose", value: "GeneralPurposeProxy" },
        { label: "VI Proxy", value: "ViProxy" },
        // Add others if known
    ];



    return (
        <div className="w-full space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 items-center space-x-2">
                    <Input
                        placeholder="Filter proxies..."
                        value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
                        onChange={(event) =>
                            table.getColumn("name")?.setFilterValue(event.target.value)
                        }
                        className="max-w-sm h-8"
                    />
                    {table.getColumn("type") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("type")}
                            title="Proxy Type"
                            options={typeOptions}
                        />
                    )}

                    {isFiltered && (
                        <Button
                            variant="ghost"
                            onClick={() => table.resetColumnFilters()}
                            className="h-8 px-2 lg:px-3"
                        >
                            Reset
                            <Search className="ml-2 h-4 w-4" />
                        </Button>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
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
                                            {columnLabels[column.id] || column.id}
                                        </DropdownMenuCheckboxItem>
                                    );
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
                                    );
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
                                    {isLoading ? "Loading proxies..." : "No proxies found."}
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
        </div >
    );
}
