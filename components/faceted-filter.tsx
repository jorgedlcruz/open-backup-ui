"use client"

import * as React from "react"
import { Check, PlusCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"

interface FacetedFilterProps {
    title?: string
    options: {
        label: string
        value: string
        icon?: React.ComponentType<{ className?: string }>
    }[]
    selectedValues: Set<string>
    onSelect: (values: Set<string>) => void
    counts?: Record<string, number>
}

export function FacetedFilter({
    title,
    options,
    selectedValues,
    onSelect,
    counts
}: FacetedFilterProps) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 border-dashed">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    {title}
                    {selectedValues?.size > 0 && (
                        <>
                            <Separator orientation="vertical" className="mx-2 h-4" />
                            <Badge
                                variant="secondary"
                                className="rounded-sm px-1 font-normal lg:hidden"
                            >
                                {selectedValues.size}
                            </Badge>
                            <div className="hidden space-x-1 lg:flex">
                                {selectedValues.size > 2 ? (
                                    <Badge
                                        variant="secondary"
                                        className="rounded-sm px-1 font-normal"
                                    >
                                        {selectedValues.size} selected
                                    </Badge>
                                ) : (
                                    options
                                        .filter((option) => selectedValues.has(option.value))
                                        .map((option) => (
                                            <Badge
                                                variant="secondary"
                                                key={option.value}
                                                className="rounded-sm px-1 font-normal"
                                            >
                                                {option.label}
                                            </Badge>
                                        ))
                                )}
                            </div>
                        </>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
                <div className="p-1">
                    {title && (
                        <>
                            <div className="px-2 py-1.5 text-sm font-semibold">Filter {title}</div>
                            <Separator className="my-1" />
                        </>
                    )}
                    {options.map((option) => {
                        const isSelected = selectedValues.has(option.value)
                        return (
                            <div
                                key={option.value}
                                className={cn(
                                    "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 cursor-pointer"
                                )}
                                onClick={() => {
                                    const newSelected = new Set(selectedValues)
                                    if (isSelected) {
                                        newSelected.delete(option.value)
                                    } else {
                                        newSelected.add(option.value)
                                    }
                                    onSelect(newSelected)
                                }}
                            >
                                <div
                                    className={cn(
                                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                        isSelected
                                            ? "bg-primary text-primary-foreground"
                                            : "opacity-50 [&_svg]:invisible"
                                    )}
                                >
                                    <Check className={cn("h-4 w-4")} />
                                </div>
                                {option.icon && (
                                    <option.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                                )}
                                <span>{option.label}</span>
                                {counts && counts[option.value] !== undefined && (
                                    <span className="ml-auto flex h-4 w-4 items-center justify-center font-mono text-xs">
                                        {counts[option.value]}
                                    </span>
                                )}
                            </div>
                        )
                    })}
                    {selectedValues.size > 0 && (
                        <>
                            <Separator className="my-1" />
                            <div
                                className="flex items-center justify-center p-1 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-sm"
                                onClick={() => onSelect(new Set())}
                            >
                                Clear filters
                            </div>
                        </>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
