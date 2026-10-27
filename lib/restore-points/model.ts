export interface RestorePoint {
  id: string; backupId: string; name?: string | null; creationTime?: string | null;
  type?: string | null; platformName?: string | null; backupFileId?: string | null;
  malwareStatus?: string | null; allowedOperations?: string[] | null; gfsPeriods?: string[] | null;
  originalSize?: number | null; sessionId?: string | null; guestOsFamily?: string | null;
}
export interface BackupFile {
  id: string; backupId: string; name?: string | null; objectIds?: string[] | null;
  restorePointIds?: string[] | null; dataSize?: number | null; backupSize?: number | null;
  dedupRatio?: number | null; compressRatio?: number | null; gfsPeriods?: string[] | null; severity?: string | null;
}
export interface BackupEvidence {
  id: string; name?: string | null; jobId?: string | null; repositoryId?: string | null; repositoryName?: string | null;
}
export interface RestorePointSnapshot {
  sourceName: string; fetchedAt: string; objectId?: string; backupId?: string;
  subject: { id: string; name?: string | null; platformName?: string | null; type?: string | null; size?: number | null } | null;
  data: RestorePoint[]; pointsComplete: boolean; backups: BackupEvidence[]; files: BackupFile[];
  filesComplete: boolean; repositories: { id: string; name?: string | null; isOnline?: boolean | null }[]; warnings: string[];
}
export interface PointEvidence {
  point: RestorePoint; backup?: BackupEvidence; file: BackupFile | null;
  mapping: 'confirmed' | 'ambiguous' | 'unavailable'; type: string; typeSource: string;
  gfs: string[]; gfsSource: string; flagged: boolean;
}
export function knownSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function formatBytes(value: unknown): string {
  const bytes = knownSize(value);
  if (bytes === null) return 'Unknown';
  if (bytes === 0) return '0 B';
  const unit = Math.min(5, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'][unit]}`;
}
export function pointTime(point: RestorePoint): number | null {
  const timestamp = point.creationTime ? Date.parse(point.creationTime) : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}
export function usableId(value?: string | null): value is string {
  return !!value && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
}
export function isFlagged(value?: string | null) { return ['infected', 'suspicious'].includes(value?.toLowerCase() || ''); }
const pointTypes: Record<string, string> = { Increment: 'Incremental', Full: 'Full', Rollback: 'Rollback', Snapshot: 'Snapshot', Cdp: 'CDP', Different: 'Different' };

// Conflicting records for the same file ID cannot safely contribute to accounting.
function uniqueFiles(files: BackupFile[]) {
  const unique = new Map<string, BackupFile>();
  const conflicts = new Set<string>();
  for (const file of files) {
    const previous = unique.get(file.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(file)) conflicts.add(file.id);
    else unique.set(file.id, file);
  }
  for (const id of conflicts) unique.delete(id);
  return { files: [...unique.values()], conflicts };
}
export function enrichPoints(snapshot: RestorePointSnapshot): PointEvidence[] {
  const unique = uniqueFiles(snapshot.files);
  const byBackup = new Map(snapshot.backups.map(backup => [backup.id, backup]));
  const byFileId = new Map(unique.files.map(file => [file.id, file]));
  const byMembership = new Map<string, BackupFile[]>();
  for (const file of unique.files) for (const id of new Set(file.restorePointIds || [])) {
    const key = `${file.backupId}:${id}`;
    byMembership.set(key, [...(byMembership.get(key) || []), file]);
  }
  return snapshot.data.map(point => {
    const direct = usableId(point.backupFileId) ? byFileId.get(point.backupFileId) : null;
    const candidates = usableId(point.backupFileId)
      ? direct?.backupId === point.backupId ? [direct] : []
      : byMembership.get(`${point.backupId}:${point.id}`) || [];
    const file = candidates.length === 1 ? candidates[0] : null;
    // A direct reference must never fall back to an unrelated indirect match.
    const mapping: PointEvidence['mapping'] = candidates.length > 1 || (point.backupFileId && unique.conflicts.has(point.backupFileId)) ? 'ambiguous' : file ? 'confirmed' : 'unavailable';
    let type = point.type ? pointTypes[point.type] || point.type : 'Unknown';
    let typeSource = point.type ? 'Reported by VBR' : 'Not reported';
    if (!point.type && file?.name) {
      const extension = file.name.toLowerCase().split('.').pop();
      const fileTypes: Record<string, string> = { vbk: 'Full', vib: 'Incremental', vrb: 'Reverse incremental' };
      const inferred = fileTypes[extension || ''];
      if (inferred) { type = inferred; typeSource = 'Inferred from file extension'; }
    }
    // Point-level GFS applies to NAS. Empty VM defaults must not hide file-level GFS.
    const pointGfs = point.platformName === 'UnstructuredData' || point.gfsPeriods?.some(flag => flag !== 'None') ? point.gfsPeriods : null;
    const gfs = pointGfs ?? file?.gfsPeriods;
    return { point, backup: byBackup.get(point.backupId), file, mapping, type, typeSource,
      gfs: gfs?.filter(flag => flag !== 'None') || [], gfsSource: pointGfs ? 'Restore point' : file?.gfsPeriods ? 'Backup file' : 'Not reported',
      flagged: isFlagged(point.malwareStatus) || isFlagged(file?.severity) };
  }).sort((a, b) => (pointTime(b.point) ?? -Infinity) - (pointTime(a.point) ?? -Infinity) || a.point.id.localeCompare(b.point.id));
}
export function fileAccounting(rows: PointEvidence[]) {
  const files = [...new Map(rows.flatMap(row => row.file ? [[row.file.id, row.file] as const] : [])).values()];
  const sum = (field: 'dataSize' | 'backupSize') => {
    const measured = files.map(file => knownSize(file[field])).filter((value): value is number => value !== null);
    const total = measured.reduce((n, value) => n + value, 0);
    return { bytes: measured.length && Number.isSafeInteger(total) ? total : null, measured: measured.length, unknown: files.length - measured.length };
  };
  const physical = sum('backupSize');
  const logical = sum('dataSize');
  const unmatched = rows.filter(row => !row.file).length;
  const complete = !unmatched && files.length > 0 && !physical.unknown && !logical.unknown && physical.bytes !== null && logical.bytes !== null;
  const references = new Map<string, number>();
  for (const row of rows) if (row.file) references.set(row.file.id, (references.get(row.file.id) || 0) + 1);
  const shared = files.filter(file => (file.objectIds?.length || 0) > 1 || (file.restorePointIds?.length || 0) > 1 || (references.get(file.id) || 0) > 1).length;
  return { files: files.length, physical, logical, unmatched, shared,
    reduction: complete && logical.bytes! > 0 && physical.bytes! <= logical.bytes! ? (1 - physical.bytes! / logical.bytes!) * 100 : null };
}
export function recoveryReadiness(snapshot: RestorePointSnapshot, rows: PointEvidence[], now = Date.now()) {
  const valid = rows.filter(row => pointTime(row.point) !== null && pointTime(row.point)! <= now);
  const latest = valid.sort((a, b) => pointTime(b.point)! - pointTime(a.point)!)[0] || null;
  const repositories = new Map(snapshot.repositories.map(repository => [repository.id, repository]));
  const locations = new Map<string, { id: string; name: string; points: number; latest: number | null; online?: boolean | null }>();
  for (const row of rows) {
    const id = row.backup?.repositoryId;
    if (!usableId(id)) continue;
    const repository = repositories.get(id);
    const location = locations.get(id) || { id, name: row.backup?.repositoryName || repository?.name || id, points: 0, latest: null, online: repository?.isOnline };
    location.points++;
    const timestamp = pointTime(row.point);
    if (timestamp !== null && timestamp <= now && timestamp > (location.latest ?? -Infinity)) location.latest = timestamp;
    locations.set(id, location);
  }
  return { latest, ageHours: latest ? (now - pointTime(latest.point)!) / 3600000 : null,
    flagged: rows.filter(row => row.flagged).length,
    reportedClean: rows.filter(row => row.point.malwareStatus === 'Clean' && !row.flagged).length,
    unknownMalware: rows.filter(row => !row.point.malwareStatus).length,
    locations: [...locations.values()], unmappedLocations: rows.filter(row => !usableId(row.backup?.repositoryId)).length,
    invalidDates: rows.filter(row => pointTime(row.point) === null || pointTime(row.point)! > now).length,
    supported: rows.filter(row => (row.point.allowedOperations?.length || 0) > 0).length };
}
const operationNames: Record<string, string> = {
  StartViVMInstantRecovery: 'VMware Instant Recovery', StartHvVMInstantRecovery: 'Hyper-V Instant Recovery',
  StartEntireVmRestore: 'Entire VM restore', StartEntireVmRestoreCloudDirector: 'Cloud Director VM restore',
  StartEntireVmRestoreHyperV: 'Hyper-V VM restore', StartFCDInstantRecovery: 'First Class Disk recovery',
  StartFlrRestore: 'Guest file restore', StartDiskPublish: 'Publish disks',
};
export function operationLabel(value: string) { return operationNames[value] || value.replace(/([a-z])([A-Z])/g, '$1 $2'); }
