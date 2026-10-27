import { z } from 'zod'
import { opaqueId } from '../vbm-protected/model'
import { validId } from '../investigation/model'
import { type Evidence } from '../vbm-dashboard/model'
const text=z.string().nullish(),bool=z.boolean().nullish(),ref=text.transform(value=>value?.toLowerCase())
export const quantity=z.union([z.number(),z.string()]).nullish().transform(value=>{const n=typeof value==='string' && /^\d+(\.\d+)?$/.test(value) ? Number(value):value;return typeof n==='number' && Number.isFinite(n) && n>=0 && n<=Number.MAX_SAFE_INTEGER ? n:null})
export const instanceSchema=z.object({instanceId:opaqueId,platformType:text,name:text,displayName:text,hostName:text,usedInstancesNumber:quantity,type:text,canBeRevoked:bool})
export const socketSchema=z.object({hostId:opaqueId,name:text,hostName:text,socketsNumber:quantity,coresNumber:quantity,type:text,canBeRevoked:bool})
export const capacityWorkloadSchema=z.object({instanceId:opaqueId,name:text,displayName:text,hostName:text,usedCapacityTb:quantity,type:text,canBeRevoked:bool})
export const vbrSchema=z.object({status:text,type:text,edition:text,cloudConnect:text,expirationDate:text,supportExpirationDate:text,licensedTo:text,supportId:text,
  autoUpdateEnabled:bool,freeAgentInstanceConsumptionEnabled:bool,IsMultiSection:bool,proactiveSupportEnabled:bool,
  instanceLicenseSummary:z.object({package:text,licensedInstancesNumber:quantity,usedInstancesNumber:quantity,newInstancesNumber:quantity,rentalInstancesNumber:quantity,
    promoInstancesNumber:quantity,licensedInstancesPromoIncludedNumber:quantity,promoExpiresOn:text,expirationDate:text,supportExpirationDate:text,
    objects:z.array(z.object({type:text,count:quantity,multiplier:quantity,usedInstancesNumber:quantity})).nullish(),workload:z.array(instanceSchema).nullish()}).nullish(),
  socketLicenseSummary:z.object({package:text,licensedSocketsNumber:quantity,usedSocketsNumber:quantity,remainingSocketsNumber:quantity,expirationDate:text,supportExpirationDate:text,workload:z.array(socketSchema).nullish()}).nullish(),
  capacityLicenseSummary:z.object({licensedCapacityTb:quantity,usedCapacityTb:quantity,expirationDate:text,supportExpirationDate:text,
    objects:z.array(z.object({type:text,usedCapacityTb:quantity})).nullish(),workload:z.array(capacityWorkloadSchema).nullish()}).nullish()})
