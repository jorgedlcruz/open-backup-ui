"use client"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { VBRRestorePointsCalendar } from '@/components/vbr-restore-points-calendar'
import { VBRRestorePointsTable } from '@/components/vbr-restore-points-table'
import { veeamApi } from '@/lib/api/veeam-client'
import { enrichPoints,fileAccounting,formatBytes,isFlagged,operationLabel,pointTime,recoveryReadiness,usableId,type RestorePointSnapshot } from '@/lib/restore-points/model'
import { cn } from '@/lib/utils'
import { ArrowLeft,ArrowUpRight,CalendarDays,CheckCircle2,CircleHelp,Clock3,Database,FileStack,HardDrive,Layers3,List,Loader2,LockKeyhole,RefreshCw,Search,ShieldCheck,TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect,useMemo,useState,type ReactNode } from 'react'
import styles from './restore-points.module.css'

export function dateLabel(value?: string | number | null) {
  const date = value == null ? NaN : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(date) ? new Date(date).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
}
function ageLabel(hours: number | null) {
  if (hours === null) return 'Unknown';
  if (hours < 1) return `${Math.floor(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} hours`;
  return `${(hours / 24).toFixed(1)} days`;
}
export function MalwareBadge({ value, fileFlagged = false }: { value?: string | null; fileFlagged?: boolean }) {
  const danger = isFlagged(value) || fileFlagged;
  return <span className={cn(ops.badge, danger ? ops.danger : value === 'Clean' ? ops.success : ops.neutral)}>
    <span className={ops.dot} />{fileFlagged && !isFlagged(value) ? 'File flagged' : value === 'Clean' ? 'Reported clean' : value || 'Unknown'}
  </span>;
}
function Panel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return <section className={ops.panel}><div className={ops.panelHeading}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return <div className={ops.metric}><div className={ops.metricLabel}>{label}{icon}</div><div className={ops.metricValue}>{value}</div><p>{detail}</p></div>;
}

