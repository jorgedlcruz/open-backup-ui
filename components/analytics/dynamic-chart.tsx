"use client"
// Open Backup UI v1.0.2

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartSectionData, VeeamOneChartItem } from "@/lib/types/veeam-one"
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie, AreaChart, Area,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from "recharts"

interface DynamicChartProps {
    sectionData: ChartSectionData
    chartData: VeeamOneChartItem[]
}

// Color mapping from API color refs to actual colors
const COLOR_MAP: Record<string, string> = {
    green: "#22c55e",
    red: "#ef4444",
    grey: "#9ca3af",
    gray: "#9ca3af",
    yellow: "#eab308",
    blue: "#3b82f6",
    orange: "#f97316",
    purple: "#a855f7",
    cyan: "#06b6d4",
    Orange: "#f97316",
    Red: "#ef4444",
    Green: "#22c55e",
    Yellow: "#eab308",
    Blue: "#3b82f6",
}

// Generate colors for series when not specified
const SERIES_COLORS = [
    "#3b82f6", "#22c55e", "#ef4444", "#eab308", "#a855f7",
    "#06b6d4", "#f97316", "#ec4899", "#14b8a6", "#8b5cf6"
]

export function DynamicChart({ sectionData, chartData }: DynamicChartProps) {
    const { chartType, name, fieldX, groupBy, series, yAxisLabel, colorsRefs, stacked } = sectionData

    if (!chartData || chartData.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{name}</CardTitle>
                </CardHeader>
                <CardContent className="h-[250px] flex items-center justify-center text-muted-foreground">
                    No data available
                </CardContent>
            </Card>
        )
    }

    // Map API colors to actual colors
    const getColor = (colorKey: string): string => {
        if (colorsRefs && colorsRefs[colorKey]) {
            return COLOR_MAP[colorsRefs[colorKey]] || COLOR_MAP[colorKey] || colorKey
        }
        return COLOR_MAP[colorKey] || colorKey
    }

    // Process data for grouped charts (Line, BarGrouped with groupBy)
    const processGroupedData = () => {
        if (!groupBy) return chartData

        // Group by fieldX and pivot groupBy values into columns
        const grouped = new Map<string, Record<string, unknown>>()
        const allGroups = new Set<string>()

        chartData.forEach(item => {
            const xValue = String(item[fieldX] || item.group_datetime || item.group_string || '')
            const groupValue = String(item[groupBy] || item.key || '')
            allGroups.add(groupValue)

            if (!grouped.has(xValue)) {
                grouped.set(xValue, { [fieldX]: xValue })
            }
            const row = grouped.get(xValue)!
            // Use the value field from series
            const yField = series[0]?.fieldY || 'value'
            row[groupValue] = Number(item[yField] || item.value || 0)
            // Store color info
            const colorField = series[0]?.colorRefField
            if (colorField && item[colorField]) {
                row[`${groupValue}_color`] = getColor(String(item[colorField]))
            }
        })

        return Array.from(grouped.values())
    }

    // Process data for pie charts
    const processPieData = () => {
        return chartData.map(item => {
            const colorRefField = series[0]?.colorRefField
            let colorValue = 'blue'
            if (colorRefField && item[colorRefField]) {
                colorValue = String(item[colorRefField])
            } else if (item.color) {
                colorValue = String(item.color)
            }
            return {
                name: String(item[groupBy || 'group'] || item.key || item.group_string || 'Unknown'),
                value: Number(item[series[0]?.fieldY || 'value'] || item.value || 0),
                color: getColor(colorValue)
            }
        })
    }

    // Get unique group names for generating series
    const getGroups = () => {
        const groups = new Set<string>()
        chartData.forEach(item => {
            const groupValue = String(item[groupBy || 'key'] || item.key || '')
            if (groupValue) groups.add(groupValue)
        })
        return Array.from(groups)
    }

    const renderChart = () => {
        switch (chartType) {
            case 'Line': {
                const data = processGroupedData()
                const groups = getGroups()
                return (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis
                                dataKey={fieldX}
                                tick={{ fontSize: 12 }}
                                angle={sectionData.xAxisSlantedLabels ? -45 : 0}
                                textAnchor={sectionData.xAxisSlantedLabels ? "end" : "middle"}
                                height={sectionData.xAxisSlantedLabels ? 60 : 30}
                            />
                            <YAxis label={{ value: yAxisLabel, angle: -90, position: 'insideLeft' }} tick={{ fontSize: 12 }} />
                            <Tooltip />
                            <Legend />
                            {groups.map((group, idx) => {
                                // Try to find color from first data point with this group
                                const sampleItem = chartData.find(d => (d[groupBy || 'key'] || d.key) === group)
                                const colorField = series[0]?.colorRefField
                                const color = sampleItem && colorField
                                    ? getColor(String(sampleItem[colorField]))
                                    : SERIES_COLORS[idx % SERIES_COLORS.length]
                                return (
                                    <Line
                                        key={group}
                                        type="monotone"
                                        dataKey={group}
                                        stroke={color}
                                        strokeWidth={2}
                                        dot={{ r: 4 }}
                                        name={group}
                                    />
                                )
                            })}
                        </LineChart>
                    </ResponsiveContainer>
                )
            }

            case 'BarGrouped':
            case 'Bar': {
                const data = processGroupedData()
                const groups = getGroups()
                return (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis
                                dataKey={fieldX}
                                tick={{ fontSize: 11 }}
                                interval={0}
                                angle={-20}
                                textAnchor="end"
                                height={80}
                            />
                            <YAxis label={{ value: yAxisLabel, angle: -90, position: 'insideLeft' }} tick={{ fontSize: 12 }} />
                            <Tooltip />
                            <Legend />
                            {groups.map((group, idx) => {
                                const sampleItem = chartData.find(d => (d[groupBy || 'key'] || d.key) === group)
                                const colorField = series[0]?.colorRefField
                                const color = sampleItem && colorField
                                    ? getColor(String(sampleItem[colorField]))
                                    : SERIES_COLORS[idx % SERIES_COLORS.length]
                                return (
                                    <Bar
                                        key={group}
                                        dataKey={group}
                                        fill={color}
                                        name={group}
                                        stackId={stacked === 'normal' ? 'stack' : undefined}
                                    />
                                )
                            })}
                        </BarChart>
                    </ResponsiveContainer>
                )
            }

            case 'Pie': {
                const data = processPieData()
                return (
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={data}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                                nameKey="name"
                            >
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip />
                            <Legend verticalAlign="bottom" height={36} />
                        </PieChart>
                    </ResponsiveContainer>
                )
            }

            case 'Area':
            case 'StackedArea100': {
                const data = processGroupedData()
                const groups = getGroups()
                return (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis dataKey={fieldX} tick={{ fontSize: 12 }} />
                            <YAxis label={{ value: yAxisLabel, angle: -90, position: 'insideLeft' }} tick={{ fontSize: 12 }} />
                            <Tooltip />
                            <Legend />
                            {groups.map((group, idx) => (
                                <Area
                                    key={group}
                                    type="monotone"
                                    dataKey={group}
                                    stackId={chartType === 'StackedArea100' || stacked === 'normal' ? '1' : undefined}
                                    fill={SERIES_COLORS[idx % SERIES_COLORS.length]}
                                    stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
                                    name={group}
                                />
                            ))}
                        </AreaChart>
                    </ResponsiveContainer>
                )
            }

            default:
                return (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        Chart type &quot;{chartType}&quot; not yet supported
                    </div>
                )
        }
    }

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">{name}</CardTitle>
            </CardHeader>
            <CardContent className="h-[280px]">
                {renderChart()}
            </CardContent>
        </Card>
    )
}
