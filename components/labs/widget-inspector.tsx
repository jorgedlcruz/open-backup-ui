'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { fieldsFor } from '@/lib/labs/data'
import { filterRows, isCachedSource, metricOperation, palettes, sources, views, type Dataset, type Filter, type Widget } from '@/lib/labs/model'
import { chartModel, recommendedViews } from '@/lib/labs/chart'
import { defaultColumns } from '@/lib/labs/catalog'
import { useI18n } from '@/components/providers/i18n-provider'
import { WidgetView } from './widget-view'
import { SourceIcon, ViewIcon } from './icons'
import styles from './labs.module.css'

function LayoutInput({ label, value, disabled, onCommit }: { label: string; value: number; disabled: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return <label className={styles.field}><span>{label}</span><input type="number" step={20} value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={() => {
    const number = Number(draft)
    if (draft.trim() && Number.isFinite(number) && number !== value) onCommit(number)
    setDraft(String(value))
  }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>
}

export function WidgetInspector({ widget: w, data, locked, onChange, onClose }: { widget: Widget; data?: Dataset | Error; locked: boolean; onChange: (patch: Partial<Widget>) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [tab, setTab] = useState('view'), [seriesSearch, setSeriesSearch] = useState('')
  const fields = fieldsFor(w.source), numeric = fields.filter(f => f.type === 'number'), dates = fields.filter(f => f.type === 'date')
  const model = useMemo(() => data && !(data instanceof Error) ? chartModel(filterRows(data, w), data, w) : null, [data, w])
  const grouped = model?.all ?? []
  const chart = !['table', 'grid', 'kpi'].includes(w.view), singleMetric = ['pie', 'donut', 'treemap'].includes(w.view)
  const toggle = (items: string[], value: string) => items.includes(value) ? items.filter(i => i !== value) : [...items, value]
  const select = (label: string, key: keyof Widget, options: { value: string; label: string }[]) => <label className={styles.field}><span>{t(label)}</span><select value={String(w[key])} onChange={e => onChange({ [key]: e.target.value, ...(key === 'groupBy' ? { hidden: [] } : {}), ...(key === 'splitBy' ? { hiddenSeries: [] } : {}) })}>{options.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}</select></label>
  const check = (label: string, key: 'legend' | 'legendValues' | 'horizontal' | 'labels' | 'smooth' | 'stacked') => <label className={styles.check}><input type="checkbox" checked={w[key]} onChange={e => onChange({ [key]: e.target.checked })} />{t(label)}</label>
  const categoricalFields = fields.filter(f => f.type !== 'number').map(f => ({ value: f.key, label: f.label }))
  function updateFilter(index: number, patch: Partial<Filter>) { onChange({ filters: w.filters.map((f, i) => i === index ? { ...f, ...patch } : f) }) }
  return <aside className={styles.inspector} aria-label={t('Widget inspector')}>
    <header><div><span className={styles.eyebrow}>{t('THE SHAPE OF YOUR DATA')}</span><h2 className={styles.inspectorTitle}><SourceIcon source={w.source} />{t('Inspector')}</h2></div><button onClick={onClose} aria-label={t('Close inspector')}><X size={18} /></button></header>
    <div className={styles.preview}><span>{t('LIVE PREVIEW')}</span><div><WidgetView widget={w} data={data} /></div></div>
    <div className={styles.inspectorTabs} role="tablist" aria-label={t('Widget settings')}>{['view', 'data', 'style'].map(value => <button key={value} role="tab" id={`labs-tab-${value}`} aria-controls={`labs-panel-${value}`} aria-selected={tab === value} onClick={() => setTab(value)}>{t(value === 'data' ? 'Data & filters' : value === 'view' ? 'Mapping & series' : 'Style & layout')}</button>)}</div>
    <div className={styles.inspectorBody} role="tabpanel" id={`labs-panel-${tab}`} aria-labelledby={`labs-tab-${tab}`}>
      <label className={styles.field}><span>{t('Widget title')}</span><input value={w.title} maxLength={120} onChange={e => onChange({ title: e.target.value })} /></label>
      {isCachedSource(w.source) && <div className={styles.forecastControls}>
        <label className={styles.field}><span>{t('Repository')}</span><select value={w.repositoryId} onChange={e => onChange({ repositoryId: e.target.value, hidden: [], hiddenSeries: [] })}>
          <option value="">{t(w.source === 'forecast' ? 'First available repository' : 'All repositories')}</option>
          {data && !(data instanceof Error) && data.repositories?.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          {w.repositoryId && (!data || data instanceof Error || !data.repositories?.some(r => r.id === w.repositoryId)) && <option value={w.repositoryId}>{t(data && !(data instanceof Error) ? 'Selected repository unavailable' : 'Selected repository')}</option>}
        </select></label>
        {w.source === 'forecast' && <>
          {select('Forecast basis', 'forecastMode', [{ value: 'capacity', label: 'Recorded volume usage' }, { value: 'files', label: 'Backup files & retention' }])}
          <label className={styles.field}><span>{t('Forecast horizon')}</span><select value={w.horizon} onChange={e => onChange({ horizon: Number(e.target.value) as Widget['horizon'] })}>{[30, 60, 90].map(days => <option value={days} key={days}>{t('{count} days', { count: days })}</option>)}</select></label>
        </>}
        <p className={styles.hint}>{t('Uses the existing source cache. Screen refresh reads the latest cache; it does not force a new forecast collection.')}</p>
      </div>}
      {tab === 'data' && <>
        <div className={styles.sourceStamp}><span className={styles.sourceBadge}><SourceIcon source={w.source} size={24} /></span><div><strong>{t(sources.find(s => s.id === w.source)!.name)}</strong><small>{data && !(data instanceof Error) ? data.sourceName : t('Connected VBR source')}</small></div></div>
        {['history', 'overview'].includes(w.source) && select('History window', 'range', [{ value: '24h', label: 'Last 24 hours' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }])}
        {w.source === 'licenses' && <p className={styles.hint}>{t('Use percentages to compare entitlement types. Filter by entitlement unit before combining license quantities.')}</p>}
        {w.source === 'proxies' && <p className={styles.hint}>{t('Task limits are configured concurrency limits, not measured active tasks.')}</p>}
        {w.source === 'history' && <p className={styles.hint}>{t('Job names are matched by job ID. If no matching job is reported, the session name is shown. Inspect Job name evidence to see which was used.')}</p>}
        {w.source === 'objects' && <p className={styles.hint}>{t('One record per workload. Size uses the largest reported copy; recovery points sum across copies when all counts are known.')}</p>}
        {w.source === 'repositories' && <p className={styles.hint}>{t('Aggregate parents are excluded to avoid counting capacity twice. Shared backing volumes may still overlap.')}</p>}
        {w.source === 'malware' && <p className={styles.hint}>{t('Reported malware events, including resolved events. Filter resolution state to focus on current detections. Heuristic indicators are excluded.')}</p>}
        <label className={styles.field}><span>{t('Search')}</span><input type="search" placeholder={t('Find names, states, destinations…')} value={w.query} maxLength={300} onChange={e => onChange({ query: e.target.value })} /></label>
        {select('Search in', 'searchField', [{ value: '*', label: 'Every field' }, ...fields.map(f => ({ value: f.key, label: f.label }))])}
        <div className={styles.sectionLabel}>{t('Filter rules')}<small>{t('Match all')}</small></div>
        {w.filters.map((f, i) => <div className={styles.filterRule} key={i}>
          <select aria-label={t('Filter field')} value={f.field} onChange={e => updateFilter(i, { field: e.target.value })}>{fields.map(field => <option key={field.key} value={field.key}>{t(field.label)}</option>)}</select>
          <select aria-label={t('Filter operator')} value={f.op} onChange={e => updateFilter(i, { op: e.target.value as Filter['op'] })}>{[['contains', 'Contains'], ['equals', 'Equals'], ['not', 'Does not equal'], ['gt', 'Greater / after'], ['lt', 'Less / before'], ['empty', 'Not reported']].map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
          {f.op !== 'empty' && <input aria-label={t('Filter value')} placeholder={fields.find(field => field.key === f.field)?.type === 'date' ? '2026-10-30T00:00:00Z' : t('Value')} value={f.value} maxLength={300} onChange={e => updateFilter(i, { value: e.target.value })} />}
          <button aria-label={t('Remove filter')} onClick={() => onChange({ filters: w.filters.filter((_, index) => index !== i) })}><X size={14} /></button>
        </div>)}
        <button className={styles.textButton} disabled={w.filters.length >= 12} onClick={() => onChange({ filters: [...w.filters, { field: 'name', op: 'contains', value: '' }] })}><Plus size={14} />{t('Add a rule')}</button>
        <details className={styles.details}><summary>{t('Source evidence')}<ChevronDown size={14} /></summary>{data && !(data instanceof Error) ? <><p>{t('Fetched')}: {new Date(data.fetchedAt).toLocaleString()}</p><p>{t(data.complete ? 'Collection is complete.' : 'Collection is incomplete. Totals may be lower than the full environment.')}</p>{data.warnings.map((warning, i) => <p key={i}>{t(warning)}</p>)}</> : <p>{t('Evidence is not available yet.')}</p>}</details>
      </>}
      {tab === 'view' && <>
        <div className={styles.sectionLabel}>{t('Start with a useful view')}</div><div className={styles.presets}>{recommendedViews(w.source).map(preset => <button key={preset.name} onClick={() => onChange({ ...preset.patch, labels: false, legend: true, hidden: [], hiddenSeries: [] })}><strong>{t(preset.name)} ↗</strong><span>{t(preset.detail)}</span></button>)}</div>
        <div className={styles.miniViews}>{views.map(view => <button key={view.id} aria-pressed={w.view === view.id} onClick={() => onChange({ view: view.id, hiddenSeries: [], ...(view.id === 'area' && dates.length ? { groupBy: dates[0].key } : {}), ...(['pie', 'donut', 'treemap'].includes(view.id) ? { metrics: [w.metrics[0]] } : {}) })}><ViewIcon view={view.id} />{t(view.name)}</button>)}</div>
        {w.view === 'kpi' && select('KPI arrangement', 'kpiMode', [{ value: 'groups', label: 'One card per named group' }, { value: 'total', label: 'One total for all matching records' }])}
        {(chart || w.view === 'grid' || w.view === 'kpi' && w.kpiMode === 'groups') && select(w.view === 'grid' ? 'Color nodes by' : ['line', 'area'].includes(w.view) ? 'X axis' : 'Category labels', 'groupBy', categoricalFields)}
        {['bar', 'line', 'area', 'radar'].includes(w.view) && <>{select('Split into series', 'splitBy', [{ value: '', label: 'No split · one series per measure' }, ...fields.filter(f => f.type === 'text').map(f => ({ value: f.key, label: f.label }))])}<p className={styles.hint}>{t('Category labels name each group. Split creates a separate series for each job, state, or other selected field.')}</p></>}
        {w.view === 'grid' && <>{select('Cards represent', 'gridMode', [{ value: 'groups', label: 'Objects grouped by the name field' }, { value: 'records', label: 'Individual source records' }])}<p className={styles.hint}>{t('Grouped cards combine records with the same object ID. Counts show events or sessions; Mixed means the group contains different states.')}</p>{select('Node name', 'labelField', categoricalFields)}{select('Node detail', 'detailField', fields.map(f => ({ value: f.key, label: f.label })))}</>}
        {chart && dates.some(f => f.key === w.groupBy) && <>{select('Time buckets (UTC)', 'bucket', [{ value: 'hour', label: 'Hour' }, { value: 'day', label: 'Day' }, { value: 'week', label: 'Week (epoch aligned)' }])}<p className={styles.hint}>{t('Only buckets containing reported records are plotted; missing buckets are not assumed to be zero.')}</p></>}
        {w.view !== 'table' && <><div className={styles.sectionLabel}>{t('Values')}<small>{t(singleMetric ? 'Choose one' : 'Up to four')}</small></div><div className={styles.checks}>{[{ key: 'count', label: 'Record count' }, ...numeric].map(f => <label key={f.key} className={styles.check}><input type={singleMetric ? 'radio' : 'checkbox'} name={`metric-${w.id}`} checked={w.metrics.some(m => m === f.key)} onChange={() => { const metrics = (singleMetric ? [f.key] : toggle(w.metrics, f.key)) as Widget['metrics']; if (metrics.length && metrics.length <= 4) onChange({ metrics }) }} />{t(f.label)}</label>)}</div>
          {w.metrics.map(metric => <div className={styles.measureEditor} key={metric}><strong>{t(metric === 'count' ? 'Record count' : fields.find(f => f.key === metric)?.label ?? metric)}</strong><label className={styles.field}><span>{t('Display name')}</span><input aria-label={`${t('Display name')} · ${metric}`} maxLength={80} placeholder={t(metric === 'count' ? 'Record count' : fields.find(f => f.key === metric)?.label ?? metric)} value={w.metricNames[metric] ?? ''} onChange={e => onChange({ metricNames: { ...w.metricNames, [metric]: e.target.value } })} /></label>{metric !== 'count' && w.view !== 'grid' && <label className={styles.field}><span>{t('Calculation')}</span><select aria-label={`${t('Calculation')} · ${metric}`} value={metricOperation(w, metric)} onChange={e => onChange({ metricAggregates: { ...w.metricAggregates, [metric]: e.target.value as Widget['aggregate'] } })}>{[['sum', 'Sum'], ['avg', 'Average'], ['min', 'Minimum'], ['max', 'Maximum']].map(([key, name]) => <option value={key} key={key}>{t(name)}</option>)}</select></label>}</div>)}
        </>}
        {chart && !singleMetric && model && <details className={styles.details}><summary>{t('Series names & visibility')}<ChevronDown size={14} /></summary>{w.splitBy && <label className={styles.field}><span>{t('Maximum visible series groups')}</span><input type="number" min={1} max={24} value={w.seriesLimit} onChange={e => onChange({ seriesLimit: Math.max(1, Math.min(24, Number(e.target.value) || 1)) })} /></label>}<label className={styles.field}><span>{t('Find a series')}</span><input type="search" value={seriesSearch} onChange={e => setSeriesSearch(e.target.value)} /></label><button className={styles.textButton} onClick={() => onChange({ hiddenSeries: [] })}>{t('Show all')}</button>{model.allSeries.filter(s => s.name.toLocaleLowerCase().includes(seriesSearch.toLocaleLowerCase())).slice(0, 100).map(s => <div className={styles.seriesEditor} key={s.id}><label className={styles.check}><input type="checkbox" checked={!w.hiddenSeries.includes(s.id)} onChange={() => onChange({ hiddenSeries: toggle(w.hiddenSeries, s.id).slice(0, 500) })} />{s.name}</label><input aria-label={`${t('Series display name')} · ${s.name}`} placeholder={s.name} maxLength={120} value={w.seriesNames[s.id] ?? ''} onChange={e => onChange({ seriesNames: { ...w.seriesNames, [s.id]: e.target.value } })} /></div>)}{model.allSeries.length > 100 && <p>{t('Showing up to 100 matching series. Search to find more.')}</p>}</details>}
        {w.view === 'table' && <><div className={styles.sectionLabel}>{t('Visible columns')}</div>{fields.map(f => <label className={styles.check} key={f.key}><input type="checkbox" checked={(w.columns.length ? w.columns : defaultColumns(w.source)).includes(f.key)} onChange={() => { const columns = toggle(w.columns.length ? w.columns : defaultColumns(w.source), f.key); if (columns.length) onChange({ columns }) }} />{t(f.label)}</label>)}</>}
        {(w.view === 'grid' || w.view === 'table') && <>{select('Sort by', 'sort', [{ value: '', label: 'Source order' }, ...fields.map(f => ({ value: f.key, label: f.label }))])}{select('Sort direction', 'direction', [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }])}</>}
        <label className={styles.field}><span>{t(chart || w.view === 'kpi' ? 'Maximum visible groups' : 'Maximum visible records')}</span><input type="number" min={1} max={500} value={w.limit} onChange={e => onChange({ limit: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} /></label>
        {w.view !== 'table' && grouped.length > 0 && <details className={styles.details}><summary>{t('Category visibility')}<ChevronDown size={14} /></summary><button className={styles.textButton} onClick={() => onChange({ hidden: [] })}>{t('Show all')}</button>{grouped.slice(0, 500).map(g => <label key={g.key} className={styles.check}><input type="checkbox" checked={!w.hidden.includes(g.key) && !w.hidden.includes(g.name)} onChange={() => onChange({ hidden: w.hidden.includes(g.key) || w.hidden.includes(g.name) ? w.hidden.filter(k => k !== g.key && k !== g.name) : [...w.hidden, g.key].slice(0, 500) })} />{g.name}</label>)}</details>}
      </>}
      {tab === 'style' && <>
        <div className={styles.sectionLabel}>{t('Chart palette')}</div><div className={styles.paletteChoices}>{Object.entries(palettes).map(([name, colors]) => <button key={name} aria-pressed={w.palette === name} onClick={() => onChange({ palette: name as Widget['palette'] })}>{colors.slice(0, 4).map(color => <i key={color} style={{ background: color }} />)}<span>{t(name === 'brand' ? 'Branding' : name === 'atelier' ? 'Atelier' : name === 'ocean' ? 'Ocean' : 'Ember')}</span></button>)}</div>
        <p className={styles.hint}>{t('Surfaces, fonts, transparency and corners follow Branding & Appearance. Branding also follows its chart palette and custom accents.')}</p>
        {chart && <>{check('Show legend', 'legend')}{check('Show values beside legend names', 'legendValues')}{select('Label content', 'labelMode', [{ value: 'name', label: 'Name' }, { value: 'value', label: 'Value' }, { value: 'name-value', label: 'Name and value' }])}</>}{check(w.view === 'grid' ? 'Show node details' : 'Show labels / points', 'labels')}
        {w.view === 'bar' && check('Horizontal bars', 'horizontal')}
        {['area', 'line'].includes(w.view) && check('Smooth curves', 'smooth')}
        {['area', 'bar'].includes(w.view) && check('Stack measures', 'stacked')}
        {['table', 'grid'].includes(w.view) && select('Density', 'density', [{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }])}
        <div className={styles.sectionLabel}>{t('Position & dimensions')}<small>{t(locked ? 'Layout locked' : '20 px grid')}</small></div><div className={styles.dimensions}>{(['x', 'y', 'w', 'h'] as const).map(key => <LayoutInput key={key} disabled={locked} label={t({ x: 'Left', y: 'Top', w: 'Width', h: 'Height' }[key])} value={w[key]} onCommit={value => onChange({ [key]: value })} />)}</div>
        <p className={styles.hint}>{t('Widgets snap into alignment and repel neighbours while keeping the chosen spacing. At the canvas edge, neighbours move below. Undo restores the whole movement.')}</p>
      </>}
    </div>
    <footer><button className={styles.primaryButton} onClick={onClose}>{t('Done shaping')} <span>↗</span></button></footer>
  </aside>
}
