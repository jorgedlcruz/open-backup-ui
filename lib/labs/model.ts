// Open Backup UI v1.0.2
import { z } from 'zod'
import { defaultColumns, fieldsFor, type Field } from './catalog'
import { CANVAS_WIDTH, CANVAS_HEIGHT, MAX_CANVAS_HEIGHT, normalizeLayout } from './layout'
export { CANVAS_WIDTH, CANVAS_HEIGHT } from './layout'
export type { Field } from './catalog'

export const LABS_COOKIE = 'open-backup-ui-labs'
/** Local layout identity also works on trusted LAN HTTP origins (no randomUUID there). */
export function newWidgetId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export const sources = [
  { id: 'protected', name: 'Protected Data', detail: 'Every backup copy, its size and recovery coverage.', family: 'Protection' },
  { id: 'objects', name: 'Protected Objects', detail: 'One node per workload, across its backup copies.', family: 'Protection' },
  { id: 'history', name: 'Job History', detail: 'Protection sessions, outcomes and duration over time.', family: 'Activity' },
  { id: 'jobs', name: 'Current Job State', detail: 'Live job status, progress, schedules and destinations.', family: 'Activity' },
  { id: 'malware', name: 'Malware Events', detail: 'Reported detections, severity and resolution state.', family: 'Security' },
  { id: 'repositories', name: 'Repository Capacity', detail: 'Measured capacity and space across storage extents.', family: 'Infrastructure' },
  { id: 'security', name: 'Security Posture', detail: 'Reported best practices and their current status.', family: 'Security' },
  { id: 'forecast', name: 'Capacity Forecast', detail: 'Choose a repository and display its cached history and projection.', family: 'Planning' },
  { id: 'runway', name: 'Repository Runway', detail: 'Cached growth, 30 / 60 / 90 day usage and time to 80%.', family: 'Planning' },
  { id: 'footprint', name: 'Backup Footprint', detail: 'Cached backup file sizes, retention and modeled future footprint.', family: 'Planning' },
  { id: 'retention', name: 'Retention Evidence', detail: 'Cached file categories, chain dependencies and configured hold windows.', family: 'Planning' },
  { id: 'hygiene', name: 'Backup Hygiene', detail: 'Cached recovery age, missing job references and findings to review.', family: 'Protection' },
  { id: 'overview', name: 'Operations Summary', detail: 'Active jobs, failures, success rate, storage risk and security counts.', family: 'Activity' },
  { id: 'proxies', name: 'Backup Proxies', detail: 'Readiness, task limits, transport modes and managed hosts.', family: 'Infrastructure' },
  { id: 'servers', name: 'Managed Servers', detail: 'Reported server status, updates and infrastructure roles.', family: 'Infrastructure' },
  { id: 'licenses', name: 'License Health', detail: 'Entitlement usage, expiry, support and licensing findings.', family: 'Infrastructure' },
] as const
export type SourceId = typeof sources[number]['id']
export const views = [
  { id: 'grid', name: 'Object grid' }, { id: 'table', name: 'Simple table' },
  { id: 'donut', name: 'Donut' }, { id: 'pie', name: 'Pie' },
  { id: 'bar', name: 'Bar chart' }, { id: 'line', name: 'Line chart' },
  { id: 'area', name: 'Time series' }, { id: 'kpi', name: 'KPI' },
  { id: 'treemap', name: 'Mosaic' }, { id: 'radar', name: 'Radar' },
] as const
export type ViewId = typeof views[number]['id']
export type RecordRow = Record<string, string | number | null>
export type Dataset = { rows: RecordRow[]; fields: Field[]; available: boolean; complete: boolean; warnings: string[]; fetchedAt: string; sourceName: string; repositories?: {id: string; name: string}[]; freshness?: { cached: boolean; stale: boolean; refreshing: boolean }; emptyReason?: 'cache-empty' | 'repository-missing' | 'no-projection' }
export const cachedSources = ['forecast', 'runway', 'footprint', 'retention', 'hygiene'] as const
export const isCachedSource = (source: string): source is typeof cachedSources[number] => (cachedSources as readonly string[]).includes(source)
const metricSchema = z.string().min(1).max(80)
const aggregateSchema = z.enum(['sum', 'avg', 'min', 'max'])
const numeric = (min: number, max: number) => z.number().finite().min(min).max(max)
export const filterSchema = z.object({ field: z.string().max(80), op: z.enum(['contains', 'equals', 'not', 'gt', 'lt', 'empty']), value: z.string().max(300) })
export type Filter = z.infer<typeof filterSchema>
export const widgetSchema = z.object({
  id: z.string().min(1).max(80), title: z.string().max(120), source: z.enum(['protected', 'objects', 'history', 'jobs', 'malware', 'repositories', 'security', 'forecast', 'runway', 'footprint', 'retention', 'hygiene', 'overview', 'proxies', 'servers', 'licenses']),
  view: z.enum(['grid', 'table', 'donut', 'pie', 'bar', 'line', 'area', 'kpi', 'treemap', 'radar']),
  x: numeric(0, CANVAS_WIDTH - 240), y: numeric(0, MAX_CANVAS_HEIGHT - 200), w: numeric(240, CANVAS_WIDTH), h: numeric(200, CANVAS_HEIGHT),
  range: z.enum(['24h', '7d', '30d']), query: z.string().max(300), searchField: z.string().max(80),
  repositoryId: z.string().max(80).default(''), forecastMode: z.enum(['capacity', 'files']).default('capacity'), horizon: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(30),
  filters: z.array(filterSchema).max(12), columns: z.array(z.string().max(80)).max(30),
  groupBy: z.string().max(80), metrics: z.array(metricSchema).min(1).max(4),
  aggregate: aggregateSchema, bucket: z.enum(['hour', 'day', 'week']),
  splitBy: z.string().max(80).default(''), seriesLimit: numeric(1, 24).int().default(12),
  hiddenSeries: z.array(z.string().max(2000)).max(500).default([]),
  seriesNames: z.record(z.string().max(2000), z.string().max(120)).default({}),
  metricNames: z.record(z.string().max(80), z.string().max(80)).default({}),
  metricAggregates: z.record(z.string().max(80), aggregateSchema).default({}),
  legendValues: z.boolean().default(true), labelMode: z.enum(['name', 'value', 'name-value']).default('name-value'),
  labelField: z.string().max(80).default('name'), detailField: z.string().max(80).default('status'),
  gridMode: z.enum(['groups', 'records']).default('groups'),
  kpiMode: z.enum(['total', 'groups']).default('total'), horizontal: z.boolean().default(false),
  hidden: z.array(z.string().max(2000)).max(500), sort: z.string().max(80), direction: z.enum(['asc', 'desc']),
  limit: numeric(1, 500).int(), palette: z.enum(['brand', 'atelier', 'ocean', 'ember']), legend: z.boolean(), labels: z.boolean(),
  stacked: z.boolean(), smooth: z.boolean(), density: z.enum(['compact', 'comfortable']),
}).superRefine((value, ctx) => {
  if (value.x + value.w > CANVAS_WIDTH || value.y + value.h > MAX_CANVAS_HEIGHT) ctx.addIssue({ code: 'custom', message: 'Widget extends beyond the canvas.' })
  const catalog = fieldsFor(value.source), fields = catalog.map(f => f.key)
  if ([value.groupBy, value.labelField, value.detailField, ...value.columns, ...value.filters.map(f => f.field), ...(value.splitBy ? [value.splitBy] : []), ...(value.searchField === '*' ? [] : [value.searchField]), ...(value.sort ? [value.sort] : []), ...value.metrics.filter(m => m !== 'count')].some(key => !fields.includes(key))) ctx.addIssue({ code: 'custom', message: 'A widget field does not belong to its source.' })
  if (value.splitBy && catalog.find(f => f.key === value.splitBy)?.type !== 'text') ctx.addIssue({ code: 'custom', message: 'Series must use a categorical field.' })
  if (value.metrics.some(key => key !== 'count' && !catalog.some(f => f.key === key && f.type === 'number'))) ctx.addIssue({ code: 'custom', message: 'Choose a numeric measure.' })
  if ([...Object.keys(value.metricNames), ...Object.keys(value.metricAggregates)].some(key => key !== 'count' && !catalog.some(f => f.key === key && f.type === 'number'))) ctx.addIssue({ code: 'custom', message: 'Choose a numeric measure.' })
  if (new Set(value.metrics).size !== value.metrics.length || new Set(value.columns).size !== value.columns.length) ctx.addIssue({ code: 'custom', message: 'Measures and columns must be unique.' })
})
export type Widget = z.infer<typeof widgetSchema>
export const refreshSchema = z.object({ enabled: z.boolean(), seconds: z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(300), z.literal(600)]) })
export const boardSchema = z.object({ version: z.literal(3), name: z.string().min(1).max(100), widgets: z.array(widgetSchema).max(40), layout: z.object({ gap: numeric(20, 80).multipleOf(20), locked: z.boolean() }).default({ gap: 20, locked: false }), refresh: refreshSchema.default({ enabled: false, seconds: 60 }) })
  .refine(board => new Set(board.widgets.map(w => w.id)).size === board.widgets.length, 'Duplicate widget IDs.')
