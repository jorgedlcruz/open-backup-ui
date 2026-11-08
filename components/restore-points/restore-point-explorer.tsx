"use client"
import { useRecoveryPresentation } from './use-presentation'
import { RestoreWorkflow } from './restore-workflow'
import { isRestoreOperation, type RestoreOperation } from '@/lib/restore-points/workflow'
import workflow from './workflow.module.css'

import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { VBRRestorePointsCalendar } from '@/components/vbr-restore-points-calendar'
import { VBRRestorePointsTable } from '@/components/vbr-restore-points-table'
import { veeamApi } from '@/lib/api/veeam-client'
import { enrichPoints,fileAccounting,isFlagged,pointTime,recoveryReadiness,usableId,type RestorePointSnapshot } from '@/lib/restore-points/model'
import { cn } from '@/lib/utils'
import { ArrowLeft,ArrowUpRight,CalendarDays,CheckCircle2,CircleHelp,Clock3,Database,FileStack,HardDrive,Layers3,List,Loader2,LockKeyhole,RefreshCw,Search,ShieldCheck,TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect,useMemo,useState,type ReactNode } from 'react'
import styles from './restore-points.module.css'

export function MalwareBadge({ value, fileFlagged = false }: { value?: string | null; fileFlagged?: boolean }) {
  const { t, label } = useRecoveryPresentation()
  const danger = isFlagged(value) || fileFlagged;
  return <span className={cn(ops.badge, danger ? ops.danger : value === 'Clean' ? ops.success : ops.neutral)}>
    <span className={ops.dot} />{fileFlagged && !isFlagged(value) ? t("File flagged") : value === 'Clean' ? t("Reported clean") : value ? label(value) : t("Unknown")}
  </span>;
}
function Panel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return <section className={ops.panel}><div className={ops.panelHeading}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return <div className={ops.metric}><div className={ops.metricLabel}>{label}{icon}</div><div className={ops.metricValue}>{value}</div><p>{detail}</p></div>;
}

