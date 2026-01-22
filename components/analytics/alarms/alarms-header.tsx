"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useScroll } from "@/lib/hooks/use-scroll"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, Check, ChevronDown } from "lucide-react"

// Date range options
const DATE_RANGES = {
    "24h": "Last 24 Hours",
    "7d": "Last 7 Days",
    "30d": "Last 30 Days",
    "90d": "Last 90 Days",
    "all": "All Time"
} as const

type DateRangeKey = keyof typeof DATE_RANGES

// Status options with colors
const STATUSES = [
    { value: "Error", label: "Error", color: "bg-red-500" },
    { value: "Warning", label: "Warning", color: "bg-orange-500" },
    { value: "Resolved", label: "Resolved", color: "bg-green-500" },
    { value: "Information", label: "Information", color: "bg-blue-500" },
]

export function AlarmsFilterBar() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const scrolled = useScroll(80)

    // Parse current params
    const [search, setSearch] = React.useState(searchParams.get("search") || "")
    const [dateRange, setDateRange] = React.useState<DateRangeKey>(
        (searchParams.get("range") as DateRangeKey) || "30d"
    )

    const initialStatusParam = searchParams.get("status")
    const initialStatuses = initialStatusParam && initialStatusParam !== 'All'
        ? initialStatusParam.split(',')
        : []
    const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>(initialStatuses)

    // Update URL with filters - triggers server re-render with new API calls
    const updateFilters = React.useCallback((
        newSearch: string,
        newStatuses: string[],
        newRange: DateRangeKey
    ) => {
        const params = new URLSearchParams()

        if (newSearch) params.set("search", newSearch)
        if (newStatuses.length > 0) params.set("status", newStatuses.join(','))
        if (newRange !== "30d") params.set("range", newRange)

        router.push(`?${params.toString()}`)
    }, [router])

    // Debounced search
    React.useEffect(() => {
        const timer = setTimeout(() => {
            updateFilters(search, selectedStatuses, dateRange)
        }, 500)
        return () => clearTimeout(timer)
    }, [search, selectedStatuses, dateRange, updateFilters])

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

    const handleReset = () => {
        setSearch("")
        setSelectedStatuses([])
        setDateRange("30d")
        router.push("?")
    }

    const hasFilters = search || selectedStatuses.length > 0 || dateRange !== "30d"

    return (
        <div
            className={cn(
                "sticky top-0 z-50",
                "bg-background",
                "py-3",
                "transition-all duration-200",
                scrolled && "border-b border-border shadow-sm bg-background/95 backdrop-blur"
            )}
        >
            <div className="flex items-end gap-4 flex-wrap">
                {/* Search - LEFT, small */}
                <div className="space-y-1">
                    <Label htmlFor="search-input" className="text-sm font-medium block">
                        Search
                    </Label>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            id="search-input"
                            type="search"
                            placeholder="Search..."
                            className="pl-8 w-[250px] h-9"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                </div>

                {/* Date Range Filter */}
                <div className="space-y-1">
                    <Label htmlFor="date-range" className="text-sm font-medium block">
                        Date Range
                    </Label>
                    <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRangeKey)}>
                        <SelectTrigger id="date-range" className="w-[140px] h-9">
                            <SelectValue placeholder="Select range" />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.entries(DATE_RANGES).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Status Multi-select Filter - LABEL ON TOP */}
                <div className="space-y-1">
                    <Label className="text-sm font-medium block">Status</Label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="w-[160px] justify-between h-9">
                                {selectedStatuses.length === 0 ? (
                                    <span className="text-muted-foreground">All</span>
                                ) : selectedStatuses.length <= 2 ? (
                                    <div className="flex gap-1">
                                        {selectedStatuses.map(s => (
                                            <Badge key={s} variant="secondary" className="rounded-sm px-1.5 text-xs">
                                                {s}
                                            </Badge>
                                        ))}
                                    </div>
                                ) : (
                                    <Badge variant="secondary" className="rounded-sm px-1.5">
                                        {selectedStatuses.length} selected
                                    </Badge>
                                )}
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[200px] p-0" align="start">
                            <Command>
                                <CommandList>
                                    <CommandEmpty>No status found.</CommandEmpty>
                                    <CommandGroup>
                                        {STATUSES.map((status) => {
                                            const isSelected = selectedStatuses.includes(status.value)
                                            return (
                                                <CommandItem
                                                    key={status.value}
                                                    onSelect={() => toggleStatus(status.value)}
                                                >
                                                    <div
                                                        className={cn(
                                                            "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                            isSelected
                                                                ? "bg-primary text-primary-foreground"
                                                                : "opacity-50 [&_svg]:invisible"
                                                        )}
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </div>
                                                    <span
                                                        className={cn(
                                                            "inline-block size-2 shrink-0 rounded-full mr-2",
                                                            status.color
                                                        )}
                                                    />
                                                    {status.label}
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
                                                    Clear status
                                                </CommandItem>
                                            </CommandGroup>
                                        </>
                                    )}
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                </div>

                {/* Reset Button */}
                {hasFilters && (
                    <Button variant="outline" onClick={handleReset} className="h-9">
                        Reset
                    </Button>
                )}
            </div>
        </div>
    )
}
