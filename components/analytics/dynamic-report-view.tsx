"use client"

import { useState, useEffect, useCallback } from "react"
import { SortableGrid } from '@/components/ui/sortable-grid'

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import {
    VeeamOneChartItem,
    VeeamOneTableItem,
    VeeamOneReportParameter
} from "@/lib/types/veeam-one"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface SectionInfo {
    sectionId: string
    status: string
}

interface DynamicReportViewProps {
    taskId: string
    sessionId: string
    resourceId: string
    sections: SectionInfo[]
}

interface SectionData {
    items?: unknown[]
    totalCount?: number
    // For parameters section
    parameters?: unknown[]
}

// Colors for charts
const CHART_COLORS = ["#22c55e", "#ef4444", "#9ca3af", "#eab308", "#3b82f6", "#f97316", "#a855f7"]

async function fetchSectionData(
    taskId: string,
    sectionId: string,
    sessionId: string,
    resourceId: string
): Promise<SectionData | null> {
    try {
        const response = await fetch(`/api/veeam-one/report-section`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, sectionId, sessionId, resourceId })
        })
        if (!response.ok) return null
        return await response.json()
    } catch (e) {
        console.error(`Error fetching section ${sectionId}:`, e)
        return null
    }
}

// Infer section type from sectionId naming convention
function inferSectionType(sectionId: string): 'summary' | 'chart' | 'table' | 'parameters' | 'unknown' {
    const id = sectionId.toLowerCase()
    if (id.includes('summ') || id === 'summary') return 'summary'
    if (id.includes('chart') || id.includes('pie')) return 'chart'
    if (id.includes('table') || id.includes('details') || id.includes('grid')) return 'table'
    if (id.includes('param')) return 'parameters'
    return 'unknown'
}

// Render a summary section (key-value pairs)
function SummarySection({ data }: { data: SectionData }) {
    const items = data.items as { name?: string; value?: string; indent?: number }[] || []
    if (items.length === 0) return <p className="text-muted-foreground">No summary data</p>

    return (
        <div className="grid gap-3">
            {items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center py-2 border-b last:border-0" style={{ paddingLeft: (item.indent || 0) * 20 }}>
                    <span className="text-muted-foreground">{item.name}</span>
                    <span className="font-medium">{item.value}</span>
                </div>
            ))}
        </div>
    )
}