export function RestorePointExplorer({ objectId, backupId, name }: { objectId?: string; backupId?: string; name?: string }) {
  const [snapshot, setSnapshot] = useState<RestorePointSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [malware, setMalware] = useState('all');
  const [repository, setRepository] = useState('all');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const title = data?.subject?.name || name || (objectId ? 'Protected workload' : 'Backup recovery points');
  const oldest = [...rows].reverse().find(row => pointTime(row.point) !== null && pointTime(row.point)! <= Date.parse(data?.fetchedAt || ''));
  const partialStorage = !data?.pointsComplete || accounting.unmatched > 0 || accounting.physical.unknown > 0;

  return <div className={cn(ops.console, styles.explorer)}>
    <Link href="/vbr/protected-data" className={styles.back}><ArrowLeft size={14} />Protected data</Link>
    <header className={ops.header}>
      <div>
        <h1>{title}</h1><p>Inspect recovery options, backup-file evidence, and the points you can recover from.</p>
        <div className={styles.identity}>{data?.subject?.platformName && <span>{data.subject.platformName}</span>}<span>{objectId ? 'Backup object' : 'Backup'} · {objectId || backupId || 'Not selected'}</span></div>
      </div>
      <div className={ops.headerActions}><span className={ops.source}><span className={cn(ops.dot, data && !error && ops.connected)} />{data?.sourceName || 'VBR source'}</span>
        <Button variant="outline" size="sm" disabled={loading || (!objectId && !backupId)} onClick={() => setRevision(n => n + 1)}><RefreshCw size={14} className={cn(loading && 'animate-spin')} />Refresh</Button>
      </div>
    </header>
    {error && <div className={ops.notice} role="alert"><TriangleAlert size={20} /><div><strong>{data ? 'Refresh failed. Showing the previous snapshot.' : 'Unable to load recovery points.'}</strong><p>{error}</p></div><Link href="/connect">Connections <ArrowUpRight size={14} /></Link></div>}
    {!data ? <div className={ops.loading}>{loading ? <><Loader2 size={28} className="animate-spin" /><h2>Loading recovery evidence</h2><p>Reading restore points, unique backup files, and destination states.</p></> : <><Database size={28} /><h2>{!objectId && !backupId ? 'Select a protected workload' : 'Recovery evidence is unavailable'}</h2><p>{!objectId && !backupId ? 'Open a workload from Protected Data to inspect its recovery points.' : 'Check the connection and retry. Missing evidence is not an empty backup.'}</p><Button asChild variant="outline"><Link href="/vbr/protected-data">Open protected data</Link></Button></>}</div> : <>
      {!!data.warnings.length && <details className={ops.warnings}><summary>Evidence gaps · {data.warnings.length} collection notice{data.warnings.length === 1 ? '' : 's'}</summary><ul>{data.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
      <div className={ops.metrics}>
        <Metric label="Latest point age" value={ageLabel(readiness!.ageHours)} detail={readiness!.latest ? `${dateLabel(readiness!.latest.point.creationTime)} · at refresh` : 'No valid restore-point date reported'} icon={<Clock3 size={18} />} />
        <Metric label="Recovery points" value={String(rows.length)} detail={`${data.pointsComplete ? 'Loaded collection' : 'Partial collection'} · oldest ${oldest ? dateLabel(oldest.point.creationTime) : 'unknown'}`} icon={<Layers3 size={18} />} />
        <Metric label="Repository locations" value={rows.length && !readiness!.locations.length ? 'Unknown' : String(readiness!.locations.length)} detail={`${readiness!.unmappedLocations} points without a destination · independence unverified`} icon={<HardDrive size={18} />} />
        <Metric label="Unique-file storage" value={formatBytes(accounting.physical.bytes)} detail={`${accounting.physical.measured} measured files${partialStorage ? ' · partial subtotal' : ''} · whole-file sizes`} icon={<FileStack size={18} />} />
      </div>
      <section className={cn(styles.readiness, readiness!.flagged > 0 && styles.flagged)} aria-label="Recovery readiness">
        <div className={styles.readinessTitle}><ShieldCheck size={23} /><div><h2>Recovery readiness</h2><p>{readiness!.flagged ? `${readiness!.flagged} points need security review before recovery.` : rows.length ? 'Recovery evidence is available. Verification gaps remain.' : data.pointsComplete ? 'No recovery points were returned for this selection.' : 'No points loaded. Collection coverage is incomplete.'}</p></div>{readiness!.flagged > 0 && <Button variant="outline" size="sm" onClick={() => { setMalware('flagged'); setRepository('all'); setSearch(''); }}>Show flagged points</Button>}</div>
        <div className={styles.readinessGrid}>
          <div><Clock3 size={16} /><strong>Backup freshness</strong><span>{ageLabel(readiness!.ageHours)}{readiness!.ageHours === null ? '' : ' old'}</span><small>No RPO target configured</small></div>
          <div><ShieldCheck size={16} /><strong>Malware evidence</strong><span>{readiness!.flagged} flagged · {readiness!.reportedClean} reported clean</span><small>Clean labels do not prove a recent scan</small></div>
          <div><Layers3 size={16} /><strong>Recovery options</strong><span>{readiness!.supported} points with reported operations</span><small>Inspect a point for its supported paths</small></div>
          <div><LockKeyhole size={16} /><strong>Immutability & testing</strong><span>Unknown</span><small>Point-level expiry and recovery-test evidence unavailable</small></div>
        </div>
      </section>
      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section className={ops.panel} aria-label="Restore points">
            <div className={ops.panelHeading}><div><h2>Recovery point explorer</h2><p>{filtered.length} of {rows.length} loaded points · newest first · local time</p></div>
              <div className={styles.viewToggle}><button aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14} />List</button><button aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><CalendarDays size={14} />Calendar</button></div>
            </div>
            <FilterWorkspace label="Grid filters" search={<><label className={ops.search}><Search size={15} /><input aria-label="Search recovery points" placeholder="Job, repository, file, point ID…" value={search} onChange={event => setSearch(event.target.value)} /></label></>} onClear={resetFilters} filters={<FilterFields><FilterSelect label={"Malware filter"} value={malware} onValueChange={event => setMalware(event)}><option value="all">All malware states</option><option value="flagged">Flagged points</option><option value="clean">Reported clean</option><option value="unknown">Unknown status</option></FilterSelect>
<FilterSelect label={"Repository filter"} value={repository} onValueChange={event => setRepository(event)}><option value="all">All repositories</option>{readiness!.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</FilterSelect></FilterFields>}>
{!filtered.length ? <div className={ops.empty}><CircleHelp size={25} /><p>{rows.length ? 'No points match these filters.' : data.pointsComplete ? 'No restore points reported for this selection.' : 'The partial collection contains no restore points.'}</p>{rows.length > 0 && <Button size="sm" variant="outline" onClick={resetFilters}>Clear filters</Button>}</div>
              : view === 'list' ? <VBRRestorePointsTable data={filtered} onInspect={setSelectedId} showWorkload={!objectId} /> : <VBRRestorePointsCalendar data={filtered} onInspect={setSelectedId} showWorkload={!objectId} />}
<div className={ops.panelFoot}>File sizes describe the entire matched file. Shared files can contain other points or workloads; they are counted once in the storage summary.</div>
</FilterWorkspace></section>
        </div>
        <aside className={styles.sideColumn}>
          <Panel title="Recovery locations" subtitle="Observed repository IDs, not independent copies">
            <div className={styles.locations}>{readiness!.locations.length ? readiness!.locations.map(location => <div key={location.id}>
              <strong><Link className="hover:underline" href={`/vbr/infrastructure/repositories/${encodeURIComponent(location.id)}`}>{location.name}</Link></strong><span className={cn(ops.badge, location.online === false ? ops.danger : location.online === true ? ops.success : ops.neutral)}>{location.online === false ? 'Offline' : location.online === true ? 'Online' : 'State unknown'}</span>
              <p>{location.points} points · latest {dateLabel(location.latest)}</p>
            </div>) : <p className={styles.muted}>No repository mapping available.</p>}</div>
          </Panel>
          <Panel title="Storage accounting" subtitle="Whole files referenced by the loaded points">
            <dl className={styles.accounting}><div><dt>Unique matched files</dt><dd>{accounting.files}</dd></div><div><dt>Known shared files</dt><dd>{accounting.shared}</dd></div><div><dt>Unmapped points</dt><dd>{accounting.unmatched}</dd></div><div><dt>Stored bytes{partialStorage ? ' (subtotal)' : ''}</dt><dd>{formatBytes(accounting.physical.bytes)}</dd></div><div><dt>Before compression / dedupe{!data.pointsComplete || accounting.unmatched || accounting.logical.unknown ? ' (subtotal)' : ''}</dt><dd>{formatBytes(accounting.logical.bytes)}</dd></div><div><dt>Unknown file sizes</dt><dd>{accounting.physical.unknown}</dd></div><div><dt>Measured reduction</dt><dd>{accounting.reduction === null ? 'Unknown' : `${accounting.reduction.toFixed(1)}%`}</dd></div></dl>
            <div className={ops.panelFoot}>These are file-level observations, not exclusive workload usage or the space freed by deleting a point. Dependent chain files may be additional.</div>
          </Panel>
          <Panel title="Evidence boundaries"><div className={styles.boundaries}><p><CircleHelp size={15} />A restore point and an allowed operation do not prove successful recovery.</p><p><LockKeyhole size={15} />Repository configuration alone does not establish this point’s immutable-until date.</p><p><CheckCircle2 size={15} />Use a verified recovery test and an explicit recovery target to establish readiness.</p></div></Panel>
        </aside>
      </div>
      <footer className={ops.footer}><span><Database size={12} />VBR · {data.sourceName} · snapshot {dateLabel(data.fetchedAt)}</span><span>Readiness describes API evidence · no recovery action is started here</span></footer>
    </>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelectedId(null); }}><DialogContent className={styles.dialog}>
      {selected && <><DialogHeader><DialogTitle>Recovery point evidence</DialogTitle><DialogDescription>{selected.point.name || title} · {dateLabel(selected.point.creationTime)}</DialogDescription></DialogHeader>
        <div className={styles.detailBadges}><span className={ops.badge}>{selected.type}</span><MalwareBadge value={selected.point.malwareStatus} fileFlagged={isFlagged(selected.file?.severity)} />{selected.gfs.map(flag => <span className={ops.badge} key={flag}>{flag}</span>)}</div>
        {selected.flagged && <div className={styles.securityNotice}><TriangleAlert size={18} />Review the reported threat and scan evidence before choosing this point.</div>}
        <section className={styles.detailSection}><h3>Available recovery operations</h3><p>Reported by VBR for this point. Availability does not confirm permissions, prerequisites, or a tested recovery.</p>
          {selected.point.allowedOperations == null ? <span className={styles.muted}>Unknown — operations were not reported.</span> : selected.point.allowedOperations.length ? <ul className={styles.operations}>{selected.point.allowedOperations.map(operation => <li key={operation}><ArrowUpRight size={13} />{operationLabel(operation)}</li>)}</ul> : <span className={styles.muted}>VBR reported no available operations.</span>}
        </section>
        <dl className={styles.detailGrid}>
          <div><dt>Type evidence</dt><dd>{selected.typeSource}</dd></div><div><dt>GFS flags</dt><dd>{selected.gfs.length ? selected.gfs.join(', ') : selected.gfsSource === 'Not reported' ? 'Unknown' : 'None reported'}<small>{selected.gfsSource}</small></dd></div>
          <div><dt>Point malware status</dt><dd>{selected.point.malwareStatus || 'Unknown'}<small>Scan time and provenance not reported</small></dd></div><div><dt>File malware status</dt><dd>{selected.file?.severity || 'Unknown'}</dd></div>
          <div><dt>Repository</dt><dd>{usableId(selected.backup?.repositoryId) ? <Link className="hover:underline" href={`/vbr/infrastructure/repositories/${encodeURIComponent(selected.backup.repositoryId)}`}>{selected.backup.repositoryName || selected.backup.repositoryId}</Link> : 'Unknown'}</dd></div><div><dt>Job / backup</dt><dd>{selected.backup?.name || 'Unknown'}</dd></div>
          <div><dt>Original workload size</dt><dd>{formatBytes(selected.point.originalSize)}</dd></div><div><dt>Whole-file stored size</dt><dd>{formatBytes(selected.file?.backupSize)}</dd></div>
          <div><dt>Whole-file data size</dt><dd>{formatBytes(selected.file?.dataSize)}</dd></div><div><dt>Workloads sharing this file</dt><dd>{selected.file?.objectIds?.length ?? 'Unknown'}</dd></div>
          <div><dt>File mapping</dt><dd>{selected.mapping === 'confirmed' ? usableId(selected.point.backupFileId) ? 'Direct backup-file ID' : 'File restore-point membership' : selected.mapping === 'ambiguous' ? 'Conflicting / ambiguous evidence' : 'Unknown'}</dd></div><div><dt>Recovery test / immutable-until</dt><dd>Unknown</dd></div>
        </dl>
        <section className={styles.detailSection}><h3>Source identifiers</h3><dl className={styles.identifiers}><dt>Restore point</dt><dd>{selected.point.id}</dd><dt>Backup</dt><dd>{selected.point.backupId}</dd><dt>Backup file</dt><dd>{selected.file?.id || selected.point.backupFileId || 'Unknown'}</dd><dt>Session</dt><dd>{usableId(selected.point.sessionId) ? <Link href={`/vbr/sessions/${selected.point.sessionId}`}>Investigate session ↗</Link> : 'Unknown'}</dd><dt>File path</dt><dd>{selected.file?.name || 'Unknown'}</dd></dl></section>
        {usableId(selected.backup?.jobId) && <Button asChild variant="outline"><Link href={`/vbr/jobs/${encodeURIComponent(selected.backup.jobId)}`}>Inspect source job <ArrowUpRight size={14} /></Link></Button>}
      </>}
    </DialogContent></Dialog>
  </div>;
}
