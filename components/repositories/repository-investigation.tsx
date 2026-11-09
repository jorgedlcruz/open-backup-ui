"use client"
// Open Backup UI v1.0.2

import { Trans } from '@/components/providers/i18n-provider'
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { Empty,Loading,Notice,Pager,Panel,SearchBox,Status,useEvidence,useRefresh } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { veeamApi } from '@/lib/api/veeam-client'
import { validId } from '@/lib/investigation/model'
import { jobStatus,repositoryRisk,utilization } from '@/lib/operations/model'
import { configuredImmutability,repositoryHref,yesNo,type RepositoryConfig,type RepositorySnapshot } from '@/lib/repositories/model'
import { useRecoveryPresentation } from '@/components/restore-points/use-presentation'
import { cn } from '@/lib/utils'
import { ArrowLeft,ArrowUpRight,Database,HardDrive,Layers,RefreshCw,ShieldCheck,TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useCallback,useState,type ReactNode } from 'react'
import styles from './repositories.module.css'

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'danger' | 'warning' | 'success' | 'neutral' | 'active' }) {
  return <span className={cn(ops.badge, ops[tone])}><span className={ops.dot} />{children}</span>
}
const healthTone = (health: string) => health === 'Offline' || health === 'Critical' ? 'danger' : health === 'Low space' || health === 'Outdated' ? 'warning' : health === 'Healthy' ? 'success' : 'neutral'
function Metric({ label, value, note, icon, tone }: { label: string; value: ReactNode; note: string; icon: ReactNode; tone?: string }) {
  return <div className={ops.metric}><div className={ops.metricLabel}>{label}<span className={ops.metricIcon}>{icon}</span></div><div className={cn(ops.metricValue, styles.metricValue, tone && ops[tone])}>{value}</div><p>{note}</p></div>
}
function Detail({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div> }
function Immutability({ config, parent }: { config: RepositoryConfig | null; parent: boolean }) {
  const { t, label } = useRecoveryPresentation()
  const evidence = configuredImmutability(config)
  const tone = ['Enabled', 'Configured'].includes(evidence.status) ? 'success' : evidence.status === 'Disabled' ? 'warning' : 'neutral'
  return <Panel title={t("Immutability")} subtitle={parent ? t("Review configuration on each extent below") : t("Repository configuration returned by VBR")} action={<ShieldCheck size={18} className={ops.neutral} />}>
    <div className={styles.protection}><Badge tone={tone}>{parent ? t("Defined per extent") : label(evidence.status)}</Badge><strong>{parent ? t("Extent policies") : label(evidence.period)}</strong><p>{parent ? t("A scale-out repository can contain extents with different immutability settings.") : label(evidence.evidence)}</p></div>
    {!parent && <dl className={styles.details}><Detail label={t("Policy mode")}>{label(evidence.mode)}</Detail><Detail label={t("File lock verification")}>{t("Not exposed by this API")}</Detail></dl>}
    <p className={ops.panelFoot}>{t("Configured retention does not verify that every file is currently locked. These endpoints do not report file lock expiry or safely reclaimable bytes. Investigate job and task logs for immutability errors.")}</p>
  </Panel>
}
function Capacity({ data, parent }: { data: RepositorySnapshot; parent: boolean }) {
  const { t, label, gb, formatNumber } = useRecoveryPresentation()
  const state = data.state, percent = state ? utilization(state) : null
  const health = state ? repositoryRisk(state) : 'Unknown'
  const settings = data.config?.repository, storage = data.config?.bucket || data.config?.container
  const taskEnabled = settings?.taskLimitEnabled ?? settings?.enableTaskLimit ?? data.config?.taskLimitEnabled
  const taskCount = settings?.maxTaskCount ?? data.config?.maxTaskCount
  const limit = storage?.storageConsumptionLimit
  if (parent) {
    const capacity = data.scaleOut?.capacityTier, archive = data.scaleOut?.archiveTier
    const days = (value?: number | null) => value != null && value >= 0 ? t('{count} days', { count: formatNumber(value) }) : t('Not reported')
    const tiers = ['Performance', 'Capacity', 'Archive']
    return <Panel title={t("Capacity & storage")} subtitle={t("Scale-out layout and tiering policies")} action={<Layers size={18} className={ops.neutral} />}>
      <div className={styles.capacity}><div className={styles.capacityNumber}><strong>{formatNumber(data.extents.length)}</strong><span>{t("storage extents")}</span></div><div className={cn(styles.capacityNumbers, styles.tiers)}>{tiers.map(tier => <div key={tier}><small>{t('{tier} tier', { tier: label(tier) })}</small><strong>{t('{count} extents', { count: formatNumber(data.extents.filter(e => e.tier.startsWith(tier)).length) })}</strong></div>)}</div></div>
      <dl className={styles.details}>
        <Detail label={t("Capacity tier")}>{label(yesNo(capacity?.isEnabled))}</Detail>
        <Detail label={t("Copy backups to capacity tier")}>{label(yesNo(capacity?.copyPolicyEnabled))}</Detail>
        <Detail label={t("Move inactive chains")}>{label(yesNo(capacity?.movePolicyEnabled))}</Detail>
        <Detail label={t("Operational restore window")}>{days(capacity?.operationalRestorePeriodDays)}</Detail>
        <Detail label={t("Archive tier")}>{label(yesNo(archive?.isEnabled))}</Detail>
        <Detail label={t("Archive after")}>{archive?.isEnabled === false ? t("Not applicable") : days(archive?.archivePeriodDays)}</Detail>
      </dl>
      <p className={ops.panelFoot}>{t("Inspect free space on each extent below. Capacity is not added across tiers or shared volumes; a parent total would conceal which storage location needs attention.")}</p>
    </Panel>
  }
  return <Panel title={t("Capacity & storage")} subtitle={parent ? t("Parent readings are shown separately from extent capacity") : t("Current repository readings from VBR")} action={<Badge tone={healthTone(health)}>{label(health)}</Badge>}>
    <div className={styles.capacity}>
      <div className={styles.capacityNumber}><strong className={ops[healthTone(health)]}>{percent === null ? t("Unmeasured") : formatNumber(percent / 100, { style: 'percent', maximumFractionDigits: 1 })}</strong><span>{t("used capacity")}</span></div>
      <div className={styles.capacityTrack} role={percent === null ? undefined : 'meter'} aria-label={t("Repository capacity used")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><span className={percent !== null && percent >= 90 ? ops.dangerBar : percent !== null && percent >= 80 ? ops.warningBar : ops.successBar} style={{ width: `${percent ?? 0}%` }} /></div>
      <div className={styles.capacityNumbers}><div><small><Trans>{"Free"}</Trans></small><strong>{gb(state?.freeGB)}</strong></div><div><small><Trans>{"Total"}</Trans></small><strong>{gb(state?.capacityGB)}</strong></div><div><small>{t("Reported used")}</small><strong>{gb(state?.usedSpaceGB)}</strong></div></div>
    </div>
    {state?.usedSpaceGB != null && state.capacityGB != null && state.capacityGB > 0 && state.usedSpaceGB > state.capacityGB && <div className={styles.inlineNotice}><Layers size={15} /><p>{t("Reported used bytes exceed volume capacity.")}{settings?.useFastCloningOnXFSVolumes === true && (" " + t("XFS Fast Clone is enabled."))} {t("File sizes can include shared blocks; use free capacity to assess storage headroom.")}</p></div>}
    <dl className={styles.details}>
      <Detail label={t("Availability")}><Badge tone={state?.isOnline === true ? 'success' : state?.isOnline === false ? 'danger' : 'neutral'}>{state?.isOnline === true ? t("Online") : state?.isOnline === false ? t("Offline") : t("Not reported")}</Badge></Detail>
      <Detail label={t("Components")}>{state?.isOutOfDate === true ? t("Update required") : state?.isOutOfDate === false ? t("Up to date") : t("Not reported")}</Detail>
      <Detail label={t("Host")}>{state?.hostName || (parent ? t("Multiple extents") : t("Not reported"))}</Detail>
      <Detail label={t("Path / container")}>{state?.path || settings?.path || [storage?.bucketName || storage?.containerName, storage?.folderName || storage?.folder].filter(Boolean).join('/') || t("Not reported")}</Detail>
      <Detail label={t("Concurrent task limit")}>{taskEnabled === false ? t("Unlimited (configured)") : taskEnabled === true && taskCount != null && taskCount > 0 ? t('{count} tasks', { count: formatNumber(taskCount) }) : t("Not reported")}</Detail>
      <Detail label={t("XFS Fast Clone")}>{label(yesNo(settings?.useFastCloningOnXFSVolumes))}</Detail>
      <Detail label={t("Per-VM backup files")}>{label(yesNo(settings?.advancedSettings?.perVmBackup))}</Detail>
      {limit && <Detail label={t("Object storage soft limit")}>{limit.isEnabled === false ? t("Disabled") : limit.isEnabled === true && limit.consumptionLimitCount != null ? t('{count} {unit}', { count: formatNumber(limit.consumptionLimitCount), unit: limit.consumptionLimitKind || t('Unit not reported') }) : t("Not reported")}</Detail>}
    </dl>
    <p className={ops.panelFoot}>{t("Capacity units are GB as reported by VBR. Utilization uses total minus free. Repositories may share a volume; their capacity readings must not be added together. Negative capacity values remain unmeasured.")}</p>
  </Panel>
}
function BackupTable({ data, parent }: { data: RepositorySnapshot; parent: boolean }) {
  const { t, label, size, date, formatNumber, diagnostic } = useRecoveryPresentation()
  const [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const rows = data.backups.data.filter(b => [b.name, b.repositoryName, b.jobType].join(' ').toLowerCase().includes(query.toLowerCase()))
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 8) - 1))
  return <Panel title={t("Backup consumption")} subtitle={parent ? t("Backups assigned to this scale-out repository or its extents") : t("Backups linked to this repository by repository ID")} action={<span className={ops.smallTag}>{data.backups.available ? t('{count} backups', { count: formatNumber(data.backups.data.length) }) : t("UNAVAILABLE")}</span>}>
    <div className={styles.consumptionSummary}><div><small>{data.consumption.complete ? t("Reported file bytes") : t("Known file bytes · partial")}</small><strong>{size(data.consumption.physical)}</strong></div><div><small>{!data.consumption.complete || data.consumption.unknownLogical ? t('Before compression / deduplication · known subtotal') : t('Before compression / deduplication')}</small><strong>{data.consumption.logical === null ? t("Not measured") : size(data.consumption.logical)}</strong></div><div><small>{t("Unique files loaded")}</small><strong>{formatNumber(data.consumption.files)}<span> · {t('{count} shared across workloads', { count: formatNumber(data.consumption.shared) })}</span></strong></div></div>
    {(!data.consumption.complete || !data.backups.complete) && <div className={styles.inlineNotice}><TriangleAlert size={15} /><p>{t("Consumption covers readable files only.")}{' '}{data.consumption.unknownPhysical > 0 && (t("{count} files have an unknown size.", { count: formatNumber(data.consumption.unknownPhysical) }) + " ")}{data.consumption.conflicts > 0 && (t("{count} conflicting file IDs were excluded.", { count: formatNumber(data.consumption.conflicts) }) + " ")}{t("Missing or unsupported inventory is not zero usage.")}</p></div>}
    {!!data.parentBackups && <div className={styles.inlineNotice}><Layers size={15} /><p>{t('{count} additional backups belong to a scale-out parent. Their file bytes are not assigned to this extent; inspect the parent for those backups.', { count: formatNumber(data.parentBackups) })}</p></div>}
    <FilterWorkspace label={t("Backup consumption filters")} search={<><SearchBox label={t("Search backups")} value={query} onChange={value => { setQuery(value); setPage(0) }} /></>} onClear={()=>{setQuery('');setPage(0)}} filters={<FilterFields><span>{t("Largest known file size first")}</span></FilterFields>}>
{!data.backups.available ? <Empty>{t("Backup inventory is unavailable. Refresh to retry.")}</Empty> : !rows.length ? <Empty>{query ? t("No backups match your search.") : t("No backups in the loaded inventory reference this repository directly.")}</Empty> : <div className={ops.tableScroll}><SortableGrid rows={rows} columns={[{id:'name',value:r=>r.name},{id:'physical',value:r=>r.consumption.physical},{id:'logical',value:r=>r.consumption.logical},{id:'files',value:r=>r.consumption.files},{id:'newest',value:r=>r.consumption.latest,kind:'date'}]} onSortChange={()=>setPage(0)}>{(rows)=>(<table className={ops.table}><thead><tr><th>{t("Backup")}</th><th>{t("Reported file bytes")}</th><th>{t("Data before reduction")}</th><th>{t("Files / shared")}</th><th>{t("Newest file")}</th><th>{t("Investigate")}</th></tr></thead><tbody>{rows.slice(current * 8, current * 8 + 8).map(backup => <tr key={backup.id}>
      <td><Link className={ops.jobName} href={`/vbr/protected-data/restore-points?backupId=${backup.id}&name=${encodeURIComponent(backup.name || t('Backup'))}`}>{backup.name || backup.id}</Link><p className={ops.subtext}>{backup.jobType ? label(backup.jobType) : t("Type not reported")}{parent && ` · ${backup.repositoryName || backup.repositoryId || t('Repository not reported')}`}</p></td>
      <td className={styles.numeric}><strong>{size(backup.consumption.physical)}</strong><p className={ops.subtext}>{backup.error ? diagnostic(backup.error) : (!backup.available ? t("Unavailable") : backup.consumption.complete ? t("Complete file inventory") : t("Partial / unknown sizes"))}</p></td>
      <td className={styles.numeric}>{backup.consumption.logical === null ? t("Not measured") : size(backup.consumption.logical)}{backup.consumption.unknownLogical > 0 && <p className={ops.subtext}>{t('Known subtotal · {count} unknown', { count: formatNumber(backup.consumption.unknownLogical) })}</p>}</td>
      <td>{backup.available ? `${formatNumber(backup.consumption.files)} / ${formatNumber(backup.consumption.shared)}` : t("Not reported")}</td><td className={ops.dateCell}>{date(backup.consumption.latest)}</td>
      <td>{validId(backup.jobId) ? <Link className={ops.textLink} href={`/vbr/jobs/${backup.jobId}`}><Trans>{"Job"}</Trans>{' '}<ArrowUpRight size={13} /></Link> : <span className={ops.subtext}>{t("Job not reported")}</span>}</td>
    </tr>)}</tbody></table>)}</SortableGrid></div>}
<Pager page={current} count={rows.length} size={8} onChange={setPage} label={t("backups")} />
<p className={ops.panelFoot}>{t("Each file ID is counted once; shared files are never multiplied by workload or restore-point count. File sizes are displayed in IEC units. File bytes are not exclusive disk allocation: Fast Clone, other data, and metadata can differ from volume usage.")}{parent && (" " + t("The file API does not locate bytes on individual tiers, so these figures are not a tier allocation breakdown."))}</p>
</FilterWorkspace></Panel>
}
function JobTable({ data }: { data: RepositorySnapshot }) {
  const { t, label, date, formatNumber } = useRecoveryPresentation()
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(0)
  const rows = data.jobs.data.filter(row => [row.name, ...row.relationships].join(' ').toLowerCase().includes(query.toLowerCase()) &&
    (filter === 'all' || filter === 'issues' && ['Failed', 'Warning'].includes(row.job?.lastResult || '') || filter === 'target' && row.relationships.some(r => r !== 'Retained backup')))
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 8) - 1))
  return <Panel title={t("Affected jobs")} subtitle={t("Configured targets, scale-out dependencies, and retained-backup ownership")} action={<span className={ops.smallTag}>{t('{count} linked', { count: formatNumber(data.jobs.data.length) })}</span>}>
    {!data.jobs.complete && <div className={styles.inlineNotice}><TriangleAlert size={15} /><p>{t("Dependency inventory is incomplete. Additional jobs may be affected.")}</p></div>}
    <FilterWorkspace label={t("Affected jobs filters")} search={<><SearchBox label={t("Search affected jobs")} value={query} onChange={value => { setQuery(value); setPage(0) }} /></>} onClear={()=>{setQuery('');setFilter('all');setPage(0)}} filters={<FilterFields><FilterSelect label={t("Affected jobs filter")} value={filter} onValueChange={e => { setFilter(e); setPage(0) }}><option value="all">{t("All relationships")}</option><option value="issues">{t("Last run failed / warning")}</option><option value="target">{t("Configured dependencies")}</option></FilterSelect></FilterFields>}>
{!data.jobs.available ? <Empty>{t("Job dependencies are unavailable.")}</Empty> : !rows.length ? <Empty>{query || filter !== 'all' ? t("No linked jobs match these filters.") : t("No job relationships were found in the loaded inventory.")}</Empty> : <div className={ops.tableScroll}><SortableGrid rows={rows} columns={[{id:'name',value:r=>r.name},{id:'relationship',value:r=>r.relationships.join(", ")},{id:'status',value:r=>r.job?.status},{id:'result',value:r=>r.job?.lastResult},{id:'lastRun',value:r=>r.job?.lastRun,kind:'date'},{id:'nextRun',value:r=>r.job?.nextRun,kind:'date'}]} onSortChange={()=>setPage(0)}>{(rows)=>(<table className={ops.table}><thead><tr><th><Trans>{"Job"}</Trans></th><th>{t("Relationship")}</th><th>{t("Current status")}</th><th>{t("Last result")}</th><th>{t("Last run")}</th><th>{t("Next run")}</th><th>{t("Evidence")}</th></tr></thead><tbody>{rows.slice(current * 8, current * 8 + 8).map(row => <tr key={row.id}>
      <td><Link className={ops.jobName} href={`/vbr/jobs/${row.id}`}>{row.name}</Link><p className={ops.subtext}>{row.job?.type ? label(row.job.type) : t("Current job not returned")}</p></td>
      <td><div className={styles.relationships}>{row.relationships.map(r => <Badge key={r} tone={r === 'Via scale-out parent' ? 'active' : 'neutral'}>{label(r)}</Badge>)}</div>{row.backups > 0 && <p className={ops.subtext}>{row.backups === 1 ? t('{count} {unit}', { count: formatNumber(row.backups), unit: t('Retained backup') }) : t('{count} retained backups', { count: formatNumber(row.backups) })}</p>}</td>
      <td><Status value={row.job?.status || 'Not reported'} /></td><td><Status value={row.job?.lastResult || 'Not reported'} /></td>
      <td className={ops.dateCell}>{date(row.job?.lastRun)}</td><td className={ops.dateCell}>{date(row.job?.nextRun)}</td>
      <td><Link className={ops.textLink} href={`/vbr/jobs/${row.id}${validId(row.job?.sessionId) ? `?session=${row.job.sessionId}` : ''}`}>{t("Sessions & logs")}<ArrowUpRight size={13} /></Link></td>
    </tr>)}</tbody></table>)}</SortableGrid></div>}
