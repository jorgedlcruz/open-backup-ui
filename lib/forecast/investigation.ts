import {DAY,repositoryBackups,uniqueFiles,type BackupPlan,type ForecastFile,type ForecastSnapshot,type Policy} from './model'
import type {RepositoryConfig} from '../repositories/model'

export const retentionCategories={within:'Within short-term window',gfs:'GFS-tagged',dependency:'Chain dependency',hold:'Configured hold window',review:'Past window · review',unknown:'Evidence unresolved'} as const
export type RetentionCategory=keyof typeof retentionCategories
export type RetentionRow={id:string;backup:BackupPlan;file:ForecastFile;workloads:string[];bytes:number|null;at:number|null;category:RetentionCategory;reason:string;outside:boolean|null;holdUntil:number|null;holdLabel:string;policy?:Policy}
const stamp=(s?:string|null)=>s&&Number.isFinite(Date.parse(s))?Date.parse(s):null
const knownBytes=(n?:number|null)=>n!=null&&Number.isSafeInteger(n)&&n>=0?n:null
const memberKey=(file:ForecastFile)=>[...new Set(file.objectIds||[])].sort().join(',')
const full=(file:ForecastFile)=>/\.vbk$/i.test(file.name||'')
const increment=(file:ForecastFile)=>/\.vib$/i.test(file.name||'')
const gfs=(file:ForecastFile)=>!!file.gfsPeriods?.some(p=>p!=='None')
export const workloadNames=(backup:BackupPlan)=>[...new Set((backup.workloads||[]).map(w=>w.name||w.id))]

export function immutabilityPolicy(config?:RepositoryConfig) {
  const value=config?.repository
  if(config?.type==='LinuxHardened'&&value?.makeRecentBackupsImmutableDays!=null&&value.makeRecentBackupsImmutableDays>0)return {days:value.makeRecentBackupsImmutableDays,label:`${value.makeRecentBackupsImmutableDays} days · hardened repository`,chainEstimate:true}
  if(config?.type==='LinuxLocal'&&value?.enableGovernanceMode===true&&value.governanceModeRetentionDays!=null&&value.governanceModeRetentionDays>0)return {days:value.governanceModeRetentionDays,label:`${value.governanceModeRetentionDays} days · governance`,chainEstimate:false}
  if(config?.type==='LinuxLocal'&&value?.enableGovernanceMode===false)return {days:0,label:'Repository governance disabled',chainEstimate:false}
  const storage=config?.bucket?.immutability||config?.container?.immutability
  if(storage?.isEnabled===false)return {days:0,label:'Object immutability disabled',chainEstimate:false}
  if(storage?.isEnabled===true)return {days:storage.immutabilityMode==='RepositorySettings'&&storage.daysCount!=null&&storage.daysCount>0?storage.daysCount:null,label:storage.immutabilityMode==='RetentionSettings'?'Object lock follows retention · expiry not reported':`${storage.daysCount??'Unknown'} days + storage generation rules`,chainEstimate:false}
  return {days:null,label:'File lock expiry not reported',chainEstimate:false}
}

