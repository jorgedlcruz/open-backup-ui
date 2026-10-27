"use client"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterCondition,FilterFields,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableGrid } from '@/components/ui/sortable-grid'
import { useCallback,useMemo,useState } from 'react'

import { Empty,Loading,Notice,Pager,Panel,SearchBox,date,useEvidence,useRefresh } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { veeamApi } from '@/lib/api/veeam-client'
import { buildGroups,defaultGroupFilters,entityIssues,groupHref,groupPage,groupType,matchesGroup,type GroupFilters,type GroupIssue } from '@/lib/protection-groups/model'
import { cn } from '@/lib/utils'
import { ArrowLeft,ArrowUpRight,CircleHelp,Layers,RefreshCw,Server,TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { GroupDetail } from './group-detail'
import styles from './protection-operations.module.css'
import { Actions,Badge,Discovery,Enabled,actionNames,type Action } from './shared'

const groupFilters: { value: GroupIssue; label: string }[] = [
  {value:'all',label:'All groups'},{value:'attention',label:'Needs attention'},{value:'discovery',label:'Discovery issues'},
  {value:'offline',label:'Offline computers'},{value:'agent',label:'Agent issues'},{value:'updates',label:'Component updates'},
  {value:'driver',label:'Driver issues'},{value:'reboot',label:'Reboot required'},{value:'trust',label:'Trust issues'},{value:'disabled',label:'Disabled'},
  {value:'missingAgent',label:'Agent not installed'},{value:'empty',label:'Empty groups'},{value:'unknown',label:'Missing evidence'},
]
export function ProtectionOperations({ id }: { id?: string }) {
  const {revision,refresh}=useRefresh()
  const load=useCallback((signal:AbortSignal)=>veeamApi.getProtectionInventory(id,signal),[id])
  const {data,error,loading}=useEvidence(load,revision)
  const rows=useMemo(()=>data ? buildGroups(data):[],[data])
  const [filters,setFilters]=useState<GroupFilters>(defaultGroupFilters), [order,setOrder]=useState('risk'),[page,setPage]=useState(0)
  const [action,setAction]=useState<Action|null>(null),[pending,setPending]=useState(false)
  const selected=id ? rows.find(r=>r.group.id===id):null, view=groupPage(rows,filters,order,page)
  const counts=Object.fromEntries(groupFilters.map(f=>[f.value,rows.filter(r=>matchesGroup(r,{...defaultGroupFilters,issue:f.value})).length]))
  const entities=rows.flatMap(r=>r.entities).filter(e=>e.type==='Computer')
  const complete=data && [data.groups,data.entities,data.sessions].every(e=>e.complete)
  function quick(issue:GroupIssue) {setFilters({...defaultGroupFilters,issue});setPage(0)}
  async function runAction() {
    if(!action || pending) return
    setPending(true)
    try {
      const {group,entity,kind}=action
      if(entity) {
        if(kind==='rescan') await veeamApi.rescanDiscoveredEntities(group.id,[entity.id])
        else if(kind==='installAgent') await veeamApi.installAgent(group.id,[entity.id])
        else if(kind==='uninstallAgent') await veeamApi.uninstallAgent(group.id,[entity.id])
      } else if(kind==='rescan') await veeamApi.rescanProtectionGroup(group.id)
      else if(kind==='enable') await veeamApi.enableProtectionGroup(group.id)
      else if(kind==='disable') await veeamApi.disableProtectionGroup(group.id)
      toast.success(`${actionNames[kind]} request accepted`);setAction(null);refresh()
    } catch(error) {toast.error(error instanceof Error ? error.message:'The operation could not be submitted.')}
    finally {setPending(false)}
  }
  return <div className={cn(ops.console,styles.page)}>
    <header className={ops.header}><div><h1>{id ? selected?.group.name || 'Protection group investigation':'Protection groups'}</h1><p>{id ? 'Discovery, agent health, and component evidence for this protection group.':'Find discovery failures, disconnected computers, and agents that need attention.'}</p></div><div className={ops.headerActions}>{id && <Link className={ops.backLink} href="/vbr/inventory/protection-groups"><ArrowLeft size={14}/>All groups</Link>}{data && <span className={ops.source}><span className={ops.dot}/>{data.sourceName}</span>}<Button variant="outline" size="sm" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'animate-spin':''}/>Refresh</Button>{selected && <Actions group={selected.group} onAction={setAction}/>}</div></header>
    {error && <Notice error>{error}{data && ' Showing the previous snapshot; this refresh failed.'}</Notice>}
    {!data ? loading ? <Loading>Loading protection groups and discovery evidence…</Loading>:<Empty>Protection-group inventory is unavailable. Use Refresh to retry.</Empty> : <>
      {!!data.warnings.length && <details className={ops.warnings}><summary>{data.warnings.length} data coverage {data.warnings.length===1 ? 'notice':'notices'}</summary><ul>{data.warnings.map(w=><li key={w}>{w}</li>)}</ul></details>}
      {id ? selected ? <GroupDetail key={id} row={selected} onAction={setAction}/>:<Empty>This group was not returned by the connected source.</Empty>:<>
        <div className={ops.metrics}>
          <button className={cn(ops.metric,styles.metric)} onClick={()=>quick('all')}><div className={ops.metricLabel}>Protection groups<Layers size={17}/></div><div className={ops.metricValue}>{rows.length}</div><p>{entities.length} discovered computers · {counts.disabled} disabled groups</p></button>
          <button className={cn(ops.metric,styles.metric)} onClick={()=>quick('attention')}><div className={ops.metricLabel}>Groups needing attention<TriangleAlert size={17}/></div><div className={cn(ops.metricValue,counts.attention ? ops.danger:ops.neutral)}>{counts.attention}</div><p>{counts.discovery} discovery issues · {entities.filter(e=>entityIssues(e).offline).length} offline computers</p></button>
          <button className={cn(ops.metric,styles.metric)} onClick={()=>quick('updates')}><div className={ops.metricLabel}>Computer updates<Server size={17}/></div><div className={ops.metricValue}>{entities.filter(e=>entityIssues(e).updates).length}</div><p>Agent, CBT driver, or plug-in updates · {counts.updates} groups</p></button>
          <button className={cn(ops.metric,styles.metric)} onClick={()=>quick('unknown')}><div className={ops.metricLabel}>Groups with missing evidence<CircleHelp size={17}/></div><div className={ops.metricValue}>{counts.unknown}</div><p>Unknown health, incomplete inventory, or no linked discovery run</p></button>
        </div>
        <Panel title="Protection group inventory" subtitle="Discovery history and computer health are evaluated independently." action={<span className={ops.smallTag}>{view.count} MATCHING</span>}>
          <FilterWorkspace label="Protection group inventory filters" search={<><SearchBox label="Search groups, computers, IPs, or IDs" value={filters.query} onChange={query=>{setFilters(v=>({...v,query}));setPage(0)}}/></>} onClear={()=>quick('all')} filters={<FilterFields><FilterCondition>{groupFilters.map(f=><button key={f.value} className={cn(styles.chip,filters.issue===f.value && styles.selected)} aria-pressed={filters.issue===f.value} onClick={()=>{setFilters(v=>({...v,issue:f.value}));setPage(0)}}>{f.label}<span>{counts[f.value]}</span></button>)}</FilterCondition>
<FilterSelect label={"Group type"} value={filters.type} onValueChange={e=>{setFilters(v=>({...v,type:e}));setPage(0)}}><option value="all">All types</option>{[...new Set(rows.map(r=>r.group.type || 'unknown'))].sort().map(t=><option key={t} value={t}>{groupType(t)}</option>)}</FilterSelect></FilterFields>} actions={<><GridViewMenu><label>Sort<select aria-label="Protection group sort" value={order} onChange={e=>{setOrder(e.target.value);setPage(0)}}><option value="risk">Issues first</option><option value="name">Name A–Z</option><option value="computers">Most computers</option></select></label></GridViewMenu></>}>
{view.count ? <div className={ops.tableScroll}><SortableGrid rows={view.allRows} columns={[{id:'name',value:r=>r.group.name || r.group.id},{id:'state',value:r=>r.group.isDisabled},{id:'discovery',value:r=>r.sessions[0]?.creationTime,kind:'date'},{id:'computers',value:r=>r.entities.filter(e=>e.type==="Computer").length},{id:'issues',value:r=>r.entities.filter(e=>entityIssues(e).attention).length}]} key={order} onSortChange={()=>setPage(0)}>{(sortedRows)=>(<table className={cn(ops.table,styles.table)}><thead><tr><th>Protection group</th><th>Group state</th><th>Latest discovery · 30 days</th><th>Discovered computers</th><th>Agent / component issues</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{sortedRows.slice(view.current*15,(view.current+1)*15).map(row=>{
            const computers=row.entities.filter(e=>e.type==='Computer'), count=(k:keyof ReturnType<typeof entityIssues>)=>computers.filter(e=>entityIssues(e)[k]).length
            return <tr key={row.group.id}><td><div className={styles.identity}><Layers size={17}/><div><Link className={ops.jobName} href={groupHref(row.group.id)}>{row.group.name || row.group.id}</Link><div className={ops.subtext}>{groupType(row.group.type)}</div><div className={styles.description} title={row.group.description || undefined}>{row.group.description || 'No description reported'}</div></div></div></td>
              <td><Enabled group={row.group}/></td><td><Discovery row={row}/></td><td><div className={styles.stack}><strong>{computers.length} loaded</strong><small>{computers.filter(e=>e.state==='Online').length} online · {count('offline')} offline</small><small>{row.entities.length-computers.length} other entities{!row.complete && ' · partial evidence'}</small></div></td>
              <td><div className={styles.badges}>{count('agent')>0 && <Badge value={`${count('agent')} agent issues`} tone="danger"/>}{count('updates')>0 && <Badge value={`${count('updates')} updates`} tone="warning"/>}{count('driver')>0 && <Badge value={`${count('driver')} driver issues`} tone="danger"/>}{count('reboot')>0 && <Badge value={`${count('reboot')} reboot`} tone="warning"/>}{count('trust')>0 && <Badge value={`${count('trust')} trust issues`} tone="warning"/>}{!computers.some(e=>{const i=entityIssues(e);return i.agent || i.updates || i.driver || i.reboot || i.trust}) && <span className={styles.muted}>None reported</span>}</div><div className={styles.description}>{count('missingAgent')} without agent · {count('unknown')} with unknown health</div></td>
              <td><div className={styles.actions}><Link className={ops.inspect} href={groupHref(row.group.id)} aria-label={`Investigate ${row.group.name || row.group.id}`}><ArrowUpRight size={17}/></Link><Actions group={row.group} onAction={setAction}/></div></td></tr>
          })}</tbody></table>)}</SortableGrid></div>:<Empty>{rows.length ? 'No protection groups match these filters.':data.groups.complete ? 'No protection groups were returned by this source.':'No protection groups were returned in the available inventory.'}</Empty>}
<Pager page={view.current} count={view.count} size={15} onChange={setPage} label="protection groups"/>
<p className={ops.panelFoot}>Counts cover loaded membership records. Containers are separate from computers. Missing discovery history does not mean a group has never been scanned, and an installed agent alone does not prove successful backup protection.</p>
</FilterWorkspace></Panel>
      </>}
      <footer className={ops.footer}><span><span className={ops.dot}/>Snapshot {date(data.fetchedAt)} · {loading ? 'Refreshing…':'Refreshes every 60 seconds while visible'}</span><span>VBR {data.apiRevision} · {complete ? 'Source coverage complete':'Partial evidence'}</span></footer>
    </>}
    <Dialog open={!!action} onOpenChange={open=>{if(!open && !pending)setAction(null)}}><DialogContent><DialogHeader><DialogTitle>{action ? actionNames[action.kind]:''}</DialogTitle><DialogDescription>{action?.kind==='rescan' ? 'Rescan this target. Discovery may deploy or update components according to the protection group policy.' : action?.kind==='uninstallAgent' ? 'Remove the backup agent from this computer. This can interrupt its backup protection.' : action?.kind==='installAgent' ? 'Deploy the backup agent to this computer using the protection group configuration.' : action?.kind==='disable' ? 'Disable this protection group and its scheduled discovery.' : 'Enable this protection group and its configured discovery policy.'} Review the target before submitting.</DialogDescription></DialogHeader><p className="text-sm break-words">{action?.group.name}{action?.entity && ` / ${action.entity.name}`}</p><code className="text-xs break-all">{action?.entity?.id || action?.group.id}</code><DialogFooter><Button variant="outline" disabled={pending} onClick={()=>setAction(null)}>Cancel</Button><Button variant={action?.kind==='uninstallAgent' ? 'destructive':'default'} disabled={pending} onClick={runAction}>{pending ? 'Sending…':action ? actionNames[action.kind]:''}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
