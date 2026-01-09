"use client"

import React, { useState, ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { GripVertical, ChevronDown, ChevronUp, X, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WidgetDefinition } from './widget-registry'
import { Skeleton } from '@/components/ui/skeleton'

interface WidgetWrapperProps {
    widget: WidgetDefinition
    children: ReactNode
    loading?: boolean
    isEditMode?: boolean
    onRemove?: () => void
}

export function WidgetWrapper({
    widget,
    children,
    loading = false,
    isEditMode = false,
    onRemove
}: WidgetWrapperProps) {
    const [isCollapsed, setIsCollapsed] = useState(false)
    const [isMaximized, setIsMaximized] = useState(false)

    return (
        <Card
            className={cn(
                "h-full flex flex-col transition-all duration-300 ease-out",
                isCollapsed && "!h-auto",
                isMaximized && "fixed inset-4 z-50",
                "widget-card"
            )}
        >
            {/* Header with drag handle */}
            <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3 px-4">
                <div className="flex items-center gap-2">
                    {isEditMode && (
                        <div className="widget-drag-handle cursor-grab active:cursor-grabbing p-1 -ml-1 rounded hover:bg-muted">
                            <GripVertical className="h-4 w-4 text-muted-foreground" />
                        </div>
                    )}
                    <widget.icon className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
                </div>

                <div className="flex items-center gap-1">
                    {/* Maximize/Minimize button */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setIsMaximized(!isMaximized)}
                    >
                        {isMaximized ? (
                            <Minimize2 className="h-3.5 w-3.5" />
                        ) : (
                            <Maximize2 className="h-3.5 w-3.5" />
                        )}
                    </Button>

                    {/* Collapse/Expand button */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setIsCollapsed(!isCollapsed)}
                    >
                        {isCollapsed ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                            <ChevronUp className="h-3.5 w-3.5" />
                        )}
                    </Button>

                    {/* Remove button (only in edit mode) */}
                    {isEditMode && onRemove && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={onRemove}
                        >
                            <X className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </CardHeader>

            {/* Content */}
            <CardContent
                className={cn(
                    "flex-1 overflow-auto transition-all duration-300 ease-out",
                    isCollapsed && "h-0 py-0 overflow-hidden"
                )}
            >
                {loading ? (
                    <WidgetSkeleton widget={widget} />
                ) : (
                    children
                )}
            </CardContent>

            {/* Maximized overlay backdrop */}
            {isMaximized && (
                <div
                    className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
                    onClick={() => setIsMaximized(false)}
                />
            )}
        </Card>
    )
}

// Skeleton loader for widgets
function WidgetSkeleton({ widget }: { widget: WidgetDefinition }) {
    // Generate appropriate skeleton based on widget category
    if (widget.category === 'stats') {
        return (
            <div className="grid grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="space-y-2">
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-8 w-full" />
                    </div>
                ))}
            </div>
        )
    }

    if (widget.category === 'charts') {
        return (
            <div className="space-y-4">
                <div className="flex justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-[200px] w-full" />
            </div>
        )
    }

    if (widget.category === 'tables') {
        return (
            <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                {[1, 2, 3, 4].map(i => (
                    <Skeleton key={i} className="h-12 w-full" />
                ))}
            </div>
        )
    }

    // Default info skeleton
    return (
        <div className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-1/2" />
        </div>
    )
}

// Mini widget preview for catalog
export function WidgetPreview({ widget }: { widget: WidgetDefinition }) {
    return (
        <div className="border rounded-lg p-3 bg-card hover:bg-accent/50 cursor-grab active:cursor-grabbing transition-colors">
            <div className="flex items-center gap-2 mb-2">
                <widget.icon className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{widget.title}</span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
                {widget.description}
            </p>
            <div className="mt-2 h-12 bg-muted/50 rounded flex items-center justify-center">
                <WidgetMiniSkeleton category={widget.category} />
            </div>
        </div>
    )
}

// Mini skeleton for widget preview thumbnails
function WidgetMiniSkeleton({ category }: { category: string }) {
    if (category === 'stats') {
        return (
            <div className="flex gap-2 px-2">
                {[1, 2, 3].map(i => (
                    <div key={i} className="h-6 w-6 bg-muted rounded" />
                ))}
            </div>
        )
    }

    if (category === 'charts') {
        return (
            <svg className="w-16 h-8 text-muted" viewBox="0 0 64 32">
                <path
                    d="M0 28 L16 20 L32 24 L48 12 L64 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                />
            </svg>
        )
    }

    return (
        <div className="flex flex-col gap-1 px-2 w-full">
            <div className="h-1.5 bg-muted rounded w-full" />
            <div className="h-1.5 bg-muted rounded w-3/4" />
            <div className="h-1.5 bg-muted rounded w-1/2" />
        </div>
    )
}
