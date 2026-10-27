"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export function AppearanceOptions<T extends string>({ label, value, options, onChange }: {
    label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void
}) {
    return <ToggleGroup type="single" aria-label={label} value={value} onValueChange={next => { if (options.some(option => option.value === next)) onChange(next as T) }} className="flex-wrap justify-start gap-2">
        {options.map(option => <ToggleGroupItem key={option.value} value={option.value} variant="outline" className="h-9 px-3 text-xs" aria-label={`${label}: ${option.label}`}>{option.label}</ToggleGroupItem>)}
    </ToggleGroup>
}
