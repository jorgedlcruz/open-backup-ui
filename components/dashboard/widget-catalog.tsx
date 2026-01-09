"use client"

import React, { useState } from 'react'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, Search, GripVertical } from 'lucide-react'
import {
    WidgetDefinition,
    getWidgetsForProduct,
    WIDGET_CATEGORIES,
    WidgetCategory
} from './widget-registry'
import { useGridStack } from './gridstack-provider'
import { cn } from '@/lib/utils'

interface WidgetCatalogProps {
    productId: 'vbr' | 'vbm'
    existingWidgetIds?: string[]
}

export function WidgetCatalog({ productId, existingWidgetIds = [] }: WidgetCatalogProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<WidgetCategory>('all')
    const { addWidget } = useGridStack()

    const allWidgets = getWidgetsForProduct(productId)

    // Filter widgets
    const filteredWidgets = allWidgets.filter(widget => {
        // Search filter
        const matchesSearch =
            widget.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            widget.description.toLowerCase().includes(searchQuery.toLowerCase())

        // Category filter
        const matchesCategory =
            selectedCategory === 'all' || widget.category === selectedCategory

        return matchesSearch && matchesCategory
    })

    // Check if widget is already on dashboard
    const isWidgetOnDashboard = (widgetId: string) => existingWidgetIds.includes(widgetId)

    const handleAddWidget = (widget: WidgetDefinition) => {
        addWidget(widget)
        // Keep catalog open so user can add more widgets
    }

    const handleDragStart = (e: React.DragEvent, widget: WidgetDefinition) => {
        e.dataTransfer.setData('widget-id', widget.id)
        e.dataTransfer.effectAllowed = 'copy'

        // Create a custom drag image
        const dragPreview = document.createElement('div')
        dragPreview.className = 'bg-card border rounded-lg p-3 shadow-lg'
        dragPreview.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="text-sm font-medium">${widget.title}</span>
            </div>
        `
        dragPreview.style.position = 'absolute'
        dragPreview.style.top = '-1000px'
        document.body.appendChild(dragPreview)
        e.dataTransfer.setDragImage(dragPreview, 50, 25)

        // Clean up after drag starts
        setTimeout(() => {
            document.body.removeChild(dragPreview)
        }, 0)
    }

    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Widget
                </Button>
            </SheetTrigger>
            <SheetContent className="w-[400px] sm:w-[540px] p-0 flex flex-col">
                <SheetHeader className="p-6 pb-4 border-b">
                    <SheetTitle className="flex items-center gap-2">
                        <GripVertical className="h-5 w-5 text-muted-foreground" />
                        Widget Tools
                    </SheetTitle>
                    <SheetDescription>
                        Choose a widget and drag it into your workspace
                    </SheetDescription>
                </SheetHeader>

                {/* Category Tabs */}
                <div className="px-6 py-3 border-b">
                    <div className="flex flex-wrap gap-2">
                        {WIDGET_CATEGORIES.map(category => (
                            <Badge
                                key={category.id}
                                variant={selectedCategory === category.id ? 'default' : 'outline'}
                                className={cn(
                                    "cursor-pointer transition-colors",
                                    selectedCategory === category.id
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-accent'
                                )}
                                onClick={() => setSelectedCategory(category.id)}
                            >
                                {category.label}
                            </Badge>
                        ))}
                    </div>
                </div>

                {/* Search */}
                <div className="px-6 py-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search for widgets..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                </div>

                {/* Widget List */}
                <ScrollArea className="flex-1 px-6 pb-6">
                    <div className="space-y-3">
                        {filteredWidgets.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                No widgets found matching your criteria
                            </div>
                        ) : (
                            filteredWidgets.map(widget => (
                                <WidgetCatalogItem
                                    key={widget.id}
                                    widget={widget}
                                    isOnDashboard={isWidgetOnDashboard(widget.id)}
                                    onAdd={() => handleAddWidget(widget)}
                                    onDragStart={(e) => handleDragStart(e, widget)}
                                />
                            ))
                        )}
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    )
}

interface WidgetCatalogItemProps {
    widget: WidgetDefinition
    isOnDashboard: boolean
    onAdd: () => void
    onDragStart: (e: React.DragEvent) => void
}

function WidgetCatalogItem({
    widget,
    isOnDashboard,
    onAdd,
    onDragStart
}: WidgetCatalogItemProps) {
    return (
        <div
            className={cn(
                "border rounded-lg p-4 bg-card hover:border-primary/50 transition-all",
                "cursor-grab active:cursor-grabbing",
                isOnDashboard && "opacity-60"
            )}
            draggable
            onDragStart={onDragStart}
        >
            <div className="flex items-start gap-3">
                {/* Drag Handle */}
                <div className="mt-0.5 text-muted-foreground">
                    <GripVertical className="h-5 w-5" />
                </div>

                {/* Widget Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <widget.icon className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium text-sm">{widget.title}</span>
                        {isOnDashboard && (
                            <Badge variant="secondary" className="text-xs">
                                Added
                            </Badge>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                        {widget.description}
                    </p>

                    {/* Mini Preview */}
                    <div className="mt-3 h-16 bg-muted/50 rounded-md flex items-center justify-center overflow-hidden">
                        <WidgetMiniPreview category={widget.category} />
                    </div>
                </div>

                {/* Add Button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-8 w-8"
                    onClick={(e) => {
                        e.stopPropagation()
                        onAdd()
                    }}
                >
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}

// Mini preview graphics for widget thumbnails
function WidgetMiniPreview({ category }: { category: string }) {
    if (category === 'stats') {
        return (
            <div className="flex gap-3 px-4 w-full">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex flex-col gap-1 flex-1">
                        <div className="h-2 bg-muted rounded w-8" />
                        <div className="h-4 bg-primary/20 rounded" />
                    </div>
                ))}
            </div>
        )
    }

    if (category === 'charts') {
        return (
            <svg className="w-full h-full px-4" viewBox="0 0 120 40" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                    </linearGradient>
                </defs>
                <path
                    d="M0 35 L20 28 L40 32 L60 20 L80 25 L100 15 L120 18 L120 40 L0 40 Z"
                    fill="url(#chartGradient)"
                />
                <path
                    d="M0 35 L20 28 L40 32 L60 20 L80 25 L100 15 L120 18"
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="2"
                />
            </svg>
        )
    }

    if (category === 'tables') {
        return (
            <div className="flex flex-col gap-1 px-4 w-full">
                <div className="h-2 bg-muted rounded w-full" />
                <div className="h-2 bg-muted/70 rounded w-full" />
                <div className="h-2 bg-muted/50 rounded w-full" />
                <div className="h-2 bg-muted/30 rounded w-3/4" />
            </div>
        )
    }

    // Default info
    return (
        <div className="flex flex-col gap-1.5 px-4 w-full">
            <div className="h-3 bg-muted rounded w-3/4" />
            <div className="h-6 bg-primary/10 rounded w-full" />
            <div className="h-2 bg-muted rounded w-1/2" />
        </div>
    )
}
