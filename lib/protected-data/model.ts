import { z } from 'zod'
import { backupSchema as objectBase, backupKey } from '../virtual-infrastructure/model'
import { backupSchema as baseBackupSchema, type Consumption } from '../repositories/model'
import { validId, type Evidence } from '../investigation/model'
import { knownSize } from '../restore-points/model'

const text=z.string().nullish()
export const objectSchema=objectBase.extend({
  restorePointsCount:z.number().finite().nullish(),
  backupId:text.transform(v=>v?.toLowerCase()), platformId:text, hostId:text, fileServerId:text,
  jobId:text, jobName:text, repositoryId:text, repositoryName:text,
})
export const backupSchema=baseBackupSchema.extend({platformName:text})
export type Backup=z.infer<typeof backupSchema>
export { backupKey }
export type ObjectRecord=z.infer<typeof objectSchema>
export type Latest={state:'verified'|'empty'|'unavailable';creationTime:string|null;reason?:string}
export type Snapshot={
  sourceName:string;fetchedAt:string;apiRevision:string;warnings:string[];
  data:ObjectRecord[];objectsComplete:boolean;backups:Evidence<Backup>;consumption:Consumption;
  latest:Record<string,Latest>;recoveryTimesRequested:boolean;
  recoveryTimesFetchedAt?:string;cacheExpiresAt?:string;
  backupLinks?:Record<string,string>;
}
export type Row={
  object:ObjectRecord;key:string;name:string;backup:Backup|null;copies:number;
  coverage:'Restore points available'|'No restore points'|'Count not reported';
  run:'Failed'|'Not failed'|'Not reported';size:number|null;points:number|null;latest:Latest|null;
}
export function rowsFrom(data:Snapshot):Row[] {
  const objects=[...new Map(data.data.map(o=>[backupKey(o),o])).values()]
  const copies=new Map<string,number>(),backups=new Map(data.backups.data.map(b=>[b.id,b]))
  for(const o of objects)copies.set(o.id,(copies.get(o.id)||0)+1)
  return objects.map(object=>{
    const points=knownSize(object.restorePointsCount),size=knownSize(object.size),key=backupKey(object)
    return {object,key,name:object.name || object.id,backup:backups.get(data.backupLinks?.[key] || object.backupId || '') || null,copies:copies.get(object.id)!,
      coverage:points===null ? 'Count not reported':points===0 ? 'No restore points':'Restore points available',
      run:object.lastRunFailed===true ? 'Failed':object.lastRunFailed===false ? 'Not failed':'Not reported',
      size,points,latest:data.latest[key] || null}
  })
}
export function restoreHref(row:Row) {
  const query=new URLSearchParams({objectId:row.object.id,name:row.name})
  if(validId(row.backup?.id))query.set('backupId',row.backup.id)
  return `/vbr/protected-data/restore-points?${query}`
}
export const repositoryId=(r:Row)=>validId(r.backup?.repositoryId) ? r.backup.repositoryId:validId(r.object.repositoryId) ? r.object.repositoryId:''
export const repositoryName=(r:Row)=>r.backup?.repositoryName || r.object.repositoryName || repositoryId(r) || 'Not reported'
export type Rpo='Within threshold'|'Outside threshold'|'No restore points'|'Unknown'
export function rpoStatus(row:Row,hours:number,now:number):Rpo {
  const stamp=row.latest?.state==='verified' && row.latest.creationTime ? Date.parse(row.latest.creationTime):NaN
  if(Number.isFinite(stamp) && stamp<=now && Number.isFinite(hours) && hours>0)
    return now-stamp<=hours*3600000 ? 'Within threshold':'Outside threshold'
  if(row.points===0 && row.latest?.state!=='verified')return 'No restore points'
  return 'Unknown'
}
export type Issue='all'|'failed'|'noPoints'|'unknown'|'sizeUnknown'|'copies'
export type Filters={query:string;platforms:string[];types:string[];repository:string;coverage:string;run:string;issue:Issue;rpo:Rpo[]}
export const defaults:Filters={query:'',platforms:[],types:[],repository:'all',coverage:'all',run:'all',issue:'all',rpo:[]}
export function issueMatch(row:Row,issue:Issue) {
  return issue==='all' || (issue==='failed' ? row.run==='Failed':issue==='noPoints' ? row.points===0:
    issue==='unknown' ? row.points===null || row.run==='Not reported':issue==='sizeUnknown' ? row.size===null:row.copies>1)
}
export function matches(row:Row,f:Filters,hours=24,now=Date.now()) {
  if(f.platforms.length && !f.platforms.includes(row.object.platformName || 'Not reported') ||
    f.types.length && !f.types.includes(row.object.type || 'Not reported') ||
    f.repository!=='all' && (repositoryId(row)||'unknown')!==f.repository ||
    f.coverage!=='all' && row.coverage!==f.coverage || f.run!=='all' && row.run!==f.run || !issueMatch(row,f.issue) ||
    f.rpo.length && !f.rpo.includes(rpoStatus(row,hours,now)))return false
  return [row.name,row.object.id,row.object.type,row.object.platformName,row.object.path,row.object.objectId,row.object.backupId,
    row.backup?.name,row.backup?.jobId,row.object.jobName,repositoryName(row)].join(' ').toLowerCase().includes(f.query.trim().toLowerCase())
}
export function sorted(rows:Row[],order:string) {
  return [...rows].sort((a,b)=>{
    if(order==='size' || order==='points' || order==='pointsAsc') {
      const av=order==='size' ? a.size:a.points,bv=order==='size' ? b.size:b.points
      if(av===null)return bv===null ? a.name.localeCompare(b.name):1
      if(bv===null)return -1
      if(av!==bv)return (av-bv)*(order==='pointsAsc' ? 1:-1)
    }
    if(order==='risk') {
      const rank=(r:Row)=>r.run==='Failed' ? 0:r.points===0 ? 1:r.points===null || r.run==='Not reported' ? 2:3
      if(rank(a)!==rank(b))return rank(a)-rank(b)
    }
    return a.name.localeCompare(b.name)*(order==='nameDesc' ? -1:1) || a.key.localeCompare(b.key)
  })
}
export function summary(rows:Row[]) {
  const groups=new Map<string,Row[]>()
  for(const row of rows)groups.set(row.object.id,[...(groups.get(row.object.id)||[]),row])
  const sum=(key:'points'|'size')=>{
    const measured=rows.map(r=>r[key]).filter((n):n is number=>n!==null)
    const total=measured.reduce((a,b)=>a+b,0)
    return {value:Number.isSafeInteger(total) && (measured.length || !rows.length) ? total:null,unknown:rows.length-measured.length}
  }
  const platformCounts=new Map<string,Set<string>>()
  for(const r of rows){const p=r.object.platformName || 'Not reported';const ids=platformCounts.get(p)||new Set();ids.add(r.object.id);platformCounts.set(p,ids)}
  return {records:rows.length,workloads:groups.size,withPoints:[...groups.values()].filter(g=>g.some(r=>(r.points||0)>0)).length,
    failed:rows.filter(r=>r.run==='Failed').length,noPoints:rows.filter(r=>r.points===0).length,points:sum('points'),size:sum('size'),
    topPlatform:[...platformCounts].sort((a,b)=>b[1].size-a[1].size || a[0].localeCompare(b[0]))[0]?.[0] || 'Not reported'}
}
