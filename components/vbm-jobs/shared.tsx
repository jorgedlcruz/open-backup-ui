'use client'
// Open Backup UI v1.2.0
import { Trans, useI18n } from "@/components/providers/i18n-provider"
import { FilterFacet } from '@/components/operations/filter-facet'
import { Button } from '@/components/ui/button'
import { DropdownMenu,DropdownMenuCheckboxItem,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import styles from '@/components/vbm-dashboard/vbm-dashboard.module.css'
import { veeamApi } from '@/lib/api/veeam-client'
import { csvCell } from '@/lib/vbm-dashboard/model'
import { type Job,type JobAction,type Window } from '@/lib/vbm-jobs/model'
import { ArrowDownToLine,ArrowUpRight,Columns3,MoreHorizontal,PauseCircle,PlayCircle,Square } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { m365Diagnostic } from '@/lib/i18n/m365'

export function JobActions({job,onRefresh}:{job:Job;onRefresh:()=>void}) {
  const { t, locale } = useI18n()
  const [pending,setPending]=useState<JobAction|null>(null)
  async function run(action:JobAction) {
    if(pending)return
    setPending(action)
    try {
      const calls={start:()=>veeamApi.startVBMJob(job.id),stop:()=>veeamApi.stopVBMJob(job.id),enable:()=>veeamApi.enableVBMJob(job.id),disable:()=>veeamApi.disableVBMJob(job.id)}
      const messages={start:'Start request accepted for {name}',stop:'Stop request accepted for {name}',enable:'Enable request accepted for {name}',disable:'Disable request accepted for {name}'}
      await calls[action]();toast.success(t(messages[action],{name:job.name || t('job')}));onRefresh()
    }catch(error){const failures={start:'Could not start job',stop:'Could not stop job',enable:'Could not enable job',disable:'Could not disable job'};toast.error(error instanceof Error ? m365Diagnostic(t,error.message,locale):t(failures[action]))}finally{setPending(null)}
  }
  return <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={!!pending} aria-label={t('Actions for {name}',{name:job.name || job.id})}><MoreHorizontal size={15}/>{t(pending ? 'Working…':'Actions')}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={()=>run('start')}><PlayCircle size={14}/><Trans>{"Start"}</Trans></DropdownMenuItem><DropdownMenuItem onSelect={()=>run('stop')}><Square size={14}/><Trans>{"Stop"}</Trans></DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem disabled={job.isEnabled===false} onSelect={()=>run('disable')}><PauseCircle size={14}/><Trans>{"Disable"}</Trans></DropdownMenuItem><DropdownMenuItem disabled={job.isEnabled===true} onSelect={()=>run('enable')}><PlayCircle size={14}/><Trans>{"Enable"}</Trans></DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem asChild><Link href={`/vbm/jobs/${encodeURIComponent(job.id)}/sessions`}><Trans>{"View sessions"}</Trans><ArrowUpRight size={14}/></Link></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
}
export function HistoryWindow({value,onChange}:{value:Window;onChange:(value:Window)=>void}) {
  const { t } = useI18n()
  return <label className={styles.range}><Trans>{"Session history"}</Trans><select aria-label={t('Session history window')} value={value} onChange={event=>onChange(event.target.value as Window)}><option value="7"><Trans>{"Last 7 days"}</Trans></option><option value="30"><Trans>{"Last 30 days"}</Trans></option><option value="all"><Trans>{"All retained history"}</Trans></option></select></label>
}
export function MultiFilter({label,options,selected,onChange,defaultOpen}:{label:string;options:{id:string;name:string;count?:number}[];selected:string[];onChange:(value:string[])=>void;defaultOpen?:boolean}) { return <FilterFacet title={label} options={options.map(option=>({value:option.id,label:option.name,count:option.count}))} selected={selected} onChange={onChange} defaultOpen={defaultOpen ?? /status|severity/i.test(label)}/> }
export function ColumnPicker({columns,visible,onChange}:{columns:{id:string;name:string}[];visible:string[];onChange:(value:string[])=>void}) {
  const { t } = useI18n()
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Columns3 size={13}/><Trans>{"Columns"}</Trans></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{columns.map(column=><DropdownMenuCheckboxItem key={column.id} checked={visible.includes(column.id)} disabled={visible.length===1 && visible.includes(column.id)} onSelect={event=>event.preventDefault()} onCheckedChange={()=>onChange(visible.includes(column.id) ? visible.filter(id=>id!==column.id):[...visible,column.id])}>{t(column.name)}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu>
}
export function Export({rows,name}:{rows:Record<string,unknown>[];name:string}) {
  function download(format:'csv'|'json') {
    const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))]
    const body=format==='json' ? JSON.stringify(rows,null,2):[keys.map(csvCell).join(','),...rows.map(row=>keys.map(key=>csvCell(typeof row[key]==='object' && row[key]!==null ? JSON.stringify(row[key]):row[key])).join(','))].join('\r\n')
    const url=URL.createObjectURL(new Blob([body],{type:format==='csv' ? 'text/csv;charset=utf-8':'application/json'})),link=document.createElement('a')
    link.href=url;link.download=`${name}.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={!rows.length}><ArrowDownToLine size={14}/><Trans>{"Export"}</Trans></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={()=>download('csv')}><Trans>{"Export as CSV"}</Trans></DropdownMenuItem><DropdownMenuItem onSelect={()=>download('json')}><Trans>{"Export as JSON"}</Trans></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
}
