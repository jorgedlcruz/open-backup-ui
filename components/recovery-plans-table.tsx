"use client"

import * as React from "react"
import { SortableTableHead } from '@/components/ui/sortable-table-head'
import { sortableColumns } from '@/lib/table-sort'

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  SortingState,
} from "@tanstack/react-table"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import { VRORecoveryPlan } from "@/lib/types/veeam"

interface RecoveryPlansTableProps {
  data: VRORecoveryPlan[]
  loading?: boolean
}

const getResultColor = (result?: string) => {
  if (!result) return 'text-gray-500'
  
  const resultLower = result.toLowerCase()
  if (resultLower.includes('success') || resultLower.includes('complete')) {
    return 'text-green-600 font-medium'
  }
  if (resultLower.includes('warning')) {
    return 'text-yellow-600 font-medium'
  }
  if (resultLower.includes('error') || resultLower.includes('malware')) {
    return 'text-red-600 font-medium'
  }
  return 'text-gray-500'
}

const getStateColor = (state: string) => {
  switch (state.toLowerCase()) {
    case 'ready':
      return 'text-green-600 font-medium'
    case 'running':
      return 'text-blue-600 font-medium'
    case 'failovercomplete':
    case 'failbackcomplete':
      return 'text-green-600 font-medium'
    case 'halted':
      return 'text-red-600 font-medium'
    case 'disabled':
      return 'text-gray-500'
    default:
      return 'text-gray-700'
  }
}

const columns: ColumnDef<VRORecoveryPlan>[] = [
  {
    accessorKey: "name",
    header: "Plan Name",
    cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>,
  },
  {
    accessorKey: "planType",
    header: "Type",
  },
  {
    accessorKey: "stateName",
    header: "State",
    cell: ({ row }) => {
      const state = row.getValue("stateName") as string
      return <div className={getStateColor(state)}>{state}</div>
    },
  },
  {
    accessorKey: "planMode",
    header: "Mode",
    cell: ({ row }) => {
      const mode = row.getValue("planMode") as string
      return (
        <span className={mode === 'Enabled' ? 'text-green-600' : 'text-gray-500'}>
          {mode}
        </span>
      )
    },
  },
  {
    accessorKey: "lastTestResult",
    header: "Last Test",
    cell: ({ row }) => {
      const result = row.getValue("lastTestResult") as string
      const time = row.original.lastTestTime
      return (
        <div>
          <div className={getResultColor(result)}>{result || 'None'}</div>
          {time && <div className="text-xs text-gray-500">{new Date(time).toLocaleString()}</div>}
        </div>
      )
    },
  },
  {
    accessorKey: "lastCheckResult",
    header: "Last Check",
    cell: ({ row }) => {
      const result = row.getValue("lastCheckResult") as string
      const time = row.original.lastCheckTime
      return (
        <div>
          <div className={getResultColor(result)}>{result || 'None'}</div>
          {time && <div className="text-xs text-gray-500">{new Date(time).toLocaleString()}</div>}
        </div>
      )
    },
  },
  {
    accessorKey: "progress",
    header: "Progress",
    cell: ({ row }) => {
      const progress = row.getValue("progress") as number
      const isRunning = row.original.isRunning
      
      if (!isRunning && !progress) return <span className="text-gray-400">-</span>
      
      return (
        <div className="flex items-center gap-2">
          <div className="w-24 bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all" 
              style={{ width: `${progress || 0}%` }}
            />
          </div>
          <span className="text-sm">{progress || 0}%</span>
        </div>
      )
    },
  },
  {
    accessorKey: "nearestFailoverScheduleTime",
    header: "Next Failover",
    cell: ({ row }) => {
      const date = row.getValue("nearestFailoverScheduleTime") as string
      return date ? new Date(date).toLocaleString() : <span className="text-gray-400">Not scheduled</span>
    },
  },
]

export function RecoveryPlansTable({ data, loading = false }: RecoveryPlansTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([])

  const table = useReactTable({
    data,
    columns: sortableColumns(columns, sorting, data),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
    },
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading recovery plans...</div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 border rounded-lg">
        <div className="text-gray-500">No recovery plans found</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
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
  )
}
