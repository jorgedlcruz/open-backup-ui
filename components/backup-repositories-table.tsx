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
    ArrowUpDown,
    Check,
    ChevronDown,
    MoreHorizontal,
    Search,
    RefreshCw,
    AlertCircle,
    Database,
    Trash2,
    RotateCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { VeeamRepositoryEnriched } from "@/lib/types/veeam";
import { veeamApi } from "@/lib/api/veeam-client";
import { DataTableFacetedFilter } from "@/components/data-table-faceted-filter";
import { toast } from "sonner";

export function BackupRepositoriesTable() {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
    const [rowSelection, setRowSelection] = React.useState({});
    const [data, setData] = React.useState<VeeamRepositoryEnriched[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);

    const fetchData = React.useCallback(async () => {
        setIsLoading(true);
        try {
            const repositories = await veeamApi.getEnrichedBackupRepositories();
            setData(repositories);
        } catch (error) {
            console.error("Failed to fetch repositories", error);
            setData([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    React.useEffect(() => {
        fetchData();
        // Poll every 30 seconds
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const onRefresh = () => {
        fetchData();
    };

    const handleAction = async (action: 'rescan' | 'delete', repo: VeeamRepositoryEnriched) => {
        try {
            if (action === 'rescan') {
                toast.info(`Rescan of ${repo.name} started`);
                await veeamApi.rescanBackupRepository([repo.id]);
                toast.success(`Rescan of ${repo.name} initiated successfully`);
            } else if (action === 'delete') {
                if (!confirm(`Are you sure you want to delete repository "${repo.name}"? This action cannot be undone.`)) return;
                toast.info(`Deleting ${repo.name}...`);
                await veeamApi.deleteBackupRepository(repo.id);
                toast.success(`Repository ${repo.name} deleted successfully`);
                fetchData();
            }
        } catch (error) {
            toast.error(`Failed to ${action} repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    const columns: ColumnDef<VeeamRepositoryEnriched>[] = [
        {
            id: "select",
            header: ({ table }) => (
                <Checkbox
                    checked={
                        table.getIsAllPageRowsSelected() ||
                        (table.getIsSomePageRowsSelected() && "indeterminate")
                    }
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                />
            ),
            enableSorting: false,
            enableHiding: false,
        },
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
                );
            },
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="font-medium">{row.getValue("name")}</span>
                    <span className="text-xs text-muted-foreground">{row.original.description}</span>
                </div>
            ),
        },
        {
            accessorKey: "type",
            header: "Type",
            cell: ({ row }) => <Badge variant="outline">{row.getValue("type")}</Badge>,
        },
        {
            accessorKey: "hostName",
            header: "Host",
            cell: ({ row }) => <div className="text-sm">{row.getValue("hostName")}</div>,
        },
        {
            accessorKey: "path",
            header: "Path",
            cell: ({ row }) => <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={row.getValue("path")}>{row.getValue("path")}</div>,
        },
        {
            id: "Capacity",
            accessorFn: (row) => row.capacityGB,
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Capacity
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const total = row.original.capacityGB;
                const free = row.original.freeGB;
                const used = row.original.usedSpaceGB;

                // -1 usually indicates cloud or unlimited/unknown
                if (total < 0) {
                    return (
                        <div className="flex flex-col text-sm">
                            <span>Unlimited</span>
                            <span className="text-xs text-muted-foreground">{used.toFixed(1)} GB Used</span>
                        </div>
                    );
                }

                return (
                    <div className="flex flex-col text-sm">
                        <span>{total.toFixed(1)} GB Total</span>
                        <span className="text-xs text-muted-foreground">{used.toFixed(1)} GB Used - {free.toFixed(1)} GB Free</span>
                    </div>
                )
            }
        },
        {
            id: "Usage",
            accessorFn: (row) => {
                if (row.capacityGB <= 0) return 0;
                return (row.usedSpaceGB / row.capacityGB) * 100;
            },
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Usage
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const total = row.original.capacityGB;
                const used = row.original.usedSpaceGB;

                // Calculate percentage
                let percentage = 0;
                let text = "N/A";

                if (total > 0) {
                    percentage = Math.min(100, Math.max(0, (used / total) * 100));
                    text = `${percentage.toFixed(0)}% Used`;
                } else {
                    // Unlimited / Cloud
                    if (used > 0) {
                        text = `${used.toFixed(1)} GB Used`;
                    }
                }

                // Color logic
                let colorClass = "bg-blue-500";
                if (percentage > 90) colorClass = "bg-red-500";
                else if (percentage > 75) colorClass = "bg-yellow-500";

                return (
                    <div className="w-[120px] space-y-1">
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                            <div className={`h-full ${colorClass}`} style={{ width: `${percentage}%` }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span>{text}</span>
                        </div>
                    </div>
                );
            }
        },
        {
            id: "Task Limits",
            accessorFn: (row) => row.maxTaskCount,
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Tasks
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const enabled = row.original.taskLimitEnabled;
                const max = row.original.maxTaskCount;
                if (!enabled) return <Badge variant="secondary">Unlimited</Badge>;
                return <Badge variant="outline">{max} Concurrent</Badge>;
            }
        },
        {
            id: "Immutability",
            header: "Immutability",
            cell: ({ row }) => {
                const enabled = row.original.immutabilityEnabled;
                const days = row.original.immutabilityDays;
                if (!enabled) return <span className="text-muted-foreground text-xs">-</span>;
                return <Badge variant="success" className="gap-1"><Check className="w-3 h-3" /> {days} Days</Badge>;
            }
        },
        {
            accessorKey: "isOnline",
            id: "Status",
            header: "Status",
            cell: ({ row }) => {
                const isOnline = row.getValue("Status");
                return (
                    <Badge variant={isOnline ? "success" : "destructive"}>
                        {isOnline ? "Online" : "Offline"}
                    </Badge>
                );
            },
            filterFn: (row, id, value) => {
                return value.includes(String(row.getValue(id)));
            },
        },
        {
            id: "actions",
            enableHiding: false,
            cell: ({ row }) => {
                const repo = row.original;

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
                            <DropdownMenuItem onClick={() => handleAction('rescan', repo)}>
                                <RotateCw className="mr-2 h-4 w-4" /> Rescan
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleAction('delete', repo)} className="text-red-600">
                                <Trash2 className="mr-2 h-4 w-4" /> Remove
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
        { label: "Windows Local", value: "WinLocal" },
        { label: "Linux Hardened", value: "LinuxHardened" },
        { label: "NFS Share", value: "Nfs" },
        { label: "SMB Share", value: "Smb" },
        { label: "Object Storage", value: "WasabiCloud" }, // Add others as found
    ];

    const statusOptions = [
        { label: "Online", value: "true" },
        { label: "Offline", value: "false" }
    ];

    const columnLabels: { [key: string]: string } = {
        name: "Name",
        type: "Type",
        hostName: "Host",
        path: "Path",
        Capacity: "Capacity",
        Usage: "Usage",
        "Task Limits": "Task Limits",
        Immutability: "Immutability",
        Status: "Status",
    };

    return (
        <div className="w-full space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 items-center space-x-2">
                    <Search className="w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Filter repositories..."
                        value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
                        onChange={(event) =>
                            table.getColumn("name")?.setFilterValue(event.target.value)
                        }
                        className="max-w-sm h-8"
                    />
                    {table.getColumn("type") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("type")}
                            title="Repo Type"
                            options={typeOptions}
                        />
                    )}
                    {table.getColumn("Status") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("Status")}
                            title="Status"
                            options={statusOptions}
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
                                    {isLoading ? "Loading repositories..." : "No repositories found."}
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
    );
}