export type Board = z.infer<typeof boardSchema>
export const emptyBoard = (): Board => ({ version: 3, name: 'Untitled exploration', widgets: [], layout: { gap: 20, locked: false }, refresh: { enabled: false, seconds: 60 } })
export const palettes = { brand: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'], atelier: ['#19766d', '#e4a53c', '#c6654c', '#7799ac', '#8c7fa8', '#688f43'], ocean: ['#287bba', '#33a3a1', '#7f81c2', '#e4aa62', '#ab6c91', '#748f9c'], ember: ['#c55b40', '#df9238', '#b9757c', '#6d7e51', '#a48c61', '#607e95'] }
export function categoryColor(name: string, index: number, palette: Widget['palette']) {
  if (palette === 'brand') {
    if (['Failed', 'Infected', 'Critical', 'Offline', 'No restore points'].includes(name)) return 'var(--ops-chart-danger)'
    if (['Success', 'Healthy', 'Restore points available', 'Passed'].includes(name)) return 'var(--ops-chart-success)'
    if (['Warning', 'Suspicious', 'Low space'].includes(name)) return 'var(--ops-chart-warning)'
    if (['Running', 'Working', 'Starting', 'Stopping'].includes(name)) return 'var(--ops-chart-active)'
    if (['Unknown', 'Not reported', 'Count not reported', 'Mixed'].includes(name)) return 'var(--muted-foreground)'
  }
  if (palette === 'atelier') {
    if (['Failed', 'Infected', 'Critical', 'Offline', 'No restore points'].includes(name)) return '#ce7058'
    if (['Success', 'Healthy', 'Restore points available', 'Passed'].includes(name)) return '#4d9a83'
    if (['Warning', 'Suspicious', 'Low space'].includes(name)) return '#dba84e'
    if (['Running', 'Working', 'Starting', 'Stopping'].includes(name)) return '#799fb9'
    if (['Unknown', 'Not reported', 'Count not reported'].includes(name)) return '#8a9690'
  }
  return palettes[palette][index % palettes[palette].length]
}
export function createWidget(source: SourceId, view: ViewId, box: Pick<Widget, 'x' | 'y' | 'w' | 'h'>, id: string): Widget {
  const category = source === 'history' ? 'jobName' : source === 'malware' ? 'severity' : 'name'
  const temporal = ['area', 'line'].includes(view) && ['history', 'jobs', 'malware'].includes(source)
  const columns = defaultColumns(source)
  const widget: Widget = { id, title: sources.find(s => s.id === source)!.name, source, view, x: box.x, y: box.y, w: box.w, h: box.h, range: '7d', query: '', searchField: '*', filters: [], columns, repositoryId: '', forecastMode: 'capacity', horizon: 30,
    groupBy: temporal ? 'time' : view === 'grid' ? 'status' : category,
    metrics: source === 'repositories' ? ['used'] : source === 'protected' || source === 'objects' ? ['size'] : ['count'], aggregate: 'sum', bucket: 'day', hidden: [], sort: '', direction: 'desc', limit: view === 'grid' || view === 'table' ? 100 : 12,
    splitBy: temporal && source === 'history' ? 'jobName' : '', seriesLimit: 12, hiddenSeries: [], seriesNames: {}, metricNames: {}, metricAggregates: {}, legendValues: true, labelMode: 'name-value', labelField: source === 'history' ? 'jobName' : 'name', detailField: 'status', kpiMode: 'groups', horizontal: view === 'bar',
    gridMode: 'groups', palette: 'brand', legend: true, labels: false, stacked: false, smooth: true, density: 'comfortable' }
  const defaults: Partial<Record<SourceId, string[]>> = { forecast: ['recorded', 'projected'], runway: ['used'], footprint: ['size'], retention: ['size'], hygiene: ['findings'], overview: ['active', 'attention', 'failedRuns', 'atRisk'], proxies: ['tasks'], servers: ['assignments'], licenses: ['utilization'] }
  if (defaults[source]) widget.metrics = defaults[source]!
  if (['pie', 'donut', 'treemap'].includes(view)) widget.metrics = widget.metrics.slice(0, 1)
  if (source === 'forecast') { widget.forecastMode = 'files'; widget.groupBy = ['line', 'area', 'table'].includes(view) ? 'time' : 'name'; widget.limit = 500; widget.smooth = false; widget.legendValues = false; widget.aggregate = ['kpi', 'grid', 'bar'].includes(view) ? 'max' : 'avg' }
  if (source === 'overview') { widget.range = '24h'; widget.kpiMode = 'total' }
  return widget
}
export function filterRows(data: Dataset, widget: Widget): RecordRow[] {
  const query = widget.query.trim().toLocaleLowerCase()
  const fields = new Map(data.fields.map(f => [f.key, f]))
  return data.rows.filter(row => {
    if (isCachedSource(widget.source) && widget.repositoryId && row.repositoryId !== widget.repositoryId) return false
    if (query && !(widget.searchField === '*' ? Object.values(row) : [row[widget.searchField]]).some(v => v != null && String(v).toLocaleLowerCase().includes(query))) return false
    return widget.filters.every(f => {
      const value = row[f.field], field = fields.get(f.field)
      if (!field) return false
      if (f.op === 'empty') return value == null || value === ''
      if (value == null) return false
      const a = String(value).toLocaleLowerCase(), b = f.value.toLocaleLowerCase()
      if (f.op === 'contains') return a.includes(b)
      if (f.op === 'equals') return a === b
      if (f.op === 'not') return a !== b
      const left = field.type === 'date' ? Date.parse(a) : Number(value), right = field.type === 'date' ? Date.parse(f.value) : f.value.trim() ? Number(f.value) : NaN
      return Number.isFinite(left) && Number.isFinite(right) && (f.op === 'gt' ? left > right : left < right)
    })
  })
}
export function sortRows(rows: RecordRow[], widget: Widget) {
  if (!widget.sort) return rows
  return [...rows].sort((a, b) => {
    const av = a[widget.sort], bv = b[widget.sort]
    if (av == null) return bv == null ? 0 : 1
    if (bv == null) return -1
    return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true })) * (widget.direction === 'asc' ? 1 : -1)
  })
}
export function aggregate(rows: RecordRow[], metric: string, operation: Widget['aggregate']): number | null {
  if (metric === 'count') return rows.length
  const values = rows.map(r => r[metric]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (!values.length) return null
  if (operation === 'min') return values.reduce((a, b) => Math.min(a, b))
  if (operation === 'max') return values.reduce((a, b) => Math.max(a, b))
  const total = values.reduce((a, b) => a + b, 0)
  return operation === 'avg' ? total / values.length : total
}
export const metricOperation = (w: Widget, metric: string) => w.metricAggregates[metric] ?? (['utilization', 'progress', 'successRate', 'growth'].includes(metric) ? 'avg' : ['days80', 'days', 'supportDays'].includes(metric) ? 'min' : w.aggregate)
export function categoryFor(row: RecordRow, data: Dataset, fieldKey: string, w: Widget, bucketDates = true) {
  const field = data.fields.find(f => f.key === fieldKey)
  let name = row[fieldKey] == null ? 'Not reported' : String(row[fieldKey])
  if (bucketDates && field?.type === 'date') {
    const time = Date.parse(name), width = w.bucket === 'hour' ? 3600000 : w.bucket === 'week' ? 604800000 : 86400000
    name = Number.isFinite(time) ? new Date(Math.floor(time / width) * width).toISOString() : 'Not reported'
  }
  const identity = field?.identityKey ? row[field.identityKey] ?? row.id ?? name : name
  return { key: JSON.stringify([fieldKey, String(identity)]), name }
}
export function groupRows(rows: RecordRow[], data: Dataset, widget: Widget) {
  const groups = new Map<string, RecordRow[]>()
  const names = new Map<string, string>()
  const isDate = widget.view !== 'grid' && data.fields.find(f => f.key === widget.groupBy)?.type === 'date'
  for (const row of rows) {
    const { key, name } = categoryFor(row, data, widget.groupBy, widget, widget.view !== 'grid')
    names.set(key, name)
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group)
  }
  const occurrences = new Map<string, number>()
  for (const name of names.values()) occurrences.set(name, (occurrences.get(name) ?? 0) + 1)
  const result = [...groups].map(([key, items]) => {
    const rawName = names.get(key)!, name = (occurrences.get(rawName) ?? 0) > 1 ? `${rawName} · ${String(JSON.parse(key)[1]).slice(-8)}` : rawName
    return { key, name, ...Object.fromEntries(widget.metrics.map(m => [m, aggregate(items, m, metricOperation(widget, m))])) }
  })
  const ordered = isDate ? result.sort((a, b) => a.name.localeCompare(b.name)) : result.sort((a, b) => {
    const av = (a as RecordRow)[widget.metrics[0]], bv = (b as RecordRow)[widget.metrics[0]]
    return (typeof bv === 'number' ? bv : -Infinity) - (typeof av === 'number' ? av : -Infinity) || a.name.localeCompare(b.name)
  })
  return { all: ordered, visible: ordered.filter(r => !widget.hidden.includes(r.key) && !widget.hidden.includes(r.name)).slice(0, widget.limit), isDate, members: groups }
}
export function parseBoard(raw: string): Board {
  if (raw.length > 500000) throw new Error('This canvas file is too large.')
  const value = JSON.parse(raw)
  if (value?.version === 1 || value?.version === 2) {
    value.version = 3
    if (Array.isArray(value.widgets)) for (const widget of value.widgets) if (widget?.palette === 'atelier') widget.palette = 'brand'
  }
  const result = boardSchema.safeParse(value)
  if (!result.success) throw new Error('This is not a valid Kiosk Builder canvas (version 1, 2 or 3, up to 40 widgets).')
  return { ...result.data, widgets: normalizeLayout(result.data.widgets, result.data.layout.gap) }
}
export function fitBox(box: Pick<Widget, 'x' | 'y' | 'w' | 'h'>) {
  const snap = (v: number) => Math.round(v / 20) * 20
  const w = Math.max(240, Math.min(CANVAS_WIDTH, snap(box.w))), h = Math.max(200, Math.min(CANVAS_HEIGHT, snap(box.h)))
  return { x: Math.max(0, Math.min(CANVAS_WIDTH - w, snap(box.x))), y: Math.max(0, Math.min(CANVAS_HEIGHT - h, snap(box.y))), w, h }
}
