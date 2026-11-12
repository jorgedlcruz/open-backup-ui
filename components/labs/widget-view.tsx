'use client'
// Open Backup UI v1.2.0

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, Treemap, XAxis, YAxis } from 'recharts'
import { AlertCircle, ArrowDownUp, Database, X } from 'lucide-react'
import { categoryColor, metricOperation, palettes, type Dataset, type Field, type RecordRow, type Widget } from '@/lib/labs/model'
import { prepareWidget, type GridNode, type Presentation } from '@/lib/labs/presentation'
import { defaultColumns } from '@/lib/labs/catalog'
import { useI18n } from '@/components/providers/i18n-provider'
import { SourceIcon } from './icons'
import styles from './labs.module.css'

export function formatValue(value: unknown, field?: Field, locale = 'en') {
  if (value == null) return '—'
  if (field?.type === 'date') return Number.isFinite(Date.parse(String(value))) ? new Date(String(value)).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '—'
  if (typeof value !== 'number') return String(value)
  if (field?.unit === 'bytes') {
    const unit = value === 0 ? 0 : Math.max(0, Math.min(4, Math.floor(Math.log(Math.abs(value)) / Math.log(1024))))
    return `${(value / 1024 ** unit).toLocaleString(locale, { maximumFractionDigits: 1 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}${field?.unit === 'percent' ? '%' : field?.unit === 'seconds' ? ' s' : field?.unit === 'gb' ? ' GB' : field?.unit === 'gb-day' ? ' GB/d' : field?.unit === 'days' ? ' d' : ''}`
}

function MosaicTile({ x = 0, y = 0, width = 0, height = 0, depth, name, annotation, fill }: { x?: number; y?: number; width?: number; height?: number; depth?: number; name?: string; annotation?: string; fill?: string }) {
  if (depth !== 1) return null
  return <g><title>{annotation || name}</title><rect x={x + 2} y={y + 2} width={Math.max(0, width - 4)} height={Math.max(0, height - 4)} rx={8} fill={fill} />
    {width > 65 && height > 35 && <text x={x + 10} y={y + 22} fill="var(--foreground)" stroke="var(--background)" strokeWidth={2} paintOrder="stroke" strokeLinejoin="round" fontSize={11}>{(annotation || name || '').slice(0, Math.floor((width - 20) / 6))}</text>}
  </g>
}

export function WidgetView({ widget, data, prepared, readOnly = false, refreshing = false, onChange }: { widget: Widget; data?: Dataset | Error; prepared?: Presentation; readOnly?: boolean; refreshing?: boolean; onChange?: (patch: Partial<Widget>) => void }) {
  const { t, locale } = useI18n()
  const [inspected, setInspected] = useState<GridNode | null>(null)
  useEffect(() => setInspected(null), [widget.view, widget.source, data, prepared])
  const presentation = useMemo(() => prepared ?? (data && !(data instanceof Error) ? prepareWidget(data, widget) : null), [prepared, data, widget])
  if (!data && !prepared) return <div className={styles.dataState} role="status"><span className={styles.loadingOrbit} />{t('Gathering evidence…')}</div>
  if (presentation?.emptyReason) return <div className={styles.dataState} role="status"><Database size={23} /><strong>{t(presentation.emptyReason === 'cache-empty' ? 'Waiting for cached evidence' : presentation.emptyReason === 'repository-missing' ? 'Repository unavailable' : 'No forecast available yet')}</strong><span>{t(presentation.emptyReason === 'cache-empty' ? 'The background collector has not saved a forecast yet. Auto-refresh will pick it up when ready.' : presentation.emptyReason === 'repository-missing' ? 'The selected repository is no longer in this cached snapshot.' : 'This repository does not yet have enough usable evidence for this forecast basis.')}</span></div>
  if (data instanceof Error || !presentation?.available) return <div className={styles.dataState} role="alert"><AlertCircle size={23} /><strong>{t('Source unavailable')}</strong><span>{t(data instanceof Error ? data.message : 'This source did not report usable evidence. Refresh to retry.')}</span>{!readOnly && <Link className={styles.textButton} href="/connect">{t('Manage connections')} ↗</Link>}</div>
  const model = presentation.chart, displayed = presentation.rows
  const colors = palettes[widget.palette]
  const field = (key: string) => presentation.fields.find(f => f.key === key)
  const value = (v: unknown, key: string) => formatValue(v, field(key), locale)
  const measure = (key: string) => widget.metricNames[key]?.trim() || t(key === 'count' ? 'Record count' : field(key)?.label ?? key)
  const category = (name: string) => model.isDate && Number.isFinite(Date.parse(name)) ? new Date(name).toLocaleString(locale, { month: 'short', day: 'numeric', ...(widget.bucket === 'hour' ? { hour: '2-digit' as const } : {}), timeZone: 'UTC' }) : name
  const annotation = (name: string, v: unknown, metric: string) => widget.labelMode === 'name' ? name : widget.labelMode === 'value' ? value(v, metric) : `${name} · ${value(v, metric)}`
  const chartData = model.points.map(r => ({ ...r, label: category(r.name), ...Object.fromEntries(model.series.map((s, i) => [`a${i}`, annotation(category(r.name), r[s.key], s.metric)])) }))
  const columns = (widget.columns.length ? widget.columns : defaultColumns(widget.source)).map(field).filter((f): f is Field => !!f)
  const categorical = ['donut', 'pie', 'treemap'].includes(widget.view) || widget.view === 'bar' && model.series.length === 1 && !model.split
  const firstMetric = ['donut', 'pie', 'treemap'].includes(widget.view) ? widget.metrics[0] : model.series[0]?.metric ?? widget.metrics[0]
  const legendEntries = categorical ? model.visible.map((g, i) => ({ id: g.key, name: category(g.name), value: value((g as RecordRow)[firstMetric], firstMetric), color: categoryColor(g.name, i, widget.palette) }))
    : model.series.map(s => ({ id: s.id, name: t(s.name), value: value(s.value, s.metric), color: categoryColor(s.name, s.colorIndex, widget.palette) }))
  const legend = widget.legend && <div className={styles.seriesLegend} aria-label={t('Names and values')}>{legendEntries.map(entry => <div key={entry.id}><i style={{ background: entry.color }} /><span>{entry.name}</span>{widget.legendValues && <strong>{entry.value}</strong>}</div>)}</div>
  const tooltip = <Tooltip content={({ active, payload, label }) => !active || !payload?.length ? null : <div className={styles.chartTooltip}><strong>{String(categorical ? payload[0].payload.label ?? payload[0].name : label ?? '')}</strong>{payload.map((item, i) => {
    const series = model.series.find(s => s.key === item.dataKey)
    return <div key={i}><span>{series ? t(series.name) : measure(firstMetric)}</span><b>{value(item.value, series?.metric ?? firstMetric)}</b></div>
  })}</div>} />
  const shortName = (v: unknown) => String(v).length > 18 ? String(v).slice(0, 17) + '…' : String(v)
  const numericAxis = { tick: { fontSize: 10, fill: 'var(--labs-muted)' }, axisLine: false, tickLine: false, tickFormatter: (v: unknown) => value(v, model.series[0]?.metric ?? firstMetric) }
  // Recharts discovers axes among direct children. Keep these flat, including conditional axes.
  const axes = [<CartesianGrid key="grid" stroke="var(--labs-line)" strokeDasharray="3 5" vertical={false} />, ...(widget.view === 'bar' && widget.horizontal ? [<XAxis key="x" type="number" {...numericAxis} />, <YAxis key="y" type="category" dataKey="label" width={135} tick={{ fontSize: 10, fill: 'var(--labs-muted)' }} tickFormatter={shortName} axisLine={false} tickLine={false} interval={0} />] : [<XAxis key="x" dataKey="label" tick={{ fontSize: 10, fill: 'var(--labs-muted)' }} axisLine={false} tickLine={false} tickFormatter={shortName} minTickGap={20} />, <YAxis key="y" width={65} {...numericAxis} />])]
  const labels = (i: number) => widget.labels ? <LabelList dataKey={`a${i}`} position={widget.view === 'bar' && widget.horizontal ? 'right' : 'top'} fontSize={10} fill="var(--labs-muted)" /> : null
  let content
  if (!presentation.matching) content = <div className={styles.dataState}><Database size={22} /><strong>{t(presentation.total ? 'No matching records' : 'No records reported')}</strong><span>{t(readOnly ? 'This published view currently has no matching records.' : presentation.total ? 'Adjust the search or filters to reveal your data.' : 'This source returned an empty collection.')}</span></div>
  else if (widget.view === 'kpi') {
    const separate = widget.kpiMode === 'total' && widget.metrics.length > 1
    const cards = presentation.cards.flatMap(card => separate ? widget.metrics.map(metric => ({ ...card, key: `${card.key}:${metric}`, name: measure(metric), metrics: [metric] })) : [{ ...card, metrics: widget.metrics }])
    content = <div className={styles.namedKpis}>{cards.map(card => <div key={card.key}><h4>{category(card.name)}</h4>{card.metrics.map(metric => <div className={styles.kpiValue} key={metric}>{!separate && <span>{measure(metric)}</span>}<strong style={{ color: colors[widget.metrics.indexOf(metric) % colors.length] }}>{value(card.values[metric], metric)}</strong><small>{t(metric === 'count' ? 'Matching records' : metricOperation(widget, metric) === 'avg' ? 'Average of reported values' : metricOperation(widget, metric) === 'sum' ? 'Sum of reported values' : metricOperation(widget, metric) === 'min' ? 'Minimum reported value' : 'Maximum reported value')}</small></div>)}</div>)}</div>
  }
  else if (widget.view === 'table') content = <div className={styles.tableScroll}><table className={styles.table} data-density={widget.density}><thead><tr>{columns.map(f => <th key={f.key}>{readOnly ? t(f.label) : <button onClick={() => onChange?.({ sort: f.key, direction: widget.sort === f.key && widget.direction === 'asc' ? 'desc' : 'asc' })}>{t(f.label)}<ArrowDownUp size={10} /></button>}</th>)}</tr></thead><tbody>{displayed.map((row, i) => <tr key={String(row.id ?? i)}>{columns.map(f => <td key={f.key} title={value(row[f.key], f.key)}>{value(row[f.key], f.key)}</td>)}</tr>)}</tbody></table></div>
  else if (widget.view === 'grid') {
    const NodeTag = readOnly ? 'div' : 'button'
    content = <div className={styles.nodeGrid} data-density={widget.density}>{presentation.nodes.map((node, i) => <NodeTag key={node.key} className={styles.node} data-readonly={readOnly} title={node.name} style={{ '--node-color': categoryColor(node.category, i, widget.palette) } as React.CSSProperties} onClick={readOnly ? undefined : () => setInspected(node)} aria-label={readOnly ? node.name : `${t('Inspect')} ${node.name}`}>
      <div className={styles.nodeHeading}><SourceIcon source={widget.source} size={18} /><strong>{node.name}</strong></div>
      <div className={styles.nodeMeta}><span className={styles.nodeStatus}><i />{t(node.detail)}</span><span>{node.count} {t(widget.source === 'malware' ? 'events' : widget.source === 'history' ? 'sessions' : 'records')}</span></div>
      {widget.labels && node.category !== node.detail && <small>{t(field(widget.groupBy)?.label ?? widget.groupBy)} · {t(node.category)}</small>}
      {widget.metrics.filter(m => m !== 'count').map(metric => <div className={styles.nodeMeasure} key={metric}><span>{measure(metric)}</span><strong>{value(node.values[metric], metric)}</strong></div>)}
      {node.time && <small>{t('Latest')} · {formatValue(node.time, { key: 'time', label: 'Time', type: 'date' }, locale)}</small>}
    </NodeTag>)}</div>
  }
  else if (model.units.length > 1) content = <div className={styles.dataState}><strong>{t('These measures use different units')}</strong><span>{t(readOnly ? 'Ask the owner to update this view.' : 'Choose measures with the same unit, or use KPI cards or a table to compare them accurately.')}</span></div>
  else if (!chartData.length || !model.series.length) content = <div className={styles.dataState}>{t(readOnly ? 'This published view has no visible series with reported values.' : 'No visible series with reported values. Adjust series or metrics.')}</div>
  else {
    let chart
    if (widget.view === 'donut' || widget.view === 'pie') chart = chartData.some(r => Number((r as RecordRow)[firstMetric]) > 0) ? <PieChart>{tooltip}<Pie data={chartData} dataKey={firstMetric} nameKey="label" innerRadius={widget.view === 'donut' ? '57%' : 0} outerRadius="78%" paddingAngle={2} stroke="var(--labs-surface)" strokeWidth={3} label={widget.labels ? entry => annotation(String(entry.label), entry[firstMetric], firstMetric) : false} isAnimationActive={false}>{chartData.map((r, i) => <Cell key={r.key} fill={categoryColor(r.name, i, widget.palette)} />)}</Pie></PieChart> : null
    else if (widget.view === 'treemap') chart = <Treemap data={chartData.map((r, i) => ({ ...r, name: r.label, annotation: widget.labels ? annotation(r.label, (r as RecordRow)[firstMetric], firstMetric) : r.label, fill: categoryColor(r.name, i, widget.palette) }))} dataKey={firstMetric} nameKey="name" content={<MosaicTile />} isAnimationActive={false}>{tooltip}</Treemap>
    else if (widget.view === 'radar') chart = <RadarChart data={chartData} outerRadius="70%"><PolarGrid stroke="var(--labs-line)" /><PolarAngleAxis dataKey="label" tick={{ fill: 'var(--labs-muted)', fontSize: 10 }} tickFormatter={shortName} />{model.series.map(s => <Radar key={s.id} name={s.name} dataKey={s.key} stroke={categoryColor(s.name, s.colorIndex, widget.palette)} fill={categoryColor(s.name, s.colorIndex, widget.palette)} fillOpacity={.18} isAnimationActive={false} />)}{tooltip}</RadarChart>
    else if (widget.view === 'bar') chart = <BarChart data={chartData} layout={widget.horizontal ? 'vertical' : 'horizontal'} margin={{ top: 15, right: widget.labels ? 70 : 15, bottom: 0, left: 0 }}>{axes}{tooltip}{model.series.map((s, i) => <Bar key={s.id} name={s.name} dataKey={s.key} fill={categoryColor(s.name, s.colorIndex, widget.palette)} radius={3} stackId={widget.stacked ? 'stack' : undefined} isAnimationActive={false}>{categorical && chartData.map((r, j) => <Cell key={r.key} fill={categoryColor(r.name, j, widget.palette)} />)}{labels(i)}</Bar>)}</BarChart>
    else if (widget.view === 'line') chart = <LineChart data={chartData} margin={{ top: 18, right: 18, bottom: 0, left: 0 }}>{axes}{tooltip}{model.series.map((s, i) => <Line key={s.id} name={s.name} type={widget.smooth ? 'monotone' : 'linear'} dataKey={s.key} stroke={categoryColor(s.name, s.colorIndex, widget.palette)} strokeWidth={2.5} strokeDasharray={widget.source === 'forecast' && ['projected', 'peak'].includes(s.metric) ? '5 4' : undefined} dot={chartData.length < 30} connectNulls={false} isAnimationActive={false}>{labels(i)}</Line>)}</LineChart>
    else chart = <AreaChart data={chartData} margin={{ top: 18, right: 18, bottom: 0, left: 0 }}>{axes}{tooltip}{model.series.map((s, i) => <Area key={s.id} name={s.name} type={widget.smooth ? 'monotone' : 'linear'} dataKey={s.key} stroke={categoryColor(s.name, s.colorIndex, widget.palette)} fill={categoryColor(s.name, s.colorIndex, widget.palette)} fillOpacity={.15} strokeWidth={2} strokeDasharray={widget.source === 'forecast' && ['projected', 'peak'].includes(s.metric) ? '5 4' : undefined} stackId={widget.stacked ? 'stack' : undefined} connectNulls={false} isAnimationActive={false}>{labels(i)}</Area>)}</AreaChart>
    content = <div className={styles.chartBody}>
      <div className={styles.chartCaption}>{widget.metrics.map(metric => <span key={metric}>{measure(metric)}{metric !== 'count' && ` · ${t({ sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum' }[metricOperation(widget, metric)])}`}</span>)}</div>
      <div className={styles.chartPlot}><div style={{ height: '100%', minHeight: widget.view === 'bar' && widget.horizontal ? chartData.length * 28 + 45 : 0 }}>
        {chart ? <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer> : <div className={styles.dataState}>{t('No positive values to draw. Reported values are listed below.')}</div>}
      </div></div>
      {legend}
    </div>
  }
  return <div className={styles.visualization}>
    {widget.source === 'forecast' && <div className={styles.forecastContext}><strong>{presentation.contextLabel}</strong><span>{t(widget.forecastMode === 'files' ? 'Modeled backups only · retained file dates are not disk history' : 'Recorded volume usage · dashed lines are projections')} · {t('{count} days', { count: widget.horizon })}</span></div>}
    <div className={styles.plot}>{content}</div>
    {inspected && <div className={styles.recordDetail}><button aria-label={t('Close record')} onClick={() => setInspected(null)}><X size={16} /></button><strong>{inspected.name}</strong><p>{inspected.count} {t('records')} · {t('Showing up to 20 records. Use a table to explore more.')}</p>{inspected.records?.slice(0, 20).map((row, i) => <details key={i} open={i === 0}><summary>{String(row.name ?? inspected.name)}{row.time && ` · ${value(row.time, 'time')}`}</summary><dl>{presentation.fields.map(f => <div key={f.key}><dt>{t(f.label)}</dt><dd>{value(row[f.key], f.key)}</dd></div>)}</dl></details>)}</div>}
    <div className={styles.evidence} title={presentation.warnings.map(w => t(w)).join('\n')}><span data-partial={!presentation.complete || presentation.freshness?.stale}>{t(presentation.freshness?.stale ? 'Stale cache' : presentation.complete ? 'Reported evidence' : 'Partial evidence')}{presentation.warnings.length ? ` · ${presentation.warnings.length} ${t('source notices')}` : ''}</span><span>{widget.view === 'grid' ? `${presentation.nodes.length} ${t(widget.gridMode === 'groups' ? 'cards' : 'records')} · ${presentation.matching} ${t('records')}` : widget.view === 'table' ? `${displayed.length} / ${presentation.matching}` : `${presentation.matching} ${t('records')}`}{!['table', 'grid', 'kpi'].includes(widget.view) && ` · ${model.visible.length}/${model.allCount} ${t('groups')}`}{model.split && ` · ${model.visiblePartitions}/${model.partitionCount} ${t('series')}`}</span><span>{t(presentation.freshness?.cached ? 'Cached' : 'Fetched')} · {formatValue(presentation.fetchedAt, { key: 'time', label: 'Time', type: 'date' }, locale)}{(refreshing || presentation.freshness?.refreshing) && ` · ${t('Refreshing…')}`}</span></div>
  </div>
}