export const vbmSchema=z.object({licenseID:text,email:text,status:text,licenseExpires:text,gracePeriodExpires:text,type:text,package:text,licensedTo:text,totalNumber:quantity,usedNumber:quantity,newNumber:quantity,supportID:text})
// Tenant-qualified licensed-user IDs are opaque and case-sensitive; do not UUID-validate or lowercase them.
export const userSchema=z.object({id:opaqueId,name:text,isBackedUp:bool,lastBackupDate:text,licenseState:text,organizationId:ref,backedUpOrganizationId:text,organizationName:text})
export type VbrLicense=z.infer<typeof vbrSchema>
export type VbmLicense=z.infer<typeof vbmSchema>
export type LicensedUser=z.infer<typeof userSchema>
export type Platform='vbr'|'vbm'
export const platforms={vbr:'Veeam Backup & Replication',vbm:'Microsoft 365'}
export type Snapshot={platform:Platform;sourceName:string;fetchedAt:string;warnings:string[];vbr:VbrLicense|null;vbm:VbmLicense|null;users:Evidence<LicensedUser>;autoUpdate:boolean|null}
export const number=(value?:number|null)=>value==null ? 'Unknown':value!==0 && Math.abs(value)<0.001 ? value.toPrecision(3):value.toLocaleString(undefined,{maximumFractionDigits:3})
export function timestamp(value?:string|null) {if(!value)return null;const n=Date.parse(value),year=new Date(n).getUTCFullYear();return Number.isFinite(n) && year>=1970 && year<9999 ? n:null}
export const date=(value?:string|null)=>timestamp(value)===null ? 'Not reported':new Date(value!).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})
export function deadline(value:string|null|undefined,now:string,days:number) {
  const at=timestamp(value),current=timestamp(now)
  if(at===null || current===null)return {value:value || null,days:null,state:'unknown' as const,label:'Not reported'}
  const delta=at-current,remaining=Math.ceil(delta/86400000)
  return {value:value!,days:remaining,state:delta<=0 ? 'expired' as const:delta<=days*86400000 ? 'soon' as const:'future' as const,label:delta<=0 ? 'Expired':`${remaining} day${remaining===1 ? '':'s'} remaining`}
}
export function usage(used:number|null|undefined,total:number|null|undefined) {
  const known=used!=null && total!=null,ratio=known && total>0 ? used/total*100:null,percent=ratio!==null && Number.isFinite(ratio) ? ratio:null
  return {used:used ?? null,total:total ?? null,percent,remaining:known ? total-used:null,
    state:!known ? 'unknown':used>total ? 'over':total===0 ? 'zero':used===total ? 'full':percent!==null && percent>=80 ? 'low':'normal'}
}
export type Entitlement={key:string;platform:Platform;kind:'instances'|'sockets'|'capacity'|'users'|'license';name:string;unit:string;status:string|null|undefined;type:string|null|undefined;sourceName:string;
  usage:ReturnType<typeof usage>;expires:ReturnType<typeof deadline>;support:ReturnType<typeof deadline>|null;promo:ReturnType<typeof deadline>|null;grace:ReturnType<typeof deadline>|null;
  totalBasis:string;newCount:number|null;rental:number|null;promoCount:number|null;apiRemaining:number|null;issues:{kind:'health'|'capacity'|'expiry'|'unknown';label:string}[]}
