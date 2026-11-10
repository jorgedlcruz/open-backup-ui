// Open Backup UI v1.0.2
import { z } from 'zod'
import type { RecoverySend } from '../server/vbr-recovery'
import type { RestorePoint } from '../restore-points/model'
import { VbrRecoveryError } from './error'
import { collect, findPoint } from './options'
import {multiVmKind} from '../restore-points/recovery-selection'
import type {VbrReader} from '../server/vbr-read'
import {objectSchema,backupKey} from '../protected-data/model'
import {readOperationsCollection} from '../operations/load'

export const applicationObjectSchema = z.object({id:z.string().uuid().nullish(),objectId:z.string().uuid().nullish(),backupId:z.string().uuid(),childBackupId:z.string().uuid().nullish(),fileServerId:z.string().uuid().nullish(),tenantName:z.string().nullish(),itemIconType:z.string().nullish(),repositoryType:z.string().nullish(),platformName:z.string().nullish(),name:z.string().nullish(),path:z.string().nullish(),operations:z.array(z.object({operation:z.string(),enabled:z.boolean()})).nullish()})
const member = z.object({id:z.string().uuid(),backupId:z.string().uuid()})
const policies = [{kind:'activeDirectory',operation:'ExploreForMsAd',permission:'StartExplorerForMsAd'},
  {kind:'sql',operation:'ExploreForMsSql',permission:'StartExplorerForMsSql'}] as const
const permissions = z.object({permissions:z.array(z.string())})
export async function applicationAccess(send:RecoverySend) {
  const result = permissions.parse(await send('/private-api/v1/permissions',{method:'POST'}))
  return new Set(result.permissions)
}
export function supportedApplications(row:z.infer<typeof applicationObjectSchema>, rights:Set<string>) {
  if (!row.objectId || row.repositoryType?.toLowerCase()==='archivetier' ||
    !['VMware','HyperV','WindowsPhysical','LinuxPhysical','LinuxPhysicalPpc','Nutanix','Proxmox','UnstructuredData','AWSEC2','GCE','AzureCompute'].includes(row.platformName||'') ||
    !['ViewBackupObjects','ViewRestorePoints','ViewTasks'].every(p=>rights.has(p))) return []
  return policies.filter(p=>rights.has(p.permission) && row.operations?.some(op=>op.enabled && op.operation===p.operation))
    .map(p=>({kind:p.kind,objectId:row.objectId!}))
}
export async function publicBackupObjects(read:VbrReader,backupId:string) {
  try{
    return await readOperationsCollection(p=>read(p,'1.3-rev2'),'/api/v1/backups/'+backupId+'/objects',objectSchema,20000,backupKey)
  }catch(e){if(e instanceof Error&&'status' in e&&e.status===401)throw e;return undefined}
}
// The web service occasionally reports a complete zero-row list while the backup
// header still counts members and the public object/point inventory still exists.
// A later read replaces the earlier one. Never replay cached capability grants.
export async function verifiedBackupObjects(send:RecoverySend,id:string,expected:{ids:Iterable<string>;minimum?:number;knownEmpty?:boolean}){
  const wanted=new Set(expected.ids),minimum=expected.minimum??0
  const load=async()=>(await collect(send,'/private-api/v1/backups/'+id+'/objects',applicationObjectSchema)).filter(o=>o.backupId===id)
  const verified=(rows:Awaited<ReturnType<typeof load>>)=>{
    const returned=new Set(rows.map(o=>o.objectId))
    return (rows.length>0||expected.knownEmpty===true)&&rows.length>=minimum&&[...wanted].every(key=>returned.has(key))
  }
  let rows=await load()
  for(const delay of [300,950,2000]){
    if(verified(rows))return {rows,complete:true}
    await new Promise(resolve=>setTimeout(resolve,delay));rows=await load()
  }
  return {rows,complete:verified(rows)}
}
const members = (send:RecoverySend,id:string,objectId:string) => collect(send,'/private-api/v1/restorePoints?backupIdFilter='+id+'&backupObjectIdFilter='+objectId,member)

