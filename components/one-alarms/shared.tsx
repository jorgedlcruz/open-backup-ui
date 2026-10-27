'use client'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { dateMs } from '@/lib/one-alarms/model'
import ops from '@/components/operations/operations.module.css'
import styles from './one-alarms.module.css'

export const tone = (value:string) => value==='Error' ? 'danger':value==='Warning' ? 'warning':['Resolved','Success','Remediated'].includes(value) ? 'success':['Information','Acknowledged'].includes(value) ? 'active':'neutral'
export const color = (value:string) => `var(${value==='Error' ? '--ops-chart-danger':value==='Warning' ? '--ops-chart-warning':value==='Information' ? '--ops-chart-active':value==='Acknowledged' ? '--chart-4':['Success','Resolved','Remediated'].includes(value) ? '--ops-chart-success':'--muted-foreground'})`
export const date = (value:string) => { const ms=dateMs(value);return ms===null ? 'Not reported':new Date(ms).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}) }
export const count = (value:number,complete:boolean) => complete ? value.toLocaleString():value ? `${value.toLocaleString()}+`:'Unknown'
export function Status({value}:{value:string}) {return <span className={cn(ops.badge,ops[tone(value)])}><span className={ops.dot}/>{value}</span>}
export async function read<T>(url:string,signal:AbortSignal):Promise<T> {
  const response=await fetch(url,{signal,cache:'no-store'}),data=await response.json()
  if(!response.ok)throw Error(data.error || 'Alarm evidence could not be read.')
  return data
}
export function Pages({page,total,loaded,disabled=false,onChange,label}:{page:number;total:number|null;loaded:number;disabled?:boolean;onChange:(page:number)=>void;label:string}) {
  const last=total===null ? null:Math.max(0,Math.ceil(total/20)-1),next=last===null ? loaded===20:page<last
  return <div className={cn(ops.pagination,styles.pagination)}><span>{loaded ? `${page*20+1}–${page*20+loaded}`:'No records on this page'}{total!==null ? ` of ${total.toLocaleString()}`:' · total not reported'}</span><div><Button size="icon" variant="ghost" aria-label={`First ${label} page`} disabled={disabled || page===0} onClick={()=>onChange(0)}><ChevronsLeft size={14}/></Button><Button size="icon" variant="ghost" aria-label={`Previous ${label} page`} disabled={disabled || page===0} onClick={()=>onChange(page-1)}><ChevronLeft size={14}/></Button><span>{page+1}{last!==null ? ` / ${last+1}`:''}</span><Button size="icon" variant="ghost" aria-label={`Next ${label} page`} disabled={disabled || !next} onClick={()=>onChange(page+1)}><ChevronRight size={14}/></Button><Button size="icon" variant="ghost" aria-label={`Last ${label} page`} disabled={disabled || last===null || page>=last} onClick={()=>last!==null && onChange(last)}><ChevronsRight size={14}/></Button></div></div>
}