export function entitlements(data:Snapshot,days=90):Entitlement[] {
  const rows:Entitlement[]=[],vbr=data.vbr,vbm=data.vbm
  const add=(kind:Entitlement['kind'],name:string,unit:string,used:number|null|undefined,total:number|null|undefined,expires:string|null|undefined,support?:string|null,extras?:Partial<Entitlement>)=>{
    const row:Entitlement={key:`${data.platform}:${kind}`,platform:data.platform,kind,name,unit,sourceName:data.sourceName,status:vbr?.status || vbm?.status,type:vbr?.type || vbm?.type,
      usage:usage(used,total),expires:deadline(expires,data.fetchedAt,days),support:support==null ? null:deadline(support,data.fetchedAt,days),promo:null,grace:null,totalBasis:'Reported entitlement',newCount:null,rental:null,promoCount:null,apiRemaining:null,issues:[],...extras}
    if(['Expired','Invalid'].includes(row.status || ''))row.issues.push({kind:'health',label:`License status: ${row.status}`})
    else if(row.status!=='Valid')row.issues.push({kind:'unknown',label:`License status: ${row.status || 'not reported'}`})
    if(['over','full','low'].includes(row.usage.state))row.issues.push({kind:'capacity',label:row.usage.state==='over' ? 'Reported usage exceeds entitlement':row.usage.state==='full' ? 'Entitlement fully consumed':'Less than 20% headroom'})
    if(row.usage.state==='unknown')row.issues.push({kind:'unknown',label:'Usage or entitlement not reported'})
    for(const [label,value] of [['License',row.expires],['Support',row.support],['Promo',row.promo]] as const)if(value){if(value.state==='expired' || value.state==='soon')row.issues.push({kind:'expiry',label:`${label} ${value.state==='expired' ? 'expired':`expires within ${days} days`}`});else if(value.state==='unknown')row.issues.push({kind:'unknown',label:`${label} expiration not reported`})}
    if(row.grace && (row.expires.state==='expired' || row.status==='Expired'))row.issues.push({kind:'expiry',label:row.grace.state==='expired' ? 'Grace period ended':row.grace.state==='unknown' ? 'Grace-period end not reported':`Grace period ends ${date(row.grace.value)}`})
    rows.push(row)
  }
  if(vbr){const i=vbr.instanceLicenseSummary,s=vbr.socketLicenseSummary,c=vbr.capacityLicenseSummary
    if(i)add('instances','VBR instances','instances',i.usedInstancesNumber,i.licensedInstancesPromoIncludedNumber ?? i.licensedInstancesNumber,i.expirationDate ?? vbr.expirationDate,i.supportExpirationDate ?? vbr.supportExpirationDate,
      {newCount:i.newInstancesNumber,rental:i.rentalInstancesNumber,promoCount:i.promoInstancesNumber,totalBasis:i.licensedInstancesPromoIncludedNumber!==null ? 'Reported entitlement including promo':'Reported instance entitlement',promo:i.promoExpiresOn || (i.promoInstancesNumber!==null && i.promoInstancesNumber>0) ? deadline(i.promoExpiresOn,data.fetchedAt,days):null})
    if(s)add('sockets','VBR sockets','sockets',s.usedSocketsNumber,s.licensedSocketsNumber,s.expirationDate ?? vbr.expirationDate,s.supportExpirationDate ?? vbr.supportExpirationDate,{apiRemaining:s.remainingSocketsNumber})
    if(c)add('capacity','VBR capacity','TB',c.usedCapacityTb,c.licensedCapacityTb,c.expirationDate ?? vbr.expirationDate,c.supportExpirationDate ?? vbr.supportExpirationDate)
    if(!i && !s && !c)add('license','VBR license','',null,null,vbr.expirationDate,vbr.supportExpirationDate)
  }
  if(vbm)add('users','Microsoft 365 users','users',vbm.usedNumber,vbm.totalNumber,vbm.licenseExpires,undefined,{newCount:vbm.newNumber,grace:deadline(vbm.gracePeriodExpires,data.fetchedAt,days)})
  return rows
}
export const licenseIssues=[['all','All licenses'],['attention','Needs attention'],['capacity','Capacity risk'],['over','Over entitlement'],['expiry','Expiration / support'],['health','Expired / invalid'],['unknown','Unknown evidence']] as const
export type LicenseIssue=typeof licenseIssues[number][0]
export function matchesLicense(row:Entitlement,issue:LicenseIssue) {return issue==='all' || (issue==='attention' ? row.issues.length>0:issue==='over' ? row.usage.state==='over':issue==='health' ? row.expires.state==='expired' || row.issues.some(value=>value.kind==='health'):row.issues.some(value=>value.kind===issue))}
export type Consumer={key:string;platform:Platform;kind:'instances'|'sockets'|'capacity'|'users';id:string;name:string;displayName?:string|null;host?:string|null;type?:string|null;platformType?:string|null;
  unit:string;used:number|null;cores?:number|null;organization?:string|null;organizationId?:string|null;backedUpOrganizationId?:string|null;state?:string|null;lastBackup?:string|null;isBackedUp?:boolean|null;
  revoke:'instances'|'sockets'|'capacity'|'user'|null;revokeEvidence:'reported'|'server'|'unavailable';issues:string[];stale:boolean;unknown:boolean}
