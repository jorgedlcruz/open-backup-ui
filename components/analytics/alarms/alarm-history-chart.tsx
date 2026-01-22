"use client"

import { AlarmHistoryItem } from "@/lib/types/veeam-one-alarms"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts"
import { useMemo } from "react"
import { format, parseISO } from "date-fns"

interface AlarmHistoryChartProps {
    data: AlarmHistoryItem[]
}

// Color mapping for alarm statuses
const STATUS_COLORS: Record<string, string> = {
    "Error": "#ef4444",
    "Warning": "#f97316",
    "Information": "#3b82f6",
    "Resolved": "#22c55e"
}

// Custom Tooltip Component (matching VBM Dashboard style)
interface TooltipPayload {
    name: string
    value: number
    color?: string
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean, payload?: TooltipPayload[], label?: string }) => {
    if (active && payload && payload.length) {
        return (
            <div className="border border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs shadow-xl">
                <div className="font-medium text-foreground">
                    {format(parseISO(label || ""), 'MMM d, yyyy')}
                </div>
                <div className="grid gap-1.5">
                    {payload.map((entry: TooltipPayload, index: number) => {
                        if (entry.value === 0) return null
                        const color = STATUS_COLORS[entry.name] || entry.color || "#888888"

                        return (
                            <div key={index} className="flex w-full flex-wrap gap-2 items-center">
                                <div
                                    className="shrink-0 rounded-[2px] h-2.5 w-2.5 border"
                                    style={{
                                        backgroundColor: color,
                                        borderColor: color
                                    }}
                                />
                                <div className="flex flex-1 justify-between leading-none items-center gap-4">
                                    <span className="text-muted-foreground">{entry.name}</span>
                                    <span className="text-foreground font-mono font-medium tabular-nums">{entry.value}</span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }
    return null
}

// Custom Legend that only shows statuses present in data
interface LegendPayload {
    value: string
    color: string
}

const CustomLegend = ({ payload, chartData }: { payload?: LegendPayload[], chartData: { Error: number, Warning: number, Information: number }[] }) => {
    if (!payload) return null;

    // Check which statuses have any data across all dates
    const hasData = {
        Error: chartData.some(d => d.Error > 0),
        Warning: chartData.some(d => d.Warning > 0),
        Information: chartData.some(d => d.Information > 0),
    };

    const visiblePayload = payload.filter(entry => hasData[entry.value as keyof typeof hasData]);

    if (visiblePayload.length === 0) return null;

    return (
        <div className="flex justify-center gap-4 mt-2">
            {visiblePayload.map((entry, index) => (
                <div key={index} className="flex items-center gap-1.5 text-[10px]">
                    <div
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: entry.color }}
                    />
                    <span className="text-muted-foreground">{entry.value}</span>
                </div>
            ))}
        </div>
    );
};

export function AlarmHistoryChart({ data }: AlarmHistoryChartProps) {
    // Transform data: Group by date and pivot statuses to columns
    const chartData = useMemo(() => {
        const grouped = data.reduce((acc, item) => {
            const date = item.time.split('T')[0];
            if (!acc[date]) {
                acc[date] = { date, Error: 0, Warning: 0, Information: 0, Resolved: 0 };
            }
            acc[date][item.status] = item.status_Count;
            return acc;
        }, {} as Record<string, { date: string, Error: number, Warning: number, Information: number, Resolved: number }>);

        return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
    }, [data]);

    // Determine which bars to show based on data
    const hasError = chartData.some(d => d.Error > 0);
    const hasWarning = chartData.some(d => d.Warning > 0);
    const hasInfo = chartData.some(d => d.Information > 0);

    return (
        <div className="relative w-full h-[262px] rounded-lg border p-6 text-left shadow-sm bg-card border-border">
            <dt className="text-sm font-medium text-foreground mb-2">
                Alarm History
            </dt>
            <div className="h-[175px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                        <XAxis
                            dataKey="date"
                            tickFormatter={(value) => format(parseISO(value), 'MM/dd')}
                            stroke="#888888"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="#888888"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <Tooltip
                            content={<CustomTooltip />}
                            cursor={{ fill: "transparent" }}
                        />
                        <Legend
                            content={<CustomLegend chartData={chartData} />}
                        />
                        {hasError && <Bar dataKey="Error" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />}
                        {hasWarning && <Bar dataKey="Warning" stackId="a" fill="#f97316" radius={[0, 0, 0, 0]} />}
                        {hasInfo && <Bar dataKey="Information" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} />}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}
