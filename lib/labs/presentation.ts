// Open Backup UI v1.2.0
import { aggregate, categoryFor, filterRows, metricOperation, sortRows, type Dataset, type Field, type RecordRow, type Widget } from './model'
import { chartModel, type Series } from './chart'
import { defaultColumns } from './catalog'

export type GridNode = { key: string; name: string; category: string; detail: string; count: number; time: string | null; values: Record<string, number | null>; records?: RecordRow[] }
export type Presentation = {
  available: boolean; complete: boolean; fetchedAt: string; warnings: string[]; total: number; matching: number
  freshness?: Dataset['freshness']; emptyReason?: Dataset['emptyReason']; contextLabel?: string
  fields: Field[]; rows: RecordRow[]; nodes: GridNode[]
  cards: { key: string; name: string; values: Record<string, number | null> }[]
  chart: { points: (RecordRow & { key: string; name: string })[]; visible: (RecordRow & { key: string; name: string })[]; allCount: number; series: Series[]; isDate: boolean; split: boolean; units: string[]; partitionCount: number; visiblePartitions: number }
}
const distinct = (rows: RecordRow[], field: string) => [...new Set(rows.map(row => row[field] == null ? 'Not reported' : String(row[field])))]
export function gridNodes(rows: RecordRow[], data: Dataset, w: Widget): GridNode[] {
  const ordered = sortRows(rows, w).filter(row => {
    const c = categoryFor(row, data, w.groupBy, w, false)
    return !w.hidden.includes(c.key) && !w.hidden.includes(c.name)
  })
  const groups = new Map<string, { name: string; records: RecordRow[] }>()
  for (const [i, row] of ordered.entries()) {
    const label = categoryFor(row, data, w.labelField, w, false), key = w.gridMode === 'records' ? String(i) : label.key
    const node = groups.get(key) ?? { name: label.name, records: [] }
    node.records.push(row); groups.set(key, node)
  }
  const names = new Map<string, number>()
  for (const group of groups.values()) names.set(group.name, (names.get(group.name) ?? 0) + 1)
  return [...groups.entries()].slice(0, w.limit).map(([key, group]) => {
    const records = group.records, categories = distinct(records, w.groupBy), details = distinct(records, w.detailField)
    const times = records.map(r => r.time).filter((time): time is string => typeof time === 'string' && Number.isFinite(Date.parse(time))).sort((a, b) => Date.parse(a) - Date.parse(b))
    const name = w.gridMode === 'groups' && names.get(group.name)! > 1 ? `${group.name} · ${String(JSON.parse(key)[1]).slice(-8)}` : group.name
    return { key, name, category: categories.length === 1 ? categories[0] : 'Mixed', detail: details.length === 1 ? details[0] : 'Mixed', count: records.length, time: times.at(-1) ?? null, values: Object.fromEntries(w.metrics.map(m => [m, aggregate(records, m, metricOperation(w, m))])), records }
  })
}

/** One rendering model for the editor and public viewer. Public mode contains only displayed evidence. */
export function prepareWidget(data: Dataset, w: Widget, publicView = false): Presentation {
  if (publicView && !data.available) return { available: false, complete: false, fetchedAt: data.fetchedAt, freshness: data.freshness, emptyReason: data.emptyReason, warnings: [], total: 0, matching: 0, fields: [], rows: [], nodes: [], cards: [], chart: { points: [], visible: [], allCount: 0, series: [], isDate: false, split: false, units: [], partitionCount: 0, visiblePartitions: 0 } }
  const rows = filterRows(data, w), model = chartModel(rows, data, w)
  const columns = w.columns.length ? w.columns : defaultColumns(w.source)
  const displayed = w.view === 'table' ? sortRows(rows, w).slice(0, w.limit) : []
  const nodes = w.view === 'grid' ? gridNodes(rows, data, w) : []
  const cards = w.view !== 'kpi' ? [] : (w.kpiMode === 'groups' ? model.visible.map(g => ({ key: g.key, name: g.name, rows: model.members.get(g.key)! })) : [{ key: 'total', name: 'All matching records', rows }])
    .map(g => ({ key: g.key, name: g.name, values: Object.fromEntries(w.metrics.map(m => [m, aggregate(g.rows, m, metricOperation(w, m))])) }))
  const chartView = !['table', 'grid', 'kpi'].includes(w.view)
  const singleMeasure = ['donut', 'pie', 'treemap'].includes(w.view)
  const series = model.series.filter(s => !singleMeasure || s.metric === w.metrics[0])
  const units = [...new Set(series.map(s => data.fields.find(f => f.key === s.metric)?.unit ?? 'number'))]
  const hasChart = chartView && series.length > 0 && units.length <= 1
  const fields = publicView ? data.fields.filter(f => w.view === 'table' ? columns.includes(f.key) : w.metrics.includes(f.key as Widget['metrics'][number]) || ['groupBy', 'detailField', 'labelField'].some(key => w[key as 'groupBy'] === f.key)).map(({ key, label, type, unit }) => ({ key, label, type, unit })) : data.fields
  // Never send filtered-out records, hidden columns, raw source diagnostics, IDs embedded
  // in grouping keys, or the original rows behind an aggregate to a shared viewer.
  return {
    available: data.available, complete: data.complete, fetchedAt: data.fetchedAt, freshness: data.freshness, emptyReason: data.emptyReason,
    contextLabel: w.source === 'forecast' && rows.length ? String(rows[0].repository ?? rows[0].name) : undefined,
    warnings: publicView ? data.complete ? [] : ['Collection is incomplete. Totals may be lower than the full environment.'] : data.warnings,
    total: publicView ? rows.length : data.rows.length, matching: rows.length, fields,
    rows: publicView ? displayed.map(row => Object.fromEntries(columns.map(key => [key, row[key] ?? null]))) : displayed,
    nodes: nodes.map((node, i) => publicView ? { ...node, key: String(i), records: undefined } : node),
    cards: cards.map((card, i) => publicView ? { ...card, key: String(i) } : card),
    chart: {
      points: hasChart ? model.points.map((point, i) => publicView ? { key: String(i), name: point.name, ...Object.fromEntries([...(singleMeasure ? [w.metrics[0]] : []), ...series.map(s => s.key)].map(key => [key, point[key] ?? null])) } : point) : [],
      visible: hasChart ? model.visible.map((point, i) => publicView ? { key: String(i), name: point.name, ...Object.fromEntries(!model.split && series.length === 1 ? [[series[0].metric, (point as RecordRow)[series[0].metric] ?? null]] : []) } : point) : [],
      allCount: model.all.length, series: chartView && (!publicView || hasChart) ? series.map((s, i) => publicView ? { ...s, id: String(i) } : s) : [],
      isDate: !!model.isDate, split: model.split, units, partitionCount: model.partitionCount, visiblePartitions: model.visiblePartitions,
    },
  }
}

export function publicWidget(w: Widget): Widget {
  return { ...w, repositoryId: '', query: '', searchField: '*', filters: [], hidden: [], hiddenSeries: [], seriesNames: {}, sort: '', metricNames: Object.fromEntries(w.metrics.map(m => [m, w.metricNames[m] ?? ''])) }
}
