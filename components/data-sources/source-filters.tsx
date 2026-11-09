'use client'
// Open Backup UI v1.0.2
import { FilterFacet } from '@/components/operations/filter-facet'
import { FilterFields } from '@/components/operations/filter-fields'
import { filterRows, issues, platforms, type Filters, type Row } from '@/lib/data-sources/model'

export function SourceFilters({ rows, filters, onChange }: { rows: Row[]; filters: Filters; onChange: (patch: Partial<Filters>) => void }) {
  return <FilterFields>
    <FilterFacet title="Condition" multiple={false} defaultOpen options={issues.map(([value, label]) => ({ value, label, translateLabel: true, count: filterRows(rows, { ...filters, issue: value }).length }))} selected={[filters.issue]} onChange={values => onChange({ issue: values[0] as Filters['issue'] })} />
    <FilterFacet title="Platform" multiple={false} options={[{ value: 'all', label: 'All platforms', translateLabel: true }, ...Object.entries(platforms).map(([value, platform]) => ({ value, label: platform.name, translateLabel: false }))].map(option => ({ ...option, count: filterRows(rows, { ...filters, platform: option.value as Filters['platform'] }).length }))} selected={[filters.platform]} onChange={values => onChange({ platform: values[0] as Filters['platform'] })} />
    <FilterFacet title="Configuration" multiple={false} options={[{ value: 'all', label: 'All configurations' }, { value: 'saved', label: 'Saved on server' }, { value: 'environment', label: 'Environment managed' }].map(option => ({ ...option, translateLabel: true }))} selected={[filters.managed]} onChange={values => onChange({ managed: values[0] })} />
  </FilterFields>
}
