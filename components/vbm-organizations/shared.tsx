'use client'
import { useEffect,useState,useRef } from 'react'
import { SortableGrid } from '@/components/ui/sortable-grid'

import Link from 'next/link'
import { ArrowUpRight,Briefcase,Shield,Mail,Files,MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel,Empty } from '@/components/investigation/shared'
import { formatBytes } from '@/lib/restore-points/model'
import { capacity,kinds } from '@/lib/vbm-dashboard/model'
import { lookup } from '@/lib/vbm-protected/model'
import { services,count,protectedHref,jobsHref,type Row,type Organization,type Snapshot } from '@/lib/vbm-organizations/model'
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
export function Services({organization}:{organization:Organization}) {const icons=[Mail,Files,MessageSquare];return <div className={styles.services}>{services.map((service,index)=>{const Icon=icons[index],value=organization[service.key];return <span key={service.key} className={cn(ops.badge,value===true ? ops.active:ops.neutral)} title={`${service.name}: ${value===true ? 'Enabled':value===false ? 'Disabled':'Not reported'}`}><Icon size={11}/>{service.short} {value==null ? '?':value ? 'On':'Off'}</span>})}</div>}
export function OrganizationLinks({organization}:{organization:Organization}) {return <div className={shared.actions}><Button size="sm" variant="outline" asChild><Link href={protectedHref(organization)}><Shield size={13}/>See Protected Items<ArrowUpRight size={12}/></Link></Button><Button size="sm" variant="outline" asChild><Link href={jobsHref(organization)}><Briefcase size={13}/>See Backup Jobs<ArrowUpRight size={12}/></Link></Button></div>}
export function CoverageCounts({data,row}:{data:Snapshot;row:Row}) {return <div className={shared.coverageCards}>{kinds.map(kind=><div key={kind}><span>{kind==='Sites' ? 'SharePoint sites':kind}</span><strong>{count(data.protected[kind],row.protected[kind].length)}</strong><small>Retained protected records</small></div>)}</div>}
export function StorageTable({data,rows}:{data:Snapshot;rows:Row[]}) {
  const records=rows.flatMap(row=>row.usage.data.map(usage=>({row,usage})))
  return <Panel title="Organization storage usage" subtitle="Usage is attributed by the API to each organization and repository. Repository capacity is shared infrastructure, not a tenant quota."><div className={ops.tableScroll} role="region" aria-label="Organization storage usage" tabIndex={0}><SortableGrid rows={records} columns={[{id:'name',value:r=>lookup(data.repositories.data,r.usage.repositoryId)},{id:'available',value:r=>r.usage.isAvailable},{id:'used',value:r=>r.usage.usedSpaceBytes},{id:'cache',value:r=>r.usage.localCacheUsedSpaceBytes},{id:'object',value:r=>r.usage.objectStorageUsedSpaceBytes},{id:'count',value:r=>r.usage.protectedObjectsCount},{id:'capacity',value:r=>(()=>{const repo=data.repositories.data.find(repo=>repo.id===r.usage.repositoryId);return repo?capacity(repo).primary?.percent:null})()}]}>{(records)=>(<table className={cn(ops.table,styles.storageTable)}><thead><tr><th>Organization / repository</th><th>Availability / issues</th><th>Reported used space</th><th>Local cache</th><th>Object storage</th><th>Protected count</th><th>Shared capacity</th></tr></thead><tbody>{records.map(({row,usage})=>{const repo=data.repositories.data.find(repo=>repo.id===usage.repositoryId),cap=repo ? capacity(repo):null,problems=row.repositoryProblems.filter(problem=>problem.repositoryId===usage.repositoryId);return <tr key={`${row.org.id}:${usage.repositoryId}`}><td><strong>{lookup(data.repositories.data,usage.repositoryId)}</strong><p className={shared.sub}>{row.org.name || row.org.id}{!row.usage.complete && ' · Partial usage'}</p></td><td><span className={cn(ops.badge,usage.isAvailable===true ? ops.success:usage.isAvailable===false ? ops.danger:ops.neutral)}>{usage.isAvailable===true ? 'Available':usage.isAvailable===false ? 'Unavailable':'Unknown'}</span>{problems.map(problem=><p key={problem.reason} className={cn(shared.sub,ops.warning)}>{problem.reason}</p>)}</td><td>{formatBytes(usage.usedSpaceBytes)}</td><td>{formatBytes(usage.localCacheUsedSpaceBytes)}</td><td>{formatBytes(usage.objectStorageUsedSpaceBytes)}</td><td>{usage.protectedObjectsCount ?? 'Unknown'}</td><td>{cap?.primary ? `${cap.primary.percent.toFixed(1)}% used`:repo?.objectStorage?.sizeLimitEnabled===false ? 'No object quota':'Not reported'}<p className={shared.sub}>{cap?.primary ? `${formatBytes(cap.primary.free)} free · ${cap.scope}`:cap?.scope || 'Repository details unavailable'}</p></td></tr>})}</tbody></table>)}</SortableGrid></div>{!records.length && <Empty>{rows.some(row=>!row.usage.available) ? 'Storage measurements are unavailable for the matching organizations.':'No repository usage records were returned for the matching organizations.'}</Empty>}<p className={ops.panelFoot}>Reported used space is separate from cache + object storage and is not added to that total. Repository protected counts may overlap across copies and are not summed as unique objects.</p></Panel>
}