/** Mutually exclusive primary reasons; these are file bytes, never reclaimable disk blocks. */
export function retentionAnalysis(snapshot:ForecastSnapshot,repositoryId:string,now=Date.parse(snapshot.fetchedAt)) {
  const backups=repositoryBackups(snapshot,repositoryId),rows:RetentionRow[]=[],policyGaps:{backup:BackupPlan;retentionDays:number;immutableDays:number;gapDays:number}[]=[]
  const globalConflicts=new Set(uniqueFiles(backups.flatMap(b=>b.files)).conflictingIds)
  for(const backup of backups) {
    const policy=snapshot.policies.data.find(p=>p.id===backup.jobId),config=snapshot.configs.data.find(r=>r.id===backup.repositoryId),hold=immutabilityPolicy(config),retention=policy?.storage?.retentionPolicy
    const unique=uniqueFiles(backup.files),files=unique.files.filter(f=>!globalConflicts.has(f.id))
    const quantity=retention?.quantity
    if(retention?.type==='Days'&&quantity!=null&&quantity>0&&hold.days!=null&&hold.days>quantity)policyGaps.push({backup,retentionDays:quantity,immutableDays:hold.days,gapDays:hold.days-quantity})
    const map=new Map(files.map(file=>[file.id,{id:file.id,backup,file,workloads:(backup.workloads||[]).filter(w=>file.objectIds?.includes(w.id)).map(w=>w.name||w.id),bytes:knownBytes(file.backupSize),at:stamp(file.creationTime),category:gfs(file)?'gfs':'unknown',reason:gfs(file)?`VBR reports ${file.gfsPeriods!.filter(p=>p!=='None').join(', ')} archival flags. An expiry date is not reported.`:'File membership, dates, job type or retention policy cannot establish a short-term window.',outside:null,holdUntil:null,holdLabel:hold.label,policy} as RetentionRow]))
    const owners=new Map<string,string>(),overlap=new Set<string>(),groups=new Map<string,ForecastFile[]>()
    for(const file of files) {
      const key=memberKey(file);groups.set(key,[...groups.get(key)||[],file])
      for(const id of file.objectIds||[]){const owner=owners.get(id);if(owner&&owner!==key){overlap.add(owner);overlap.add(key)}else owners.set(id,key)}
    }
    if(backup.complete&&!unique.conflicts&&!backup.files.some(f=>globalConflicts.has(f.id))&&['VSphereBackup','HyperVBackup'].includes(policy?.type||'')&&policy?.storage?.advancedSettings?.backupModeType==='Incremental'&&quantity!=null&&Number.isInteger(quantity)&&quantity>0&&['Days','RestorePoints'].includes(retention?.type||''))for(const [key,group] of groups) {
      if(!key||overlap.has(key)||group.some(f=>stamp(f.creationTime)===null||stamp(f.creationTime)!>now||!full(f)&&!increment(f)))continue
      const sorted=[...group].sort((a,b)=>stamp(a.creationTime)!-stamp(b.creationTime)!||Number(full(b))-Number(full(a)))
      // Count-based windows are only resolved when each file carries one unique
      // restore-point reference per member. Missing references remain unknown.
      if(retention?.type==='RestorePoints') {
        const seen=new Set<string>();let clear=true
        for(const file of sorted){const ids=[...new Set(file.restorePointIds||[])];if(ids.length!==new Set(file.objectIds).size||ids.some(id=>seen.has(id)))clear=false;ids.forEach(id=>seen.add(id))}
        if(!clear)continue
      }
      const within=new Set((retention?.type==='Days'?sorted.filter(f=>stamp(f.creationTime)!>=now-quantity*DAY):sorted.slice(-quantity)).map(f=>f.id))
      const chains:ForecastFile[][]=[]
      for(const file of sorted){if(full(file))chains.push([]);if(chains.length)chains.at(-1)!.push(file)}
      for(const [index,chain] of chains.entries()) {
        const needed=chain.some(f=>within.has(f.id)),active=index===chains.length-1,latest=stamp(chain.at(-1)!.creationTime)!
        const holdUntil=hold.chainEstimate&&hold.days!=null?latest+hold.days*DAY:null
        for(const file of chain) {
          const row=map.get(file.id)!;row.outside=!within.has(file.id);row.holdUntil=holdUntil
          if(gfs(file))continue
          if(within.has(file.id)){row.category='within';row.reason='File creation is inside the current short-term retention window.'}
          else if(holdUntil!==null&&holdUntil>now){row.category='hold';row.reason='The last file in this chain plus the current hardened-repository period reaches beyond today. This is a planning estimate; actual lock attributes and earlier policy settings are not returned.'}
          else if(needed||active){row.category='dependency';row.reason=needed?'An in-window increment still depends on this full/incremental chain.':'This is the latest retained chain. Its baseline/merge dependencies need review in VBR before removal.'}
          else {row.category='review';row.reason='Every loaded file in this inactive chain is outside the short-term window. Review GFS, file locks, background retention and storage placement in VBR; this is not a deletion recommendation.'}
        }
      }
    }
    rows.push(...map.values())
  }
  const categories=(Object.keys(retentionCategories) as RetentionCategory[]).map(key=>({key,label:retentionCategories[key],count:rows.filter(r=>r.category===key).length,known:rows.filter(r=>r.category===key&&r.bytes!==null).length,bytes:rows.filter(r=>r.category===key&&r.bytes!==null).reduce((sum,r)=>sum+r.bytes!,0)}))
  return {rows,categories,policyGaps,knownBytes:rows.some(r=>r.bytes!==null)?rows.reduce((sum,r)=>sum+(r.bytes||0),0):null,unknownSizes:rows.filter(r=>r.bytes===null).length,unmeasuredBackups:backups.filter(b=>!b.complete||!b.files.length).length,conflicts:globalConflicts.size}
}

