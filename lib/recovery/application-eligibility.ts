// Open Backup UI v1.0.2
import { z } from 'zod'
import type { RecoverySend } from '../server/vbr-recovery'
import type { RestorePoint } from '../restore-points/model'
import { VbrRecoveryError } from './error'
import { collect, findPoint } from './options'

const object = z.object({objectId:z.string().uuid().nullish(),backupId:z.string().uuid(),repositoryType:z.string().nullish(),platformName:z.string().nullish(),operations:z.array(z.object({operation:z.string(),enabled:z.boolean()})).nullish()})
const member = z.object({id:z.string().uuid(),backupId:z.string().uuid()})
const policies = [{kind:'activeDirectory',operation:'ExploreForMsAd',permission:'StartExplorerForMsAd'},
  {kind:'sql',operation:'ExploreForMsSql',permission:'StartExplorerForMsSql'}] as const
const permissions = z.object({permissions:z.array(z.string())})
export async function applicationAccess(send:RecoverySend) {
  const result = permissions.parse(await send('/private-api/v1/permissions',{method:'POST'}))
  return new Set(result.permissions)
}
function supported(row:z.infer<typeof object>, rights:Set<string>) {
  if (!row.objectId || row.repositoryType?.toLowerCase()==='archivetier' ||
    !['VMware','HyperV','WindowsPhysical','LinuxPhysical','LinuxPhysicalPpc','Nutanix','Proxmox','UnstructuredData','AWSEC2','GCE','AzureCompute'].includes(row.platformName||'') ||
    !['ViewBackupObjects','ViewRestorePoints','ViewTasks'].every(p=>rights.has(p))) return []
  return policies.filter(p=>rights.has(p.permission) && row.operations?.some(op=>op.enabled && op.operation===p.operation))
    .map(p=>({kind:p.kind,objectId:row.objectId!}))
}
const objects = (send:RecoverySend,id:string) => collect(send,'/private-api/v1/backups/'+id+'/objects',object)
const members = (send:RecoverySend,id:string,objectId:string) => collect(send,'/private-api/v1/restorePoints?backupIdFilter='+id+'&backupObjectIdFilter='+objectId,member)

// VBR puts the Explorer capability on a backup/object pair, not in the VM point's allowedOperations.
export async function attachApplications(send:RecoverySend, points:RestorePoint[], objectId?:string) {
  const rights=await applicationAccess(send)
  if(!policies.some(p=>rights.has(p.permission))) return
  const byId = new Map(points.map(p=>[p.id,p]))
  for(const backupId of new Set(points.map(p=>p.backupId))) {
    const rows=await objects(send,backupId)
    for(const row of rows) {
      if(row.backupId!==backupId || !row.objectId || (objectId && row.objectId!==objectId)) continue
      const apps=supported(row,rights)
      if(!apps.length) continue
      // In an object calendar the upstream public URL already proves object membership.
      const group=objectId?points.filter(p=>p.backupId===backupId):(await members(send,backupId,row.objectId))
        .filter(m=>m.backupId===backupId).map(m=>byId.get(m.id)).filter((p):p is RestorePoint=>p?.backupId===backupId)
      for(const p of group) p.applications=apps
    }
  }
}
export async function verifyExplorerPoint(send:RecoverySend,publicSend:RecoverySend, ids:{restorePointId:string;backupId:string;objectId:string;reviewedMalwareStatus?:string|null},kind:'activeDirectory'|'sql') {
  const {restorePointId,backupId,objectId}=ids
  if(![restorePointId,backupId,objectId].every(id=>z.string().uuid().safeParse(id).success)) throw new VbrRecoveryError('Select an application restore point.')
  const [point,rows,rights,points]=await Promise.all([findPoint(publicSend,restorePointId,backupId),objects(send,backupId),applicationAccess(send),members(send,backupId,objectId)])
  if((point.malwareStatus==='Infected'||point.malwareStatus==='Suspicious') && point.malwareStatus!==ids.reviewedMalwareStatus) throw new VbrRecoveryError('VBR flagged this restore point for malware. Reopen the workflow and review its current status.',409)
  if(!rows.some(o=>o.backupId===backupId && o.objectId===objectId && supported(o,rights).some(a=>a.kind===kind)) ||
    !points.some(p=>p.id===restorePointId && p.backupId===backupId)) throw new VbrRecoveryError('This Explorer is unavailable for the selected backup object and restore point.',409)
  return point
}