// Render a chart section (auto-detect pie vs bar from data shape)
function ChartSection({ data, sectionId }: { data: SectionData; sectionId: string }) {
    const items = data.items as VeeamOneChartItem[] || []
    if (items.length === 0) return <p className="text-muted-foreground">No chart data</p>

    // Detect if this is pie data (has key/value or group/value structure)
    const isPieChart = sectionId.toLowerCase().includes('pie') ||
        (items.length <= 10 && items.every(i => ('key' in i || 'group_string' in i) && ('value' in i || 'count' in i)))

    if (isPieChart) {
        const pieData = items.map((item, idx) => ({
            name: String(item.key || item.group_string || item.name || `Item ${idx + 1}`),
            value: Number(item.value || item.count || 0),
            color: CHART_COLORS[idx % CHART_COLORS.length]
        }))

        return (
            <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" nameKey="name">
                        {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36} />
                </PieChart>
            </ResponsiveContainer>
        )
    }

    // Bar chart for other data
    const barData = items.slice(0, 20).map((item, idx) => ({
        name: String(item.key || item.group_string || item.group_datetime || `Item ${idx + 1}`).slice(0, 20),
        value: Number(item.value || item.count || 0)
    }))

    return (
        <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData} margin={{ top: 5, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
        </ResponsiveContainer>
    )
}

// Render a table section
function TableSection({ data }: { data: SectionData }) {
    const items = data.items as VeeamOneTableItem[] || []
    if (items.length === 0) return <p className="text-muted-foreground">No table data</p>

    // Get column headers from first item
    const columns = Object.keys(items[0]).filter(k => !k.startsWith('_'))

    return (
        <div className="max-h-[400px] overflow-auto">
            <SortableGrid rows={items} columns={columns.slice(0,8).map(id=>({id,value:(r:VeeamOneTableItem)=>r[id]}))}>{(items)=>(<Table>
                <TableHeader>
                    <TableRow>
                        {columns.slice(0, 8).map(col => (
                            <TableHead key={col} className="whitespace-nowrap">{col}</TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.slice(0, 100).map((row, idx) => (
                        <TableRow key={idx}>
                            {columns.slice(0, 8).map(col => (
                                <TableCell key={col} className="whitespace-nowrap">
                                    {String(row[col] ?? '-')}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>)}</SortableGrid>
            {items.length > 100 && (
                <p className="text-center text-sm text-muted-foreground mt-2">Showing 100 of {items.length} rows</p>
            )}
        </div>
    )
}

// Render parameters
function ParametersSection({ data }: { data: SectionData }) {
    const items = data.items as VeeamOneReportParameter[] || []
    if (items.length === 0) return null

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Report Parameters</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {items.map((param, idx) => (
                        <div key={idx} className="text-sm">
                            <span className="text-muted-foreground">{param.name}: </span>
                            <span className="font-medium">{String(param.value)}</span>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

export function DynamicReportView({ taskId, sessionId, resourceId, sections }: DynamicReportViewProps) {
    const [loading, setLoading] = useState(true)
    const [sectionData, setSectionData] = useState<Record<string, SectionData>>({})

    // Categorize sections by inferred type
    const categorizedSections = sections.reduce((acc, s) => {
        const type = inferSectionType(s.sectionId)
        if (!acc[type]) acc[type] = []
        acc[type].push(s)
        return acc
    }, {} as Record<string, SectionInfo[]>)

    // Load all section data with polling for sections that aren't ready yet
    const loadAllSections = useCallback(async () => {
        setLoading(true)

        const loadedData: Record<string, SectionData> = {}

        // Sections that are metadata-only and can't be fetched via data API
        const skipSections = ['name', 'description']

        // Get sections that need data (not metadata-only)
        const dataSections = sections.filter(s => !skipSections.includes(s.sectionId))

        // First, load sections that are already Ready
        for (const section of dataSections) {
            if (section.status === 'Ready') {
                console.log(`[DynamicReportView] Fetching ready section: ${section.sectionId}`)
                const data = await fetchSectionData(taskId, section.sectionId, sessionId, resourceId)
                if (data) {
                    loadedData[section.sectionId] = data
                }
            }
        }

        // Track sections that need polling (status: None)
        const pendingSections = dataSections.filter(s => s.status === 'None' || s.status !== 'Ready')

        if (pendingSections.length > 0) {
            console.log(`[DynamicReportView] Polling for ${pendingSections.length} pending sections...`)

            // Poll for pending sections (max 20 polls, 500ms each = 10 seconds)
            for (let poll = 0; poll < 20; poll++) {
                await new Promise(r => setTimeout(r, 500))

                // Check status for each pending section
                for (const section of [...pendingSections]) {
                    try {
                        const data = await fetchSectionData(taskId, section.sectionId, sessionId, resourceId)
                        if (data && data.items && data.items.length > 0) {
                            console.log(`[DynamicReportView] Section ready: ${section.sectionId} (${data.items.length} items)`)
                            loadedData[section.sectionId] = data
                            // Remove from pending
                            const idx = pendingSections.indexOf(section)
                            if (idx > -1) pendingSections.splice(idx, 1)
                        }
                    } catch {
                        // Section not ready yet, continue polling
                    }
                }

                // Update state incrementally so user sees progress
                setSectionData({ ...loadedData })

                // All sections loaded?
                if (pendingSections.length === 0) break

                console.log(`[DynamicReportView] Poll ${poll + 1}/20, ${pendingSections.length} sections still pending`)
            }
        }

        setSectionData(loadedData)
        setLoading(false)
    }, [taskId, sessionId, resourceId, sections])

    useEffect(() => {
        loadAllSections()
    }, [loadAllSections])

    if (loading) {
        return (
            <div className="w-full h-[400px] flex flex-col items-center justify-center space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-muted-foreground">Loading report data...</span>
            </div>
        )
    }

    const summarySections = categorizedSections.summary || []
    const chartSections = categorizedSections.chart || []
    const tableSections = categorizedSections.table || []
    const paramsSections = categorizedSections.parameters || []
    const unknownSections = categorizedSections.unknown || []

    return (
        <Tabs defaultValue="summary" className="space-y-6">
            <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="data">Report Data</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="space-y-6">
                {/* Parameters */}
                {paramsSections.length > 0 && sectionData[paramsSections[0].sectionId] && (
                    <ParametersSection data={sectionData[paramsSections[0].sectionId]} />
                )}

                {/* Summary */}
                {summarySections.length > 0 && (
                    <div className="grid gap-4 md:grid-cols-2">
                        {summarySections.map(section => (
                            sectionData[section.sectionId] && (
                                <Card key={section.sectionId}>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base capitalize">{section.sectionId.replace(/_/g, ' ')}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <SummarySection data={sectionData[section.sectionId]} />
                                    </CardContent>
                                </Card>
                            )
                        ))}
                    </div>
                )}

                {/* Charts */}
                {chartSections.length > 0 && (
                    <div className="grid gap-6 md:grid-cols-2">
                        {chartSections.map(section => (
                            sectionData[section.sectionId] && (
                                <Card key={section.sectionId}>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base capitalize">{section.sectionId.replace(/_/g, ' ')}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <ChartSection data={sectionData[section.sectionId]} sectionId={section.sectionId} />
                                    </CardContent>
                                </Card>
                            )
                        ))}
                    </div>
                )}

                {/* Unknown sections treated as tables */}
                {unknownSections.length > 0 && (
                    <div className="space-y-6">
                        {unknownSections.map(section => (
                            sectionData[section.sectionId] && (
                                <Card key={section.sectionId}>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base capitalize">{section.sectionId.replace(/_/g, ' ')}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <TableSection data={sectionData[section.sectionId]} />
                                    </CardContent>
                                </Card>
                            )
                        ))}
                    </div>
                )}
            </TabsContent>

            <TabsContent value="data" className="space-y-6">
                {tableSections.length > 0 ? (
                    tableSections.map(section => (
                        sectionData[section.sectionId] && (
                            <Card key={section.sectionId}>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base capitalize">{section.sectionId.replace(/_/g, ' ')}</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <TableSection data={sectionData[section.sectionId]} />
                                </CardContent>
                            </Card>
                        )
                    ))
                ) : (
                    <div className="text-center py-12 text-muted-foreground">
                        No detail tables available for this report
                    </div>
                )}
            </TabsContent>
        </Tabs>
    )
}
