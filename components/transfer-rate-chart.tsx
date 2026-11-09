"use client"
// Open Backup UI v1.0.2

import { TrendingUp, TrendingDown, Activity } from "lucide-react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart"

interface TransferRateData {
    hour: string
    rate: number
    timestamp: Date
}

interface TransferRateChartProps {
    data?: TransferRateData[]
    loading?: boolean
}

const chartConfig = {
    rate: {
        label: "Transfer Rate",
        color: "hsl(var(--chart-1))",
    },
} satisfies ChartConfig

// Format bytes to human-readable format
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B/s'
    const k = 1024
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function TransferRateChart({ data = [], loading = false }: TransferRateChartProps) {
    // Calculate statistics
    const totalTransferred = data.reduce((sum, d) => sum + d.rate, 0)
    const avgRate = data.length > 0 ? totalTransferred / data.length : 0
    const maxRate = data.length > 0 ? Math.max(...data.map(d => d.rate)) : 0
    const minRate = data.length > 0 ? Math.min(...data.map(d => d.rate)) : 0

    // Calculate trend (compare first half vs second half)
    const halfPoint = Math.floor(data.length / 2)
    const firstHalfAvg = data.slice(0, halfPoint).reduce((sum, d) => sum + d.rate, 0) / (halfPoint || 1)
    const secondHalfAvg = data.slice(halfPoint).reduce((sum, d) => sum + d.rate, 0) / (data.length - halfPoint || 1)
    const trendPercent = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100 : 0
    const isUpTrend = trendPercent > 0

    // Format data for the chart
    const chartData = data.map(d => ({
        hour: d.hour,
        rate: d.rate,
    }))

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Transfer Rate - Last 24 Hours</CardTitle>
                    <CardDescription>
                        Loading transfer rate data...
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[300px] flex items-center justify-center">
                        <div className="animate-pulse text-muted-foreground">
                            <Activity className="h-8 w-8 animate-spin" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        )
    }

    if (data.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Transfer Rate - Last 24 Hours</CardTitle>
                    <CardDescription>
                        No transfer data available for the last 24 hours
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                        No data to display
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Transfer Rate - Last 24 Hours</CardTitle>
                <CardDescription>
                    Showing backup transfer rates over time
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ChartContainer config={chartConfig} className="h-[300px] w-full">
                    <AreaChart
                        accessibilityLayer
                        data={chartData}
                        margin={{
                            left: 12,
                            right: 12,
                            top: 12,
                            bottom: 12,
                        }}
                    >
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis
                            dataKey="hour"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            tickFormatter={(value) => value}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            tickFormatter={(value) => formatBytes(value).split('/')[0]}
                        />
                        <ChartTooltip
                            cursor={false}
                            content={
                                <ChartTooltipContent
                                    indicator="dot"
                                    formatter={(value) => formatBytes(value as number)}
                                />
                            }
                        />
                        <Area
                            dataKey="rate"
                            type="monotone"
                            fill="var(--color-rate)"
                            fillOpacity={0.4}
                            stroke="var(--color-rate)"
                            strokeWidth={2}
                        />
                    </AreaChart>
                </ChartContainer>
            </CardContent>
            <CardFooter>
                <div className="flex w-full items-start gap-2 text-sm">
                    <div className="grid gap-2 flex-1">
                        <div className="flex items-center gap-2 leading-none font-medium">
                            {isUpTrend ? (
                                <>
                                    Trending up by {Math.abs(trendPercent).toFixed(1)}% <TrendingUp className="h-4 w-4" />
                                </>
                            ) : (
                                <>
                                    Trending down by {Math.abs(trendPercent).toFixed(1)}% <TrendingDown className="h-4 w-4" />
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-4 text-muted-foreground text-xs">
                            <span>Avg: {formatBytes(avgRate)}</span>
                            <span>Max: {formatBytes(maxRate)}</span>
                            <span>Min: {formatBytes(minRate)}</span>
                        </div>
                    </div>
                </div>
            </CardFooter>
        </Card>
    )
}
