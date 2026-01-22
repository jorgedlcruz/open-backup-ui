"use client"

import { TriggeredAlarmItem } from "@/lib/types/veeam-one-alarms"
import { AlarmsDataTable } from "@/components/analytics/alarms/alarms-data-table"
import { columns } from "@/components/analytics/alarms/active-alarms-columns"
import { useState, useMemo, useCallback } from "react"
import { AlarmDetailsSheet } from "@/components/analytics/alarms/alarm-details-sheet"
import { useRouter, useSearchParams } from "next/navigation"
import { Row } from "@tanstack/react-table"

interface AlarmsClientViewProps {
    initialData: TriggeredAlarmItem[]
}

export function AlarmsClientView({ initialData }: AlarmsClientViewProps) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

    // Client-side status filtering for multi-select OR logic
    const filteredData = useMemo(() => {
        const statusParam = searchParams.get("status")
        if (!statusParam || statusParam === 'All') {
            return initialData
        }
        const selectedStatuses = statusParam.split(',')
        return initialData.filter(alarm => selectedStatuses.includes(alarm.status))
    }, [initialData, searchParams])

    // Get current alarm from index
    const selectedAlarm = selectedIndex !== null ? filteredData[selectedIndex] : null

    const handleRowClick = (row: Row<TriggeredAlarmItem>) => {
        // Find the index of this alarm in the filtered data
        const index = filteredData.findIndex(a => a.triggeredAlarmId === row.original.triggeredAlarmId)
        setSelectedIndex(index >= 0 ? index : null)
    }

    const handleNavigatePrevious = useCallback(() => {
        if (selectedIndex !== null && selectedIndex > 0) {
            setSelectedIndex(selectedIndex - 1)
        }
    }, [selectedIndex])

    const handleNavigateNext = useCallback(() => {
        if (selectedIndex !== null && selectedIndex < filteredData.length - 1) {
            setSelectedIndex(selectedIndex + 1)
        }
    }, [selectedIndex, filteredData.length])

    return (
        <>
            <AlarmsDataTable
                data={filteredData}
                columns={columns}
                onRowClick={handleRowClick}
                pageSize={20}
            />

            <AlarmDetailsSheet
                alarm={selectedAlarm}
                open={!!selectedAlarm}
                onOpenChange={(open) => !open && setSelectedIndex(null)}
                onResolveSuccess={() => router.refresh()}
                onNavigatePrevious={handleNavigatePrevious}
                onNavigateNext={handleNavigateNext}
                hasPrevious={selectedIndex !== null && selectedIndex > 0}
                hasNext={selectedIndex !== null && selectedIndex < filteredData.length - 1}
                currentIndex={selectedIndex !== null ? selectedIndex + 1 : 0}
                totalCount={filteredData.length}
            />
        </>
    )
}
