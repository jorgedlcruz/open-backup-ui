"use client"

import Link from 'next/link'
import { ArrowUpRight, MoreHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { date } from '@/components/investigation/shared'
import { credentialRef, serverHref, type Row } from '@/lib/unstructured-data/model'
import { validId } from '@/lib/investigation/model'
import { cn } from '@/lib/utils'
import ops from '@/components/operations/operations.module.css'
import styles from './unstructured-operations.module.css'

export function Badge({value,tone='neutral'}:{value:string;tone?:'neutral'|'success'|'warning'|'danger'|'active'}) {
  return <span className={cn(ops.badge,ops[tone])}><span className={ops.dot}/>{value}</span>
}
export function Protection({row}:{row:Row}) {
  return <div className={styles.stack}><Badge value={row.protection} tone={row.protection==='Backup evidence' ? 'success':row.protection==='No protection found' || row.protection==='Configured only' ? 'warning':'neutral'}/>{row.issues.backup && <Badge value="Last backup run failed" tone="danger"/>}{row.issues.noPoints && <Badge value="No restore points" tone="warning"/>}</div>
}
export function CredentialCell({row}:{row:Row}) {
  const ref=credentialRef(row.server),credential=row.credential
  return credential ? <div className={styles.stack}><span>{credential.username || credential.type || 'Credential record'}</span>{credential.description && <small>{credential.description}</small>}{credential.creationTime && <small>Created {date(credential.creationTime)}</small>}{credential.lastModified && <small>Modified {date(credential.lastModified)}</small>}</div>
    : <div className={styles.stack}><span className={styles.muted}>{ref.id ? 'Metadata unavailable':row.server.accessCredentialsRequired===false ? 'Not required':row.server.type==='FileServer' ? 'Managed host access':'Not reported'}</span>{row.issues.credentials && <Badge value="Missing credential reference" tone="warning"/>}</div>
}
export function Cache({row}:{row:Row}) {
  const id=row.server.processing?.cacheRepositoryId,name=row.repository?.name || row.repositoryState?.name || id || 'Not reported'
  return <div className={styles.stack}>{validId(id) ? <Link className={ops.textLink} href={`/vbr/infrastructure/repositories/${encodeURIComponent(id)}`}>{name}<ArrowUpRight size={12}/></Link>:<span>{name}</span>}<Badge value={row.cacheLabel} tone={row.cacheLabel==='Offline' ? 'danger':row.issues.cache ? 'warning':row.cacheLabel==='Online' ? 'success':'neutral'}/>{row.cacheUsedPercent!==null && <div><small>{row.cacheUsedPercent.toFixed(1)}% used</small><div className={styles.bar}><span className={row.cacheUsedPercent>=85 ? styles.pressure:''} style={{width:`${row.cacheUsedPercent}%`}}/></div></div>}</div>
}
export async function copyId(id:string) {
  try {await navigator.clipboard.writeText(id);toast.success('Source ID copied')}catch {toast.error('Clipboard unavailable')}
}
export function Actions({row,onDelete}:{row:Row;onDelete:(row:Row)=>void}) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Actions for ${row.name}`}><MoreHorizontal size={16}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
    <DropdownMenuItem asChild><Link href={serverHref(row.server.id)}>Investigate source</Link></DropdownMenuItem>
    <DropdownMenuItem onClick={()=>copyId(row.server.id)}>Copy ID</DropdownMenuItem>
    <DropdownMenuItem className="text-destructive" onClick={()=>onDelete(row)}><Trash2 size={14}/>Delete</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>
}
