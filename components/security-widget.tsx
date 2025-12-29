"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ShieldCheck, AlertTriangle } from "lucide-react"
import { SecurityBestPracticeItem } from "@/lib/types/veeam"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"

interface SecurityWidgetProps {
    items: SecurityBestPracticeItem[]
    loading?: boolean
}

export function SecurityWidget({ items, loading }: SecurityWidgetProps) {

    if (loading) {
        return (
            <Card className="col-span-1 md:col-span-2 lg:col-span-1 h-[487px] flex flex-col">
                <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium">Security Score</CardTitle>
                    <CardDescription>Analyze compliance with best practices</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-6">
                    <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-2">
                            <Skeleton className="h-8 w-16" />
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-2 w-full mt-2" />
                        </div>
                        <div className="space-y-2">
                            <Skeleton className="h-8 w-16" />
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-2 w-full mt-2" />
                        </div>
                    </div>
                    <div className="border-t pt-4 mt-2 flex-1 min-h-0 flex flex-col">
                        <Skeleton className="h-5 w-32 mb-3" />
                        <div className="space-y-3">
                            <Skeleton className="h-12 w-full" />
                            <Skeleton className="h-12 w-full" />
                            <Skeleton className="h-12 w-full" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        )
    }

    const totalItems = items.length

    // Status Logic
    const passedItems = items.filter(i => i.status?.toLowerCase() === 'ok').length
    const issueItems = totalItems - passedItems

    const passedPercent = totalItems > 0 ? (passedItems / totalItems) * 100 : 0
    const issuePercent = totalItems > 0 ? (issueItems / totalItems) * 100 : 0

    const violations = items.filter(i => i.status?.toLowerCase() !== 'ok')

    return (
        <Card className="col-span-1 md:col-span-2 lg:col-span-1 h-[487px] flex flex-col">
            <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Security Score</CardTitle>
                <CardDescription>Analyze compliance with best practices</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-6">

                {/* Stats Section */}
                <div className="grid grid-cols-2 gap-8">
                    {/* Passed Section */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-4xl font-bold">{passedItems}</span>
                            <ShieldCheck className="h-5 w-5 text-blue-500 opacity-80" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-muted-foreground">Passed Checks</span>
                            <div className="flex items-center text-xs text-green-600">
                                <span className="font-medium">↑ {Math.round(passedPercent)}%</span>
                                <span className="text-muted-foreground ml-1">coverage</span>
                            </div>
                        </div>
                        <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full mt-2 overflow-hidden">
                            <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: `${passedPercent}%`, transition: 'width 1s ease-in-out' }}
                            />
                        </div>
                    </div>

                    {/* Issues Section */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-4xl font-bold">{issueItems}</span>
                            <AlertTriangle className="h-5 w-5 text-orange-500 opacity-80" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-muted-foreground">Attention Needed</span>
                            <div className="flex items-center text-xs text-orange-600">
                                <span className="font-medium">↓ {Math.round(issuePercent)}%</span>
                                <span className="text-muted-foreground ml-1">of total</span>
                            </div>
                        </div>
                        <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full mt-2 overflow-hidden">
                            <div
                                className="h-full bg-orange-500 rounded-full"
                                style={{ width: `${issuePercent}%`, transition: 'width 1s ease-in-out' }}
                            />
                        </div>
                    </div>
                </div>


                {/* Details List */}
                <div className="border-t pt-4 mt-2 flex-1 min-h-0 flex flex-col overflow-hidden">
                    <h4 className="text-sm font-medium mb-3">Active Issues</h4>
                    <ScrollArea className="flex-1 pr-4">
                        {violations.length === 0 ? (
                            <div className="flex items-center text-sm text-green-600 bg-green-50 p-3 rounded-md">
                                <ShieldCheck className="mr-2 h-4 w-4" />
                                All checks passed!
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {violations.map((item) => (
                                    <div key={item.id} className="flex items-start space-x-3 text-sm p-2 hover:bg-muted/50 rounded-md transition-colors">
                                        {item.status === 'Violation' ? (
                                            <div className="mt-0.5 text-red-500 bg-red-100 p-1 rounded-full"><AlertTriangle className="h-3 w-3" /></div>
                                        ) : (
                                            <div className="mt-0.5 text-orange-500 bg-orange-100 p-1 rounded-full"><AlertTriangle className="h-3 w-3" /></div>
                                        )}
                                        <div className="flex-1">
                                            <p className="font-medium text-foreground">{item.bestPractice}</p>
                                            {item.note && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{item.note}</p>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </div>

            </CardContent>
        </Card>
    )
}
