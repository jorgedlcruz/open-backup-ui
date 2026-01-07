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
import { DataTableFacetedFilter } from "@/components/data-table-faceted-filter"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { VeeamBackupJob } from "@/lib/types/veeam"
import { veeamApi } from "@/lib/api/veeam-client"
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  PlayCircle,
  PauseCircle,
  HelpCircle,
  MoreHorizontal,
  Columns,
  ArrowUpDown
} from "lucide-react"
import { toast } from "sonner"

interface BackupJobsTableProps {
  data: VeeamBackupJob[]
  loading?: boolean
  onRefresh?: () => void
}

const getResultBadge = (status?: string) => {
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
    case 'None':
    case undefined:
      return (
        <Badge variant="outline" className="text-gray-500 gap-1">
          <HelpCircle className="w-3 h-3" />
          None
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export function BackupJobsTable({ data, loading = false, onRefresh }: BackupJobsTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])

  const columns = React.useMemo<ColumnDef<VeeamBackupJob>[]>(() => [
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
          <Link href={`/vbr/jobs/${row.original.id}`} className="font-medium hover:underline text-primary">
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
      accessorKey: "type",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="!p-0 hover:!bg-transparent"
          >
            Type
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => <div className="text-sm">{row.getValue("type")}</div>,
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: "repositoryName",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="!p-0 hover:!bg-transparent"
          >
            Repository
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">
          {row.original.repositoryName || '-'}
        </div>
      ),
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: "lastResult",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="!p-0 hover:!bg-transparent"
          >
            Last Result
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => {
        const status = row.getValue("lastResult") as string
        return getResultBadge(status)
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },
    {
      accessorKey: "lastRun",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="!p-0 hover:!bg-transparent"
          >
            Last Run
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => {
        const date = row.getValue("lastRun") as string
        return <div className="text-sm">{date ? new Date(date).toLocaleString() : 'Never'}</div>
      },
    },
    {
      accessorKey: "nextRun",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="!p-0 hover:!bg-transparent"
          >
            Next Run
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => {
        const date = row.getValue("nextRun") as string
        const enabled = !row.original.isDisabled
        if (!enabled) return <span className="text-xs text-gray-400">Disabled</span>
        return <div className="text-sm">{date ? new Date(date).toLocaleString() : 'Not scheduled'}</div>
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="p-0 h-auto hover:bg-transparent -ml-2"
          >
            Status
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        const progress = row.original.progressPercent || 0;
        // Only consider running if status is explicitly 'Running' and not 100% complete
        const isRunning = status === 'Running' && progress < 100;

        return (
          <div className="flex flex-col gap-1.5 min-w-[140px]">
            <div className="flex items-center">
              {isRunning ? (
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100 gap-1 px-2 py-0.5 h-6">
                  <PlayCircle className="w-3 h-3 animate-pulse" />
                  Running
                </Badge>
              ) : status === 'Disabled' ? (
                <Badge variant="secondary" className="bg-gray-100 text-gray-500 hover:bg-gray-100 gap-1 px-2 py-0.5 h-6">
                  <PauseCircle className="w-3 h-3" />
                  Disabled
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 px-2 py-0.5 h-6">
                  <Clock className="w-3 h-3" />
                  {status}
                </Badge>
              )}
            </div>
            {isRunning && (
              <div className="flex items-center gap-2 w-full">
                <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-500 font-mono w-8 text-right">{progress}%</span>
              </div>
            )}
          </div>
        )
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const job = row.original

        const handleAction = async (action: 'start' | 'stop' | 'retry' | 'disable' | 'enable') => {
          try {
            switch (action) {
              case 'start':
                await veeamApi.startJob(job.id);
                toast.success('Job started successfully');
                break;
              case 'stop':
                await veeamApi.stopJob(job.id);
                toast.success('Job stopped successfully');
                break;
              case 'retry':
                await veeamApi.retryJob(job.id);
                toast.success('Job retry initiated successfully');
                break;
              case 'disable':
                await veeamApi.disableJob(job.id);
                toast.success('Job disabled successfully');
                break;
              case 'enable':
                await veeamApi.enableJob(job.id);
                toast.success('Job enabled successfully');
                break;
            }

            console.log(`Job ${job.id} ${action} successful`);

            // Trigger refresh if provided
            if (onRefresh) {
              onRefresh();
            }
          } catch (error) {
            console.error(`Error performing ${action} on job ${job.id}:`, error);
            toast.error(`Failed to ${action} job: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
                Start
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAction('stop')}>
                Stop
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAction('retry')}>
                Retry
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleAction('disable')}>
                Disable
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAction('enable')}>
                Enable
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [onRefresh]);

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
        <div className="text-gray-500">Loading backup jobs...</div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 border rounded-lg">
        <div className="text-gray-500">No backup jobs found</div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-1 items-center space-x-2">
          <Input
            placeholder="Filter jobs..."
            value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
              table.getColumn("name")?.setFilterValue(event.target.value)
            }
            className="h-8 w-[150px] lg:w-[250px]"
          />
          {table.getColumn("type") && (
            <DataTableFacetedFilter
              column={table.getColumn("type")}
              title="Type"
              options={Array.from(new Set(data.map(j => j.type))).sort().map(type => ({
                label: type,
                value: type,
              }))}
            />
          )}
          {table.getColumn("repositoryName") && (
            <DataTableFacetedFilter
              column={table.getColumn("repositoryName")}
              title="Repository"
              options={Array.from(new Set(data.map(j => j.repositoryName).filter(Boolean))).sort().map(repo => ({
                label: repo as string,
                value: repo as string,
              }))}
            />
          )}
          {table.getColumn("lastResult") && (
            <DataTableFacetedFilter
              column={table.getColumn("lastResult")}
              title="Last Result"
              options={[
                { label: "Success", value: "Success", icon: CheckCircle2 },
                { label: "Warning", value: "Warning", icon: AlertTriangle },
                { label: "Failed", value: "Failed", icon: XCircle },
                { label: "None", value: "None", icon: HelpCircle },
              ]}
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
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
