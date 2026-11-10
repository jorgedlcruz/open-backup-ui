// Open Backup UI v1.0.2
import { z } from 'zod'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import { enrichPoints, type RestorePoint, type RestorePointSnapshot } from './model'
import type { Collection } from '../operations/model'
import { pointSchema } from './cached-collection'
export { pointSchema } from './cached-collection'
import { multiVmKind } from './recovery-selection'
import { validId } from '../investigation/model'

const text = z.string().nullable().optional();
const number = z.number().nullable().optional();
const strings = z.array(z.string()).nullable().optional();
const fileSchema = z.object({ id: z.string().min(1), backupId: z.string().min(1), name: text, objectIds: strings,
  restorePointIds: strings, dataSize: number, backupSize: number, dedupRatio: number, compressRatio: number,
  gfsPeriods: strings, severity: text });
const backupSchema = z.object({ id: z.string().min(1), name: text, jobId: text, repositoryId: text, repositoryName: text });
const subjectSchema = z.object({ id: z.string().min(1), name: text, platformName: text, type: text, size: number });
const repoSchema = z.object({ id: z.string(), name: text, isOnline: z.boolean().nullable().optional() });
type Read = (path: string) => Promise<unknown>;

export const partialMembership = 'Some restore points could not be associated with a virtual machine. Open the workload to select its restore point.'
const vmMember = z.object({id:z.string().uuid(),type:z.string()})
const memberPoint = z.object({id:z.string().uuid(),backupId:z.string().uuid()})

/** The public object-scoped collection binds a point to a VM even on a bearer-only connection. */
export async function completeVmMembership(read:Read, snapshot:RestorePointSnapshot, signal?:AbortSignal) {
  const backupId=snapshot.backupId
  if(snapshot.objectId||!validId(backupId))return
  const eligible=snapshot.data.filter(p=>p.backupId===backupId&&p.allowedOperations?.some(multiVmKind))
  if(!eligible.some(p=>!p.verifiedObjectId))return
  const unresolved=new Map(eligible.filter(p=>p.verifiedObjectId===undefined).map(p=>[p.id.toLowerCase(),p]))
  const matches=new Map<string,Set<string>>()
  const deadline=Date.now()+12_000
  let requests=0,complete=true
  async function boundedRead(path:string) {
    if(signal?.aborted||Date.now()>=deadline||requests++>=96)throw new Error('Membership lookup limit')
    return read(path)
  }
  try {
    if(unresolved.size) {
      // On per-machine chains a row's backupId can differ from this parent backup.
      // The endpoint establishes membership. The point pair must also match exactly.
      const members=await readOperationsCollection(boundedRead,'/api/v1/backups/'+backupId+'/objects',vmMember,80)
      complete=members.complete
      const vms=members.data.filter(vm=>validId(vm.id)&&['vm','virtualmachine'].includes(vm.type.toLowerCase()))
      let cursor=0
      const workers=await Promise.allSettled(Array.from({length:Math.min(vms.length,4)},async()=>{
        while(complete&&cursor<vms.length) {
          const vm=vms[cursor++]
          const page=await readOperationsCollection(boundedRead,'/api/v1/backupObjects/'+vm.id+'/restorePoints?backupIdFilter='+backupId,memberPoint,2000)
            .catch(error=>{complete=false;throw error})
          if(!page.complete){complete=false;return}
          for(const p of page.data) {
            const id=p.id.toLowerCase()
            if(!unresolved.has(id)||p.backupId.toLowerCase()!==backupId.toLowerCase())continue
            const owners=matches.get(id)??new Set<string>()
            owners.add(vm.id.toLowerCase());matches.set(id,owners)
          }
        }
      }))
      for(const worker of workers)if(worker.status==='rejected'&&worker.reason instanceof TopologyRequestError&&worker.reason.status===401)throw worker.reason
      for(const [id,owners] of matches) {
        const point=unresolved.get(id)!
        if(owners.size>1)point.verifiedObjectId=null
        else if(complete)point.verifiedObjectId=[...owners][0]
      }
    }
  } catch(error) {
    if(error instanceof TopologyRequestError&&error.status===401)throw error
  }
  return eligible
}

export async function loadRestorePoints(read: Read, sourceName: string, selection: { objectId?: string; backupId?: string },
  objectPoints?: () => Promise<Collection<RestorePoint>>): Promise<RestorePointSnapshot> {
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
    selection.objectId && objectPoints ? objectPoints().then(page => page.data.length > 5000
      ? { ...page, data: page.data.slice(0, 5000), complete: false } : page)
      : readOperationsCollection(read, `${path}?${query}`, pointSchema, 5000),
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
