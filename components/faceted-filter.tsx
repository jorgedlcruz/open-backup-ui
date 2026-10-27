"use client"
import { FilterFacet } from '@/components/operations/filter-facet'

import * as React from "react"

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
}: FacetedFilterProps) { return <FilterFacet title={title || 'Filter'} options={options.map(option=>({...option,count:counts?.[option.value]}))} selected={[...selectedValues]} onChange={values=>onSelect(new Set(values))}/> }
