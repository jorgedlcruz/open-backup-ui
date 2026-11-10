"use client"
// Open Backup UI v1.2.0

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { VeeamOneReportParameter, VeeamOneSummaryResponse } from "@/lib/types/veeam-one"

interface DynamicSummaryProps {
    parameters: VeeamOneReportParameter[]
    summaryData: VeeamOneSummaryResponse | null
}

export function DynamicSummary({ parameters, summaryData }: DynamicSummaryProps) {
    return (
        <div className="space-y-6">
            {/* Parameters Section */}
            {parameters.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Report Parameters</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {parameters.map((param, idx) => (
                                <div key={idx} className="space-y-1">
                                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                                        {param.name}
                                    </p>
                                    <p className="text-sm font-medium">{param.value || '-'}</p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Summary Groups */}
            {summaryData && summaryData.items && summaryData.items.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {summaryData.items.map((group, groupIdx) => (
                        <Card key={groupIdx}>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">{group.name}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    {group.data.map((item, itemIdx) => (
                                        <div
                                            key={itemIdx}
                                            className="flex justify-between items-center"
                                            style={{ paddingLeft: `${(item.indent || 0) * 1.5}rem` }}
                                        >
                                            <span className={item.indent === 0 ? "font-medium" : "text-muted-foreground text-sm"}>
                                                {item.name}
                                            </span>
                                            <Badge variant="outline" className="font-mono">
                                                {item.value}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