<Pager page={current} count={rows.length} size={8} onChange={setPage} label={t("affected jobs")} />
<p className={ops.panelFoot}>{t("A retained backup identifies its creating job, which may now target another repository or have been removed. Scale-out dependencies indicate potential exposure; they do not prove which extent a run used or that storage caused its failure.")}</p>
</FilterWorkspace></Panel>
}
function Extents({ data }: { data: RepositorySnapshot }) {
  const { t, label, gb } = useRecoveryPresentation()
  if (!data.extents.length) return null
  return <Panel title={t("Storage extents")} subtitle={t("Capacity and immutability stay separate for each repository")}>
    <div className={ops.tableScroll}><SortableGrid rows={data.extents} columns={[{id:'name',value:r=>r.name || r.id},{id:'tier',value:r=>r.tier},{id:'health',value:r=>r.state?repositoryRisk(r.state):null},{id:'free',value:r=>r.state?.freeGB},{id:'immutable',value:r=>configuredImmutability(r.config).status}]}>{(extents)=>(<table className={ops.table}><thead><tr><th>{t("Extent")}</th><th>{t("Tier / state")}</th><th><Trans>{"Health"}</Trans></th><th>{t("Free / total")}</th><th><Trans>{"Immutability"}</Trans></th></tr></thead><tbody>{extents.map(extent => {
      const policy = configuredImmutability(extent.config), health = extent.state ? repositoryRisk(extent.state) : 'Unknown'
      return <tr key={extent.id}><td><Link className={ops.jobName} href={repositoryHref(extent.id)}>{extent.name}</Link></td><td>{label(extent.tier)}<p className={ops.subtext}>{extent.status.map(label).join(', ') || t("Extent status not reported")}</p></td><td><Badge tone={healthTone(health)}>{label(health)}</Badge></td><td>{gb(extent.state?.freeGB)} / {gb(extent.state?.capacityGB)}</td><td>{label(policy.status)}<p className={ops.subtext}>{label(policy.period)} · {label(policy.mode)}</p></td></tr>
    })}</tbody></table>)}</SortableGrid></div>
    <p className={ops.panelFoot}>{t("Capacity and archive tiers may have unmeasured or unlimited capacity. Parent and extent values are not summed.")}</p>
  </Panel>
}
export function RepositoryInvestigation({ id }: { id: string }) {
  const { t, label, gb, size, date, formatNumber, diagnostic } = useRecoveryPresentation()
  const { revision, refresh } = useRefresh()
  const load = useCallback((signal: AbortSignal) => veeamApi.getRepositoryInvestigation(id, signal), [id])
  const { data, error, loading } = useEvidence(load, revision)
  const parent = !!data && (!!data.scaleOut || !!data.extents.length || data.state?.type === 'ExtendableRepository')
  const repositoryType = data?.config?.type || data?.state?.type
  const health = data?.state ? repositoryRisk(data.state) : 'Unknown'
  const issues = data?.jobs.data.filter(row => row.job && ['Failed', 'Warning'].includes(jobStatus(row.job))).length || 0
  const targets = data?.jobs.data.filter(row => row.relationships.some(r => r !== 'Retained backup')).length || 0
  const extentRisks = data?.extents.filter(e => e.state && ['Critical', 'Low space', 'Offline', 'Outdated'].includes(repositoryRisk(e.state))).length || 0
  return <div className={cn(ops.console, styles.page)}>
    <header className={ops.header}><div><h1>{data?.name || t("Repository investigation")}</h1><p>{parent ? t("Scale-out repository") : repositoryType ? label(repositoryType) : t('Backup repository')} {t("· Capacity, backup consumption, and job dependencies")}</p></div><div className={ops.headerActions}><Link href="/vbr/infrastructure/repositories" className={ops.backLink}><ArrowLeft size={14} /> {t("Repositories")}</Link><Link href="/vbr/lens/capacity" className={ops.backLink}>{t("Capacity overview")}</Link><Button variant="outline" size="sm" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {' '}<Trans>{"Refresh"}</Trans></Button></div></header>
    {error && <Notice error>{diagnostic(error)}{data && (" " + t("Showing the previous snapshot; this refresh failed."))}</Notice>}
    {!data ? loading ? <Loading>{t("Loading repository evidence…")}</Loading> : <Empty>{t("Repository data could not be loaded. Use Refresh to retry.")}</Empty> : <>
      <nav aria-label={t("Repository sections")} className={styles.sectionNav}><a href="#storage">{t("Storage overview")}</a><a href="#consumption">{t("Backup consumption")}</a><a href="#affected-jobs">{t("Affected jobs")}</a><span>{data.sourceName}</span></nav>
      {(health === 'Critical' || health === 'Offline' || health === 'Low space') && <div className={cn(styles.alert, ops[healthTone(health)])}><TriangleAlert size={20} /><div><strong>{health === 'Offline' ? t("Repository is offline") : health === 'Critical' ? t("Capacity needs attention") : t("Free capacity is running low")}</strong><p>{health === 'Offline' ? t("Check storage connectivity and inspect dependent job logs.") : t('{capacity} free. Review the largest backups and investigate failed or warning job runs.', { capacity: gb(data.state?.freeGB) })} {data.jobs.statesAvailable ? t('{count} configured job dependencies found.', { count: formatNumber(targets) }) : t("Configured job dependencies are unavailable.")}</p></div><a href="#affected-jobs">{t("Investigate jobs")}<ArrowUpRight size={14} /></a></div>}
      {!!data.warnings.length && <details className={ops.warnings}><summary>{t('{count} data coverage notices', { count: formatNumber(data.warnings.length) })}</summary><ul>{data.warnings.map(w => <li key={w}>{diagnostic(w)}</li>)}</ul></details>}
      <div className={ops.metrics}>
        {parent ? <Metric label={t("Extent capacity")} value={t('{count} at risk', { count: formatNumber(extentRisks) })} note={t('{measured} of {count} extents have measured capacity', { measured: formatNumber(data.extents.filter(e => e.state && utilization(e.state) !== null).length), count: formatNumber(data.extents.length) })} icon={<HardDrive size={17} />} tone={extentRisks ? 'warning' : 'neutral'} />
          : <Metric label={t("Free capacity")} value={gb(data.state?.freeGB)} note={data.state?.capacityGB != null && data.state.capacityGB >= 0 ? t('of {capacity} reported capacity', { capacity: gb(data.state.capacityGB) }) : t("Capacity is unmeasured")} icon={<HardDrive size={17} />} tone={healthTone(health)} />}
        <Metric label={t("Backup file bytes")} value={size(data.consumption.physical)} note={data.consumption.complete ? t('{count} unique files · complete inventory', { count: formatNumber(data.consumption.files) }) : t('{count} files loaded · partial accounting', { count: formatNumber(data.consumption.files) })} icon={<Database size={17} />} />
        <Metric label={t("Job dependencies")} value={data.jobs.statesAvailable ? formatNumber(targets) : t('Unknown')} note={data.jobs.complete ? t("Direct targets and scale-out dependencies") : t("Loaded dependencies · inventory incomplete")} icon={<Layers size={17} />} />
        <Metric label={t("Jobs needing attention")} value={data.jobs.statesAvailable ? formatNumber(issues) : t('Unknown')} note={t("Loaded linked jobs with a failed or warning last result")} icon={<TriangleAlert size={17} />} tone={issues ? 'danger' : 'neutral'} />
      </div>
      {!!data.parents.length && <div className={styles.parentLinks}><Layers size={16} /><span>{t("Member of")}</span>{data.parents.map(p => <Link key={p.id} href={repositoryHref(p.id)}>{p.name}<ArrowUpRight size={13} /></Link>)}</div>}
      <div id="storage" className={styles.overview}><Capacity data={data} parent={parent} /><Immutability config={data.config} parent={parent} /></div>
      <div className={styles.stack}><Extents data={data} /><div id="consumption"><BackupTable data={data} parent={parent} /></div><div id="affected-jobs"><JobTable data={data} /></div></div>
      <footer className={ops.footer}><span><span className={ops.dot} /> {t('Snapshot {date}', { date: date(data.fetchedAt) })}{loading ? (" " + t("· Refreshing…")) : (" " + t("· Refreshes every 60 seconds while visible"))}</span><span>VBR {data.apiRevision} · {data.id}</span></footer>
    </>}
  </div>
}
