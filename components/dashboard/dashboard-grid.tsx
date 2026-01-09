"use client"

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw, Plus, RotateCcw } from 'lucide-react'
import { WidgetDefinition, getWidgetsForProduct } from './widget-registry'
import {
    GridStackItemLayout,
    saveDashboardLayout,
    loadDashboardLayout,
    resetDashboardLayout,
    hasCustomLayout
} from '@/lib/utils/dashboard-layout'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

interface DashboardGridProps {
    productId: 'vbr' | 'vbm'
    defaultLayout: GridStackItemLayout[]
    renderWidget: (widgetId: string, loading: boolean) => React.ReactNode
    loading?: boolean
    onRefresh?: () => void
    lastUpdated?: Date | null
    isRefreshing?: boolean
}

export function DashboardGrid({
    productId,
    defaultLayout,
    renderWidget,
    loading = false,
    onRefresh,
    lastUpdated,
    isRefreshing = false
}: DashboardGridProps) {
    const [layout, setLayout] = useState<GridStackItemLayout[]>(defaultLayout)
    const [showResetDialog, setShowResetDialog] = useState(false)
    const [isCatalogOpen, setIsCatalogOpen] = useState(false)
    const gridRef = useRef<HTMLDivElement>(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gridInstanceRef = useRef<any>(null)

    // Load saved layout on mount
    useEffect(() => {
        const savedLayout = loadDashboardLayout(productId)
        if (savedLayout) {
            setLayout(savedLayout)
        }
    }, [productId])

    // Initialize GridStack - ALWAYS draggable, no edit mode
    useEffect(() => {
        if (typeof window === 'undefined' || !gridRef.current) return

        let mounted = true

        const initGrid = async () => {
            try {
                const { GridStack } = await import('gridstack')

                if (!mounted || !gridRef.current) return

                // Destroy existing grid if any
                if (gridInstanceRef.current) {
                    gridInstanceRef.current.destroy(false)
                }

                const grid = GridStack.init({
                    column: 10,       // 10 columns as requested
                    cellHeight: 10,   // 10px row height for fine-grained control
                    margin: '10px',   // Equal margin
                    float: false,     // Disable float to ENFORCE vertical gaps
                    // @ts-expect-error - feature exists in library but missing in types
                    disableOneColumnMode: true, // Prevent falling back to 1 column
                    animate: true,
                    staticGrid: false,
                    resizable: {
                        handles: 's, se' // Remove 'e' handle to avoid double arrow on side hover
                    },
                }, gridRef.current)

                gridInstanceRef.current = grid

                // Auto-save on any change
                grid.on('change', () => {
                    const items = grid.getGridItems()
                    const newLayout: GridStackItemLayout[] = items.map(el => {
                        const node = el.gridstackNode as { id?: string; x?: number; y?: number; w?: number; h?: number } | undefined
                        return {
                            id: node?.id || '',
                            x: node?.x || 0,
                            y: node?.y || 0,
                            w: node?.w || 1,
                            h: node?.h || 1,
                        }
                    }).filter(item => item.id)

                    setLayout(newLayout)
                    saveDashboardLayout(productId, newLayout)
                })

                console.log('GridStack initialized - real-time drag enabled')
            } catch (error) {
                console.error('Failed to initialize GridStack:', error)
            }
        }

        initGrid()

        return () => {
            mounted = false
            if (gridInstanceRef.current) {
                gridInstanceRef.current.destroy(false)
                gridInstanceRef.current = null
            }
        }

    }, [productId])

    const handleResetLayout = useCallback(() => {
        resetDashboardLayout(productId)
        setLayout(defaultLayout)
        setShowResetDialog(false)
        toast.success('Dashboard reset to default layout')
        window.location.reload()
    }, [productId, defaultLayout])

    const handleAddWidget = useCallback((widget: WidgetDefinition) => {
        if (!gridInstanceRef.current) return

        const newItem: GridStackItemLayout = {
            id: widget.id,
            x: 0,
            y: 100,
            w: widget.defaultSize.w,
            h: widget.defaultSize.h,
        }

        gridInstanceRef.current.addWidget({
            id: widget.id,
            x: 0,
            y: 100,
            w: widget.defaultSize.w,
            h: widget.defaultSize.h,
            minW: widget.minSize.w,
            minH: widget.minSize.h,
            maxW: widget.maxSize.w,
            maxH: widget.maxSize.h,
            autoPosition: true,
        })

        setLayout(prev => [...prev, newItem])
        toast.success(`Added ${widget.title}`)
    }, [])

    const existingWidgetIds = layout.map(l => l.id)
    const availableWidgets = getWidgetsForProduct(productId).filter(
        w => !existingWidgetIds.includes(w.id)
    )

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
                    <p className="text-muted-foreground mt-1">
                        Overview of your backup infrastructure health and performance
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {lastUpdated && (
                        <span className="text-sm text-muted-foreground mr-2">
                            Updated at {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}

                    {/* Add Widget Dropdown */}
                    <DropdownMenu open={isCatalogOpen} onOpenChange={setIsCatalogOpen}>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-1">
                                <Plus className="h-4 w-4" />
                                Add Widget
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                            {availableWidgets.length === 0 ? (
                                <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                                    All widgets are already on the dashboard
                                </div>
                            ) : (
                                availableWidgets.map(widget => (
                                    <DropdownMenuItem
                                        key={widget.id}
                                        onClick={() => handleAddWidget(widget)}
                                        className="cursor-pointer"
                                    >
                                        <widget.icon className="mr-2 h-4 w-4" />
                                        <div className="flex-1">
                                            <div className="font-medium">{widget.title}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {widget.description}
                                            </div>
                                        </div>
                                    </DropdownMenuItem>
                                ))
                            )}
                            {hasCustomLayout(productId) && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => setShowResetDialog(true)}
                                        className="text-destructive focus:text-destructive cursor-pointer"
                                    >
                                        <RotateCcw className="mr-2 h-4 w-4" />
                                        Reset to Default
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Refresh Button */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onRefresh}
                        disabled={loading || isRefreshing}
                    >
                        <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Grid Container - widgets render DIRECTLY inside without extra wrappers */}
            <div
                ref={gridRef}
                className="grid-stack grid-stack-10"
            >
                {layout.map(item => {
                    // Handle spacer widget for gaps
                    if (item.id === 'vbr-gap') {
                        return (
                            <div
                                key={item.id}
                                className="grid-stack-item opacity-0 pointer-events-none"
                                gs-id={item.id}
                                gs-x={item.x}
                                gs-y={item.y}
                                gs-w={item.w}
                                gs-h={item.h}
                                gs-no-move="true"
                                gs-no-resize="true"
                                gs-locked="true"
                            >
                                <div className="grid-stack-item-content border-0 shadow-none bg-transparent" />
                            </div>
                        )
                    }

                    const widgetDef = getWidgetsForProduct(productId).find(w => w.id === item.id)
                    if (!widgetDef) return null

                    return (
                        <div
                            key={item.id}
                            className="grid-stack-item"
                            gs-id={item.id}
                            gs-x={item.x}
                            gs-y={item.y}
                            gs-w={item.w}
                            gs-h={item.h}
                            gs-min-w={widgetDef.minSize.w}
                            gs-min-h={widgetDef.minSize.h}
                            gs-max-w={widgetDef.maxSize.w}
                            gs-max-h={widgetDef.maxSize.h}
                        >
                            {/* NO EXTRA WRAPPERS - widget renders directly */}
                            <div className="grid-stack-item-content">
                                {renderWidget(item.id, loading)}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Reset Confirmation Dialog */}
            <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Reset Dashboard Layout?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will remove all customizations and restore the default widget layout.
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleResetLayout}>
                            Reset to Default
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

export { WidgetWrapper, WidgetPreview } from './widget-wrapper'
export { WidgetCatalog } from './widget-catalog'
export * from './widget-registry'
