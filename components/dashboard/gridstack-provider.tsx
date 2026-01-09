"use client"

import React, { createContext, useContext, useRef, useEffect, useCallback, useState } from 'react'
import { GridStack, GridStackNode, GridStackOptions } from 'gridstack'
import { GridStackItemLayout, saveDashboardLayout, loadDashboardLayout } from '@/lib/utils/dashboard-layout'
import { WidgetDefinition, getWidgetsForProduct } from './widget-registry'

// Import GridStack CSS
import 'gridstack/dist/gridstack.min.css'

interface GridStackContextType {
    grid: GridStack | null
    addWidget: (widget: WidgetDefinition, x?: number, y?: number) => void
    removeWidget: (id: string) => void
    saveLayout: () => void
    resetLayout: () => void
    isEditMode: boolean
    setEditMode: (editing: boolean) => void
}

const GridStackContext = createContext<GridStackContextType | null>(null)

export function useGridStack() {
    const context = useContext(GridStackContext)
    if (!context) {
        throw new Error('useGridStack must be used within a GridStackProvider')
    }
    return context
}

interface GridStackProviderProps {
    children: React.ReactNode
    productId: 'vbr' | 'vbm'
    defaultLayout: GridStackItemLayout[]
    onLayoutChange?: (layout: GridStackItemLayout[]) => void
}

export function GridStackProvider({
    children,
    productId,
    defaultLayout,
    onLayoutChange
}: GridStackProviderProps) {
    const gridRef = useRef<GridStack | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isEditMode, setEditMode] = useState(false)
    const [isReady, setIsReady] = useState(false)

    // Initialize GridStack
    useEffect(() => {
        if (!containerRef.current || gridRef.current) return

        // Load saved layout or use default
        const savedLayout = loadDashboardLayout(productId)
        const initialLayout = savedLayout || defaultLayout

        const options: GridStackOptions = {
            column: 12,
            cellHeight: 80,
            margin: 12,
            float: false,
            animate: true,
            draggable: {
                handle: '.widget-drag-handle',
            },
            resizable: {
                handles: 'e, se, s, sw, w'
            },
            acceptWidgets: true,
            removable: false,
        }

        // Initialize grid
        const grid = GridStack.init(options, containerRef.current)
        gridRef.current = grid

        // Add initial widgets
        grid.batchUpdate()
        initialLayout.forEach(item => {
            const widgetDef = getWidgetsForProduct(productId).find(w => w.id === item.id)
            if (widgetDef) {
                grid.addWidget({
                    id: item.id,
                    x: item.x,
                    y: item.y,
                    w: item.w,
                    h: item.h,
                    minW: widgetDef.minSize.w,
                    minH: widgetDef.minSize.h,
                    maxW: widgetDef.maxSize.w,
                    maxH: widgetDef.maxSize.h,
                    content: `<div data-widget-id="${item.id}"></div>`,
                })
            }
        })
        grid.batchUpdate(false)

        // Handle layout changes
        grid.on('change', (_event: Event, items: GridStackNode[]) => {
            if (items && items.length > 0) {
                const layout: GridStackItemLayout[] = grid.getGridItems().map(el => {
                    const node = el.gridstackNode
                    return {
                        id: node?.id as string || '',
                        x: node?.x || 0,
                        y: node?.y || 0,
                        w: node?.w || 1,
                        h: node?.h || 1,
                    }
                }).filter(item => item.id)

                onLayoutChange?.(layout)
            }
        })

        setIsReady(true)

        return () => {
            grid.destroy(false)
            gridRef.current = null
        }
    }, [productId, defaultLayout, onLayoutChange])

    // Toggle edit mode (enable/disable dragging)
    useEffect(() => {
        if (!gridRef.current) return

        if (isEditMode) {
            gridRef.current.enable()
        } else {
            gridRef.current.disable()
        }
    }, [isEditMode])

    const addWidget = useCallback((widget: WidgetDefinition, x?: number, y?: number) => {
        if (!gridRef.current) return

        gridRef.current.addWidget({
            id: widget.id,
            x: x,
            y: y,
            w: widget.defaultSize.w,
            h: widget.defaultSize.h,
            minW: widget.minSize.w,
            minH: widget.minSize.h,
            maxW: widget.maxSize.w,
            maxH: widget.maxSize.h,
            content: `<div data-widget-id="${widget.id}" class="widget-dropping"></div>`,
        })
    }, [])

    const removeWidget = useCallback((id: string) => {
        if (!gridRef.current) return

        const items = gridRef.current.getGridItems()
        const item = items.find(el => el.gridstackNode?.id === id)
        if (item) {
            gridRef.current.removeWidget(item)
        }
    }, [])

    const saveLayout = useCallback(() => {
        if (!gridRef.current) return

        const layout: GridStackItemLayout[] = gridRef.current.getGridItems().map(el => {
            const node = el.gridstackNode
            return {
                id: node?.id as string || '',
                x: node?.x || 0,
                y: node?.y || 0,
                w: node?.w || 1,
                h: node?.h || 1,
            }
        }).filter(item => item.id)

        saveDashboardLayout(productId, layout)
    }, [productId])

    const resetLayout = useCallback(() => {
        if (!gridRef.current) return

        // Remove all widgets
        gridRef.current.removeAll()

        // Re-add default widgets
        gridRef.current.batchUpdate()
        defaultLayout.forEach(item => {
            const widgetDef = getWidgetsForProduct(productId).find(w => w.id === item.id)
            if (widgetDef) {
                gridRef.current!.addWidget({
                    id: item.id,
                    x: item.x,
                    y: item.y,
                    w: item.w,
                    h: item.h,
                    minW: widgetDef.minSize.w,
                    minH: widgetDef.minSize.h,
                    maxW: widgetDef.maxSize.w,
                    maxH: widgetDef.maxSize.h,
                    content: `<div data-widget-id="${item.id}"></div>`,
                })
            }
        })
        gridRef.current.batchUpdate(false)

        // Clear saved layout
        saveDashboardLayout(productId, defaultLayout)
    }, [productId, defaultLayout])

    const contextValue: GridStackContextType = {
        grid: gridRef.current,
        addWidget,
        removeWidget,
        saveLayout,
        resetLayout,
        isEditMode,
        setEditMode,
    }

    return (
        <GridStackContext.Provider value={contextValue}>
            <div
                ref={containerRef}
                className="grid-stack"
                style={{ minHeight: '400px' }}
            >
                {isReady && children}
            </div>
        </GridStackContext.Provider>
    )
}
