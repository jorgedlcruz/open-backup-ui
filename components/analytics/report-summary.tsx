"use client"
// Open Backup UI v1.0.2

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { VeeamOneReportParameter, VeeamOneChartItem } from "@/lib/types/veeam-one"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts"
import { Badge } from "@/components/ui/badge"

interface ReportSummaryProps {
    parameters: VeeamOneReportParameter[]
    summaryData: { name: string; value: string; indent?: number }[]
    protectedVmsChart: VeeamOneChartItem[]
    backupAgeChart: VeeamOneChartItem[]
}

const COLORS = {
    green: "#22c55e",
    red: "#ef4444",
    grey: "#9ca3af",
    yellow: "#eab308",
    blue: "#3b82f6"
}

export function ReportSummary({ parameters, summaryData, protectedVmsChart, backupAgeChart }: ReportSummaryProps) {

    // Transform chart data for Recharts and map colors
    const processChartData = (items: VeeamOneChartItem[]) => {
        return items.map(item => ({
            name: item.group,
            value: Number(item.value),
            color: COLORS[item.color as keyof typeof COLORS] || COLORS.grey
        }))
    }

    const protectedData = processChartData(protectedVmsChart)
    const ageData = processChartData(backupAgeChart)

    return (
        <div className="space-y-6">
            {/* Parameters Section */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Report Parameters</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {parameters.map((param, idx) => (
                            <div key={idx} className="space-y-1">
                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{param.name}</p>
                                <p className="text-sm font-medium">{param.value}</p>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* VM Overview List */}
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="text-base">VMs Overview</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {summaryData.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center" style={{ paddingLeft: `${(item.indent || 0) * 1.5}rem` }}>
                                    <span className={item.indent === 0 ? "font-medium" : "text-muted-foreground"}>{item.name}</span>
                                    <Badge variant="outline" className="font-mono">{item.value}</Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Charts */}
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="text-base">Protected VMs</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={protectedData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {protectedData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="text-base">VM Backup Status</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={ageData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {ageData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
