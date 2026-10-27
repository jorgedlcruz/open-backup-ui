'use client'

import { useId, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, Columns3, Filter, LayoutList, PanelLeft, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { authLabels, connectionLabels, emptyFilters, filterRows, issues, matches, platforms, type Filters, type Row } from '@/lib/data-sources/model'
import { cn } from '@/lib/utils'
import { demoNow, demoSources } from './demo-data'
import ops from '@/components/operations/operations.module.css'
import styles from './filter-lab.module.css'

const concepts = [
  { id: 'popover', name: 'Compact popover', icon: SlidersHorizontal, description: 'Search and one Filters button. Open a small panel only when you need it.', good: 'Maximum room for the grid', tradeoff: 'Filter choices are hidden until opened.' },
  { id: 'rail', name: 'Push-in filter rail', icon: PanelLeft, description: 'A collapsible left panel moves the grid across. Keep the filters and results in view together.', good: 'Best for investigation across many fields', tradeoff: 'Uses some horizontal space while open.' },
  { id: 'tray', name: 'Expandable filter tray', icon: Filter, description: 'A single button reveals a row of filters above the table. Collapse it when the results are right.', good: 'Keeps the full width of the table', tradeoff: 'Uses more vertical space while open.' },
  { id: 'views', name: 'Task-based views', icon: LayoutList, description: 'Start with All, Needs attention, or Access issues. Refine only when your investigation needs more.', good: 'Fastest for repetitive daily checks', tradeoff: 'The preset views need to be curated per grid.' },
  { id: 'sentence', name: 'A filter sentence', icon: Sparkles, description: 'Read the filters as a sentence. Change a phrase to change what the grid shows.', good: 'Easy to understand at a glance', tradeoff: 'Works best with a small number of filter fields.' },
] as const
type Concept = typeof concepts[number]
type FilterField = 'issue' | 'platform' | 'managed'
const fieldLabels: Record<FilterField, string> = { issue: 'Show', platform: 'Platform', managed: 'Configuration' }
const fields: FilterField[] = ['issue', 'platform', 'managed']
const options: Record<FilterField, { value: string; label: string }[]> = {
  issue: issues.map(([value, label]) => ({ value, label })),
  platform: [{ value: 'all', label: 'All platforms' }, ...Object.entries(platforms).map(([value, platform]) => ({ value, label: platform.name }))],
  managed: [{ value: 'all', label: 'All configurations' }, { value: 'saved', label: 'Saved on server' }, { value: 'environment', label: 'Environment managed' }],
}
const gridColumns = [
  { id: 'name', label: 'Data source', value: (row: Row) => row.name },
  { id: 'connection', label: 'Connection', value: (row: Row) => row.health.connection },
  { id: 'authentication', label: 'Authentication', value: (row: Row) => row.health.authentication },
  { id: 'api', label: 'API version', value: (row: Row) => row.health.apiVersion },
  { id: 'checked', label: 'Last checked', kind: 'date' as const, value: (row: Row) => row.health.checkedAt },
  { id: 'configuration', label: 'Configuration', value: (row: Row) => row.managed },
]
const defaultColumns = ['name', 'connection', 'authentication', 'checked']
const clock = (value: string | null) => value ? `${value.slice(11, 16)} UTC` : 'Not checked'

function Demo({ concept }: { concept: Concept }) {
  const uid = useId()
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters })
  const [expanded, setExpanded] = useState(concept.id === 'rail' || concept.id === 'tray')
  const [visible, setVisible] = useState(defaultColumns)
  const [selected, setSelected] = useState<Row | null>(null)
  const update = (patch: Partial<Filters>) => setFilters(old => ({ ...old, ...patch }))
  const rows = filterRows(demoSources, filters, demoNow)
  const count = fields.filter(field => filters[field] !== 'all').length
  const filtered = count > 0 || !!filters.query
  const reset = () => setFilters({ ...emptyFilters, sort: filters.sort })
  const choose = (field: FilterField, value: string) => update({ [field]: value } as Partial<Filters>)
  const selection = (field: FilterField) => options[field].find(option => option.value === filters[field])!.label
  const railOptions = (field: FilterField, values = options[field]) => values.map(option => <label key={option.value}><input type="radio" name={`${uid}-${field}`} checked={filters[field] === option.value} onChange={() => choose(field, option.value)} /><span>{option.label}</span><small>{filterRows(demoSources, { ...filters, [field]: option.value }, demoNow).length}</small></label>)

  const select = (field: FilterField, sentence = false) => <label className={sentence ? styles.phrase : styles.field}>
    {!sentence && <span>{fieldLabels[field]}</span>}
    <select aria-label={`${concept.name}: ${fieldLabels[field]}`} value={filters[field]} onChange={event => choose(field, event.target.value)}>
      {options[field].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
  const filterFields = <div className={styles.fields}>{fields.map(field => <div key={field}>{select(field)}</div>)}</div>
  const filtersButton = (label = 'Filters') => <Button size="sm" variant="outline"><SlidersHorizontal size={14} />{label}{count > 0 && <span className={styles.count}>{count}</span>}</Button>
  const filterPopover = (label = 'Filters') => <Popover><PopoverTrigger asChild>{filtersButton(label)}</PopoverTrigger><PopoverContent align="start" className={styles.popover} aria-label={`${concept.name} filters`}>
    <div className={styles.popoverHeading}><strong>Filter sources</strong><span>Changes apply instantly</span></div>{filterFields}
    {count > 0 && <Button size="sm" variant="ghost" onClick={() => update({ issue: 'all', platform: 'all', managed: 'all' })}>Reset filters</Button>}
  </PopoverContent></Popover>
  const view = <Popover><PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label={`${concept.name}: Grid view options`}><Columns3 size={14} />View<ChevronDown size={12} /></Button></PopoverTrigger><PopoverContent align="end" className={styles.popover}>
    <div className={styles.popoverHeading}><strong>Grid view</strong><span>Columns and default order</span></div>
    <fieldset className={styles.columnList}><legend>Visible columns</legend>{gridColumns.map(column => <label key={column.id}><input type="checkbox" checked={visible.includes(column.id)} disabled={column.id === 'name'} onChange={() => setVisible(old => old.includes(column.id) ? old.filter(id => id !== column.id) : [...old, column.id])} />{column.label}</label>)}</fieldset>
    <label className={styles.field}><span>Default order</span><select aria-label={`${concept.name}: Default order`} value={filters.sort} onChange={event => update({ sort: event.target.value as Filters['sort'] })}><option value="name">Name</option><option value="issues">Issues first</option><option value="latency">Slowest response</option></select></label>
  </PopoverContent></Popover>
  const search = <label className={styles.search}><Search size={15} /><input aria-label={`${concept.name}: Search sources`} placeholder="Search sources…" value={filters.query} onChange={event => update({ query: event.target.value })} />{filters.query && <button type="button" aria-label="Clear search" onClick={() => update({ query: '' })}><X size={13} /></button>}</label>
  const chips = concept.id !== 'rail' && filtered && <div className={styles.chips} aria-label="Active filters">
    {filters.query && <button onClick={() => update({ query: '' })}>Search: {filters.query}<X size={12} /><span className="sr-only">Remove search filter</span></button>}
    {fields.filter(field => filters[field] !== 'all').map(field => <button key={field} aria-label={`Remove ${fieldLabels[field]} filter: ${selection(field)}`} onClick={() => choose(field, 'all')}>{selection(field)}<X size={12} /></button>)}
    <button className={styles.clear} onClick={reset}>Clear all</button>
  </div>

  function cell(row: Row, id: string): ReactNode {
    if (id === 'name') return <><button className={styles.sourceName} onClick={() => setSelected(row)}>{row.name}</button><small>{platforms[row.type].name}</small></>
    if (id === 'connection') return <span className={cn(styles.status, row.health.connection === 'reachable' ? styles.healthy : row.health.connection === 'unreachable' ? styles.danger : styles.neutral)}><span />{connectionLabels[row.health.connection]}</span>
    if (id === 'authentication') return <span className={cn(styles.auth, row.health.authentication === 'verified' ? styles.healthy : row.health.authentication === 'unknown' ? styles.neutral : styles.warning)}>{authLabels[row.health.authentication]}</span>
    if (id === 'api') return row.health.apiVersion || 'Not verified'
    if (id === 'configuration') return row.managed === 'saved' ? 'Saved on server' : 'Environment managed'
    return clock(row.health.checkedAt)
  }
  const table = <div className={styles.results}>
    <div className={styles.resultSummary}><span role="status"><strong>{rows.length}</strong> of {demoSources.length} sources{filtered ? ' match' : ''}</span><span>Sample evidence · 09:45 UTC</span></div>
    <div className={styles.tableScroll} role="region" aria-label={`${concept.name} results`} tabIndex={0}>
      <SortableGrid key={filters.sort} rows={rows} columns={[...gridColumns.filter(column => visible.includes(column.id)), null]} scope="sample sources">{sorted => <table className={styles.table}>
        <thead><tr>{gridColumns.filter(column => visible.includes(column.id)).map(column => <th key={column.id}>{column.label}</th>)}<th><span className="sr-only">Inspect</span></th></tr></thead>
        <tbody>{sorted.map(row => <tr key={row.id}>{gridColumns.filter(column => visible.includes(column.id)).map(column => <td key={column.id}>{cell(row, column.id)}</td>)}<td><button className={styles.inspect} aria-label={`Inspect ${row.name}`} onClick={() => setSelected(row)}><ArrowUpRight size={15} /></button></td></tr>)}</tbody>
      </table>}</SortableGrid>
      {!rows.length && <div className={styles.empty}><Search size={20} /><strong>No matching sources</strong><p>Try a broader search or remove a filter.</p>{concept.id !== 'rail' && <Button size="sm" variant="outline" onClick={reset}>Clear all filters</Button>}</div>}
    </div>
  </div>

  return <div className={styles.demo} aria-label={`${concept.name} demo`}>
    <div className={styles.demoTitle}><h3>Data Sources</h3><span className={styles.sample}>Interactive sample</span></div>
    {concept.id === 'views' && <div className={styles.focusViews} aria-label="Task views">{([['all', 'All sources'], ['attention', 'Needs attention'], ['authentication', 'Access issues']] as const).map(([issue, label]) => <button key={issue} aria-pressed={filters.issue === issue} onClick={() => update({ issue })}>{label}<span>{demoSources.filter(row => matches(row, issue, demoNow)).length}</span></button>)}</div>}
    <div className={styles.toolbar}>{search}
      {concept.id === 'popover' && filterPopover()}
      {(concept.id === 'rail' || concept.id === 'tray') && <Button size="sm" variant="outline" aria-expanded={expanded} aria-controls={`${uid}-filters`} onClick={() => setExpanded(old => !old)}>{concept.id === 'rail' ? <PanelLeft size={14} /> : <Filter size={14} />}{expanded ? 'Hide filters' : 'Filters'}{count > 0 && <span className={styles.count}>{count}</span>}</Button>}
      {concept.id === 'rail' && <Button size="sm" variant="ghost" disabled={!filtered} onClick={reset}>Clear all</Button>}
      {concept.id === 'views' && filterPopover('Refine')}
      <div className={styles.viewControl}>{view}</div>
    </div>
    {concept.id === 'sentence' && <div className={styles.sentence}>Show {select('issue', true)} on {select('platform', true)} using {select('managed', true)}.</div>}
    {concept.id === 'tray' && expanded && <div id={`${uid}-filters`} className={styles.tray}>{filterFields}</div>}
    {chips}
    <div className={cn(styles.split, concept.id === 'rail' && expanded && styles.splitOpen)}>
      {concept.id === 'rail' && expanded && <aside className={styles.rail} id={`${uid}-filters`} aria-label="Source filters">
        <div className={styles.railHeading}><strong>Filters</strong><span>Apply instantly</span></div>
        <fieldset><legend>Show</legend>{railOptions('issue', options.issue.slice(0, 4))}<details className={styles.moreConditions}><summary>More conditions</summary>{railOptions('issue', options.issue.slice(4))}</details></fieldset>
        <fieldset><legend>Platform</legend>{railOptions('platform')}</fieldset>
        {select('managed')}
      </aside>}
      {table}
    </div>
    <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}><DialogContent><DialogHeader><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>Sample source details for this design comparison.</DialogDescription></DialogHeader>{selected && <dl className={styles.detail}>{[['Platform', platforms[selected.type].name], ['Endpoint', selected.url], ['Connection', connectionLabels[selected.health.connection]], ['Authentication', authLabels[selected.health.authentication]], ['API', selected.health.apiVersion || 'Not verified'], ['Last checked', clock(selected.health.checkedAt)], ['Evidence', selected.health.detail]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}</DialogContent></Dialog>
  </div>
}

export function FilterLab() {
  const [choice, setChoice] = useState<string | null>(null)
  const chosen = concepts.find(concept => concept.id === choice)
  return <div className={cn(ops.console, styles.page)}>
    <header className={styles.intro} id="filter-lab-top"><div className={styles.previewLabel}><span />Design comparison · sample data</div><h1>Less chrome. More clarity.</h1><p>Five ways to simplify grid filters. Try each with the same eight sources, then choose the pattern that feels right.</p><Link href="/administration/data-sources" className={styles.back}><ArrowLeft size={14} />Back to Data Sources</Link></header>
    <div className={styles.principles}><span><Check size={14} />One grid title</span><span><Check size={14} />Search always visible</span><span><Check size={14} />Clear only when filtered</span><span><Check size={14} />Columns under View</span><span><Check size={14} />Sort in column headers</span></div>
    <nav className={styles.index} aria-label="Compare filter layouts">{concepts.map((concept, index) => <a key={concept.id} href={`#${concept.id}`}><span className={styles.indexNumber}>0{index + 1}</span><concept.icon size={20} /><strong>{concept.name}</strong><span>{concept.id === 'rail' ? 'Recommended' : concept.good}</span><ArrowUpRight size={14} className={styles.jump} /></a>)}</nav>
    <div className={styles.recommendation}><PanelLeft size={22} /><div><strong>Selected direction: the collapsible left rail</strong><p>Option 2 now has no filter chips, with Clear all beside the Filters button. The same pattern is available in <Link href="/administration/data-sources" className={styles.liveLink}>live Data Sources</Link>. The examples below use sample data.</p></div></div>
    {concepts.map((concept, index) => <section id={concept.id} key={concept.id} className={styles.concept} aria-label={`Option ${index + 1}: ${concept.name}`}>
      <header className={styles.conceptHeader}><span className={styles.number}>0{index + 1}</span><div><h2>{concept.name}{concept.id === 'rail' && <span className={styles.recommended}>Recommended</span>}</h2><p>{concept.description}</p></div><Button variant={choice === concept.id ? 'default' : 'outline'} size="sm" aria-pressed={choice === concept.id} onClick={() => setChoice(choice === concept.id ? null : concept.id)}>{choice === concept.id ? <Check size={14} /> : null}{choice === concept.id ? 'Shortlisted' : `Pick option ${index + 1}`}</Button></header>
      <Demo concept={concept} />
      <div className={styles.tradeoff}><span><Check size={13} />{concept.good}</span><span>{concept.tradeoff}</span><a href="#filter-lab-top">Back to comparison ↑</a></div>
    </section>)}
    <div className={styles.decision} role="status"><div><strong>{chosen ? `Your shortlist: ${chosen.name}` : 'Which feels clearest to you?'}</strong><p>{chosen ? 'Tell me this option number in the chat when you are ready to apply it across the grids.' : 'Try search, filters, View, and date sorting in each example. Pick an option above to shortlist it.'}</p></div>{chosen && <Button size="sm" variant="ghost" onClick={() => setChoice(null)}>Clear shortlist</Button>}</div>
  </div>
}
