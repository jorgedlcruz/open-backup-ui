"use client"
// Open Backup UI v1.0.2
import { Trans, useI18n } from "@/components/providers/i18n-provider"
import { enumLabel, type Translator } from '@/lib/i18n/presentation'
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
export function FacetPicker({title,options,values,onChange,defaultOpen=false}:{title:string;options:Option[];values:string[];onChange:(values:string[])=>void;defaultOpen?:boolean}) { return <FilterFacet title={title} options={options} selected={values} onChange={onChange} defaultOpen={defaultOpen}/> }
export function Protection({row}:{row:VirtualRow}) {
  const { t } = useI18n()
  return <div className={styles.stack}><span className={cn(ops.badge,row.protection==='Protected' ? ops.success:row.protection==='Unprotected' ? ops.warning:ops.neutral)}><span className={ops.dot}/>{enumLabel(t,row.protection)}</span>
    {row.backupIssue && <small className={ops.danger}><Trans>{"Last backup run failed"}</Trans></small>}{row.zeroPoints && <small className={ops.warning}><Trans>{"No restore points reported"}</Trans></small>}</div>
}
export function Coverage({rows}:{rows:VirtualRow[]}) {
  const { t, formatNumber } = useI18n()
  if(!rows.length)return <span className={styles.muted}><Trans>{"No VM relationships returned"}</Trans></span>
  const protectedCount=rows.filter(r=>r.protection==='Protected').length, unprotected=rows.filter(r=>r.protection==='Unprotected').length, unknown=rows.length-protectedCount-unprotected
  return <div className={styles.coverage}><strong>{t('{count} VMs',{count:formatNumber(rows.length)})}</strong><div className={styles.bar} aria-hidden><span className={styles.protected} style={{width:`${protectedCount/Math.max(1,rows.length)*100}%`}}/><span className={styles.unprotected} style={{width:`${unprotected/Math.max(1,rows.length)*100}%`}}/><span className={styles.unknown} style={{width:`${unknown/Math.max(1,rows.length)*100}%`}}/></div><div className={ops.subtext}>{t('{protected} protected · {unprotected} unprotected · {unknown} unknown',{protected:formatNumber(protectedCount),unprotected:formatNumber(unprotected),unknown:formatNumber(unknown)})}</div></div>
}
export async function copy(value:string,t:Translator) {try {await navigator.clipboard.writeText(value);toast.success(t('Copied to clipboard'))}catch {toast.error(t('Clipboard unavailable'))}}
export function RowActions({row,inspect,quick}:{row:VirtualRow;inspect:()=>void;quick:()=>void}) {
  const { t } = useI18n()
  return <div className={styles.actions}><button className={ops.inspect} aria-label={t('Inspect {name}',{name:row.item.name || row.key})} onClick={inspect}><ArrowUpRight size={16}/></button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t('Actions for {name}',{name:row.item.name || row.key})}><MoreHorizontal size={16}/></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem onClick={inspect}><Trans>{"Inspect object"}</Trans></DropdownMenuItem>{canQuickBackup(row.item) && <DropdownMenuItem onClick={quick}><Trans>{"Quick Backup…"}</Trans></DropdownMenuItem>}
        <DropdownMenuItem disabled={!row.item.objectId} onClick={()=>copy(row.item.objectId!,t)}><Trans>{"Copy Object ID"}</Trans></DropdownMenuItem><DropdownMenuItem disabled={!row.item.urn} onClick={()=>copy(row.item.urn!,t)}><Trans>{"Copy URN"}</Trans></DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu></div>
}
