"use client"

import { format, parseISO } from "date-fns"
import { ColumnDef } from "@tanstack/react-table"
import { TriggeredAlarmItem } from "@/lib/types/veeam-one-alarms"
import {
    ArrowUpDown,
    Activity,
    AlertCircle,
    CheckCircle2,
    HardDrive,
    Info,
    Monitor,
    Server,
    XCircle,
    Cloud,
    LayoutGrid
} from "lucide-react"

// Helper for Object Type Icons
const getObjectTypeIcon = (type: string | undefined) => {
    if (!type) return <LayoutGrid className="h-4 w-4 text-muted-foreground" />
    const t = type.toLowerCase()
    if (t.includes('server') || t.includes('host')) return <Server className="h-4 w-4 text-muted-foreground" />
    if (t.includes('vm') || t.includes('virtual')) return <Monitor className="h-4 w-4 text-muted-foreground" />
    if (t.includes('datastore') || t.includes('repository')) return <HardDrive className="h-4 w-4 text-muted-foreground" />
    if (t.includes('cloud')) return <Cloud className="h-4 w-4 text-muted-foreground" />
    if (t.includes('job') || t.includes('backup')) return <Activity className="h-4 w-4 text-muted-foreground" />
    return <LayoutGrid className="h-4 w-4 text-muted-foreground" />
}

export const columns: ColumnDef<TriggeredAlarmItem>[] = [
    {
        accessorKey: "time",
        header: ({ column }) => {
            return (
                <div
                    className="flex items-center space-x-1 cursor-pointer hover:text-foreground"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    <span>Time Period</span>
                    <ArrowUpDown className="h-3 w-3" />
                </div>
            )
        },
        cell: ({ row }) => {
            const dateStr = row.getValue("time") as string
            if (!dateStr) return <span className="text-muted-foreground">-</span>
            return (
                <div className="text-xs sm:text-sm whitespace-nowrap text-muted-foreground">
                    {format(parseISO(dateStr), "M/d/yyyy h:mm:ss a")}
                </div>
            )
        },
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const status = row.getValue("status") as string
            return (
                <div className="flex items-center gap-2">
                    {status === 'Error' && <XCircle className="h-4 w-4 text-red-500" />}
                    {status === 'Warning' && <AlertCircle className="h-4 w-4 text-orange-500" />}
                    {status === 'Resolved' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    {status === 'Information' && <Info className="h-4 w-4 text-blue-500" />}
                    <span className="text-xs sm:text-sm">{status}</span>
                </div>
            )
        },
    },
    {
        accessorKey: "entityName",
        header: "Object",
        cell: ({ row }) => <div className="font-medium text-xs sm:text-sm">{row.getValue("entityName")}</div>,
    },
    {
        id: "objectType",
        header: "Object Type",
        cell: ({ row }) => {
            return (
                <div className="flex items-center gap-2">
                    {getObjectTypeIcon(row.original.entityType)}
                    <span className="text-xs sm:text-sm">{row.original.entityType || 'Unknown'}</span>
                </div>
            )
        }
    },
    {
        accessorKey: "alarmName",
        header: "Alarm Name",
        cell: ({ row }) => <div className="text-xs sm:text-sm truncate max-w-[200px]" title={row.getValue("alarmName")}>{row.getValue("alarmName")}</div>,
    },
    {
        accessorKey: "source",
        header: "Reason or Source",
        cell: ({ row }) => <div className="text-xs sm:text-sm text-muted-foreground truncate max-w-[250px]" title={row.original.source}>{row.original.source || '-'}</div>,
    },
]
