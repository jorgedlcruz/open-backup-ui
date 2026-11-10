// Open Backup UI v1.0.2
import {mergeActivity,sessionProgress,type ActivityRow,type Mount} from '../activity/model'
import {sessionGroups} from '../activity/filters'
import {recoveryCenterPath} from '../navigation/recovery'
import {recordStatus,type Session} from '../investigation/model'
import type {RestoreLaunch} from '../restore-points/launch'

export const quickFilters=['all','active','pending','ready','attention','completed'] as const
export type QuickFilter=typeof quickFilters[number]
type Category=Exclude<QuickFilter,'all'>|'other'
export const quickLabels:Record<QuickFilter,string>={all:'All recoveries',active:'In progress',pending:'Pending',ready:'Ready for action',attention:'Needs attention',completed:'Completed'}

export type RecoveryBatchSummary={id:string;sourceKey:string;createdAt:string;items:{objectId:string;name:string;targetName?:string;operation:string;
  status:string;sessionId?:string|null;sessionType?:string|null}[]}
export type RecoveryRow={key:string;name:string;type:string;platform?:string;category:Category;state:string;started?:string;
  initiatedBy?:string;result?:string;progress?:number;sessionId?:string;href:string;batchHref?:string;batch?:boolean}
export type RecoveryGridFilters={quick:QuickFilter;search:string;types:string[];platforms:string[];states:string[];window:string}
export const defaultGridFilters:RecoveryGridFilters={quick:'all',search:'',types:[],platforms:[],states:[],window:''}
export const sortFields=['name','type','platform','state','started','progress'] as const
export type RecoverySort=typeof sortFields[number]
export const recoverySessionTypes=[...sessionGroups.Recovery,...sessionGroups.Replication.filter(value=>value!=='ReplicaJob')]
const registry=new Set(recoverySessionTypes)
export const isRecoverySession=(session:Pick<Session,'sessionType'>)=>!!session.sessionType&&registry.has(session.sessionType)
const prefix=recoveryCenterPath
function sessionLink(sourceKey:string,id:string,mount?:Mount) {
  const query=new URLSearchParams({sourceKey})
  if(mount){query.set('mount',mount.id);query.set('kind',mount.kind)}
  return prefix+'/'+encodeURIComponent(id)+'?'+query
}
const sourceTypes:Record<string,string>={StartViVMInstantRecovery:'InstantRecovery',StartHvVMInstantRecovery:'InstantRecovery',
  StartEntireVmRestore:'RestoreVm',StartEntireVmRestoreHyperV:'RestoreVm',StartEntireVmRestoreCloudDirector:'CloudDirectorVmRestore',
  StartFCDInstantRecovery:'FirstClassDiskInstantRestore',StartFlrRestore:'FileLevelRestore',StartDiskPublish:'PublishBackupContentViaMount',
  BrowseActiveDirectory:'ApplicationLevelRestore',BrowseSql:'ApplicationLevelRestore'}
const mountTypes:Record<Mount['kind'],string>={vSphere:'InstantRecovery',hyperV:'InstantRecovery',flr:'FileLevelRestore',fcd:'FirstClassDiskInstantRestore',
  publish:'PublishBackupContentViaMount',other:'InstantRecovery'}