export type HygieneFlag={key:'stale'|'empty'|'unlinked'|'missing-job'|'job-unknown'|'disabled'|'chain'|'membership'|'evidence';label:string;detail:string;attention:boolean}
export function hygieneAnalysis(snapshot:ForecastSnapshot,repositoryId:string,staleDays=14,now=Date.parse(snapshot.fetchedAt)) {
  return repositoryBackups(snapshot,repositoryId).map(backup=>{
    const policy=snapshot.policies.data.find(p=>p.id===backup.jobId),unique=uniqueFiles(backup.files),files=unique.files,flags:HygieneFlag[]=[]
    const point=backup.latestPoint,pointTime=point?.state==='verified'?stamp(point.at):null
    const latestPoint=pointTime!==null&&pointTime<=now?pointTime:null
    const times=files.map(f=>stamp(f.creationTime)).filter((t):t is number=>t!==null&&t<=now),latestFile=times.length?Math.max(...times):null
    const add=(key:HygieneFlag['key'],label:string,detail:string,attention=true)=>flags.push({key,label,detail,attention})
    if(latestPoint!==null&&latestPoint<now-staleDays*DAY)add('stale',`No restore point in ${staleDays} days`,'The latest scoped restore-point query returned this recovery time. Archive-only or intentionally stopped backups may be expected.')
    else if(point?.state==='empty')add('empty','No restore points returned','The scoped endpoint returned no points. Verify the backup type and VBR inventory; files are not assumed safe to remove.')
    else if(latestPoint===null)add('evidence','Recovery age unknown',point?.reason||'Latest restore-point evidence is unavailable.',false)
    if(!backup.jobId||/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(backup.jobId))add('unlinked','No job reference','This backup has no usable job reference. Imported or detached backups may be intentional.')
    else if(!policy&&snapshot.policies.available&&snapshot.policies.complete)add('missing-job','Job not in inventory','The referenced job is absent from the complete returned job inventory. Treat this as an orphan candidate, not confirmed deletion eligibility.')
    else if(!policy)add('job-unknown','Job linkage unresolved','Job inventory is partial or unavailable. This backup cannot be classified as orphaned.',false)
    if(policy?.isDisabled===true||policy?.schedule?.runAutomatically===false)add('disabled','Automatic runs disabled','Current job settings disable automatic runs. Manual backup and retention behavior may still apply.',false)
    if(!backup.complete||unique.conflicts||files.some(f=>knownBytes(f.backupSize)===null))add('evidence','File evidence incomplete',backup.issue||'Some file sizes or identities are unresolved.',false)
    if(files.some(f=>!f.objectIds?.length))add('membership','Unmapped workload files','Some files have no explicit workload membership. Their bytes remain in the backup subtotal.',false)
    if(backup.complete){const groups=new Map<string,ForecastFile[]>();for(const f of files){const key=memberKey(f);if(key)groups.set(key,[...groups.get(key)||[],f])}if([...groups.values()].some(group=>group.some(increment)&&!group.some(full)))add('chain','Full baseline not reported','A complete file listing has increments without a reported .vbk for that membership. Investigate storage tiers and chain metadata in VBR.')}
    return {backup,policy,workloads:workloadNames(backup),latestPoint,latestFile,flags,attention:flags.some(f=>f.attention),bytes:files.some(f=>knownBytes(f.backupSize)!==null)?files.reduce((sum,f)=>sum+(knownBytes(f.backupSize)||0),0):null,shared:files.filter(f=>(f.objectIds?.length||0)>1).length}
  })
}