export function RestorePointExplorer({ objectId, backupId, name }: { objectId?: string; backupId?: string; name?: string }) {
  const { t, formatNumber, date, age, size, label, diagnostic } = useRecoveryPresentation()

  const [snapshot, setSnapshot] = useState<RestorePointSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [malware, setMalware] = useState('all');
  const [repository, setRepository] = useState('all');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [operation, setOperation] = useState<RestoreOperation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  function inspectPoint(id: string) {
    setOperation(null);
    setSelectedId(id);
  }
  useEffect(() => {
    if (!objectId && !backupId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(null);
    veeamApi.getRestorePointEvidence({ objectId, backupId }, controller.signal).then(value => {
      if (!controller.signal.aborted) setSnapshot(value);
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Restore-point evidence could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [objectId, backupId, revision]);
  useEffect(() => { setSearch(''); setMalware('all'); setRepository('all'); setSelectedId(null); }, [objectId, backupId]);
  const data = snapshot?.objectId === objectId && snapshot?.backupId === backupId ? snapshot : null;
  const rows = useMemo(() => data ? enrichPoints(data) : [], [data]);
  const accounting = useMemo(() => fileAccounting(rows), [rows]);
  const readiness = useMemo(() => data ? recoveryReadiness(data, rows, Date.parse(data.fetchedAt)) : null, [data, rows]);
  const selected = rows.find(row => row.point.id === selectedId);
  const filtered = useMemo(() => rows.filter(row => {
    if (malware === 'flagged' && !row.flagged) return false;
    if (malware === 'clean' && (row.point.malwareStatus !== 'Clean' || row.flagged)) return false;
    if (malware === 'unknown' && row.point.malwareStatus) return false;
    if (repository !== 'all' && row.backup?.repositoryId !== repository) return false;
    return [row.point.id, row.point.name, row.backup?.name, row.backup?.repositoryName, row.file?.name, row.type, ...row.gfs].join(' ').toLowerCase().includes(search.trim().toLowerCase());
  }), [rows, malware, repository, search]);
  const resetFilters = () => { setSearch(''); setMalware('all'); setRepository('all'); };
  const title = data?.subject?.name || name || (objectId ? t('Protected workload') : t('Backup recovery points'));
  const oldest = [...rows].reverse().find(row => pointTime(row.point) !== null && pointTime(row.point)! <= Date.parse(data?.fetchedAt || ''));
  const partialStorage = !data?.pointsComplete || accounting.unmatched > 0 || accounting.physical.unknown > 0;

  return <div className={cn(ops.console, styles.explorer)}>
    <Link href="/vbr/protected-data" className={styles.back}><ArrowLeft size={14} />{t("Protected data")}</Link>
    <header className={ops.header}>
      <div>
        <h1>{title}</h1><p>{t("Inspect recovery options, backup-file evidence, and the points you can recover from.")}</p>
        <div className={styles.identity}>{data?.subject?.platformName && <span>{label(data.subject.platformName)}</span>}<span>{objectId ? t("Backup object") : t("Backup")} · {objectId || backupId || t("Not selected")}</span></div>
      </div>
      <div className={ops.headerActions}><span className={ops.source}><span className={cn(ops.dot, data && !error && ops.connected)} />{data?.sourceName || t("VBR source")}</span>
        <Button variant="outline" size="sm" disabled={loading || (!objectId && !backupId)} onClick={() => setRevision(n => n + 1)}><RefreshCw size={14} className={cn(loading && 'animate-spin')} />{t("Refresh")}</Button>
      </div>
    </header>
    {error && <div className={ops.notice} role="alert"><TriangleAlert size={20} /><div><strong>{data ? t("Refresh failed. Showing the previous snapshot.") : t("Unable to load recovery points.")}</strong><p>{diagnostic(error)}</p></div><Link href="/connect">{t("Connections")}<ArrowUpRight size={14} /></Link></div>}
    {!data ? <div className={ops.loading}>{loading ? <><Loader2 size={28} className="animate-spin" /><h2>{t("Loading recovery evidence")}</h2><p>{t("Reading restore points, unique backup files, and destination states.")}</p></> : <><Database size={28} /><h2>{!objectId && !backupId ? t("Select a protected workload") : t("Recovery evidence is unavailable")}</h2><p>{!objectId && !backupId ? t("Open a workload from Protected Data to inspect its recovery points.") : t("Check the connection and retry. Missing evidence is not an empty backup.")}</p><Button asChild variant="outline"><Link href="/vbr/protected-data">{t("Open protected data")}</Link></Button></>}</div> : <>
      {!!data.warnings.length && <details className={ops.warnings}><summary>{t('Evidence gaps · {count} collection notices', { count: formatNumber(data.warnings.length) })}</summary><ul>{data.warnings.map(warning => <li key={warning}>{diagnostic(warning)}</li>)}</ul></details>}
      <div className={ops.metrics}>
        <Metric label={t("Latest point age")} value={age(readiness!.ageHours)} detail={readiness!.latest ? t('{date} · at refresh', { date: date(readiness!.latest.point.creationTime) }) : t("No valid restore-point date reported")} icon={<Clock3 size={18} />} />
        <Metric label={t("Recovery points")} value={formatNumber(rows.length)} detail={t('{collection} · oldest {date}', { collection: data.pointsComplete ? t('Loaded collection') : t('Partial collection'), date: oldest ? date(oldest.point.creationTime) : t('Unknown') })} icon={<Layers3 size={18} />} />
        <Metric label={t("Repository locations")} value={rows.length && !readiness!.locations.length ? t('Unknown') : formatNumber(readiness!.locations.length)} detail={t('{count} points without a destination · independence unverified', { count: formatNumber(readiness!.unmappedLocations) })} icon={<HardDrive size={18} />} />
        <Metric label={t("Unique-file storage")} value={size(accounting.physical.bytes)} detail={partialStorage ? t('{count} measured files · partial subtotal · whole-file sizes', { count: formatNumber(accounting.physical.measured) }) : t('{count} measured files · whole-file sizes', { count: formatNumber(accounting.physical.measured) })} icon={<FileStack size={18} />} />
      </div>
      <section className={cn(styles.readiness, readiness!.flagged > 0 && styles.flagged)} aria-label={t("Recovery readiness")}>
        <div className={styles.readinessTitle}><ShieldCheck size={23} /><div><h2>{t("Recovery readiness")}</h2><p>{readiness!.flagged ? t('{count} points need security review before recovery.', { count: formatNumber(readiness!.flagged) }) : rows.length ? t("Recovery evidence is available. Verification gaps remain.") : data.pointsComplete ? t("No recovery points were returned for this selection.") : t("No points loaded. Collection coverage is incomplete.")}</p></div>{readiness!.flagged > 0 && <Button variant="outline" size="sm" onClick={() => { setMalware('flagged'); setRepository('all'); setSearch(''); }}>{t("Show flagged points")}</Button>}</div>
        <div className={styles.readinessGrid}>
          <div><Clock3 size={16} /><strong>{t("Backup freshness")}</strong><span>{age(readiness!.ageHours)}</span><small>{t("No RPO target configured")}</small></div>
          <div><ShieldCheck size={16} /><strong>{t("Malware evidence")}</strong><span>{t('{flagged} flagged · {clean} reported clean', { flagged: formatNumber(readiness!.flagged), clean: formatNumber(readiness!.reportedClean) })}</span><small>{t("Clean labels do not prove a recent scan")}</small></div>
          <div><Layers3 size={16} /><strong>{t("Recovery options")}</strong><span>{t('{count} points with reported operations', { count: formatNumber(readiness!.supported) })}</span><small>{t("Inspect a point for its supported paths")}</small></div>
          <div><LockKeyhole size={16} /><strong>{t("Immutability & testing")}</strong><span>{t("Unknown")}</span><small>{t("Point-level expiry and recovery-test evidence unavailable")}</small></div>
        </div>
      </section>
      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section className={ops.panel} aria-label={t("Restore points")}>
            <div className={ops.panelHeading}><div><h2>{t("Recovery point explorer")}</h2><p>{t('{visible} of {count} loaded points · newest first · local time', { visible: formatNumber(filtered.length), count: formatNumber(rows.length) })}</p></div>
              <div className={styles.viewToggle}><button aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14} />{t("List")}</button><button aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><CalendarDays size={14} />{t("Calendar")}</button></div>
            </div>
            <FilterWorkspace label={t("Grid filters")} search={<><label className={ops.search}><Search size={15} /><input aria-label={t("Search recovery points")} placeholder={t("Job, repository, file, point ID…")} value={search} onChange={event => setSearch(event.target.value)} /></label></>} onClear={resetFilters} filters={<FilterFields><FilterSelect label={t("Malware filter")} value={malware} onValueChange={event => setMalware(event)}><option value="all">{t("All malware states")}</option><option value="flagged">{t("Flagged points")}</option><option value="clean">{t("Reported clean")}</option><option value="unknown">{t("Unknown status")}</option></FilterSelect>
<FilterSelect label={t("Repository filter")} value={repository} onValueChange={event => setRepository(event)}><option value="all">{t("All repositories")}</option>{readiness!.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</FilterSelect></FilterFields>}>
{!filtered.length ? <div className={ops.empty}><CircleHelp size={25} /><p>{rows.length ? t("No points match these filters.") : data.pointsComplete ? t("No restore points reported for this selection.") : t("The partial collection contains no restore points.")}</p>{rows.length > 0 && <Button size="sm" variant="outline" onClick={resetFilters}>{t("Clear filters")}</Button>}</div>
              : view === 'list' ? <VBRRestorePointsTable data={filtered} onInspect={inspectPoint} showWorkload={!objectId} /> : <VBRRestorePointsCalendar data={filtered} onInspect={inspectPoint} showWorkload={!objectId} />}
<div className={ops.panelFoot}>{t("File sizes describe the entire matched file. Shared files can contain other points or workloads; they are counted once in the storage summary.")}</div>
</FilterWorkspace></section>
        </div>
        <aside className={styles.sideColumn}>
          <Panel title={t("Recovery locations")} subtitle={t("Observed repository IDs, not independent copies")}>
            <div className={styles.locations}>{readiness!.locations.length ? readiness!.locations.map(location => <div key={location.id}>
              <strong><Link className="hover:underline" href={`/vbr/infrastructure/repositories/${encodeURIComponent(location.id)}`}>{location.name}</Link></strong><span className={cn(ops.badge, location.online === false ? ops.danger : location.online === true ? ops.success : ops.neutral)}>{location.online === false ? t("Offline") : location.online === true ? t("Online") : t("State unknown")}</span>
              <p>{t('{count} points · latest {date}', { count: formatNumber(location.points), date: date(location.latest) })}</p>
            </div>) : <p className={styles.muted}>{t("No repository mapping available.")}</p>}</div>
          </Panel>
          <Panel title={t("Storage accounting")} subtitle={t("Whole files referenced by the loaded points")}>
            <dl className={styles.accounting}><div><dt>{t("Unique matched files")}</dt><dd>{formatNumber(accounting.files)}</dd></div><div><dt>{t("Known shared files")}</dt><dd>{formatNumber(accounting.shared)}</dd></div><div><dt>{t("Unmapped points")}</dt><dd>{formatNumber(accounting.unmatched)}</dd></div><div><dt>{partialStorage ? t('Stored bytes (subtotal)') : t('Stored bytes')}</dt><dd>{size(accounting.physical.bytes)}</dd></div><div><dt>{!data.pointsComplete || accounting.unmatched || accounting.logical.unknown ? t('Before compression / dedupe (subtotal)') : t('Before compression / dedupe')}</dt><dd>{size(accounting.logical.bytes)}</dd></div><div><dt>{t("Unknown file sizes")}</dt><dd>{formatNumber(accounting.physical.unknown)}</dd></div><div><dt>{t("Measured reduction")}</dt><dd>{accounting.reduction === null ? t("Unknown") : formatNumber(accounting.reduction / 100, { style: 'percent', maximumFractionDigits: 1 })}</dd></div></dl>
            <div className={ops.panelFoot}>{t("These are file-level observations, not exclusive workload usage or the space freed by deleting a point. Dependent chain files may be additional.")}</div>
          </Panel>
          <Panel title={t("Evidence boundaries")}><div className={styles.boundaries}><p><CircleHelp size={15} />{t("A restore point and an allowed operation do not prove successful recovery.")}</p><p><LockKeyhole size={15} />{t("Repository configuration alone does not establish this point’s immutable-until date.")}</p><p><CheckCircle2 size={15} />{t("Use a verified recovery test and an explicit recovery target to establish readiness.")}</p></div></Panel>
        </aside>
      </div>
      <footer className={ops.footer}><span><Database size={12} />{t('VBR · {source} · snapshot {date}', { source: data.sourceName, date: date(data.fetchedAt) })}</span></footer>
    </>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !submitting) setSelectedId(null); }}><DialogContent showCloseButton={!submitting} className={styles.dialog}>
      {selected && <><DialogHeader><DialogTitle>{operation ? label(operation) : t("Restore point")}</DialogTitle><DialogDescription>{selected.point.name || title} · {date(selected.point.creationTime)}</DialogDescription></DialogHeader>
        <div className={styles.detailBadges}><span className={ops.badge}>{label(selected.type)}</span><MalwareBadge value={selected.point.malwareStatus} fileFlagged={isFlagged(selected.file?.severity)} />{selected.gfs.map(flag => <span className={ops.badge} key={flag}>{label(flag)}</span>)}</div>
        {selected.flagged && <div className={styles.securityNotice}><TriangleAlert size={18} />{t("Review the reported threat and scan evidence before choosing this point.")}</div>}
        {operation ? <RestoreWorkflow key={selected.point.id + operation} point={selected.point} flagged={selected.flagged} sourceKey={data?.sourceKey} operation={operation} onBack={() => setOperation(null)} onBusy={setSubmitting} /> : <>
        <section className={styles.detailSection}><h3>{t("Available recovery operations")}</h3>
          {selected.point.allowedOperations == null ? <span className={styles.muted}>{t("Unknown — operations were not reported.")}</span> : selected.point.allowedOperations.length ? <ul className={workflow.operations}>{[...new Set(selected.point.allowedOperations)].map(item => <li key={item}>
            {isRestoreOperation(item) ? <button type="button" onClick={() => setOperation(item)}>{label(item)}<ArrowUpRight size={15} /></button> : <span>{label(item)} · {t('Available in VBR')}</span>}
          </li>)}</ul> : <span className={styles.muted}>{t("VBR reported no available operations.")}</span>}
        </section>
        <details className={workflow.evidence}><summary>{t("Recovery point evidence")}</summary>
        <dl className={styles.detailGrid}>
          <div><dt>{t("Type evidence")}</dt><dd>{label(selected.typeSource)}</dd></div><div><dt>{t("GFS flags")}</dt><dd>{selected.gfs.length ? selected.gfs.map(label).join(', ') : selected.gfsSource === 'Not reported' ? t("Unknown") : t("None reported")}<small>{label(selected.gfsSource)}</small></dd></div>
          <div><dt>{t("Point malware status")}</dt><dd>{selected.point.malwareStatus ? label(selected.point.malwareStatus) : t("Unknown")}<small>{t("Scan time and provenance not reported")}</small></dd></div><div><dt>{t("File malware status")}</dt><dd>{selected.file?.severity ? label(selected.file.severity) : t("Unknown")}</dd></div>
          <div><dt>{t("Repository")}</dt><dd>{usableId(selected.backup?.repositoryId) ? <Link className="hover:underline" href={`/vbr/infrastructure/repositories/${encodeURIComponent(selected.backup.repositoryId)}`}>{selected.backup.repositoryName || selected.backup.repositoryId}</Link> : t("Unknown")}</dd></div><div><dt>{t("Job / backup")}</dt><dd>{selected.backup?.name || t("Unknown")}</dd></div>
          <div><dt>{t("Original workload size")}</dt><dd>{size(selected.point.originalSize)}</dd></div><div><dt>{t("Whole-file stored size")}</dt><dd>{size(selected.file?.backupSize)}</dd></div>
          <div><dt>{t("Whole-file data size")}</dt><dd>{size(selected.file?.dataSize)}</dd></div><div><dt>{t("Workloads sharing this file")}</dt><dd>{selected.file?.objectIds ? formatNumber(selected.file.objectIds.length) : t("Unknown")}</dd></div>
          <div><dt>{t("File mapping")}</dt><dd>{selected.mapping === 'confirmed' ? usableId(selected.point.backupFileId) ? t("Direct backup-file ID") : t("File restore-point membership") : selected.mapping === 'ambiguous' ? t("Conflicting / ambiguous evidence") : t("Unknown")}</dd></div><div><dt>{t("Recovery test / immutable-until")}</dt><dd>{t("Unknown")}</dd></div>
        </dl>
        <section className={styles.detailSection}><h3>{t("Source identifiers")}</h3><dl className={styles.identifiers}><dt>{t("Restore point")}</dt><dd>{selected.point.id}</dd><dt>{t("Backup")}</dt><dd>{selected.point.backupId}</dd><dt>{t("Backup file")}</dt><dd>{selected.file?.id || selected.point.backupFileId || t("Unknown")}</dd><dt>{t("Session")}</dt><dd>{usableId(selected.point.sessionId) ? <Link href={`/vbr/sessions/${selected.point.sessionId}`}>{t("Investigate session ↗")}</Link> : t("Unknown")}</dd><dt>{t("File path")}</dt><dd>{selected.file?.name || t("Unknown")}</dd></dl></section>
        {usableId(selected.backup?.jobId) && <Button asChild variant="outline"><Link href={`/vbr/jobs/${encodeURIComponent(selected.backup.jobId)}`}>{t("Inspect source job")}<ArrowUpRight size={14} /></Link></Button>}
        </details></>}
      </>}
    </DialogContent></Dialog>
  </div>;
}
