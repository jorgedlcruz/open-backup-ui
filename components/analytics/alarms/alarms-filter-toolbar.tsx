"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, X, Check, Filter, AlertTriangle, CheckCircle2, Info } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

const statuses = [
    { label: "Error", value: "Error", icon: X },
    { label: "Warning", value: "Warning", icon: AlertTriangle },
    { label: "Resolved", value: "Resolved", icon: CheckCircle2 },
    { label: "Information", value: "Information", icon: Info },
]

export function AlarmsFilterToolbar() {
    const router = useRouter()
    const searchParams = useSearchParams()

    const [search, setSearch] = React.useState(searchParams.get("search") || "")

    // Parse status from CSV
    const initialStatusParam = searchParams.get("status")
    const initialStatuses = initialStatusParam && initialStatusParam !== 'All'
        ? initialStatusParam.split(',')
        : []

    const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>(initialStatuses)

    const updateFilters = React.useCallback((newSearch: string, newStatuses: string[]) => {
        const params = new URLSearchParams(searchParams.toString())

        if (newSearch) {
            params.set("search", newSearch)
        } else {
            params.delete("search")
        }

        if (newStatuses.length > 0) {
            params.set("status", newStatuses.join(','))
        } else {
            params.delete("status")
        }

        // Reset offset when filtering
        params.delete("offset")

        router.push(`?${params.toString()}`)
    }, [searchParams, router])

    // Debounce search update
    React.useEffect(() => {
        const timer = setTimeout(() => {
            updateFilters(search, selectedStatuses)
        }, 500)

        return () => clearTimeout(timer)
    }, [search, selectedStatuses, updateFilters])

    // Specific handler for status changes to trigger immediate update or just state update?
    // Users expect multi-select to stay open. We update state, then effect triggers updateFilters.

    const toggleStatus = (value: string) => {
        setSelectedStatuses(current => {
            const index = current.indexOf(value)
            if (index >= 0) {
                return current.filter(s => s !== value)
            } else {
                return [...current, value]
            }
        })
    }

    const clearFilters = () => {
        setSearch("")
        setSelectedStatuses([])
        router.push("?")
    }

    return (
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-background p-4 rounded-lg border shadow-sm">
            <div className="flex flex-1 items-center gap-2 w-full">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search by alarm or object name..."
                        className="pl-8"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-10 border-dashed">
                            <Filter className="mr-2 h-4 w-4" />
                            Status
                            {selectedStatuses.length > 0 && (
                                <>
                                    <Separator orientation="vertical" className="mx-2 h-4" />
                                    <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
                                        {selectedStatuses.length}
                                    </Badge>
                                    <div className="hidden space-x-1 lg:flex">
                                        {selectedStatuses.length > 2 ? (
                                            <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                                                {selectedStatuses.length} selected
                                            </Badge>
                                        ) : (
                                            statuses
                                                .filter((option) => selectedStatuses.includes(option.value))
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
                        <Command>
                            <CommandInput placeholder="Status" />
                            <CommandList>
                                <CommandEmpty>No results found.</CommandEmpty>
                                <CommandGroup>
                                    {statuses.map((option) => {
                                        const isSelected = selectedStatuses.includes(option.value)
                                        return (
                                            <CommandItem
                                                key={option.value}
                                                onSelect={() => toggleStatus(option.value)}
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
                                                <span>{option.label}</span>
                                            </CommandItem>
                                        )
                                    })}
                                </CommandGroup>
                                {selectedStatuses.length > 0 && (
                                    <>
                                        <CommandSeparator />
                                        <CommandGroup>
                                            <CommandItem
                                                onSelect={() => setSelectedStatuses([])}
                                                className="justify-center text-center"
                                            >
                                                Clear filters
                                            </CommandItem>
                                        </CommandGroup>
                                    </>
                                )}
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>

                {(search || selectedStatuses.length > 0) && (
                    <Button variant="ghost" size="icon" onClick={clearFilters} title="Clear Filters">
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>
        </div>
    )
}
