import { z } from 'zod'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import { enrichPoints, type RestorePointSnapshot } from './model'

const text = z.string().nullable().optional();
const number = z.number().nullable().optional();
const strings = z.array(z.string()).nullable().optional();
const pointSchema = z.object({ id: z.string().min(1), backupId: z.string().min(1), name: text, creationTime: text,
  type: text, platformName: text, backupFileId: text, malwareStatus: text, allowedOperations: strings,
  gfsPeriods: strings, originalSize: number, sessionId: text, guestOsFamily: text });
const fileSchema = z.object({ id: z.string().min(1), backupId: z.string().min(1), name: text, objectIds: strings,
  restorePointIds: strings, dataSize: number, backupSize: number, dedupRatio: number, compressRatio: number,
  gfsPeriods: strings, severity: text });
const backupSchema = z.object({ id: z.string().min(1), name: text, jobId: text, repositoryId: text, repositoryName: text });
const subjectSchema = z.object({ id: z.string().min(1), name: text, platformName: text, type: text, size: number });
const repoSchema = z.object({ id: z.string(), name: text, isOnline: z.boolean().nullable().optional() });
type Read = (path: string) => Promise<unknown>;

export async function loadRestorePoints(read: Read, sourceName: string, selection: { objectId?: string; backupId?: string }): Promise<RestorePointSnapshot> {
  const query = new URLSearchParams({ orderColumn: 'CreationTime', orderAsc: 'false' });
  if (selection.backupId) query.set('backupIdFilter', selection.backupId);
  const path = selection.objectId ? `/api/v1/backupObjects/${encodeURIComponent(selection.objectId)}/restorePoints` : '/api/v1/restorePoints';
  const warnings: string[] = [];
  async function optional<T>(work: () => Promise<T>, warning: string): Promise<T | null> {
    try { return await work(); } catch (error) {
      if (error instanceof TopologyRequestError && error.status === 401) throw error;
      warnings.push(warning); return null;
    }
  }
  const [points, subject, repositories] = await Promise.all([
    readOperationsCollection(read, `${path}?${query}`, pointSchema, 5000),
    optional(async () => {
      const id = selection.objectId || selection.backupId!;
      const subject = subjectSchema.parse(await read(`/api/v1/${selection.objectId ? 'backupObjects' : 'backups'}/${encodeURIComponent(id)}`));
      if (subject.id !== id) throw new Error('Unexpected identity');
      return subject;
    }, 'Workload identity details are unavailable. The selected ID remains the scope of this view.'),
    optional(() => readOperationsCollection(read, '/api/v1/backupInfrastructure/repositories/states', repoSchema), 'Repository online status is unavailable.'),
  ]);
  if (selection.backupId && points.data.some(point => point.backupId !== selection.backupId)) {
    throw new TopologyRequestError('VBR returned restore points outside the selected backup. No results were displayed.', 502);
  }
  if (!points.complete) warnings.push('Restore-point collection is partial. Counts and dates describe loaded records only.');
  if (repositories && !repositories.complete) warnings.push('Repository states are partial. Missing online states remain unknown.');
  const snapshot: RestorePointSnapshot = { sourceName, fetchedAt: new Date().toISOString(), ...selection, subject,
    data: points.data, pointsComplete: points.complete, backups: [], files: [], filesComplete: true,
    repositories: repositories?.data || [], warnings };
  const ids = [...new Set(points.data.map(point => point.backupId))];
  const selectedIds = ids.slice(0, 30);
  if (ids.length > selectedIds.length) { warnings.push('Backup enrichment reached its limit. Some file and destination evidence is unavailable.'); snapshot.filesComplete = false; }
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, selectedIds.length) }, async () => {
    while (cursor < selectedIds.length) {
      const id = selectedIds[cursor++];
      const [backup, files] = await Promise.all([
        optional(async () => {
          const value = backupSchema.parse(await read(`/api/v1/backups/${encodeURIComponent(id)}`));
          if (value.id !== id) throw new Error('Unexpected backup identity');
          return value;
        }, `Backup ${id}: destination and job details unavailable.`),
        optional(async () => {
          const value = await readOperationsCollection(read, `/api/v1/backups/${encodeURIComponent(id)}/backupFiles?orderColumn=CreationTime&orderAsc=false`, fileSchema, 3000);
          if (value.data.some(file => file.backupId !== id)) throw new Error('Unexpected file ownership');
          return value;
        }, `Backup ${id}: file evidence unavailable. File sizes remain unknown.`),
      ]);
      if (backup) snapshot.backups.push(backup);
      if (files) snapshot.files.push(...files.data);
      if (!files?.complete) { snapshot.filesComplete = false; if (files) warnings.push(`Backup ${id}: file collection is partial.`); }
    }
  }));
  const rows = enrichPoints(snapshot);
  const unmatched = rows.filter(row => !row.file).length;
  if (unmatched) warnings.push(`${unmatched} restore point(s) have no unambiguous file mapping. Storage totals cover matched files only.`);
  if (points.data.some(point => !point.creationTime || !Number.isFinite(Date.parse(point.creationTime)) || Date.parse(point.creationTime) > Date.now())) warnings.push('Some restore-point dates are missing, invalid, or in the future. Freshness excludes those dates.');
  snapshot.fetchedAt = new Date().toISOString();
  return snapshot;
}
