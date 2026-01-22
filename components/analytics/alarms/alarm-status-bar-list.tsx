"use client"

import { TriggeredAlarmItem } from "@/lib/types/veeam-one-alarms"
import { CategoryBar } from "@/components/ui/category-bar"
import { AvailableChartColorsKeys } from "@/lib/chartUtils"
import { cn } from "@/lib/utils"

interface AlarmStatusBarListProps {
    data: TriggeredAlarmItem[]
}

export function AlarmStatusBarList({ data }: AlarmStatusBarListProps) {
    const getCount = (status: string) => {
        return data.filter(d => d.status === status).reduce((sum, d) => sum + (d.status_Count || 0), 0);
    }

    // Calculate counts
    const errorCount = getCount('Error')
    const warningCount = getCount('Warning')
    const infoCount = getCount('Information')
    const resolvedCount = getCount('Resolved')

    // Total count calculation
    const totalCount = errorCount + warningCount + infoCount + resolvedCount

    // Helper to calculate percentage safely
    const getPercentage = (val: number) => {
        if (totalCount === 0) return 0;
        return Math.round((val / totalCount) * 100);
    }

    // Colors mapping
    const colorMap: Record<string, AvailableChartColorsKeys> = {
        'Resolved': 'green',
        'Error': 'red',
        'Warning': 'orange',
        'Information': 'blue'
    }

    // All items for category bar (needs all values for proper proportions)
    const allItems = [
        { label: 'Resolved', value: resolvedCount, color: colorMap['Resolved'] },
        { label: 'Error', value: errorCount, color: colorMap['Error'] },
        { label: 'Warning', value: warningCount, color: colorMap['Warning'] },
        { label: 'Information', value: infoCount, color: colorMap['Information'] }
    ]

    // Filtered items for legend - only show statuses with values > 0
    const visibleItems = allItems.filter(item => item.value > 0)

    return (
        <div className="relative w-full h-[262px] rounded-lg border p-6 text-left shadow-sm bg-card border-border">
            <dt className="text-sm font-medium text-foreground">
                Current Alarms
            </dt>
            <dd className="mt-1 text-3xl font-semibold text-foreground">
                {totalCount}
            </dd>

            <CategoryBar
                values={allItems.map(i => i.value)}
                colors={allItems.map(i => i.color)}
                className="mt-6"
                showLabels={false}
            />

            <ul role="list" className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
                {visibleItems.map((item) => (
                    <li key={item.label}>
                        <span className="text-base font-semibold text-foreground">
                            {getPercentage(item.value)}%
                        </span>
                        <div className="flex items-center gap-2">
                            <span
                                className={cn(
                                    "size-2.5 shrink-0 rounded-sm",
                                    item.label === 'Resolved' ? "bg-green-500" :
                                        item.label === 'Error' ? "bg-red-500" :
                                            item.label === 'Warning' ? "bg-orange-500" : "bg-blue-500"
                                )}
                                aria-hidden="true"
                            />
                            <span className="text-sm text-muted-foreground">
                                {item.label}
                            </span>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    )
}
