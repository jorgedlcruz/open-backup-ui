'use client'

import { ChevronDown,Search } from 'lucide-react'
import { Children,Fragment,isValidElement,useId,useState,type ReactNode } from 'react'
import styles from './filter-facet.module.css'

export type FilterOption = { value: string; label: ReactNode; searchText?: string; count?: number; disabled?: boolean }

export function FilterGroup({ title, children, count = 0, defaultOpen = false }: { title: string; children: ReactNode; count?: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || count > 0)
  return <details className={styles.group} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>{title}</span>{count > 0 && <small>{count}</small>}<ChevronDown size={13} /></summary>
    <div className={styles.body}>{children}</div>
  </details>
}

export function FilterFacet({ title, options, selected, onChange, multiple = true, defaultOpen = false }: {
  title: string; options: FilterOption[]; selected: string[]; onChange: (values: string[]) => void; multiple?: boolean; defaultOpen?: boolean
}) {
  const id = useId(), [query, setQuery] = useState('')
  const filtered = options.filter(option => (option.searchText ?? (typeof option.label === 'string' ? option.label : option.value)).toLowerCase().includes(query.toLowerCase()))
  const selectedCount = multiple ? selected.length : selected[0] !== options[0]?.value ? 1 : 0
  return <FilterGroup title={title} count={selectedCount} defaultOpen={defaultOpen}>
    {options.length > 8 && <label className={styles.search}><Search size={13} /><input type="search" aria-label={`Search ${title} options`} placeholder="Find an option…" value={query} onChange={event => setQuery(event.target.value)} /></label>}
    <div className={styles.options} role="group" aria-label={title}>
      {filtered.map(option => <label key={option.value} className={styles.option} data-selected={selected.includes(option.value)}>
        <input type={multiple ? 'checkbox' : 'radio'} name={multiple ? undefined : id} checked={selected.includes(option.value)} disabled={option.disabled} onChange={() => onChange(multiple ? selected.includes(option.value) ? selected.filter(value => value !== option.value) : [...selected, option.value] : [option.value])} />
        <span>{option.label}</span>{option.count !== undefined && <small>{option.count.toLocaleString()}</small>}
      </label>)}
      {!filtered.length && <p className={styles.empty}>No matching options</p>}
    </div>
  </FilterGroup>
}

function plainText(node: ReactNode): string {
  return Children.toArray(node).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? plainText(child.props.children) : '').join('')
}
function optionsFrom(children: ReactNode): FilterOption[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; disabled?: boolean }>(child)) return []
    if (child.type === Fragment || child.type === 'optgroup') return optionsFrom(child.props.children)
    if (child.type !== 'option') return []
    const label = plainText(child.props.children)
    return [{ value: String(child.props.value ?? label), label, disabled: child.props.disabled }]
  })
}

/** Native option definitions keep their existing API values and missing-value choices. */
export function FilterSelect({ label, value, onValueChange, children }: { label: string; value?: string | number | readonly string[]; onValueChange: (value: string) => void; children: ReactNode }) {
  return <FilterFacet title={label} multiple={false} options={optionsFrom(children)} selected={[String(value ?? '')]} onChange={values => onValueChange(values[0])} defaultOpen={/condition|severity|status|protection/i.test(label)} />
}
