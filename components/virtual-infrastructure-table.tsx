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
    getFacetedRowModel,
    getFacetedUniqueValues,
    useReactTable,
} from "@tanstack/react-table"
import { ArrowUpDown, ChevronDown, MoreHorizontal, Search, RefreshCw, Server, MonitorDot, Boxes, Building2, PlayCircle, PauseCircle, ShieldCheck, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
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
import { VeeamInventoryItem } from "@/lib/types/veeam"
import { veeamApi } from "@/lib/api/veeam-client"
import { toast } from "sonner"
import { DataTableFacetedFilter } from "@/components/data-table-faceted-filter"

// Helper to extract object names from URN
const resolveName = (id: string, map: Map<string, string>) => {
    return map.get(id) || id;
}

const extractIdFromUrn = (urn: string, type: string) => {
    // type is "datacenter" or "cluster"
    const parts = urn.split(';');
    const part = parts.find(p => p.startsWith(`${type}:`));
    return part ? part.split(':')[1] : undefined;
}

export function VirtualInfrastructureTable() {
    const [data, setData] = React.useState<VeeamInventoryItem[]>([])
    const [loading, setLoading] = React.useState(true)
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
    const [rowSelection, setRowSelection] = React.useState({})

    // Maps for lookups
    const [datacenterMap, setDatacenterMap] = React.useState<Map<string, string>>(new Map())
    const [clusterMap, setClusterMap] = React.useState<Map<string, string>>(new Map())
    const [protectedIds, setProtectedIds] = React.useState<Set<string>>(new Set())

    const fetchData = React.useCallback(async () => {
        try {
            setLoading(true)

            // Parallel fetch for inventory and backup objects
            const [allItems, backupObjects] = await Promise.all([
                veeamApi.getInventory(),
                veeamApi.getAllBackupObjects()
            ]);

            // Build protected Set
            const pSet = new Set<string>();
            backupObjects.forEach(obj => {
                if (obj.objectId) pSet.add(obj.objectId);
                // Also check platformId if necessary, but objectId is primary for mapped VMs
            });
            setProtectedIds(pSet);

            // Build maps
            const dcMap = new Map<string, string>();
            const clMap = new Map<string, string>();
            const vms: VeeamInventoryItem[] = [];

            allItems.forEach(item => {
                if (item.type === 'Datacenter') {
                    dcMap.set(item.objectId, item.name);
                } else if (item.type === 'Cluster') {
                    clMap.set(item.objectId, item.name);
                } else if (item.type === 'VirtualMachine') {
                    vms.push(item);
                }
            });

            setDatacenterMap(dcMap);
            setClusterMap(clMap);
            setData(vms);

        } catch (error) {
            console.error("Failed to fetch inventory", error)
            toast.error("Failed to fetch virtual infrastructure")
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => {
        fetchData()
    }, [fetchData])

    const columns = React.useMemo<ColumnDef<VeeamInventoryItem>[]>(() => [
        {
            accessorKey: "name",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        Object Name
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                )
            },
            cell: ({ row }) => (
                <div className="flex items-center gap-2 font-medium">
                    <MonitorDot className="h-4 w-4 text-muted-foreground" />
                    {row.getValue("name")}
                </div>
            ),
        },
        {
            id: "protected",
            accessorFn: (row) => protectedIds.has(row.objectId) ? "Protected" : "Unprotected",
            header: "Protection",
            cell: ({ row }) => {
                const isProtected = protectedIds.has(row.original.objectId);
                return (
                    <div className="flex items-center">
                        {isProtected ? (
                            <Badge variant="default" className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100 gap-1">
                                <ShieldCheck className="w-3 h-3" />
                                Protected
                            </Badge>
                        ) : (
                            <Badge variant="secondary" className="text-muted-foreground gap-1">
                                <ShieldAlert className="w-3 h-3" />
                                Unprotected
                            </Badge>
                        )}
                    </div>
                );
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        },
        {
            id: "dnsName",
            accessorFn: (row) => row.metadata?.find(m => m.field === 'dnsName')?.data || null,
            header: "DNS Name",
            cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.getValue("dnsName") || '-'}</span>
        },
        {
            accessorKey: "hostName",
            header: "vCenter",
            cell: ({ row }) => (
                <div className="flex items-center gap-2 text-sm">
                    <Server className="h-3 w-3 text-muted-foreground" />
                    {row.getValue("hostName")}
                </div>
            ),
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id))
            },
        },
        {
            id: "datacenter",
            accessorFn: (row) => {
                const urn = row.urn;
                const dcId = extractIdFromUrn(urn, 'datacenter');
                return dcId ? resolveName(dcId, datacenterMap) : null;
            },
            header: "Datacenter",
            cell: ({ row }) => {
                const dcName = row.getValue("datacenter") as string;
                return (
                    <div className="flex items-center gap-2 text-sm">
                        <Building2 className="h-3 w-3 text-muted-foreground" />
                        {dcName || '-'}
                    </div>
                )
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id))
            },
        },
        {
            id: "cluster",
            accessorFn: (row) => {
                const urn = row.urn;
                const clId = extractIdFromUrn(urn, 'cluster');
                return clId ? resolveName(clId, clusterMap) : null;
            },
            header: "Cluster",
            cell: ({ row }) => {
                const clName = row.getValue("cluster") as string;
                return (
                    <div className="flex items-center gap-2 text-sm">
                        <Boxes className="h-3 w-3 text-muted-foreground" />
                        {clName || '-'}
                    </div>
                )
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id))
            },
        },
        {
            id: "isEnabled",
            accessorFn: (row) => row.isEnabled ? "Running" : "Stopped",
            header: "State",
            cell: ({ row }) => {
                const status = row.getValue("isEnabled") as string;
                const isRunning = status === "Running";
                return (
                    <Badge variant={isRunning ? "default" : "secondary"} className={isRunning ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100" : ""}>
                        {isRunning ? <PlayCircle className="w-3 h-3 mr-1" /> : <PauseCircle className="w-3 h-3 mr-1" />}
                        {status}
                    </Badge>
                )
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id))
            },
        },
        {
            id: "guestOs",
            accessorFn: (row) => row.metadata?.find(m => m.field === 'guestOsName')?.data || null,
            header: "Guest OS",
            cell: ({ row }) => {
                const os = row.getValue("guestOs") as string;
                return <span className="text-sm truncate max-w-[200px]" title={os}>{os || '-'}</span>
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id))
            },
        },
        {
            accessorKey: "size",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        Size
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                )
            },
            cell: ({ row }) => <span className="text-sm font-mono">{row.getValue("size")}</span>
        },
        {
            id: "actions",
            enableHiding: false,
            cell: ({ row }) => {
                const item = row.original

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
                            <DropdownMenuItem onClick={() => navigator.clipboard.writeText(item.objectId)}>
                                Copy Object ID
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigator.clipboard.writeText(item.urn)}>
                                Copy URN
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            },
        },
    ], [datacenterMap, clusterMap, protectedIds])

    const table = useReactTable({
        data,
        columns,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        onColumnVisibilityChange: setColumnVisibility,
        onRowSelectionChange: setRowSelection,
        state: {
            sorting,
            columnFilters,
            columnVisibility,
            rowSelection,
        },
    })

    // Generate options based on current data
    const vCenterOptions = React.useMemo(() => {
        return Array.from(new Set(data.map(item => item.hostName))).map(val => ({ label: val, value: val }))
    }, [data]);

    const datacenterOptions = React.useMemo(() => {
        // Need to compute resolved names
        const values = new Set<string>();
        data.forEach(item => {
            const dcId = extractIdFromUrn(item.urn, 'datacenter');
            if (dcId) {
                const name = resolveName(dcId, datacenterMap);
                if (name) values.add(name);
            }
        });
        return Array.from(values).map(val => ({ label: val, value: val }));
    }, [data, datacenterMap]);

    const clusterOptions = React.useMemo(() => {
        const values = new Set<string>();
        data.forEach(item => {
            const clId = extractIdFromUrn(item.urn, 'cluster');
            if (clId) {
                const name = resolveName(clId, clusterMap);
                if (name) values.add(name);
            }
        });
        return Array.from(values).map(val => ({ label: val, value: val }));
    }, [data, clusterMap]);

    const guestOsOptions = React.useMemo(() => {
        const values = new Set<string>();
        data.forEach(item => {
            const os = item.metadata?.find(m => m.field === 'guestOsName')?.data;
            if (os) values.add(os);
        });
        return Array.from(values).map(val => ({ label: val, value: val }));
    }, [data]);

    const stateOptions = [
        { label: "Running", value: "Running", icon: PlayCircle },
        { label: "Stopped", value: "Stopped", icon: PauseCircle }
    ];

    const protectionOptions = [
        { label: "Protected", value: "Protected", icon: ShieldCheck },
        { label: "Unprotected", value: "Unprotected", icon: ShieldAlert }
    ];

    const isFiltered = table.getState().columnFilters.length > 0;

    if (loading) {
        return <div className="p-8 text-center bg-muted/20 rounded-lg animate-pulse">Loading virtual infrastructure...</div>
    }

    return (
        <div className="w-full space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 items-center space-x-2">
                    <Search className="w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Filter VMs..."
                        value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
                        onChange={(event) =>
                            table.getColumn("name")?.setFilterValue(event.target.value)
                        }
                        className="max-w-sm h-8"
                    />
                    {table.getColumn("protected") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("protected")}
                            title="Protection"
                            options={protectionOptions}
                        />
                    )}
                    {table.getColumn("hostName") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("hostName")}
                            title="vCenter"
                            options={vCenterOptions}
                        />
                    )}
                    {table.getColumn("datacenter") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("datacenter")}
                            title="Datacenter"
                            options={datacenterOptions}
                        />
                    )}
                    {table.getColumn("cluster") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("cluster")}
                            title="Cluster"
                            options={clusterOptions}
                        />
                    )}
                    {table.getColumn("isEnabled") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("isEnabled")}
                            title="State"
                            options={stateOptions}
                        />
                    )}
                    {table.getColumn("guestOs") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("guestOs")}
                            title="Guest OS"
                            options={guestOsOptions}
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
                    <Button variant="outline" size="sm" onClick={() => fetchData()}>
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
                                    No virtual machines found.
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
