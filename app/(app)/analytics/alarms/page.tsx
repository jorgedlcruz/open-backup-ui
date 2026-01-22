import { veeamOneClient } from "@/lib/api/veeam-one-client"
import { AlarmStatusBarList } from "@/components/analytics/alarms/alarm-status-bar-list"
import { AlarmHistoryChart } from "@/components/analytics/alarms/alarm-history-chart"
import { AlarmWorldMap } from "@/components/analytics/alarms/alarm-world-map"
import { AlarmsClientView } from "./client-view"
import { AlarmsFilterBar } from "@/components/analytics/alarms/alarms-header"

export const dynamic = 'force-dynamic'

interface PageProps {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

// Build filter object in the format the Veeam ONE API expects:
// { operation: "and", items: [...] }
function buildApiFilter(range: string, statusParam: string | undefined, search: string | undefined) {
    const items: Array<{
        property: string
        value: string | string[]
        operation: string
        collation: string
    }> = []

    // 1. Date/Time filter - calculate start date based on range
    const now = new Date()
    let startDate: Date | null = null

    switch (range) {
        case "24h":
            startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            break
        case "7d":
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
            break
        case "30d":
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
            break
        case "90d":
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
            break
        case "all":
            startDate = null
            break
        default:
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) // default 30d
    }

    if (startDate) {
        items.push({
            property: "time",
            value: startDate.toISOString(),
            collation: "ignorecase",
            operation: "greaterThanOrEqual"
        })
    }

    // 2. Status filter - use "in" operation with array
    if (statusParam && statusParam !== 'All') {
        const statuses = statusParam.split(',')
        items.push({
            property: "status",
            value: statuses,
            operation: "in",
            collation: "ignorecase"
        })
    }

    // 3. Search filter
    if (search) {
        items.push({
            property: "alarmName",
            value: search,
            operation: "contains",
            collation: "ignorecase"
        })
    }

    // Return filter string in correct format
    if (items.length === 0) {
        return undefined
    } else if (items.length === 1) {
        return JSON.stringify(items[0])
    } else {
        return JSON.stringify({
            operation: "and",
            items: items
        })
    }
}

export default async function AlarmsPage({ searchParams }: PageProps) {
    const params = await searchParams
    const search = typeof params.search === 'string' ? params.search : undefined
    const range = typeof params.range === 'string' ? params.range : "30d"
    const statusParam = typeof params.status === 'string' ? params.status : undefined

    // Build filter string in correct API format
    const filterString = buildApiFilter(range, statusParam, search)

    // Prepare GroupBy configurations
    const mapGroupBy = JSON.stringify({
        groupBy: ["status", "latitude", "longitude", "region", "subregion", "cityName", "isCustomCity"],
        aggregations: [{ distinct: false, function: "Count", property: "status" }]
    })

    const historyGroupBy = JSON.stringify({
        groupBy: ["time", "status"],
        aggregations: [{ distinct: false, function: "Count", property: "status" }],
        options: [{ option: "Day", propertyName: "time" }]
    })

    const listSort = JSON.stringify([{ property: "time", direction: "descending", collation: "ignorecase" }])

    // Execute all API calls in parallel - ALL use the same filter
    const [mapDataResponse, historyResponse, listResponse] = await Promise.all([
        veeamOneClient.getTriggeredChildAlarms(0, 5000, filterString, mapGroupBy),
        veeamOneClient.getTriggeredAlarmsHistory(0, 2000, filterString, historyGroupBy),
        veeamOneClient.getTriggeredChildAlarms(0, 200, filterString, undefined, listSort)
    ])

    return (
        <div className="flex-1 overflow-auto bg-background">
            <div className="container mx-auto py-8 px-4 space-y-6">
                {/* Page Header */}
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Alarms Overview</h1>
                    <p className="text-muted-foreground mt-1">
                        Real-time monitoring and resolution of infrastructure alerts
                    </p>
                </div>

                {/* Filter Bar */}
                <AlarmsFilterBar />

                {/* Widgets Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <AlarmStatusBarList data={mapDataResponse.items} />
                    <AlarmWorldMap data={mapDataResponse.items} />
                    <AlarmHistoryChart data={historyResponse.items} />
                </div>

                {/* Data Grid */}
                <div className="bg-card border rounded-xl shadow-sm">
                    <div className="p-6 border-b">
                        <h2 className="text-lg font-semibold">Active Alarms</h2>
                        <p className="text-sm text-muted-foreground">Detailed list of current triggers</p>
                    </div>
                    <AlarmsClientView initialData={listResponse.items} />
                </div>
            </div>
        </div>
    )
}
