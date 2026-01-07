"use client"

import { useMemo, useState } from "react"
import { ResponsiveContainer, Sankey, Tooltip, Layer, Rectangle } from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface ProtectedDataSankeyProps {
    data: {
        byRepository: Record<string, number>
        byWorkload: Record<string, number>
        workloadToRepos?: Record<string, string[]>
    }
}

const COLORS = [
    "#3b82f6", // Blue
    "#8b5cf6", // Violet
    "#ec4899", // Pink
    "#f43f5e", // Rose
    "#f97316", // Orange
    "#eab308", // Yellow
    "#22c55e", // Green
    "#06b6d4", // Cyan
    "#6366f1", // Indigo
    "#d946ef", // Fuchsia
]

export function ProtectedDataSankey({ data }: ProtectedDataSankeyProps) {
    const [visibleCount, setVisibleCount] = useState(20)
    const [highlightedNames, setHighlightedNames] = useState<Set<string> | null>(null)

    const formatBytes = (bytes: number) => {
        if (!bytes) return "0 B"
        const k = 1024
        const sizes = ["B", "KB", "MB", "GB", "TB"]
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
    }

    const { nodes, links, totalWorkloads } = useMemo(() => {
        const repoNames = Object.keys(data.byRepository).filter(k => data.byRepository[k] > 0)

        const allWorkloadNames = Object.keys(data.byWorkload).filter(k => data.byWorkload[k] > 0)
        const sortedWorkloads = allWorkloadNames.sort((a, b) => data.byWorkload[b] - data.byWorkload[a])

        const visibleWorkloads = sortedWorkloads.slice(0, visibleCount)
        const totalSize = Object.values(data.byRepository).reduce((a, b) => a + b, 0)

        // Compute colors for repos
        const repoNodes = repoNames.map((name, i) => ({
            name: `${name} (${formatBytes(data.byRepository[name])})`,
            originalName: name,
            value: data.byRepository[name],
            fill: COLORS[i % COLORS.length]
        }))

        const totalNode = {
            name: "Total Backup Size",
            originalName: "Total Backup Size",
            value: totalSize,
            fill: "#10b981"
        }

        const workloadNodes = visibleWorkloads.map((name, i) => ({
            name: `${name} (${formatBytes(data.byWorkload[name])})`,
            originalName: name,
            value: data.byWorkload[name],
            fill: COLORS[(i + repoNames.length) % COLORS.length]
        }))

        const nodes = [
            ...repoNodes,
            totalNode,
            ...workloadNodes
        ]

        const totalIndex = repoNames.length

        // Create links
        const links = [
            // Repos -> Total
            ...repoNames.map((name, i) => ({
                source: i,
                target: totalIndex,
                value: data.byRepository[name],
                fill: nodes[i].fill
            })),
            // Total -> Workloads
            ...visibleWorkloads.map((name, i) => ({
                source: totalIndex,
                target: totalIndex + 1 + i,
                value: data.byWorkload[name],
                fill: nodes[totalIndex + 1 + i].fill
            }))
        ]

        return { nodes, links, totalWorkloads: sortedWorkloads.length }
    }, [data, visibleCount])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onMouseEnter = (nodeData: any) => {
        if (!nodeData) return;
        const name = nodeData.originalName || nodeData.name
        const newHighlights = new Set<string>()

        newHighlights.add(name)
        newHighlights.add("Total Backup Size")

        // If hovering a workload, find its repos
        if (data.workloadToRepos && data.workloadToRepos[name]) {
            data.workloadToRepos[name].forEach(r => newHighlights.add(r))
        }

        // If hovering a repo, find workloads on it
        if (data.workloadToRepos) {
            Object.entries(data.workloadToRepos).forEach(([wl, repos]) => {
                if (repos.includes(name)) {
                    newHighlights.add(wl)
                }
            })
        }

        setHighlightedNames(newHighlights)
    }

    const onMouseLeave = () => {
        setHighlightedNames(null)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const CustomNode = (props: any) => {
        const { x, y, width, height, index, payload, containerWidth } = props
        if (!payload) return null;

        const isTotal = payload.originalName === "Total Backup Size"

        const isActive = highlightedNames === null || highlightedNames.has(payload.originalName)
        const opacity = isActive ? 1 : 0.1

        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(width) || Number.isNaN(height)) return null;

        return (
            <Layer key={`CustomNode${index}`}>
                <Rectangle
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill={payload.fill || "#8884d8"}
                    fillOpacity={opacity}
                    radius={[4, 4, 4, 4]}
                    onMouseEnter={() => onMouseEnter(payload)}
                    onMouseLeave={onMouseLeave}
                    cursor="pointer"
                    stroke={isActive ? "#fff" : "none"}
                    strokeWidth={isActive ? 1 : 0}
                    style={{ transition: 'fill-opacity 0.2s, stroke 0.2s' }}
                />

                <text
                    textAnchor={isTotal ? "middle" : (x > containerWidth / 2 ? "end" : "start")}
                    x={isTotal ? x + width / 2 : (x > containerWidth / 2 ? x - 8 : x + width + 8)}
                    y={y + height / 2 - 2}
                    fontSize={12}
                    fontWeight={isTotal ? 700 : 500}
                    fill="currentColor"
                    className="fill-foreground font-medium"
                    style={{ opacity: opacity, pointerEvents: 'none', transition: 'opacity 0.2s' }}
                >
                    {payload.name}
                </text>
            </Layer>
        );
    }

    // GUARANTEED VISIBLE LINES 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const CustomLink = (props: any) => {
        const { source, target, fill, payload } = props

        if (!source || !target) return null;

        let shouldHighlight = true
        if (highlightedNames !== null) {
            const sourceName = source ? source.originalName : '';
            const targetName = target ? target.originalName : '';
            shouldHighlight = highlightedNames.has(sourceName) && highlightedNames.has(targetName)
        }

        // Color priority: direct prop > payload prop > default
        const fillColor = fill || (payload && payload.fill) || "#8884d8"; // Default purple
        const opacity = shouldHighlight ? 0.8 : 0.6; // High visibility

        return (
            <path
                d={props.d}
                fill={fillColor}
                fillOpacity={opacity}
                stroke="none"
                style={{ transition: 'fill-opacity 0.2s' }}
            />
        )
    }

    const dynamicHeight = Math.max(600, nodes.length * 40)

    if (nodes.length === 0) {
        return (
            <Card className="h-[600px] flex items-center justify-center text-muted-foreground">
                No storage data available for visualization.
            </Card>
        )
    }

    return (
        <Card className="col-span-1 border-0 shadow-none">
            <CardContent className="p-0">
                <div style={{ height: dynamicHeight, minHeight: '600px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <Sankey
                            data={{ nodes, links }}
                            node={<CustomNode containerWidth={1200} />}
                            nodePadding={40}
                            margin={{ left: 200, right: 200, top: 20, bottom: 20 }}
                            link={<CustomLink />}
                        >
                            <Tooltip
                                content={({ active, payload }) => {
                                    if (!active || !payload || !payload.length) return null
                                    const data = payload[0]
                                    const isLink = data.payload.source !== undefined && data.payload.target !== undefined

                                    if (!isLink) {
                                        return (
                                            <div className="bg-popover border text-popover-foreground px-3 py-2 rounded-md shadow-md text-sm z-50">
                                                <span className="font-semibold block mb-1">{data.payload.originalName}</span>
                                                <div className="text-muted-foreground">
                                                    Size: <span className="text-foreground font-mono">{formatBytes(Number(data.value || 0))}</span>
                                                </div>
                                            </div>
                                        )
                                    } else {
                                        return (
                                            <div className="bg-popover border text-popover-foreground px-3 py-2 rounded-md shadow-md text-sm z-50">
                                                <span className="block mb-1">{data.payload.source.originalName} → {data.payload.target.originalName}</span>
                                                <div className="text-muted-foreground">
                                                    Size: <span className="font-mono text-foreground">{formatBytes(Number(data.value || 0))}</span>
                                                </div>
                                            </div>
                                        )
                                    }
                                }}
                            />
                        </Sankey>
                    </ResponsiveContainer>
                </div>

                <div className="flex justify-center py-4 border-t mt-4">
                    {totalWorkloads > visibleCount ? (
                        <Button
                            variant="secondary"
                            onClick={() => setVisibleCount(prev => prev + 50)}
                            className="w-full max-w-xs"
                        >
                            Load More Workloads ({visibleCount} of {totalWorkloads})
                        </Button>
                    ) : (
                        <div className="text-xs text-muted-foreground">
                            Showing all {totalWorkloads} workloads
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
