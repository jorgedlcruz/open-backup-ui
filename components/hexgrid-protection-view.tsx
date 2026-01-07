"use client"

import * as React from "react"
import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { HexGrid, Layout, Hexagon } from "react-hexgrid"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Search, Clock, Server, Monitor, Cloud, HardDrive, Database, Filter, User, Users, Globe, MessageSquare } from "lucide-react"

// =======================================================
// Color Scheme:
// Protected (within RPO): Blue (#0073E6)
// Unprotected (outside RPO): Orange (#D95319)  
// Out of Scope (no restore points): Grey (#6C757D)
// =======================================================

export interface ProtectedObject {
    id: string
    name: string
    type: string // VM, Computer, Cloud, NAS, etc.
    platformName?: string
    lastRestorePoint?: string | null // ISO date string
    restorePointsCount?: number
    size?: number
}

interface HexGridProtectionViewProps {
    data: ProtectedObject[]
    loading?: boolean
}

// Get status based on RPO threshold
function getProtectionStatus(lastRestorePoint: string | null | undefined, rpoThresholdHours: number): 'protected' | 'unprotected' | 'outOfScope' {
    if (!lastRestorePoint) return 'outOfScope'
    const lastDate = new Date(lastRestorePoint)
    if (isNaN(lastDate.getTime())) return 'outOfScope'
    const diffHours = (Date.now() - lastDate.getTime()) / (3600 * 1000)
    return diffHours <= rpoThresholdHours ? 'protected' : 'unprotected'
}

// Get color based on status
function getHexColor(status: 'protected' | 'unprotected' | 'outOfScope'): string {
    switch (status) {
        case 'protected': return '#0073E6'
        case 'unprotected': return '#D95319'
        case 'outOfScope': return '#6C757D'
    }
}

// Get icon for object type
function getTypeIcon(type: string) {
    const t = type.toLowerCase()
    // VB365 types
    if (t === 'user') return User
    if (t === 'group') return Users
    if (t === 'site') return Globe
    if (t === 'team') return MessageSquare
    // VBR types
    if (t.includes('vm') || t.includes('vmware') || t.includes('hyper')) return Monitor
    if (t.includes('computer') || t.includes('agent') || t.includes('physical')) return Server
    if (t.includes('cloud') || t.includes('aws') || t.includes('azure')) return Cloud
    if (t.includes('nas') || t.includes('file') || t.includes('share')) return HardDrive
    return Database
}

