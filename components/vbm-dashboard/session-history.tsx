'use client'
import { FilterFacet } from '@/components/operations/filter-facet'
import { FilterFields,GridColumnChoice,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableGrid } from '@/components/ui/sortable-grid'
import { useMemo,useState } from 'react'

import { date,Empty,Pager,Panel,SearchBox } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { time } from '@/lib/investigation/model'
import { cn } from '@/lib/utils'
import { csvCell,dailySessions,filterSessions,sessionExport,sessionStats,status,type Session,type SessionFilters,type Snapshot } from '@/lib/vbm-dashboard/model'
import { ArrowDownToLine,ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import styles from './vbm-dashboard.module.css'

export function Tone({value}:{value:string}) {
  const tone = ['Failed','Unhealthy','Expired','Invalid','No backup reported'].includes(value) ? 'danger'
    : ['Warning','Disabled','Update required','Unknown evidence'].includes(value) || value.startsWith('Older than') ? 'warning'
      : ['Success','Healthy','Valid','Within threshold','Enabled'].includes(value) ? 'success' : value==='Running' ? 'active':'neutral'
  return <span className={cn(ops.badge,ops[tone])}><span className={ops.dot}/>{value}</span>
}
export function SessionHistory({data,onInspect}:{data:Snapshot;onInspect:(row:Session)=>void}) {
  const [filters,setFilters]=useState<SessionFilters>({query:'',statuses:[],types:['Backup'],day:null})
  const [visible,setVisible]=useState(['status','name','type','time']),[order,setOrder]=useState('newest'),[page,setPage]=useState(0)
  const update=(patch:Partial<SessionFilters>)=>{setFilters(old=>({...old,...patch}));setPage(0)}
  const matching=useMemo(()=>filterSessions(data.sessions.data,data.jobs.data,filters),[data,filters])
  const names=new Map(data.jobs.data.map(job=>[job.id,job.name || job.id]))
  const name=(session:Session)=>names.get(session.jobId || '') || (session.jobId ? `Job ${session.jobId}`:'Job not reported')
  const rows=[...matching].sort((a,b)=>order==='name' ? name(a).localeCompare(name(b)) || a.id.localeCompare(b.id)
    : order==='type' ? (a.jobType || '').localeCompare(b.jobType || '') || a.id.localeCompare(b.id)
      : order==='status' ? status(a.status).localeCompare(status(b.status)) || a.id.localeCompare(b.id)
        : ((time(a.creationTime) ?? -Infinity)-(time(b.creationTime) ?? -Infinity))*(order==='oldest' ? 1:-1) || a.id.localeCompare(b.id))
  const current=Math.min(page,Math.max(0,Math.ceil(rows.length/8)-1))
  const chartRows=filterSessions(data.sessions.data,data.jobs.data,{...filters,day:null}),stats=sessionStats(chartRows)
  const days=dailySessions(chartRows,data.fetchedAt,data.days),max=Math.max(1,...days.map(day=>day.total))
  function download(format:'csv'|'json') {
    const exported=sessionExport(rows,data.jobs.data)
    const body=format==='json' ? JSON.stringify(exported,null,2) : [['Status','Job Name','Type','Date','Time','Session ID','Job ID','Created','Ended','Details'].map(csvCell).join(','),...exported.map(row=>[row.status,row.jobName,row.type,row.date,row.time,row.id,row.jobId,row.creationTime,row.endTime,row.details].map(csvCell).join(','))].join('\r\n')
    const url=URL.createObjectURL(new Blob([body],{type:format==='csv' ? 'text/csv;charset=utf-8':'application/json'})),link=document.createElement('a')
    link.href=url;link.download=`microsoft365-sessions-${data.days}d.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const multi=(field:'statuses'|'types',label:string,options:string[])=> <FilterFacet title={label} options={options.map(value=>({value,label:value,count:data.sessions.data.filter(row=>(field==='statuses' ? status(row.status):row.jobType || 'Not reported')===value).length}))} selected={filters[field]} onChange={values=>update({[field]:values})} defaultOpen={field==='statuses'}/>
  return <Panel title="Session history" subtitle="Backup and copy session outcomes, with the original 7/30-day history, exports, filters, and column controls." action={<DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={!rows.length}><ArrowDownToLine size={14}/>Export</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={()=>download('csv')}>Export as CSV</DropdownMenuItem><DropdownMenuItem onSelect={()=>download('json')}>Export as JSON</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}>
    <FilterWorkspace label="Session history filters" search={<><SearchBox label="Search sessions or messages" value={filters.query} onChange={query=>update({query})}/></>} onClear={()=>{setFilters({query:'',statuses:[],types:[],day:null});setPage(0)}} filters={<FilterFields>{multi('statuses','Status',[...new Set(data.sessions.data.map(row=>status(row.status)))].sort())}
{multi('types','Type',[...new Set([...data.sessions.data.map(row=>row.jobType || 'Not reported'),'Backup','Copy'])].sort())}</FilterFields>} actions={<><GridViewMenu><label>Sort<select aria-label="Session sort" value={order} onChange={event=>{setOrder(event.target.value);setPage(0)}}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Job name</option><option value="status">Status</option><option value="type">Type</option></select></label>
<fieldset className="grid-column-fields"><legend>Visible columns</legend>{[{id:'status',label:'Status'},{id:'name',label:'Job name'},{id:'type',label:'Type'},{id:'time',label:'Time'}].map(column=><GridColumnChoice key={column.id} checked={visible.includes(column.id)} disabled={visible.length===1 && visible.includes(column.id)} onSelect={event=>event.preventDefault()} onCheckedChange={()=>setVisible(old=>old.includes(column.id) ? old.filter(key=>key!==column.id):[...old,column.id])}>{column.label}</GridColumnChoice>)}</fieldset></GridViewMenu></>}>
<div className={styles.chartSummary}><strong>{chartRows.length}</strong><span>sessions loaded · {stats.recordedRate===null ? 'Unknown':`${Math.round(stats.recordedRate)}%`} successful / all records</span><span>{stats.completedRate===null ? 'No completed outcomes':`${Math.round(stats.completedRate)}% successful / completed outcomes`} · {stats.running} running</span></div>
<div className={styles.legend}>{[{key:'success',label:'Success'},{key:'warning',label:'Warning'},{key:'failed',label:'Failed'},{key:'running',label:'Running'},{key:'other',label:'Other'}].map(item=><span key={item.key}><i className={styles[item.key]}/>{item.label}</span>)}</div>
<div className={styles.chartScroll} role="region" aria-label="Daily session outcomes" tabIndex={0}><div className={styles.bars} style={{minWidth:data.days===30 ? 680:360}}>{days.map(day=><button key={day.day} aria-pressed={filters.day===day.day} aria-label={`Sessions on ${day.day}: ${day.total} total, ${day.success} successful, ${day.warning} warnings, ${day.failed} failed, ${day.running} running`} title={`${day.day} · ${day.total} sessions · ${day.success} successful · ${day.warning} warnings · ${day.failed} failed · ${day.running} running`} onClick={()=>update({day:filters.day===day.day ? null:day.day})}><span className={styles.barTotal}>{day.total}</span><span className={styles.barStack}>{(['other','running','failed','warning','success'] as const).map(key=><i key={key} className={styles[key]} style={{height:`${day[key]/max*130}px`}}/>)}</span><span className={styles.barDate}>{day.day.slice(5)}</span></button>)}</div></div>
<div className={styles.scope}><span>UTC calendar days · click a day to investigate its sessions</span>{filters.day && <Button size="sm" variant="ghost" onClick={()=>update({day:null})}>Clear date: {filters.day}</Button>}<span>{data.sessions.complete ? 'Complete API window':'Partial / unavailable history'}</span></div>
{!data.sessions.available ? <Empty>Session history is unavailable. {data.sessions.error}</Empty>:rows.length ? <div className={ops.tableScroll} role="region" aria-label="Microsoft 365 session table" tabIndex={0}><SortableGrid rows={rows} columns={[{id:'status',value:(r:typeof rows[number])=>status(r.status)},{id:'name',value:(r:typeof rows[number])=>name(r)},{id:'type',value:(r:typeof rows[number])=>r.jobType},{id:'time',kind:'date' as const,value:(r:typeof rows[number])=>r.creationTime},{id:'ended',kind:'date' as const,value:(r:typeof rows[number])=>r.endTime}].filter(c=>visible.includes(c.id==='ended'?'time':c.id))} key={order} onSortChange={()=>setPage(0)}>{(rows)=>(<table className={cn(ops.table,styles.table)}><thead><tr>{visible.includes('status') && <th>Status</th>}{visible.includes('name') && <th>Job name / details</th>}{visible.includes('type') && <th>Type</th>}{visible.includes('time') && <><th>Started</th><th>Ended</th></>}<th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.slice(current*8,current*8+8).map(row=><tr key={row.id}>{visible.includes('status') && <td><Tone value={status(row.status)}/></td>}{visible.includes('name') && <td><button className={ops.jobName} onClick={()=>onInspect(row)}>{name(row)}</button><p className={styles.excerpt}>{row.details || (row.status==='Running' ? 'Session in progress':'No message reported')}</p></td>}{visible.includes('type') && <td>{row.jobType || 'Not reported'}</td>}{visible.includes('time') && <><td>{date(row.creationTime)}</td><td>{date(row.endTime)}</td></>}<td><Button size="sm" variant="ghost" aria-label={`Inspect session ${row.id}`} onClick={()=>onInspect(row)}>Inspect<ArrowUpRight size={13}/></Button></td></tr>)}</tbody></table>)}</SortableGrid></div>:<Empty>No sessions match these filters.</Empty>}
<Pager page={current} count={rows.length} size={8} onChange={setPage} label="Microsoft 365 sessions"/>
<p className={ops.panelFoot}>Exports include all matching rows, across pages. Running, stopped, and unreported outcomes remain visible. Day selection uses creation time; the API history window may also return long-running sessions that started earlier. <Link href="/vbm/jobs" className={ops.textLink}>Manage backup jobs<ArrowUpRight size={12}/></Link></p>
</FilterWorkspace></Panel>
}
