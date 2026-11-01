import { aggregate, categoryFor, groupRows, metricOperation, type Dataset, type RecordRow, type Widget } from './model'

export type Series = { id: string; key: string; name: string; metric: string; value: number | null; colorIndex: number }
export const metricName = (data: Dataset, w: Widget, metric: string) => w.metricNames[metric]?.trim() || (metric === 'count' ? 'Record count' : data.fields.find(f => f.key === metric)?.label ?? metric)
export function chartModel(rows: RecordRow[], data: Dataset, w: Widget) {
  const groups = groupRows(rows, data, w)
  const split = !!w.splitBy && ['bar', 'line', 'area', 'radar'].includes(w.view)
  const sourceRows = groups.visible.flatMap(group => groups.members.get(group.key) ?? [])
  const partitionGroups = split ? groupRows(sourceRows, data, { ...w, groupBy: w.splitBy, view: 'grid', metrics: ['count'], hidden: [], limit: 500 }) : null
  const partitions = partitionGroups?.all ?? []
  const definitions = w.metrics.flatMap<{ metric: string; partition: { key: string; name: string } | null }>(metric => split ? partitions.map(partition => ({ metric, partition })) : [{ metric, partition: null }])
  const allSeries: Series[] = definitions.map(({ metric, partition }, index) => {
    const id = JSON.stringify([metric, partition?.key ?? ''])
    const members = partition ? partitionGroups!.members.get(partition.key)! : sourceRows
    const name = partition ? `${partition.name}${w.metrics.length > 1 ? ` · ${metricName(data, w, metric)}` : ''}` : metricName(data, w, metric)
    return { id, key: `v${index}`, name: w.seriesNames[id]?.trim() || name, metric, value: aggregate(members, metric, metricOperation(w, metric)), colorIndex: index }
  })
  const enabledPartitions = new Set(allSeries.filter(s => !w.hiddenSeries.includes(s.id)).map(s => JSON.parse(s.id)[1]))
  const visiblePartitions = new Set(partitions.filter(p => enabledPartitions.has(p.key)).slice(0, w.seriesLimit).map(p => p.key))
  const series = allSeries.filter(s => !w.hiddenSeries.includes(s.id) && (!split || visiblePartitions.has(JSON.parse(s.id)[1])))
  const points = groups.visible.map(group => {
    const members = groups.members.get(group.key) ?? []
    const values = Object.fromEntries(series.map(s => {
      const partitionKey = JSON.parse(s.id)[1]
      const subset = split ? members.filter(row => categoryFor(row, data, w.splitBy, w, false).key === partitionKey) : members
      // Missing series samples remain gaps. They never become invented healthy zeroes.
      return [s.key, subset.length ? aggregate(subset, s.metric, metricOperation(w, s.metric)) : null]
    }))
    return { ...group, ...values } as RecordRow & { key: string; name: string }
  })
  const units = new Set(series.map(s => data.fields.find(f => f.key === s.metric)?.unit ?? 'number'))
  return { ...groups, points, series, allSeries, split, units, partitionCount: partitions.length, visiblePartitions: visiblePartitions.size }
}

