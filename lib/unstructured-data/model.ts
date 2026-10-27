import { z } from 'zod'
import { uuid, validId, type Evidence } from '../investigation/model'
import { backupSchema as baseBackup, backupKey } from '../virtual-infrastructure/model'

const text=z.string().nullish(),bool=z.boolean().nullish(),number=z.number().finite().nullish()
const id=z.string().regex(uuid).transform(v=>v.toLowerCase())
const ref=text.transform(v=>v?.toLowerCase())
// Whitelist display fields; passwords, keys and tokens must never reach the browser.
export const serverSchema=z.object({
  id,type:text,name:text,description:text,path:text,hostId:ref,storageHostId:ref,hostType:text,
  accessCredentialsRequired:bool,accessCredentialsId:ref,friendlyName:text,credentialsId:ref,regionType:text,regionDisplayName:text,
  account:z.object({friendlyName:text,servicePoint:text,credentialsId:ref,regionId:text,regionType:text,regionDisplayName:text}).nullish(),
  processing:z.object({
    cacheRepositoryId:ref,backupIOControlLevel:text,nativeChangeTrackingEnabled:bool,
    backupProxies:z.object({autoSelectEnabled:bool,proxyIds:z.array(z.string().transform(v=>v.toLowerCase())).nullish()}).nullish(),
  }).nullish(),
  advancedSettings:z.object({processingMode:text,directBackupFailoverEnabled:bool,storageSnapshotPath:text}).nullish(),
})
export const credentialSchema=z.object({id,username:text,description:text,creationTime:text,lastModified:text,type:text})
export const repositorySchema=z.object({id,name:text,description:text,type:text})
export const repositoryStateSchema=repositorySchema.extend({isOnline:bool,isOutOfDate:bool,capacityGB:number,freeGB:number})
const mask=z.object({path:text,type:text,name:text,value:text,isObjectTag:bool})
export const scopeSchema=z.object({
  type:text,path:text,fileServerId:ref,objectStorageServerId:ref,container:text,
  inclusionMask:z.array(mask).nullish(),exclusionMask:z.array(mask).nullish(),
  inclusionTagMask:z.array(mask).nullish(),exclusionTagMask:z.array(mask).nullish(),exclusionPathMask:z.array(mask).nullish(),
})
export const jobSchema=z.object({
  id,name:text,type:text,description:text,isDisabled:bool,objects:z.array(scopeSchema).nullish(),
  backupRepository:z.object({backupRepositoryId:ref}).nullish(),
})
export const jobStateSchema=z.object({id,name:text,type:text,status:text,lastResult:text,lastRun:text,nextRun:text,sessionId:ref})
export const backupSchema=baseBackup.extend({fileServerId:ref,hostId:ref})
export { backupKey }
export type Server=z.infer<typeof serverSchema>
export type Credential=z.infer<typeof credentialSchema>
export type Job=z.infer<typeof jobSchema>
export type Backup=z.infer<typeof backupSchema>
export type Snapshot={
  sourceName:string;fetchedAt:string;apiRevision:string;warnings:string[];
  servers:Evidence<Server>;jobs:Evidence<Job>;jobStates:Evidence<z.infer<typeof jobStateSchema>>;
  backups:Evidence<Backup>;repositories:Evidence<z.infer<typeof repositorySchema>>;
  repositoryStates:Evidence<z.infer<typeof repositoryStateSchema>>;
  credentials:Evidence<Credential & {kind:'standard'|'cloud'}>;
}
const objectTypes=['S3Compatible','AmazonS3','AzureBlob','AzureDataLake']
const shareTypes=['SMBShare','NFSShare','SANSMBShare','SANNFSShare']
const fileTypes=[...shareTypes,'FileServer','NASFiler']
export const isObject=(s:Server)=>objectTypes.includes(s.type || '')
export const category=(s:Server)=>isObject(s) ? 'Object storage':shareTypes.includes(s.type || '') ? 'File shares':fileTypes.includes(s.type || '') ? 'File servers & NAS':'Other'
export const serverName=(s:Server)=>s.name || s.friendlyName || s.account?.friendlyName || s.path || s.id
export const sourcePath=(s:Server)=>s.path || s.account?.servicePoint || (isObject(s) ? 'Endpoint not reported':s.name || 'Not reported')
export const serverHref=(id:string)=>`/vbr/inventory/unstructured/${encodeURIComponent(id)}`
export function credentialRef(s:Server) {
  return isObject(s) ? {id:s.credentialsId || s.account?.credentialsId,kind:'cloud' as const}
    : {id:s.accessCredentialsId,kind:'standard' as const}
}
export type LinkedJob={job:Job;state:z.infer<typeof jobStateSchema>|null;scopes:z.infer<typeof scopeSchema>[]}
export type Row={
  server:Server;name:string;category:string;credential:Snapshot['credentials']['data'][number]|null;
  repository:Snapshot['repositories']['data'][number]|null;repositoryState:Snapshot['repositoryStates']['data'][number]|null;
  jobs:LinkedJob[];backups:Backup[];protection:'Backup evidence'|'Configured only'|'No protection found'|'Unknown';
  issues:{attention:boolean;backup:boolean;jobs:boolean;disabled:boolean;cache:boolean;credentials:boolean;noPoints:boolean;unknown:boolean};
  cacheLabel:string;cacheUsedPercent:number|null;note:string;
}
export function buildRows(data:Snapshot):Row[] {
  const servers=[...new Map(data.servers.data.map(s=>[s.id,s])).values()]
  const byId=new Map(servers.map(s=>[s.id,s]))
  const fileHosts=new Map<string,Server[]>()
  for(const s of servers)if(s.type==='FileServer' && validId(s.hostId))fileHosts.set(s.hostId,[...(fileHosts.get(s.hostId)||[]),s])
  const backupMap=new Map<string,Backup[]>(),ambiguous=new Set<string>()
  let unidentified=false
  for(const b of new Map(data.backups.data.map(b=>[backupKey(b),b])).values()) {
    if(b.platformName!=='UnstructuredData')continue
    // fileServerId is the explicit inventory reference. hostId can identify a managed host
    // and is only used as a fallback for a unique FileServer registration, never for sibling shares.
    const target=validId(b.fileServerId) ? byId.get(b.fileServerId)
      : validId(b.hostId) ? byId.get(b.hostId) || (data.servers.complete && fileHosts.get(b.hostId)?.length===1 ? fileHosts.get(b.hostId)![0]:undefined):undefined
    if(target) {const list=backupMap.get(target.id)||[];list.push(b);backupMap.set(target.id,list)}
    else if(!validId(b.fileServerId) && !validId(b.hostId))unidentified=true
    else if(!validId(b.fileServerId) && validId(b.hostId))for(const s of fileHosts.get(b.hostId)||[])ambiguous.add(s.id)
  }
  const jobMap=new Map<string,LinkedJob[]>(),states=new Map(data.jobStates.data.map(s=>[s.id,s]))
  for(const job of data.jobs.data)if(['FileBackup','ObjectStorageBackup'].includes(job.type || '')) {
    const scopes=new Map<string,z.infer<typeof scopeSchema>[]>()
    for(const object of job.objects || []) {
      const target=job.type==='FileBackup' ? object.fileServerId:object.objectStorageServerId
      if(!validId(target) || !byId.has(target))continue
      if((job.type==='ObjectStorageBackup') !== isObject(byId.get(target)!))continue
      const list=scopes.get(target)||[];list.push(object);scopes.set(target,list)
    }
    for(const [target,objects] of scopes) {const list=jobMap.get(target)||[];list.push({job,state:states.get(job.id)||null,scopes:objects});jobMap.set(target,list)}
  }
  const repos=new Map(data.repositories.data.map(r=>[r.id,r])),repoStates=new Map(data.repositoryStates.data.map(r=>[r.id,r]))
  const credentials=new Map(data.credentials.data.map(c=>[`${c.kind}|${c.id}`,c]))
  return servers.map(server=>{
    const jobs=jobMap.get(server.id)||[],backups=backupMap.get(server.id)||[],repoId=server.processing?.cacheRepositoryId
    const repository=repoId ? repos.get(repoId)||null:null,repositoryState=repoId ? repoStates.get(repoId)||null:null
    const reference=credentialRef(server),credential=reference.id ? credentials.get(`${reference.kind}|${reference.id}`)||null:null
    const knownType=[...fileTypes,...objectTypes].includes(server.type || '')
    const backupComplete=data.backups.complete && !unidentified && !ambiguous.has(server.id)
    const protection=backups.length ? 'Backup evidence':!knownType || !backupComplete ? 'Unknown':jobs.length ? 'Configured only':data.jobs.complete ? 'No protection found':'Unknown'
    const cap=repositoryState?.capacityGB,free=repositoryState?.freeGB
    const cacheUsedPercent=cap!=null && cap>0 && free!=null && free>=0 && free<=cap ? (cap-free)/cap*100:null
    const cacheLabel=!validId(repoId) ? 'No cache reference':repositoryState?.isOnline===false ? 'Offline'
      : cacheUsedPercent!==null && cacheUsedPercent>=85 ? 'Capacity pressure':repositoryState?.isOutOfDate===true ? 'Update required'
        : repositoryState?.isOnline===true ? 'Online':!repository && data.repositories.complete ? 'Reference unresolved':'State not reported'
    const missingCredential=(server.accessCredentialsRequired===true || isObject(server)) && !validId(reference.id)
    const issues={
      attention:false,backup:backups.some(b=>b.lastRunFailed===true),
      jobs:jobs.some(j=>['Failed','Warning'].includes(j.state?.lastResult || '')),
      disabled:jobs.length>0 && jobs.every(j=>j.job.isDisabled===true || j.state?.status==='Disabled'),
      cache:['Offline','Capacity pressure','Update required','No cache reference','Reference unresolved'].includes(cacheLabel),
      credentials:missingCredential,noPoints:backups.length>0 && backups.every(b=>b.restorePointsCount===0),
      unknown:protection==='Unknown' || !data.jobs.complete || !data.backups.complete || repositoryState?.isOnline==null ||
        (!!reference.id && !credential) || jobs.some(j=>!j.state || !j.state.lastResult),
    }
    issues.attention=issues.backup || issues.jobs || issues.disabled || issues.cache || issues.credentials || issues.noPoints || protection==='No protection found' || protection==='Configured only'
    const note=backups.length ? 'Backup objects are linked by explicit server IDs. Evidence may cover only selected shares, paths, buckets, or containers.'
      : ambiguous.has(server.id) || unidentified ? 'Backup records contain unresolved server identities. Protection cannot be determined safely.'
        : protection==='Unknown' ? 'Required evidence is incomplete or the source type is not recognized.'
          : jobs.length ? 'A job explicitly includes this source, but no matching backup objects were returned.'
            : 'No linked jobs or matching backup objects were returned by the complete collections.'
    return {server,name:serverName(server),category:category(server),credential,repository,repositoryState,jobs,backups,protection,issues,cacheLabel,cacheUsedPercent,note}
  })
}
export type Issue='all'|'attention'|'unprotected'|'configured'|'backup'|'jobs'|'disabled'|'cache'|'credentials'|'noPoints'|'unknown'
export type Filters={query:string;category:string;type:string;protection:string;cache:string;issue:Issue}
export const defaults:Filters={query:'',category:'all',type:'all',protection:'all',cache:'all',issue:'all'}
export function matches(row:Row,f:Filters) {
  if(f.category!=='all' && row.category!==f.category || f.type!=='all' && (row.server.type || 'Not reported')!==f.type || f.protection!=='all' && row.protection!==f.protection || f.cache!=='all' && row.cacheLabel!==f.cache)return false
  const query=f.query.trim().toLowerCase()
  if(query && ![row.name,row.server.id,row.server.description,sourcePath(row.server),row.server.hostId,row.server.account?.regionDisplayName,row.credential?.username,row.credential?.description,row.repository?.name,...row.jobs.flatMap(j=>[j.job.name,...j.scopes.flatMap(s=>[s.path,s.container])])].join(' ').toLowerCase().includes(query))return false
  return f.issue==='all' || (f.issue==='unprotected' ? row.protection==='No protection found':f.issue==='configured' ? row.protection==='Configured only':row.issues[f.issue])
}
export function sorted(rows:Row[],order:string) {
  const rank=(r:Row)=>r.issues.backup || r.issues.jobs ? 0:r.issues.cache || r.issues.credentials ? 1:r.issues.attention ? 2:r.issues.unknown ? 3:4
  return [...rows].sort((a,b)=>(order==='risk' ? rank(a)-rank(b):order==='jobs' ? b.jobs.length-a.jobs.length:0) || a.name.localeCompare(b.name)*(order==='nameDesc' ? -1:1))
}
