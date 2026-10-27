"use client"
import { FilterFacet } from '@/components/operations/filter-facet'

import { Column } from "@tanstack/react-table"
import * as React from "react"


interface DataTableFacetedFilterProps<TData, TValue> {
    column?: Column<TData, TValue>
    title?: string
    options: {
        label: string
        value: string
        icon?: React.ComponentType<{ className?: string }>
    }[]
}

export function DataTableFacetedFilter<TData, TValue>({
    column,
    title,
    options,
}: DataTableFacetedFilterProps<TData, TValue>) { const facets=column?.getFacetedUniqueValues();return <FilterFacet title={title || 'Filter'} options={options.map(option=>({...option,count:facets?.get(option.value) ?? 0}))} selected={(column?.getFilterValue() as string[]) || []} onChange={values=>column?.setFilterValue(values.length ? values:undefined)} defaultOpen={/status|result/i.test(title || '')}/> }