export function recommendedViews(source: Widget['source']): { name: string; detail: string; patch: Partial<Widget> }[] {
  if (source === 'forecast') return [
    { name: 'History and forecast', detail: 'Daily observations and a dashed projection for the selected repository.', patch: { view: 'line', groupBy: 'time', splitBy: '', metrics: ['recorded', 'projected'], aggregate: 'avg', bucket: 'day', limit: 500, smooth: false, legendValues: false } },
    { name: 'Capacity ceiling', detail: 'Recorded volume usage, its projected trend and reported capacity.', patch: { view: 'line', forecastMode: 'capacity', groupBy: 'time', splitBy: '', metrics: ['recorded', 'projected', 'capacity'], aggregate: 'avg', bucket: 'day', limit: 500, smooth: false, legendValues: false } },
    { name: 'Retention scenario', detail: 'Modeled file footprint and daily peak before retention; excludes unmodeled backups.', patch: { view: 'line', forecastMode: 'files', groupBy: 'time', splitBy: '', metrics: ['recorded', 'projected', 'peak'], aggregate: 'avg', bucket: 'day', limit: 500, smooth: false, legendValues: false } },
  ]
  if (source === 'runway') return [
    { name: 'Repository runway', detail: 'Current utilization, growth and estimated days to 80%.', patch: { view: 'table', columns: ['name', 'status', 'utilization', 'growth', 'days80', 'projected30', 'projected60', 'projected90'] } },
    { name: 'Future usage', detail: 'Compare projected volume usage at 30, 60 and 90 days.', patch: { view: 'bar', groupBy: 'name', splitBy: '', metrics: ['projected30', 'projected60', 'projected90'], horizontal: true, stacked: false } },
  ]
  if (source === 'footprint') return [
    { name: 'Largest backups', detail: 'Rank reported backup file sizes by backup name.', patch: { view: 'bar', groupBy: 'name', splitBy: '', metrics: ['size'], horizontal: true, limit: 12 } },
    { name: 'Footprint inventory', detail: 'Backup names, repositories, modeled coverage and future file sizes.', patch: { view: 'table', columns: ['name', 'repository', 'job', 'status', 'size', 'projected30', 'projected60', 'projected90'] } },
  ]
  if (source === 'retention') return [
    { name: 'Retention categories', detail: 'Known file bytes by evidence category, not reclaimable disk space.', patch: { view: 'donut', groupBy: 'status', splitBy: '', metrics: ['size'] } },
    { name: 'Retention details', detail: 'File names, job policies and configured hold windows.', patch: { view: 'table', columns: ['name', 'repository', 'job', 'status', 'size', 'holdUntil', 'detail'] } },
  ]
  if (source === 'hygiene') return [
    { name: 'Backups to review', detail: 'Recovery age and findings without treating file dates as restore points.', patch: { view: 'table', columns: ['name', 'repository', 'job', 'status', 'age', 'issues'], sort: 'findings', direction: 'desc' } },
    { name: 'Recovery age', detail: 'Days since each backup’s latest verified restore point.', patch: { view: 'bar', groupBy: 'name', splitBy: '', metrics: ['age'], horizontal: true, aggregate: 'max' } },
  ]
  if (source === 'overview') return [
    { name: 'Operations pulse', detail: 'Active jobs, attention, failed sessions and repositories at risk.', patch: { view: 'kpi', groupBy: 'name', splitBy: '', kpiMode: 'total', metrics: ['active', 'attention', 'failedRuns', 'atRisk'] } },
    { name: 'Protection outcomes', detail: 'Completed sessions split by successful, warning and failed outcomes.', patch: { view: 'bar', groupBy: 'name', splitBy: '', metrics: ['successful', 'warningRuns', 'failedRuns'], stacked: true, horizontal: true } },
    { name: 'Success rate', detail: 'Completed protection sessions in the selected history window.', patch: { view: 'kpi', groupBy: 'name', splitBy: '', kpiMode: 'total', metrics: ['successRate', 'completed'] } },
  ]
  if (source === 'proxies') return [
    { name: 'Proxy readiness', detail: 'Proxy names with reported readiness and configured task limits.', patch: { view: 'grid', groupBy: 'status', labelField: 'name', detailField: 'status', metrics: ['tasks'] } },
    { name: 'Proxy inventory', detail: 'Host, transport, task limits and reported component state.', patch: { view: 'table', columns: ['name', 'status', 'host', 'transport', 'tasks', 'online', 'outdated'] } },
  ]
  if (source === 'servers') return [
    { name: 'Server updates', detail: 'Reported server status, update state and assigned infrastructure roles.', patch: { view: 'table', columns: ['name', 'type', 'status', 'updates', 'roles', 'deadline'] } },
    { name: 'Server role cards', detail: 'Each managed server with its reported update state and role count.', patch: { view: 'grid', groupBy: 'updates', labelField: 'name', detailField: 'updates', metrics: ['assignments'] } },
  ]
  if (source === 'licenses') return [
    { name: 'Entitlement utilization', detail: 'Compare percentages while preserving each entitlement name.', patch: { view: 'bar', groupBy: 'name', splitBy: '', metrics: ['utilization'], horizontal: true } },
    { name: 'Expiry and support', detail: 'Remaining license and support days by entitlement.', patch: { view: 'kpi', groupBy: 'name', splitBy: '', kpiMode: 'groups', metrics: ['days', 'supportDays'] } },
    { name: 'License inventory', detail: 'Entitlement units, consumption, expiry and reported findings.', patch: { view: 'table', columns: ['name', 'status', 'unit', 'consumed', 'licensed', 'expires', 'support', 'issues'] } },
  ]
  if (source === 'repositories') return [
    { name: 'Space by repository', detail: 'Repository names with used space.', patch: { view: 'bar', groupBy: 'name', metrics: ['used'], splitBy: '', horizontal: true, legend: true, legendValues: true } },
    { name: 'Used and free', detail: 'Compare both measures for each repository.', patch: { view: 'bar', groupBy: 'name', metrics: ['used', 'free'], splitBy: '', stacked: true, horizontal: true } },
    { name: 'Capacity cards', detail: 'A named KPI for every repository.', patch: { view: 'kpi', groupBy: 'name', metrics: ['used', 'capacity'], kpiMode: 'groups', splitBy: '' } },
  ]
  if (source === 'history') return [
    { name: 'Sessions by job', detail: 'Job names with session counts.', patch: { view: 'bar', groupBy: 'jobName', metrics: ['count'], splitBy: '', horizontal: true, legend: true, legendValues: true } },
    { name: 'Job trends', detail: 'Time on the X axis, one series per job.', patch: { view: 'line', groupBy: 'time', splitBy: 'jobName', metrics: ['count'] } },
    { name: 'Outcomes by job', detail: 'Each job split into its reported outcomes.', patch: { view: 'bar', groupBy: 'jobName', splitBy: 'status', metrics: ['count'], stacked: true, horizontal: true } },
  ]
  return [
    { name: 'Named values', detail: 'Show object names alongside the selected measure.', patch: { view: 'bar', groupBy: 'name', splitBy: '', horizontal: true, legend: true, legendValues: true } },
    { name: 'Named cards', detail: 'Keep each object name visible with its value.', patch: { view: 'kpi', groupBy: 'name', splitBy: '', kpiMode: 'groups' } },
  ]
}
