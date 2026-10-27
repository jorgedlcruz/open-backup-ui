"use client"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterCondition,FilterFields,GridColumnChoice,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableGrid } from '@/components/ui/sortable-grid'
import { useCallback,useMemo,useState } from 'react'

import { Empty,Loading,Notice,Pager,Panel,SearchBox,date,useEvidence,useRefresh } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { veeamApi } from '@/lib/api/veeam-client'
import { buildRows,defaults,isObject,matches,serverHref,sorted,sourcePath,type Filters,type Issue,type Row } from '@/lib/unstructured-data/model'
import { cn } from '@/lib/utils'
import { ArrowLeft,ArrowUpRight,CircleHelp,Database,FolderClosed,Layers,RefreshCw,Server,ShieldCheck,TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Actions,Badge,Cache,CredentialCell,Protection } from './shared'
import { SourceDetail } from './source-detail'
import styles from './unstructured-operations.module.css'

const categories=[{name:'All sources',value:'all',icon:Layers},{name:'File shares',value:'File shares',icon:FolderClosed},{name:'File servers & NAS',value:'File servers & NAS',icon:Server},{name:'Object storage',value:'Object storage',icon:Database}]
const issues:{value:Issue;label:string}[]=[
  {value:'all',label:'All sources'},{value:'attention',label:'Needs attention'},{value:'unprotected',label:'No protection found'},{value:'configured',label:'Configured only'},
  {value:'backup',label:'Backup failures'},{value:'jobs',label:'Job issues'},{value:'disabled',label:'Jobs disabled'},{value:'cache',label:'Cache issues'},
  {value:'credentials',label:'Credential gaps'},{value:'noPoints',label:'No restore points'},{value:'unknown',label:'Missing evidence'},
]
const columns=[['type','Type'],['source','Path / endpoint'],['protection','Protection'],['jobs','Linked jobs'],['credentials','Credentials'],['cache','Cache repository'],['io','I/O control']] as const
type Column=typeof columns[number][0]
export function UnstructuredOperations({id}:{id?:string}) {
  const router=useRouter(),{revision,refresh}=useRefresh(),load=useCallback((signal:AbortSignal)=>veeamApi.getUnstructuredInventory(signal),[])
  const {data,error,loading}=useEvidence(load,revision),rows=useMemo(()=>data ? buildRows(data):[],[data])
  const [filters,setFilters]=useState<Filters>(defaults),[order,setOrder]=useState('risk'),[page,setPage]=useState(0),[visible,setVisible]=useState<Column[]>(columns.map(([c])=>c))
  const [deleting,setDeleting]=useState<Row|null>(null),[pending,setPending]=useState(false)
  const filtered=useMemo(()=>sorted(rows.filter(r=>matches(r,filters)),order),[rows,filters,order]),current=Math.min(page,Math.max(0,Math.ceil(filtered.length/15)-1))
  const counts=useMemo(()=>Object.fromEntries(issues.map(i=>[i.value,rows.filter(r=>matches(r,{...defaults,issue:i.value})).length])),[rows])
  const selected=id ? rows.find(r=>r.server.id===id):null
  function update(patch:Partial<Filters>){setFilters(f=>({...f,...patch}));setPage(0)}
  function quick(issue:Issue){setFilters({...defaults,issue});setPage(0)}
  async function remove() {
    if(!deleting || pending)return
    setPending(true)
    try {await veeamApi.deleteUnstructuredServer(deleting.server.id);toast.success(`${deleting.name} deleted`);setDeleting(null);if(id)router.push('/vbr/inventory/unstructured');else refresh()}
    catch(error){toast.error(error instanceof Error ? error.message:'The source could not be deleted.')}
    finally{setPending(false)}
  }
  const complete=data && [data.servers,data.jobs,data.jobStates,data.backups,data.repositories,data.repositoryStates,data.credentials].every(e=>e.complete)
  return <div className={cn(ops.console,styles.page)}>
    <header className={ops.header}><div><h1>{id ? selected?.name || 'Source investigation':'Unstructured data'}</h1><p>{id ? 'Source settings, job scope, backup evidence, and cache health.':'Investigate file shares, file servers, and object storage without losing production context.'}</p></div>
      <div className={ops.headerActions}>{id && <Link className={ops.textLink} href="/vbr/inventory/unstructured"><ArrowLeft size={14}/>All sources</Link>}{data && <span className={ops.source}><span className={ops.dot}/>{data.sourceName}</span>}<Button size="sm" variant="outline" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'animate-spin':''}/>Refresh</Button>{selected && <Actions row={selected} onDelete={setDeleting}/>}</div>
    </header>
    {error && <Notice error>{error}{data && ' Showing the previous snapshot; this refresh failed.'}</Notice>}
    {!data ? loading ? <Loading>Loading unstructured sources, job scope, and backup evidence…</Loading>:<Empty>Unstructured inventory is unavailable. Use Refresh to retry.</Empty>:<>
      {!!data.warnings.length && <details className={ops.warnings}><summary>{data.warnings.length} data coverage {data.warnings.length===1 ? 'notice':'notices'}</summary><ul>{data.warnings.map(w=><li key={w}>{w}</li>)}</ul></details>}
      {id ? selected ? <SourceDetail key={id} row={selected}/>:<Empty>This source was not returned by the connected VBR server.</Empty>:<>
        <div className={ops.metrics}>
          <button className={cn(ops.metric,styles.metric)} onClick={()=>quick('all')}><div className={ops.metricLabel}>Data sources<Layers size={17}/></div><div className={ops.metricValue}>{rows.length}</div><p>{rows.filter(r=>r.category==='File shares').length} file shares · {rows.filter(r=>isObject(r.server)).length} object storage</p></button>
          <button className={cn(ops.metric,styles.metric)} onClick={()=>{setFilters({...defaults,protection:'Backup evidence'});setPage(0)}}><div className={ops.metricLabel}>With backup evidence<ShieldCheck size={17}/></div><div className={cn(ops.metricValue,ops.success)}>{rows.filter(r=>r.protection==='Backup evidence').length}</div><p>Sources with explicitly linked backup objects</p></button>
          <button className={cn(ops.metric,styles.metric)} onClick={()=>quick('attention')}><div className={ops.metricLabel}>Needs attention<TriangleAlert size={17}/></div><div className={cn(ops.metricValue,counts.attention ? ops.warning:ops.neutral)}>{counts.attention}</div><p>{counts.jobs} job issues · {counts.backup} backup failures · {counts.cache} cache issues</p></button>
          <button className={cn(ops.metric,styles.metric)} onClick={()=>quick('unknown')}><div className={ops.metricLabel}>Missing evidence<CircleHelp size={17}/></div><div className={ops.metricValue}>{counts.unknown}</div><p>Unresolved protection, cache state, job results, or access metadata</p></button>
        </div>
        <nav className={styles.tabs} aria-label="Unstructured source categories">{categories.map(c=><button key={c.value} aria-pressed={filters.category===c.value} className={filters.category===c.value ? styles.selected:''} onClick={()=>update({category:c.value,type:'all'})}><c.icon size={15}/>{c.name}<span>{c.value==='all' ? rows.length:rows.filter(r=>r.category===c.value).length}</span></button>)}</nav>
        <Panel title="Source protection inventory" subtitle="Combine source type, protection evidence, cache health, and search to isolate issues." action={<span className={ops.smallTag}>{filtered.length} MATCHING</span>}>
          <FilterWorkspace label="Source protection inventory filters" search={<><SearchBox label="Search sources, paths, credentials, or jobs" value={filters.query} onChange={query=>update({query})}/></>} onClear={()=>quick('all')} filters={<FilterFields><FilterCondition>{issues.map(i=><button key={i.value} aria-pressed={filters.issue===i.value} className={cn(styles.chip,filters.issue===i.value && styles.selected)} onClick={()=>update({issue:i.value})}>{i.label}<span>{counts[i.value]}</span></button>)}</FilterCondition>
<FilterSelect label={"Source type"} value={filters.type} onValueChange={e=>update({type:e})}><option value="all">All types</option>{[...new Set(rows.map(r=>r.server.type || 'Not reported'))].sort().map(t=><option key={t} value={t}>{t}</option>)}</FilterSelect>
<FilterSelect label={"Protection"} value={filters.protection} onValueChange={e=>update({protection:e})}><option value="all">All protection</option>{['Backup evidence','Configured only','No protection found','Unknown'].map(t=><option key={t}>{t}</option>)}</FilterSelect>
<FilterSelect label={"Cache health"} value={filters.cache} onValueChange={e=>update({cache:e})}><option value="all">All cache states</option>{[...new Set(rows.map(r=>r.cacheLabel))].sort().map(t=><option key={t}>{t}</option>)}</FilterSelect></FilterFields>} actions={<><GridViewMenu><label>Sort<select aria-label="Unstructured inventory sort" value={order} onChange={e=>{setOrder(e.target.value);setPage(0)}}><option value="risk">Issues first</option><option value="name">Name A–Z</option><option value="nameDesc">Name Z–A</option><option value="jobs">Most linked jobs</option></select></label>
<fieldset className="grid-column-fields"><legend>Visible columns</legend>{columns.map(([c,label])=><GridColumnChoice key={c} checked={visible.includes(c)} onSelect={e=>e.preventDefault()} onCheckedChange={checked=>setVisible(v=>checked ? [...v,c]:v.filter(k=>k!==c))}>{label}</GridColumnChoice>)}</fieldset></GridViewMenu></>}>
{filtered.length ? <div className={ops.tableScroll} tabIndex={0} role="region" aria-label="Scrollable source inventory"><SortableGrid rows={filtered} columns={[{id:'name',value:(r:typeof filtered[number])=>r.name},...columns.filter(([id])=>visible.includes(id)).map(([id])=>({id:id,kind:([] as string[]).includes(id)?'date' as const:'auto' as const,value:(r:typeof filtered[number])=>({type:r.server.type,source:sourcePath(r.server),protection:r.protection,jobs:r.jobs.length,credentials:r.credential?.username,cache:r.cacheLabel,io:r.server.processing?.backupIOControlLevel} as Record<string,unknown>)[id]}))]} key={order} onSortChange={()=>setPage(0)}>{(filtered)=>(<table className={cn(ops.table,styles.table)}><thead><tr><th>Source name</th>{columns.filter(([c])=>visible.includes(c)).map(([c,label])=><th key={c}>{label}</th>)}<th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.slice(current*15,(current+1)*15).map(row=><tr key={row.server.id}>
            <td><div className={styles.identity}>{isObject(row.server) ? <Database size={17}/>:row.server.type==='FileServer' || row.server.type==='NASFiler' ? <Server size={17}/>:<FolderClosed size={17}/>}<div><Link className={ops.jobName} href={serverHref(row.server.id)}>{row.name}</Link>{row.server.description && <div className={styles.description}>{row.server.description}</div>}</div></div></td>
            {columns.filter(([c])=>visible.includes(c)).map(([c])=><td key={c}>{c==='type' ? <Badge value={row.server.type || 'Not reported'}/>:c==='source' ? <div>{sourcePath(row.server)}{(row.server.regionDisplayName || row.server.account?.regionDisplayName) && <div className={ops.subtext}>{row.server.regionDisplayName || row.server.account?.regionDisplayName}</div>}</div>
              :c==='protection' ? <Protection row={row}/>:c==='jobs' ? <div className={styles.stack}><Link href={serverHref(row.server.id)} className={ops.textLink}>{row.jobs.length} linked<ArrowUpRight size={12}/></Link>{row.issues.jobs && <Badge value="Failed / warning" tone="danger"/>}{row.issues.disabled && <Badge value="All linked jobs disabled" tone="warning"/>}</div>
                :c==='credentials' ? <CredentialCell row={row}/>:c==='cache' ? <Cache row={row}/>:row.server.processing?.backupIOControlLevel || 'Not reported'}</td>)}
            <td><div className={styles.actions}><Link href={serverHref(row.server.id)} className={ops.inspect} aria-label={`Investigate ${row.name}`}><ArrowUpRight size={16}/></Link><Actions row={row} onDelete={setDeleting}/></div></td>
          </tr>)}</tbody></table>)}</SortableGrid></div>:<Empty>{rows.length ? 'No sources match these filters. Clear filters to return to the full inventory.':'No unstructured data sources were returned by this connection.'}</Empty>}
<Pager page={current} count={filtered.length} size={15} onChange={setPage} label="unstructured sources"/>
<p className={ops.panelFoot}>Protection evidence is scoped to returned backup objects and job selections. It does not certify every file, bucket, or container on a source. Missing evidence stays unresolved.</p>
</FilterWorkspace></Panel>
      </>}
      <footer className={ops.footer}><span><span className={ops.dot}/>Snapshot {date(data.fetchedAt)} · {loading ? 'Refreshing…':'Refreshes every 60 seconds while visible'}</span><span>VBR {data.apiRevision} · {complete ? 'Collections complete':'Partial evidence'}</span></footer>
    </>}
    <Dialog open={!!deleting} onOpenChange={open=>{if(!open && !pending)setDeleting(null)}}><DialogContent><DialogHeader><DialogTitle>Delete unstructured source</DialogTitle><DialogDescription>Remove this source registration from VBR. Jobs that reference it may be affected. Review the exact source before submitting.</DialogDescription></DialogHeader><p className="text-sm break-all">{deleting?.name}</p><code className="text-xs break-all">{deleting?.server.id}</code><p className="text-sm text-muted-foreground">{deleting?.jobs.length ?? 0} linked jobs in the loaded evidence.</p><DialogFooter><Button variant="outline" disabled={pending} onClick={()=>setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={pending} onClick={remove}>{pending ? 'Deleting…':'Delete source'}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