export function consumers(data:Snapshot,staleDays=31):Consumer[] {
  const rows:Consumer[]=[],v=data.vbr
  for(const item of v?.instanceLicenseSummary?.workload || [])rows.push({key:`vbr:instances:${item.instanceId}`,platform:'vbr',kind:'instances',id:item.instanceId,name:item.name || item.instanceId,displayName:item.displayName,host:item.hostName,type:item.type,platformType:item.platformType,unit:'instances',used:item.usedInstancesNumber,revoke:item.canBeRevoked===true && validId(item.instanceId) ? item.platformType==='UnstructuredData' ? 'capacity':'instances':null,revokeEvidence:item.canBeRevoked==null ? 'unavailable':'reported',issues:[],stale:false,unknown:item.usedInstancesNumber===null})
  for(const item of v?.socketLicenseSummary?.workload || [])rows.push({key:`vbr:sockets:${item.hostId}`,platform:'vbr',kind:'sockets',id:item.hostId,name:item.name || item.hostId,host:item.hostName,type:item.type,unit:'sockets',used:item.socketsNumber,cores:item.coresNumber,revoke:validId(item.hostId) && item.canBeRevoked!==false ? 'sockets':null,revokeEvidence:item.canBeRevoked==null ? 'server':'reported',issues:[],stale:false,unknown:item.socketsNumber===null})
  for(const item of v?.capacityLicenseSummary?.workload || [])rows.push({key:`vbr:capacity:${item.instanceId}`,platform:'vbr',kind:'capacity',id:item.instanceId,name:item.name || item.instanceId,displayName:item.displayName,host:item.hostName,type:item.type,unit:'TB',used:item.usedCapacityTb,revoke:validId(item.instanceId) && item.canBeRevoked!==false ? 'capacity':null,revokeEvidence:item.canBeRevoked==null ? 'server':'reported',issues:[],stale:false,unknown:item.usedCapacityTb===null})
  for(const user of data.users.data){const backup=timestamp(user.lastBackupDate),now=timestamp(data.fetchedAt)!,stale=backup!==null && now-backup>staleDays*86400000,
    unknown=user.isBackedUp==null || (user.isBackedUp!==false && (backup===null || backup>now)) || !['Licensed','Unlicensed','New'].includes(user.licenseState || '')
    rows.push({key:`vbm:users:${user.organizationId || ''}:${user.backedUpOrganizationId || ''}:${user.id}`,platform:'vbm',kind:'users',id:user.id,name:user.name || user.id,unit:'users',used:null,
      organization:user.organizationName,organizationId:user.organizationId,backedUpOrganizationId:user.backedUpOrganizationId,state:user.licenseState,lastBackup:user.lastBackupDate,isBackedUp:user.isBackedUp,
      revoke:'user',revokeEvidence:'server',stale,unknown,issues:[...(stale ? [`Last backup older than ${staleDays} days`]:[]),...(user.isBackedUp===false ? ['No backup reported']:[]),...(user.licenseState==='Unlicensed' ? ['Unlicensed']:[])]})}
  for(const row of rows)if(row.unknown)row.issues.push('Some evidence is unknown')
  return rows
}
export const consumerIssues=[['all','All consumers'],['attention','Needs review'],['stale','Older backups'],['noBackup','No backup reported'],['unlicensed','Unlicensed'],['revocable','Revocable (API)'],['zero','Zero consumption'],['unknown','Unknown evidence']] as const
export type ConsumerIssue=typeof consumerIssues[number][0]
export function matchesConsumer(row:Consumer,issue:ConsumerIssue) {return issue==='all' || (issue==='attention' ? row.issues.length>0:issue==='stale' ? row.stale:issue==='noBackup' ? row.isBackedUp===false:issue==='unlicensed' ? row.state==='Unlicensed':issue==='revocable' ? row.revoke!==null && row.revokeEvidence==='reported':issue==='zero' ? row.used===0:row.unknown)}
export type ConsumerFilters={query:string;kind:string;issue:ConsumerIssue;types:string[];organization:string;sort:'name'|'usage'|'backup'}
export const emptyFilters:ConsumerFilters={query:'',kind:'all',issue:'all',types:[],organization:'all',sort:'name'}
export function consumerCoverage(data:Snapshot) {if(data.platform==='vbm')return data.users.available && data.users.complete;if(!data.vbr)return false;const sections=[data.vbr.instanceLicenseSummary,data.vbr.socketLicenseSummary,data.vbr.capacityLicenseSummary].filter(Boolean);return sections.length>0 && sections.every(section=>section?.workload!=null)}
export function filterConsumers(rows:Consumer[],filters:ConsumerFilters) {return rows.filter(row=>(filters.kind==='all' || row.kind===filters.kind) && matchesConsumer(row,filters.issue) && (!filters.types.length || filters.types.includes(row.type || row.state || 'Not reported')) && (filters.organization==='all' || row.organizationId===filters.organization) && [row.id,row.name,row.displayName,row.host,row.type,row.platformType,row.organization,row.state,...row.issues].join(' ').toLowerCase().includes(filters.query.trim().toLowerCase()))
  .sort((a,b)=>filters.sort==='usage' ? a.unit.localeCompare(b.unit) || (b.used ?? -1)-(a.used ?? -1) || a.name.localeCompare(b.name):filters.sort==='backup' ? (timestamp(a.lastBackup) ?? Infinity)-(timestamp(b.lastBackup) ?? Infinity) || a.name.localeCompare(b.name):a.name.localeCompare(b.name))}
