'use client'
// Open Backup UI v1.0.2

import { useVbmPresentation } from '@/components/vbm-jobs/presentation'
import { Trans } from "@/components/providers/i18n-provider"
import { useEffect,useState,useRef } from 'react'
import { SortableGrid } from '@/components/ui/sortable-grid'

import Link from 'next/link'
import { ArrowUpRight,Briefcase,Shield,Mail,Files,MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel,Empty } from '@/components/investigation/shared'

import { capacity,kinds } from '@/lib/vbm-dashboard/model'

import { services,protectedHref,jobsHref,type Row,type Organization,type Snapshot } from '@/lib/vbm-organizations/model'
import { cn } from '@/lib/utils'
import ops from '@/components/operations/operations.module.css'
import shared from '@/components/vbm-dashboard/vbm-dashboard.module.css'
import styles from './organizations.module.css'
export function useOrganizationRefresh() {
  const [revision,setRevision]=useState(0),[automatic,setAutomatic]=useState(true)
  const busy=useRef(false)
  useEffect(()=>{if(!automatic)return;const timer=setInterval(()=>{if(!document.hidden && !busy.current)setRevision(value=>value+1)},30000);return()=>clearInterval(timer)},[automatic])
  return {revision,refresh:()=>setRevision(value=>value+1),automatic,setAutomatic,busy}
}
export function Services({organization}:{organization:Organization}) {
  const {t}=useVbmPresentation()



const icons=[Mail,Files,MessageSquare];return <div className={styles.services}>{services.map((service,index)=>{const Icon=icons[index],value=organization[service.key];return <span key={service.key} className={cn(ops.badge,value===true ? ops.active:ops.neutral)} title={`${service.name}: ${value===true ? t('Enabled'):value===false ? t('Disabled'):t('Not reported')}`}><Icon size={11}/>{service.short} {value==null ? '?':value ? t("On"):t("Off")}</span>})}</div>}
export function OrganizationLinks({organization}:{organization:Organization}) {return <div className={shared.actions}><Button size="sm" variant="outline" asChild><Link href={protectedHref(organization)}><Shield size={13}/><Trans>{"See Protected Items"}</Trans><ArrowUpRight size={12}/></Link></Button><Button size="sm" variant="outline" asChild><Link href={jobsHref(organization)}><Briefcase size={13}/><Trans>{"See Backup Jobs"}</Trans><ArrowUpRight size={12}/></Link></Button></div>}
export function CoverageCounts({data,row}:{data:Snapshot;row:Row}) {
  const {t,localLabel,localCount}=useVbmPresentation()



return <div className={shared.coverageCards}>{kinds.map(kind=><div key={kind}><span>{kind==='Sites' ? t("SharePoint sites"):localLabel(kind)}</span><strong>{localCount(data.protected[kind],row.protected[kind].length)}</strong><small><Trans>{"Retained protected records"}</Trans></small></div>)}</div>}
export function StorageTable({data,rows}:{data:Snapshot;rows:Row[]}) {
  const {t,formatNumber,number,bytes,localLabel,localLookup}=useVbmPresentation()



  const records=rows.flatMap(row=>row.usage.data.map(usage=>({row,usage})))
  return <Panel title={t("Organization storage usage")} subtitle={t("Usage is attributed by the API to each organization and repository. Repository capacity is shared infrastructure, not a tenant quota.")}><div className={ops.tableScroll} role="region" aria-label={t("Organization storage usage")} tabIndex={0}><SortableGrid rows={records} columns={[{id:'name',value:r=>localLookup(data.repositories.data,r.usage.repositoryId)},{id:'available',value:r=>r.usage.isAvailable},{id:'used',value:r=>r.usage.usedSpaceBytes},{id:'cache',value:r=>r.usage.localCacheUsedSpaceBytes},{id:'object',value:r=>r.usage.objectStorageUsedSpaceBytes},{id:'count',value:r=>r.usage.protectedObjectsCount},{id:'capacity',value:r=>(()=>{const repo=data.repositories.data.find(repo=>repo.id===r.usage.repositoryId);return repo?capacity(repo).primary?.percent:null})()}]}>{(records)=>(<table className={cn(ops.table,styles.storageTable)}><thead><tr><th><Trans>{"Organization / repository"}</Trans></th><th><Trans>{"Availability / issues"}</Trans></th><th><Trans>{"Reported used space"}</Trans></th><th><Trans>{"Local cache"}</Trans></th><th><Trans>{"Object storage"}</Trans></th><th><Trans>{"Protected count"}</Trans></th><th><Trans>{"Shared capacity"}</Trans></th></tr></thead><tbody>{records.map(({row,usage})=>{const repo=data.repositories.data.find(repo=>repo.id===usage.repositoryId),cap=repo ? capacity(repo):null,problems=row.repositoryProblems.filter(problem=>problem.repositoryId===usage.repositoryId);return <tr key={`${row.org.id}:${usage.repositoryId}`}><td><strong>{localLookup(data.repositories.data,usage.repositoryId)}</strong><p className={shared.sub}>{row.org.name || row.org.id}{!row.usage.complete && t(" · Partial usage")}</p></td><td><span className={cn(ops.badge,usage.isAvailable===true ? ops.success:usage.isAvailable===false ? ops.danger:ops.neutral)}>{usage.isAvailable===true ? t("Available"):usage.isAvailable===false ? t("Unavailable"):t("Unknown")}</span>{problems.map(problem=><p key={problem.reason} className={cn(shared.sub,ops.warning)}>{localLabel(problem.reason)}</p>)}</td><td>{bytes(usage.usedSpaceBytes)}</td><td>{bytes(usage.localCacheUsedSpaceBytes)}</td><td>{bytes(usage.objectStorageUsedSpaceBytes)}</td><td>{number(usage.protectedObjectsCount)}</td><td>{cap?.primary ? t("{percent} used", {percent: formatNumber(cap.primary.percent/100,{style:"percent",maximumFractionDigits:1})}):repo?.objectStorage?.sizeLimitEnabled===false ? t("No object quota"):t("Not reported")}<p className={shared.sub}>{cap?.primary ? t("{size} free · {detail}", {size: bytes(cap.primary.free), detail: localLabel(cap.scope)}):cap?.scope ? localLabel(cap.scope):t("Repository details unavailable")}</p></td></tr>})}</tbody></table>)}</SortableGrid></div>{!records.length && <Empty>{rows.some(row=>!row.usage.available) ? t("Storage measurements are unavailable for the matching organizations."):t("No repository usage records were returned for the matching organizations.")}</Empty>}<p className={ops.panelFoot}><Trans>{"Reported used space is separate from cache + object storage and is not added to that total. Repository protected counts may overlap across copies and are not summed as unique objects."}</Trans></p></Panel>
}
