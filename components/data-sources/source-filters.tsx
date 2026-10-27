'use client'
import { FilterFacet } from '@/components/operations/filter-facet';
import { FilterFields } from '@/components/operations/filter-fields';
import { filterRows,issues,platforms,type Filters,type Row } from '@/lib/data-sources/model';

export function SourceFilters({ rows, filters, onChange }: { rows: Row[]; filters: Filters; onChange: (patch: Partial<Filters>) => void }) {
 return <FilterFields>
  <FilterFacet title="Condition" multiple={false} defaultOpen options={issues.map(([value,label])=>({value,label,count:filterRows(rows,{...filters,issue:value}).length}))} selected={[filters.issue]} onChange={values=>onChange({issue:values[0] as Filters['issue']})}/>
  <FilterFacet title="Platform" multiple={false} options={[{value:'all',label:'All platforms'},...Object.entries(platforms).map(([value,platform])=>({value,label:platform.name}))].map(option=>({...option,count:filterRows(rows,{...filters,platform:option.value as Filters['platform']}).length}))} selected={[filters.platform]} onChange={values=>onChange({platform:values[0] as Filters['platform']})}/>
  <FilterFacet title="Configuration" multiple={false} options={[{value:'all',label:'All configurations'},{value:'saved',label:'Saved on server'},{value:'environment',label:'Environment managed'}]} selected={[filters.managed]} onChange={values=>onChange({managed:values[0]})}/>
 </FilterFields>
}
