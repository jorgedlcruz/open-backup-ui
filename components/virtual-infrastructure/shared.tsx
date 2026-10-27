"use client"
import { FilterFacet } from '@/components/operations/filter-facet'

import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { canQuickBackup,type VirtualRow } from '@/lib/virtual-infrastructure/model'
import { ArrowUpRight,MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import styles from './virtual-operations.module.css'

export type Option={value:string;label:string;count:number}
export function FacetPicker({title,options,values,onChange}:{title:string;options:Option[];values:string[];onChange:(values:string[])=>void}) { return <FilterFacet title={title} options={options} selected={values} onChange={onChange} defaultOpen={title==='Protection'}/> }
export function Protection({row}:{row:VirtualRow}) {
  return <div className={styles.stack}><span className={cn(ops.badge,row.protection==='Protected' ? ops.success:row.protection==='Unprotected' ? ops.warning:ops.neutral)}><span className={ops.dot}/>{row.protection}</span>
    {row.backupIssue && <small className={ops.danger}>Last backup run failed</small>}{row.zeroPoints && <small className={ops.warning}>No restore points reported</small>}</div>
}
export function Coverage({rows}:{rows:VirtualRow[]}) {
  if(!rows.length)return <span className={styles.muted}>No VM relationships returned</span>
  const protectedCount=rows.filter(r=>r.protection==='Protected').length, unprotected=rows.filter(r=>r.protection==='Unprotected').length, unknown=rows.length-protectedCount-unprotected
  return <div className={styles.coverage}><strong>{rows.length} VMs</strong><div className={styles.bar} aria-hidden><span className={styles.protected} style={{width:`${protectedCount/Math.max(1,rows.length)*100}%`}}/><span className={styles.unprotected} style={{width:`${unprotected/Math.max(1,rows.length)*100}%`}}/><span className={styles.unknown} style={{width:`${unknown/Math.max(1,rows.length)*100}%`}}/></div><div className={ops.subtext}>{protectedCount} protected · {unprotected} unprotected · {unknown} unknown</div></div>
}
export async function copy(value:string) {try {await navigator.clipboard.writeText(value);toast.success('Copied to clipboard')}catch {toast.error('Clipboard unavailable')}}
export function RowActions({row,inspect,quick}:{row:VirtualRow;inspect:()=>void;quick:()=>void}) {
  return <div className={styles.actions}><button className={ops.inspect} aria-label={`Inspect ${row.item.name || row.key}`} onClick={inspect}><ArrowUpRight size={16}/></button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${row.item.name || row.key}`}><MoreHorizontal size={16}/></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem onClick={inspect}>Inspect object</DropdownMenuItem>{canQuickBackup(row.item) && <DropdownMenuItem onClick={quick}>Quick Backup…</DropdownMenuItem>}
        <DropdownMenuItem disabled={!row.item.objectId} onClick={()=>copy(row.item.objectId!)}>Copy Object ID</DropdownMenuItem><DropdownMenuItem disabled={!row.item.urn} onClick={()=>copy(row.item.urn!)}>Copy URN</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu></div>
}
