'use client'
import { FilterGroup } from '@/components/operations/filter-facet'
import { FilterFields,GridColumnFields,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { useState } from 'react'

import { date,Empty,Pager,Panel,SearchBox } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Tone } from '@/components/vbm-dashboard/session-history'
import shared from '@/components/vbm-dashboard/vbm-dashboard.module.css'
import { time } from '@/lib/investigation/model'
import { formatBytes } from '@/lib/restore-points/model'
import { cn } from '@/lib/utils'
import { filterSessions,status } from '@/lib/vbm-dashboard/model'
import { duration,lookup,windowLabel,type JobsSnapshot,type Session } from '@/lib/vbm-jobs/model'
import { ArrowUpRight } from 'lucide-react'
import styles from './jobs.module.css'
import { Export,MultiFilter } from './shared'
const columns=[{id:'status',name:'Status'},{id:'job',name:'Job / type'},{id:'start',name:'Start time'},{id:'end',name:'End time'},{id:'duration',name:'Duration'},{id:'transferred',name:'Transferred'},{id:'details',name:'Details'}]
export function SessionTable({data,onInspect}:{data:JobsSnapshot;onInspect:(session:Session)=>void}) {
  const [query,setQuery]=useState(''),[statuses,setStatuses]=useState<string[]>([]),[types,setTypes]=useState<string[]>([]),[order,setOrder]=useState('newest'),[page,setPage]=useState(0),[visible,setVisible]=useState(columns.map(column=>column.id)),[retryOnly,setRetryOnly]=useState(false)
  const matched=filterSessions(data.sessions.data,data.jobs.data,{query,statuses,types,day:null}) as Session[]
  const rows=matched.filter(row=>!retryOnly || (row.retryCount ?? 0)>0 || row.jobWillBeRetried===true).sort((a,b)=>order==='status' ? status(a.status).localeCompare(status(b.status)) || a.id.localeCompare(b.id):((time(a.creationTime) ?? -Infinity)-(time(b.creationTime) ?? -Infinity))*(order==='oldest' ? 1:-1) || a.id.localeCompare(b.id))
  const current=Math.min(page,Math.max(0,Math.ceil(rows.length/10)-1))
  return <Panel title="Session history" subtitle={`${windowLabel(data.window)} · backup and copy sessions, including running and stopped outcomes.`} action={<Export rows={rows.map(row=>({...row,jobName:lookup(data.jobs.data,row.jobId),duration:duration(row)}))} name={`microsoft365-${data.jobId || 'jobs'}-sessions`}/>}>
    <FilterWorkspace label="Session history filters" search={<><SearchBox label="Search session IDs or messages" value={query} onChange={value=>{setQuery(value);setPage(0)}}/></>} onClear={()=>{setQuery('');setStatuses([]);setTypes([]);setRetryOnly(false);setPage(0)}} filters={<FilterFields><FilterGroup title="Retry evidence"><label><input type="checkbox" checked={retryOnly} onChange={event=>{setRetryOnly(event.target.checked);setPage(0)}}/>Retried / retry pending ({data.sessions.data.filter(row=>(row.retryCount ?? 0)>0 || row.jobWillBeRetried).length})</label></FilterGroup>
<MultiFilter label="Status" options={[...new Set(data.sessions.data.map(row=>status(row.status)))].sort().map(value=>({id:value,name:value,count:data.sessions.data.filter(row=>status(row.status)===value).length}))} selected={statuses} onChange={values=>{setStatuses(values);setPage(0)}}/>
<MultiFilter label="Type" options={[...new Set(data.sessions.data.map(row=>row.jobType || 'Not reported'))].sort().map(value=>({id:value,name:value,count:data.sessions.data.filter(row=>(row.jobType || 'Not reported')===value).length}))} selected={types} onChange={values=>{setTypes(values);setPage(0)}}/></FilterFields>} actions={<><GridViewMenu><label>Sort<select aria-label="Session sort" value={order} onChange={event=>{setOrder(event.target.value);setPage(0)}}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="status">Status</option></select></label>
<GridColumnFields columns={columns} visible={visible} onChange={setVisible}/></GridViewMenu></>}>
{!data.sessions.available ? <Empty>Session history is unavailable. Refresh to retry.</Empty>:rows.length ? <div className={ops.tableScroll} role="region" aria-label="Job session history" tabIndex={0}><SortableGrid rows={rows} columns={columns.filter(column=>visible.includes(column.id)).map(column=>({id:column.id,kind:(['start','end'].includes(column.id)?'date':'auto') as 'date'|'auto',value:(r:typeof rows[number])=>({status:status(r.status),job:lookup(data.jobs.data,r.jobId),start:r.creationTime,end:r.endTime,duration:r.endTime&&r.creationTime?Date.parse(r.endTime)-Date.parse(r.creationTime):null,transferred:r.statistics?.transferredDataBytes,details:r.details})[column.id as 'status']}))} key={order} onSortChange={()=>setPage(0)}>{(rows)=>(<table className={cn(ops.table,styles.sessionsTable)}><thead><tr>{columns.filter(column=>visible.includes(column.id)).map(column=><th key={column.id}>{column.name}</th>)}<th>Investigate</th></tr></thead><tbody>{rows.slice(current*10,current*10+10).map(row=><tr key={row.id}>{visible.includes('status') && <td><Tone value={status(row.status)}/>{row.jobWillBeRetried && <span className={shared.sub}>Retry pending (reported)</span>}{!!row.retryCount && <span className={shared.sub}>Retry {row.retryCount}</span>}</td>}{visible.includes('job') && <td><button className={ops.jobName} disabled={!row.jobId} onClick={()=>onInspect(row)}>{lookup(data.jobs.data,row.jobId)}</button><span className={shared.sub}>{row.jobType || 'Not reported'} · {row.jobSessionConfigType || 'Configuration not reported'}</span></td>}{visible.includes('start') && <td>{date(row.creationTime)}</td>}{visible.includes('end') && <td>{date(row.endTime)}</td>}{visible.includes('duration') && <td>{duration(row)}</td>}{visible.includes('transferred') && <td>{formatBytes(row.statistics?.transferredDataBytes)}</td>}{visible.includes('details') && <td><p className={shared.excerpt} title={row.details || ''}>{row.details || 'No result message reported'}</p></td>}<td><Button size="sm" variant="ghost" disabled={!row.jobId} onClick={()=>onInspect(row)} aria-label={`Inspect session ${row.id}`}>Inspect<ArrowUpRight size={13}/></Button></td></tr>)}</tbody></table>)}</SortableGrid></div>:<Empty>No sessions match these filters.</Empty>}
<Pager page={current} count={rows.length} size={10} onChange={setPage} label="job sessions"/>
<p className={ops.panelFoot}>{data.sessions.complete ? 'Complete returned history.':'Partial / unavailable history; counts cover loaded sessions.'} Exports include every filtered row across pages. Open a session for full messages, processing statistics, and workload logs.</p>
</FilterWorkspace></Panel>
}