function nativeRow(row:ActivityRow,sourceKey:string):RecoveryRow {
  const {session,mount}=row, finished=!!session?.endTime||session?.state==='Stopped'
  const result=session?.result?.isCanceled?'Canceled':session?.result?.result
  const mounted=!!mount&&(!finished||mount.kind!=='flr')
  const state=mounted?mount.state:session?recordStatus(session):row.state
  let category:Category='other'
  if((mounted&&mount.error)||/failed|unavailable/i.test(state)||finished&&['Failed','Warning','Canceled'].includes(result||''))category='attention'
  else if(mounted&&['Mounted','Published','Ready'].includes(state))category='ready'
  else if(finished)category='completed'
  else if(state==='ActionRequired')category='ready'
  else if(['Idle','WaitingTape','WaitingRepository','WaitingSlot','Queued','Pending'].includes(state))category='pending'
  else if(session?.sessionType==='ApplicationLevelRestore'&&state==='Working'&&/\bitems browsing\s*\(/i.test(session.name||''))category='ready'
  else if(mounted||['Starting','Working','Stopping','Pausing','Resuming','Postprocessing'].includes(state))category='active'
  const platform=session?.platformName||(mount?.kind==='vSphere'||mount?.kind==='fcd'?'VMware':mount?.kind==='hyperV'?'HyperV':undefined)
  return {key:row.key,name:row.name,type:session?.sessionType||mount?.operation||(mount?mountTypes[mount.kind]:'Restore'),platform,state,category,
    started:session?.creationTime||undefined,initiatedBy:session?.initiatedBy||undefined,result:result||undefined,progress:sessionProgress(session,mounted?mount:undefined),
    sessionId:row.sessionId,href:sessionLink(sourceKey,row.sessionId,mount)}
}
const localStates:Record<string,[string,Category]>={queued:['Queued','pending'],submitting:['Submitting','pending'],accepted:['Accepted','other'],
  failed:['Failed','attention'],unknown:['Outcome unknown','attention'],notStarted:['Not started','attention']}
function operationPlatform(op:string) {
  if(op.includes('HvVM')||op.includes('HyperV'))return 'HyperV'
  if(op.includes('CloudDirector'))return 'CloudDirector'
  if(['StartViVMInstantRecovery','StartEntireVmRestore','StartFCDInstantRecovery'].includes(op))return 'VMware'
}
export function recoveryRows(sourceKey:string,sessions:Session[],mounts:Mount[],batches:RecoveryBatchSummary[],receipts:RestoreLaunch[]) {
  const rows=mergeActivity(sessions.filter(isRecoverySession),mounts).map(row=>nativeRow(row,sourceKey))
  const native=new Map<string,RecoveryRow[]>()
  for(const row of rows)if(row.sessionId)native.set(row.sessionId,[...native.get(row.sessionId)||[],row])
  const known=new Set(native.keys())
  for(const batch of batches) {
    if(batch.sourceKey!==sourceKey)continue
    const batchHref=prefix+'/batches/'+encodeURIComponent(batch.id)+'?'+new URLSearchParams({sourceKey})
    for(const [index,item] of batch.items.entries()) {
      const id=item.sessionId?.toLowerCase()
      if(id&&native.has(id)){for(const row of native.get(id)!){row.batch=true;row.batchHref=batchHref}continue}
      if(id&&known.has(id))continue
      const [state,category]=localStates[item.status]||['Not reported','other']
      rows.push({key:'batch/'+batch.id+'/'+index,name:item.targetName||item.name,type:item.sessionType||sourceTypes[item.operation]||item.operation,
        platform:operationPlatform(item.operation),category,state,started:batch.createdAt,batch:true,batchHref,sessionId:id,href:id?sessionLink(sourceKey,id):batchHref})
      if(id)known.add(id)
    }
  }
  for(const receipt of receipts) {
    if(receipt.sourceKey!==sourceKey||receipt.phase==='rejected'||receipt.sessionId&&known.has(receipt.sessionId))continue
    const pending=receipt.phase==='starting',unknown=receipt.phase==='unknown'
    const explorer=receipt.operation==='BrowseActiveDirectory'||receipt.operation==='BrowseSql'
    let state=unknown?'Outcome unknown':pending?'Submitting':'Accepted'
    if(explorer&&unknown)state='Browse session unconfirmed'
    if(explorer&&pending)state=receipt.explorerStage==='checking'?'Checking with VBR':'Waiting for Explorer'
    rows.push({key:'launch/'+receipt.requestId,name:receipt.workload,type:explorer?receipt.operation:sourceTypes[receipt.operation]||receipt.operation,platform:operationPlatform(receipt.operation),
      category:unknown?'attention':pending?'pending':'other',state,started:receipt.createdAt,
      sessionId:receipt.sessionId,href:receipt.sessionId?sessionLink(sourceKey,receipt.sessionId):prefix+'/preparing?'+new URLSearchParams({request:receipt.requestId,sourceKey})})
  }
  return rows
}

export function selectRecoveryRows(rows:RecoveryRow[],f:RecoveryGridFilters,sort:RecoverySort,ascending:boolean,locale:string,
  label:(value:string)=>string,now=Date.now()) {
  const search=f.search.trim().toLocaleLowerCase(locale)
  const earliest=f.window?now-Number(f.window)*86400000:undefined
  const selected=rows.filter(row=>(f.quick==='all'||row.category===f.quick)&&(!f.types.length||f.types.includes(row.type))&&
    (!f.platforms.length||f.platforms.includes(row.platform||''))&&(!f.states.length||f.states.includes(row.state))&&
    (earliest===undefined||!!row.started&&Date.parse(row.started)>=earliest)&&(!search||
      [row.name,row.initiatedBy,row.type,row.platform,row.state,label(row.type),label(row.state)].some(x=>x?.toLocaleLowerCase(locale).includes(search))))
  const collator=new Intl.Collator(locale,{numeric:true,sensitivity:'base'})
  return selected.sort((a,b)=>{
    const value=(row:RecoveryRow)=>sort==='started'?(row.started?Date.parse(row.started):undefined):
      sort==='progress'?row.progress:sort==='name'?row.name:row[sort]?label(row[sort]!):undefined
    const x=value(a),y=value(b)
    if(x==null||y==null)return Number(x==null)-Number(y==null)||a.key.localeCompare(b.key)
    const delta=typeof x==='number'&&typeof y==='number'?x-y:collator.compare(String(x),String(y))
    return (ascending?delta:-delta)||a.key.localeCompare(b.key)
  })
}
