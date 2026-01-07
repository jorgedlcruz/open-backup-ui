"use client"

import * as React from "react"
import Link from "next/link"
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  SortingState,
  VisibilityState,
  ColumnFiltersState,
  getFilteredRowModel,
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { VBMJob } from "@/lib/types/vbm"
import { veeamApi } from "@/lib/api/veeam-client"
import { toast } from "sonner"
import {
  MoreHorizontal,
  ArrowUpDown,
  PlayCircle,
  PauseCircle,
  XCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Columns
} from "lucide-react"
import { DataTableFacetedFilter } from "@/components/data-table-faceted-filter"

interface VBMJobsTableProps {
  data: VBMJob[]
  loading?: boolean
  onRefresh?: () => void
  orgLookup?: Record<string, string>
}

const getStatusBadge = (status?: string) => {
  switch (status) {
    case 'Success':
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1">
          <CheckCircle2 className="w-3 h-3" />
          Success
        </Badge>
      )
    case 'Warning':
      return (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 gap-1">
          <AlertTriangle className="w-3 h-3" />
          Warning
        </Badge>
      )
    case 'Failed':
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1">
          <XCircle className="w-3 h-3" />
          Failed
        </Badge>
      )
    default:
      return <Badge variant="outline">{status || 'None'}</Badge>
  }
}



export function VBMJobsTable({ data, loading = false, onRefresh, orgLookup = {} }: VBMJobsTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])

  // Note: Removed useSearchParams for build compatibility with Next.js 15
  // URL parameter filtering can be re-added by wrapping in Suspense

  const columns = React.useMemo<ColumnDef<VBMJob>[]>(() => [
    {
      accessorKey: "name",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="!p-0 hover:!bg-transparent"
          >
            Job Name
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <Link href={`/vb365/jobs/${row.original.id}/sessions`} className="font-medium hover:underline text-primary">
            {row.getValue("name")}
          </Link>
          <span
            className="text-xs text-muted-foreground truncate max-w-[300px]"
            title={row.original.description}
          >
            {row.original.description}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "organizationId",
      header: "Organization",
      cell: ({ row }) => {
        const id = row.getValue("organizationId") as string;
        const name = orgLookup[id] || id;
        return <div className="text-sm flex items-center"><Building2 className="w-4 h-4 mr-2 text-muted-foreground" />{name}</div>
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },
    {
      accessorKey: "backupType",
      header: "Type",
      cell: ({ row }) => <div className="text-sm">{row.getValue("backupType")}</div>,
    },
    {
      accessorKey: "lastStatus",
      header: "Last Status",
      cell: ({ row }) => {
        const status = row.getValue("lastStatus") as string
        return getStatusBadge(status)
      },
    },
    {
      accessorKey: "lastRun",
      header: "Last Run",
      cell: ({ row }) => {
        const date = row.getValue("lastRun") as string
        return <div className="text-sm">{date ? new Date(date).toLocaleString() : 'Never'}</div>
      },
    },
    {
      accessorKey: "nextRun",
      header: "Next Run",
      cell: ({ row }) => {
        const date = row.getValue("nextRun") as string
        return <div className="text-sm">{date ? new Date(date).toLocaleString() : 'Not Scheduled'}</div>
      },
    },
    {
      accessorKey: "isEnabled",
      header: "Status",
      cell: ({ row }) => {
        const isEnabled = row.getValue("isEnabled") as boolean
        const lastStatus = row.original.lastStatus
        const isRunning = lastStatus === 'Running';

        if (isRunning) {
          return (
            <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100 gap-1 px-2 py-0.5 h-6">
              <PlayCircle className="w-3 h-3 animate-pulse" />
              Running
            </Badge>
          )
        }

        return isEnabled ? (
          <Badge variant="outline" className="gap-1 px-2 py-0.5 h-6">
            <Clock className="w-3 h-3" />
            Enabled
          </Badge>
        ) : (
          <Badge variant="secondary" className="bg-gray-100 text-gray-500 hover:bg-gray-100 gap-1 px-2 py-0.5 h-6">
            <PauseCircle className="w-3 h-3" />
            Disabled
          </Badge>
        )
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const job = row.original

        const handleAction = async (action: 'start' | 'stop' | 'enable' | 'disable') => {
          try {
            switch (action) {
              case 'start':
                await veeamApi.startVBMJob(job.id);
                toast.success('Job started successfully');
                break;
              case 'stop':
                await veeamApi.stopVBMJob(job.id);
                toast.success('Job stopped successfully');
                break;
              case 'enable':
                await veeamApi.enableVBMJob(job.id);
                toast.success('Job enabled successfully');
                break;
              case 'disable':
                await veeamApi.disableVBMJob(job.id);
                toast.success('Job disabled successfully');
                break;
            }

            if (onRefresh) {
              // Small delay to allow API to update
              setTimeout(onRefresh, 1000);
            }
          } catch (error) {
            console.error(`Error performing ${action} on job ${job.id}:`, error);
            toast.error(`Failed to ${action} job`);
          }
        };

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
              <DropdownMenuItem onClick={() => handleAction('start')}>
                <PlayCircle className="mr-2 h-4 w-4" /> Start
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAction('stop')}>
                <XCircle className="mr-2 h-4 w-4" /> Stop
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleAction('disable')} disabled={!job.isEnabled}>
                Disable
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAction('enable')} disabled={job.isEnabled}>
                Enable
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={`/vb365/jobs/${job.id}/sessions`}>
                  View Sessions
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [onRefresh, orgLookup])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: setColumnFilters,
    state: {
      sorting,
      columnVisibility,
      columnFilters,
    },
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading VBM jobs...</div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 border rounded-lg">
        <div className="text-gray-500">No VBM jobs found</div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="flex items-center py-4 gap-2">
        {table.getColumn("organizationId") && (
          <DataTableFacetedFilter
            column={table.getColumn("organizationId")}
            title="Organization"
            options={Array.from(new Set(data.map(item => item.organizationId))).map(id => ({
              label: orgLookup[id] || id,
              value: id,
              icon: Building2
            }))}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="ml-auto">
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
                    {column.id}
                  </DropdownMenuCheckboxItem>
                )
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                  </TableHead>
                ))}
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
    </div>
  )
}