// VBR puts the Explorer capability on a backup/object pair, not in the VM point's allowedOperations.
export async function attachApplications(send:RecoverySend, points:RestorePoint[], objectId?:string,read?:VbrReader) {
  for(const point of points)delete point.applications
  const rights=await applicationAccess(send)
  if(!rights.has('ViewBackupObjects')||!rights.has('ViewRestorePoints')) return
  const byId = new Map(points.map(p=>[p.id,p]))
  let complete=true
  for(const backupId of new Set(points.map(p=>p.backupId))) {
    const groupPoints=points.filter(p=>p.backupId===backupId)
    const needMembership=!objectId&&groupPoints.some(p=>p.allowedOperations?.some(multiVmKind))
    if(!needMembership&&!policies.some(p=>rights.has(p.permission)))continue
    const expected=new Set(objectId?[objectId]:groupPoints.flatMap(p=>p.verifiedObjectId?[p.verifiedObjectId]:[]))
    if(read&&!objectId&&groupPoints.some(p=>p.verifiedObjectId===undefined)){
      const inventory=await publicBackupObjects(read,backupId)
      for(const row of inventory?.data||[])if(['vm','virtualmachine'].includes(row.type?.toLowerCase()||''))expected.add(row.id)
    }
    const found=await verifiedBackupObjects(send,backupId,{ids:expected,minimum:1})
    if(!found.complete)complete=false
    const rows=found.rows
    for(const row of rows) {
      if(row.backupId!==backupId || !row.objectId || (objectId && row.objectId!==objectId)) continue
      const apps=supportedApplications(row,rights)
      if(!apps.length && !(needMembership && ['Vm','AzureVm'].includes(row.itemIconType||''))) continue
      // In an object calendar the upstream public URL already proves object membership.
      const group=objectId?groupPoints:(await members(send,backupId,row.objectId))
        .filter(m=>m.backupId===backupId).map(m=>byId.get(m.id)).filter((p):p is RestorePoint=>p?.backupId===backupId)
      for(const p of group) {
        if(p.verifiedObjectId===null)continue
        if(p.verifiedObjectId && p.verifiedObjectId!==row.objectId) {
          p.verifiedObjectId=null
          delete p.applications
          continue
        }
        p.verifiedObjectId=row.objectId
        if(apps.length)p.applications=apps
      }
    }
  }
  if(!complete)throw new VbrRecoveryError('Application recovery options could not be checked with the VBR web console.',503)
}
export async function verifyExplorerPoint(send:RecoverySend,publicSend:RecoverySend, ids:{restorePointId:string;backupId:string;objectId:string;reviewedMalwareStatus?:string|null},kind:'activeDirectory'|'sql') {
  const {restorePointId,backupId,objectId}=ids
  if(![restorePointId,backupId,objectId].every(id=>z.string().uuid().safeParse(id).success)) throw new VbrRecoveryError('Select an application restore point.')
  const [point,rights,points]=await Promise.all([findPoint(publicSend,restorePointId,backupId),applicationAccess(send),members(send,backupId,objectId)])
  if((point.malwareStatus==='Infected'||point.malwareStatus==='Suspicious') && point.malwareStatus!==ids.reviewedMalwareStatus) throw new VbrRecoveryError('VBR flagged this restore point for malware. Reopen the workflow and review its current status.',409)
  if(!['ViewBackupObjects','ViewRestorePoints','ViewTasks',policies.find(p=>p.kind===kind)!.permission].every(r=>rights.has(r))||
    !points.some(p=>p.id===restorePointId && p.backupId===backupId))throw new VbrRecoveryError('This Explorer is unavailable for the selected backup object and restore point.',409)
  const result=await verifiedBackupObjects(send,backupId,{ids:[objectId],minimum:1})
  if(!result.complete)throw new VbrRecoveryError('Application recovery options could not be checked with the VBR web console.',503)
  if(!result.rows.some(o=>o.objectId===objectId&&supportedApplications(o,rights).some(a=>a.kind===kind)))throw new VbrRecoveryError('This Explorer is unavailable for the selected backup object and restore point.',409)
  return point
}