export function HexGridProtectionView({ data, loading }: HexGridProtectionViewProps) {
    // RPO State
    const [rpoValue, setRpoValue] = useState(24)
    const [rpoUnit, setRpoUnit] = useState<'minutes' | 'hours' | 'days'>('hours')

    const rpoThresholdHours = useMemo(() => {
        if (rpoUnit === 'minutes') return rpoValue / 60
        if (rpoUnit === 'hours') return rpoValue
        if (rpoUnit === 'days') return rpoValue * 24
        return rpoValue
    }, [rpoValue, rpoUnit])

    // Filter State
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedTypes, setSelectedTypes] = useState<string[]>([])
    const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])

    // Get unique types from data
    const typeOptions = useMemo(() => {
        const types = new Set(data.map(d => d.type || d.platformName || 'Unknown'))
        return Array.from(types).map(t => ({
            label: t,
            value: t,
            icon: getTypeIcon(t)
        }))
    }, [data])

    const statusOptions = [
        { label: 'Protected', value: 'protected', icon: undefined },
        { label: 'Unprotected', value: 'unprotected', icon: undefined },
        { label: 'Out of Scope', value: 'outOfScope', icon: undefined },
    ]

    // Filtered data
    const filteredData = useMemo(() => {
        return data.filter(item => {
            // Search filter
            if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) {
                return false
            }
            // Type filter
            const itemType = item.type || item.platformName || 'Unknown'
            if (selectedTypes.length > 0 && !selectedTypes.includes(itemType)) {
                return false
            }
            // Status filter
            if (selectedStatuses.length > 0) {
                const status = getProtectionStatus(item.lastRestorePoint, rpoThresholdHours)
                if (!selectedStatuses.includes(status)) {
                    return false
                }
            }
            return true
        })
    }, [data, searchQuery, selectedTypes, selectedStatuses, rpoThresholdHours])

    // Dialog state
    const [selectedHex, setSelectedHex] = useState<ProtectedObject | null>(null)

    // Grid container ref for responsive sizing
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerWidth, setContainerWidth] = useState(800)

    useEffect(() => {
        function updateWidth() {
            if (containerRef.current) {
                setContainerWidth(containerRef.current.offsetWidth)
            }
        }
        updateWidth()
        window.addEventListener('resize', updateWidth)
        return () => window.removeEventListener('resize', updateWidth)
    }, [])

    // Calculate grid layout
    const columns = Math.max(1, Math.ceil(Math.sqrt(filteredData.length * 1.5)))

    const hexagons = useMemo(() => {
        return filteredData.map((item, index) => {
            const row = Math.floor(index / columns)
            const col = index % columns
            const q = col - Math.floor(row / 2)
            const r = row
            const s = -q - r
            const status = getProtectionStatus(item.lastRestorePoint, rpoThresholdHours)
            return { ...item, q, r, s, status }
        })
    }, [filteredData, columns, rpoThresholdHours])

    // Calculate viewBox for auto-fit
    const size = { x: 10, y: 10 }
    const spacing = 1.05

    const pixelCoords = useMemo(() => {
        return hexagons.map((hex) => {
            const x = size.x * Math.sqrt(3) * (hex.q + hex.r / 2) * spacing
            const y = size.y * 1.5 * hex.r * spacing
            return { x, y }
        })
    }, [hexagons, size.x, size.y, spacing])

    const { viewBox, gridHeight } = useMemo(() => {
        if (pixelCoords.length === 0) {
            return { viewBox: '0 0 100 100', gridHeight: 400 }
        }
        const minX = Math.min(...pixelCoords.map(p => p.x)) - 15
        const minY = Math.min(...pixelCoords.map(p => p.y)) - 15
        const maxX = Math.max(...pixelCoords.map(p => p.x)) + 15
        const maxY = Math.max(...pixelCoords.map(p => p.y)) + 15
        const width = maxX - minX
        const height = maxY - minY
        const scaleFactor = containerWidth / width
        return {
            viewBox: `${minX} ${minY} ${width} ${height}`,
            gridHeight: Math.min(600, height * scaleFactor)
        }
    }, [pixelCoords, containerWidth])

    const handleHexClick = useCallback((item: ProtectedObject) => {
        setSelectedHex(item)
    }, [])

    // Stats
    const stats = useMemo(() => {
        let protected_ = 0, unprotected = 0, outOfScope = 0
        filteredData.forEach(item => {
            const status = getProtectionStatus(item.lastRestorePoint, rpoThresholdHours)
            if (status === 'protected') protected_++
            else if (status === 'unprotected') unprotected++
            else outOfScope++
        })
        return { protected: protected_, unprotected, outOfScope, total: filteredData.length }
    }, [filteredData, rpoThresholdHours])

    if (loading) {
        return (
            <div className="rounded-md border p-8 text-center bg-muted/20 animate-pulse">
                Loading HexGrid...
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-4">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search objects..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 h-9"
                    />
                </div>

                {/* RPO Controls */}
                <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">RPO:</span>
                    <Input
                        type="number"
                        value={rpoValue}
                        onChange={(e) => setRpoValue(Number(e.target.value) || 1)}
                        className="w-16 h-9"
                        min={1}
                    />
                    <Select value={rpoUnit} onValueChange={(v) => setRpoUnit(v as 'minutes' | 'hours' | 'days')}>
                        <SelectTrigger className="w-24 h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="minutes">Minutes</SelectItem>
                            <SelectItem value="hours">Hours</SelectItem>
                            <SelectItem value="days">Days</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Type Filter */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-9">
                            <Filter className="mr-2 h-4 w-4" />
                            Type
                            {selectedTypes.length > 0 && (
                                <Badge variant="secondary" className="ml-2 px-1.5 py-0.5 text-xs">
                                    {selectedTypes.length}
                                </Badge>
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                        {typeOptions.map((option) => {
                            const Icon = option.icon
                            const isSelected = selectedTypes.includes(option.value)
                            return (
                                <DropdownMenuCheckboxItem
                                    key={option.value}
                                    checked={isSelected}
                                    onCheckedChange={(checked: boolean) => {
                                        if (checked) {
                                            setSelectedTypes([...selectedTypes, option.value])
                                        } else {
                                            setSelectedTypes(selectedTypes.filter(t => t !== option.value))
                                        }
                                    }}
                                >
                                    {Icon && <Icon className="mr-2 h-4 w-4" />}
                                    {option.label}
                                </DropdownMenuCheckboxItem>
                            )
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Status Filter */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-9">
                            <Filter className="mr-2 h-4 w-4" />
                            Status
                            {selectedStatuses.length > 0 && (
                                <Badge variant="secondary" className="ml-2 px-1.5 py-0.5 text-xs">
                                    {selectedStatuses.length}
                                </Badge>
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                        {statusOptions.map((option) => {
                            const isSelected = selectedStatuses.includes(option.value)
                            return (
                                <DropdownMenuCheckboxItem
                                    key={option.value}
                                    checked={isSelected}
                                    onCheckedChange={(checked: boolean) => {
                                        if (checked) {
                                            setSelectedStatuses([...selectedStatuses, option.value])
                                        } else {
                                            setSelectedStatuses(selectedStatuses.filter(s => s !== option.value))
                                        }
                                    }}
                                >
                                    {option.label}
                                </DropdownMenuCheckboxItem>
                            )
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Clear filters */}
                {(searchQuery || selectedTypes.length > 0 || selectedStatuses.length > 0) && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setSearchQuery('')
                            setSelectedTypes([])
                            setSelectedStatuses([])
                        }}
                    >
                        Clear filters
                    </Button>
                )}
            </div>

            {/* Stats Bar */}
            <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">{stats.total} objects</span>
                <Badge variant="outline" className="bg-[#0073E6]/10 text-[#0073E6] border-[#0073E6]/30">
                    {stats.protected} Protected
                </Badge>
                <Badge variant="outline" className="bg-[#D95319]/10 text-[#D95319] border-[#D95319]/30">
                    {stats.unprotected} Unprotected
                </Badge>
                <Badge variant="outline" className="bg-[#6C757D]/10 text-[#6C757D] border-[#6C757D]/30">
                    {stats.outOfScope} Out of Scope
                </Badge>
            </div>

            {/* HexGrid */}
            <div ref={containerRef} className="w-full rounded-md border bg-card overflow-hidden">
                {filteredData.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        No objects match the current filters
                    </div>
                ) : (
                    <HexGrid
                        width={containerWidth}
                        height={gridHeight}
                        viewBox={viewBox}
                    >
                        <Layout size={size} flat={false} spacing={spacing} origin={{ x: 0, y: 0 }}>
                            {hexagons.map((hex) => (
                                <Hexagon
                                    key={hex.id}
                                    q={hex.q}
                                    r={hex.r}
                                    s={hex.s}
                                    className="hexagon-cell"
                                    style={{
                                        cursor: 'pointer',
                                        fill: getHexColor(hex.status),
                                        stroke: '#fff',
                                        strokeWidth: 0.3,
                                        transition: 'filter 0.15s ease-in-out',
                                    }}
                                    onClick={() => handleHexClick(hex)}
                                >
                                    <title>{hex.name}</title>
                                </Hexagon>
                            ))}
                        </Layout>
                    </HexGrid>
                )}
                <style>{`
                    .hexagon-cell:hover {
                        filter: brightness(0.8);
                    }
                `}</style>
            </div>

            {/* Details Dialog */}
            <Dialog open={!!selectedHex} onOpenChange={() => setSelectedHex(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {selectedHex && React.createElement(getTypeIcon(selectedHex.type || ''), { className: "h-5 w-5" })}
                            {selectedHex?.name}
                        </DialogTitle>
                        <DialogDescription>
                            Object details and protection status
                        </DialogDescription>
                    </DialogHeader>
                    {selectedHex && (
                        <div className="space-y-3">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Type</span>
                                <span className="font-medium">{selectedHex.type || selectedHex.platformName || 'Unknown'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Status</span>
                                <Badge
                                    variant="outline"
                                    className={
                                        getProtectionStatus(selectedHex.lastRestorePoint, rpoThresholdHours) === 'protected'
                                            ? 'bg-[#0073E6]/10 text-[#0073E6] border-[#0073E6]/30'
                                            : getProtectionStatus(selectedHex.lastRestorePoint, rpoThresholdHours) === 'unprotected'
                                                ? 'bg-[#D95319]/10 text-[#D95319] border-[#D95319]/30'
                                                : 'bg-[#6C757D]/10 text-[#6C757D] border-[#6C757D]/30'
                                    }
                                >
                                    {getProtectionStatus(selectedHex.lastRestorePoint, rpoThresholdHours) === 'protected' ? 'Protected' :
                                        getProtectionStatus(selectedHex.lastRestorePoint, rpoThresholdHours) === 'unprotected' ? 'Unprotected' : 'Out of Scope'}
                                </Badge>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Last Protected</span>
                                <span className="font-medium">
                                    {selectedHex.lastRestorePoint
                                        ? new Date(selectedHex.lastRestorePoint).toLocaleString()
                                        : 'Never'}
                                </span>
                            </div>
                            {selectedHex.restorePointsCount !== undefined && (
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Restore Points</span>
                                    <span className="font-medium">{selectedHex.restorePointsCount}</span>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
