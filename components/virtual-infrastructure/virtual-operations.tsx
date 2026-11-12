"use client"
// Open Backup UI v1.2.0

import { Trans, useI18n } from '@/components/providers/i18n-provider'
import { inventoryDiagnostic, virtualContextLabel, virtualFacetLabel } from '@/lib/protected-data/presentation'
import { vbrError } from '@/lib/i18n/vbr-errors'
import { useDisplayFormat } from "@/components/providers/use-display-format"
import { FilterCondition,FilterFields,GridColumnChoice,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableGrid } from '@/components/ui/sortable-grid'
import { sizeOrder } from '@/lib/virtual-infrastructure/model'
import { useCallback,useMemo,useState } from 'react'

import { Empty,Loading,Notice,Pager,Panel,SearchBox,useEvidence,useRefresh } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { veeamApi } from '@/lib/api/veeam-client'
import { cn } from '@/lib/utils'
import { buildVirtualRows,canQuickBackup,defaultVirtualFilters,facetValue,inView,isHost,isManager,isVm,matchesVirtual,membershipIndex,sortVirtual,type Facet,type VirtualFilters,type VirtualIssue,type VirtualRow,type VirtualView } from '@/lib/virtual-infrastructure/model'
import { ArrowUpRight,Boxes,CircleHelp,Database,Layers,RefreshCw,Server,ShieldCheck,TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { ObjectDetail } from './object-detail'
import { Coverage,FacetPicker,Protection,RowActions,type Option } from './shared'
import styles from './virtual-operations.module.css'

const views:{value:VirtualView;label:string;icon:typeof Boxes}[]=[
  {value:'vms',label:'Virtual machines',icon:Boxes},{value:'managers',label:'vCenters & servers',icon:Database},
  {value:'clusters',label:'Clusters',icon:Layers},{value:'hosts',label:'Hosts',icon:Server},{value:'all',label:'All inventory',icon:Layers},
]
const issues:{value:VirtualIssue;label:string}[]=[
  {value:'all',label:'All VMs'},{value:'unprotected',label:'Unprotected'},{value:'runningUnprotected',label:'Running & unprotected'},
  {value:'backupErrors',label:'Backup failures'},{value:'noPoints',label:'No restore points'},{value:'unknown',label:'Missing evidence'},{value:'stopped',label:'Stopped / suspended'},
]
const facetLabels:Record<Facet,string>={protection:'Protection',manager:'vCenter / server',datacenter:'Datacenter',cluster:'Cluster',host:'Host',power:'State',os:'Guest OS',type:'Object type',platform:'Platform'}
const vmFacets:Facet[]=['protection','manager','datacenter','cluster','host','power','os']
const infrastructureFacets:Facet[]=['manager','datacenter','cluster','type','platform']
const columns=[['protection','Protection'],['dns','DNS name'],['manager','vCenter / server'],['datacenter','Datacenter'],['cluster','Cluster'],['host','Host'],['power','State'],['os','Guest OS'],['size','Size']] as const
type Column=typeof columns[number][0]
export function VirtualOperations() {
  const { t, formatNumber } = useI18n()
  const { label: displayLabel, date } = useDisplayFormat()
  const {revision,refresh}=useRefresh(),load=useCallback((signal:AbortSignal)=>veeamApi.getVirtualInventory(signal),[])
  const {data,error,loading}=useEvidence(load,revision),rows=useMemo(()=>data ? buildVirtualRows(data):[],[data])
  const [view,setView]=useState<VirtualView>('vms'),[filters,setFilters]=useState<VirtualFilters>(defaultVirtualFilters),[order,setOrder]=useState('name'),[page,setPage]=useState(0)
  const [visible,setVisible]=useState<Column[]>(columns.map(([c])=>c)),[selected,setSelected]=useState<string|null>(null),[quick,setQuick]=useState<VirtualRow|null>(null),[pending,setPending]=useState(false)
  const vms=useMemo(()=>rows.filter(r=>isVm(r.item)),[rows]),base=useMemo(()=>rows.filter(r=>inView(r,view)),[rows,view])
  const matching=useMemo(()=>sortVirtual(base.filter(r=>matchesVirtual(r,filters)),order),[base,filters,order]),current=Math.min(page,Math.max(0,Math.ceil(matching.length/15)-1))
  const counts=useMemo(()=>Object.fromEntries(issues.map(i=>[i.value,vms.filter(r=>matchesVirtual(r,{...defaultVirtualFilters,issue:i.value})).length])),[vms])
  const selectedRow=rows.find(r=>r.key===selected),facets=view==='vms' ? vmFacets:infrastructureFacets
  const options=useMemo(()=>Object.fromEntries(facets.map(f=>{
    const map=new Map<string,Option>()
    for(const r of base) {const value=facetValue(r,f),old=map.get(value);map.set(value,{value,label:virtualFacetLabel(t,r,f),count:(old?.count||0)+(matchesVirtual(r,filters,f)?1:0)})}
    return [f,[...map.values()].sort((a,b)=>a.label.localeCompare(b.label))]
  })) as Record<Facet,Option[]>,[base,filters,facets,t])
  const memberships=useMemo(()=>membershipIndex(rows),[rows])
  function changeView(next:VirtualView) {setView(next);setFilters(defaultVirtualFilters);setPage(0)}
  function quickFilter(issue:VirtualIssue,protection?:string) {setView('vms');setFilters({...defaultVirtualFilters,issue,facets:protection ? {protection:[protection]}:{}});setPage(0)}
  function scope(row:VirtualRow) {
    const field:Facet=isManager(row.item) ? 'manager':isHost(row.item) ? 'host':row.item.type==='Datacenter' ? 'datacenter':'cluster'
    setView('vms');setFilters({...defaultVirtualFilters,facets:{[field]:[field==='manager' ? row.manager.key:row.key]}});setPage(0);setSelected(null)
  }
  async function runQuick() {
    if(!quick || !canQuickBackup(quick.item)||pending)return
    const i=quick.item
    setPending(true)
    try {await veeamApi.quickBackupVSphere({type:i.type!,platform:i.platform!,name:i.name!,objectId:i.objectId!,hostName:i.hostName!,urn:i.urn || ''});toast.success(t('Quick Backup request accepted'));setQuick(null);refresh()}
    catch(error){toast.error(error instanceof Error ? vbrError(t,error.message):t('Quick Backup could not be submitted.'))}
    finally{setPending(false)}
  }
  return <div className={cn(ops.console,styles.page)}>
    <header className={ops.header}><div><h1><Trans>{"Virtual Infrastructure"}</Trans></h1><p>{t("Production context, VM protection, and backup evidence in one place.")}</p></div><div className={ops.headerActions}>{data && <span className={ops.source}><span className={ops.dot}/>{data.sourceName}</span>}<Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin':''}/><Trans>{"Refresh"}</Trans></Button></div></header>
    {error && <Notice error>{inventoryDiagnostic(t,error,formatNumber)}{data && t("Showing the previous snapshot; this refresh failed.")}</Notice>}
    {!data ? loading ? <Loading>{t("Loading virtual infrastructure and backup evidence…")}</Loading>:<Empty>{t("Virtual inventory is unavailable. Use Refresh to retry.")}</Empty>:<>
      {!!data.warnings.length && <details className={ops.warnings}><summary>{t("{count} data coverage notices", { count: formatNumber(data.warnings.length) })}</summary><ul>{data.warnings.map(w=><li key={w}>{inventoryDiagnostic(t,w,formatNumber)}</li>)}</ul></details>}
      <div className={ops.metrics}>
        <button className={cn(ops.metric,styles.metric)} onClick={()=>quickFilter('all')}><div className={ops.metricLabel}>{t("Virtual machines")}<Boxes size={17}/></div><div className={ops.metricValue}>{formatNumber(vms.length)}</div><p>{t("{servers} management servers · {hosts} hosts",{servers:formatNumber(rows.filter(r=>isManager(r.item)).length),hosts:formatNumber(rows.filter(r=>isHost(r.item)).length)})}</p></button>
        <button className={cn(ops.metric,styles.metric)} onClick={()=>quickFilter('all','Protected')}><div className={ops.metricLabel}>{t("With backup evidence")}<ShieldCheck size={17}/></div><div className={cn(ops.metricValue,ops.success)}>{formatNumber(vms.filter(r=>r.protection==='Protected').length)}</div><p>{t("VMs with matching backup objects")}</p></button>
        <button className={cn(ops.metric,styles.metric)} onClick={()=>quickFilter('unprotected')}><div className={ops.metricLabel}>{t("Unprotected")}<TriangleAlert size={17}/></div><div className={cn(ops.metricValue,counts.unprotected ? ops.warning:ops.neutral)}>{formatNumber(counts.unprotected)}</div><p>{t("{count} running · no backup objects found",{count:formatNumber(counts.runningUnprotected)})}</p></button>
        <button className={cn(ops.metric,styles.metric)} onClick={()=>quickFilter('backupErrors')}><div className={ops.metricLabel}>{t("Backup failures")}<CircleHelp size={17}/></div><div className={cn(ops.metricValue,counts.backupErrors ? ops.danger:ops.neutral)}>{formatNumber(counts.backupErrors)}</div><p>{t("{unknown} unknown protection · {noPoints} without restore points",{unknown:formatNumber(vms.filter(r=>r.protection==='Unknown').length),noPoints:formatNumber(counts.noPoints)})}</p></button>
      </div>
      <nav className={styles.views} aria-label={t("Inventory views")}>{views.map(v=><button key={v.value} aria-pressed={view===v.value} className={view===v.value ? styles.selected:''} onClick={()=>changeView(v.value)}><v.icon size={15}/>{t(v.label)}<span>{formatNumber(rows.filter(r=>inView(r,v.value)).length)}</span></button>)}</nav>
      <Panel title={view==='vms' ? t("VM protection inventory"):views.find(v=>v.value===view)!.label} subtitle={view==='vms' ? t("Combine location, protection, power state, and guest OS filters. Select a VM to investigate."):t("Explore production hierarchy and the protection of VMs in each scope.")} action={<span className={ops.smallTag}>{t("{count} matching", { count: formatNumber(matching.length) })}</span>}>
        <FilterWorkspace label={t("VM protection inventory filters")} search={<><SearchBox label={t("Search names, DNS, OS, or IDs")} value={filters.query} onChange={query=>{setFilters(f=>({...f,query}));setPage(0)}}/></>} onClear={()=>{setFilters(defaultVirtualFilters);setPage(0)}} filters={<FilterFields>{view==='vms' && <><FilterCondition>{issues.map(i=><button key={i.value} aria-pressed={filters.issue===i.value} className={cn(styles.chip,filters.issue===i.value && styles.selected)} onClick={()=>{setFilters(f=>({...f,issue:i.value}));setPage(0)}}>{t(i.label)}<span>{formatNumber(counts[i.value])}</span></button>)}</FilterCondition></>}
{facets.map(f=><FacetPicker key={f} title={t(facetLabels[f])} options={options[f]} defaultOpen={f==='protection'} values={filters.facets[f]||[]} onChange={values=>{setFilters(old=>({...old,facets:{...old.facets,[f]:values}}));setPage(0)}}/>)}</FilterFields>} actions={<><GridViewMenu><select aria-label={t("Inventory sort")} value={order} onChange={e=>{setOrder(e.target.value);setPage(0)}}><option value="name">{t("Name A–Z")}</option><option value="risk">{t("Issues first")}</option><option value="sizeDesc">{t("Size: largest first")}</option><option value="sizeAsc">{t("Size: smallest first")}</option></select>
{view==='vms' && <><fieldset className="grid-column-fields"><legend><Trans>{"Visible columns"}</Trans></legend>{columns.map(([key,label])=><GridColumnChoice key={key} checked={visible.includes(key)} onCheckedChange={checked=>setVisible(v=>checked ? [...v,key]:v.filter(k=>k!==key))} onSelect={e=>e.preventDefault()}>{t(label!)}</GridColumnChoice>)}</fieldset></>}</GridViewMenu></>}>
{matching.length ? <div className={ops.tableScroll} tabIndex={0} role="region" aria-label={t("Scrollable inventory table")}><SortableGrid rows={matching} columns={[{id:'name',value:(r:typeof matching[number])=>r.item.name || r.item.objectId},...(view==='vms'?columns.filter(([id])=>visible.includes(id)).map(([id])=>({id:id,kind:([] as string[]).includes(id)?'date' as const:'auto' as const,value:(r:typeof matching[number])=>({protection:r.protection,dns:r.dns,manager:r.manager.name,datacenter:r.datacenter.name,cluster:r.cluster.name,host:r.host.name,power:r.power,os:r.os,size:sizeOrder(r.item.size)} as Record<string,unknown>)[id]})):[{id:'type',value:(r:typeof matching[number])=>r.item.type},{id:'location',value:(r:typeof matching[number])=>r.manager.name},{id:'protection',value:(r:typeof matching[number])=>isVm(r.item)?r.protection:(memberships.get(r.key)||[]).filter(vm=>vm.protection==='Protected').length},{id:'issues',value:(r:typeof matching[number])=>(isVm(r.item)?[r]:memberships.get(r.key)||[]).filter(vm=>vm.backupIssue).length},{id:'size',value:(r:typeof matching[number])=>sizeOrder(r.item.size)}])]} key={order+view} onSortChange={()=>setPage(0)}>{(matching)=>(<table className={cn(ops.table,styles.table)}><thead><tr><th>{t("Object name")}</th>{view==='vms' ? columns.filter(([c])=>visible.includes(c)).map(([c,label])=><th key={c}>{t(label!)}</th>):<><th>{t("Type / platform")}</th><th>{t("Production location")}</th><th>{t("VM protection")}</th><th>{t("Backup issues")}</th><th>{t("Reported size")}</th></>}<th><span className="sr-only"><Trans>{"Actions"}</Trans></span></th></tr></thead><tbody>{matching.slice(current*15,(current+1)*15).map(row=><tr key={row.key}>
          <td><div className={styles.identity}>{isVm(row.item) ? <Boxes size={17}/>:isHost(row.item) ? <Server size={17}/>:<Layers size={17}/>}<div><button className={ops.jobName} onClick={()=>setSelected(row.key)}>{row.item.name || row.item.objectId || t("Unnamed object")}</button><div className={ops.subtext}>{row.item.platform ? displayLabel(row.item.platform) : t("Platform not reported")}</div></div></div></td>
          {view==='vms' ? columns.filter(([c])=>visible.includes(c)).map(([c])=><td key={c} className={c==='size' ? styles.size:''}>{c==='protection' ? <Protection row={row}/>:c==='size' ? row.item.size || t("Not reported"):['manager','datacenter','cluster','host'].includes(c) ? virtualContextLabel(t,row,c as 'manager'|'datacenter'|'cluster'|'host'):c==='power' ? <span className={cn(ops.badge,row.power==='Running' ? ops.success:ops.neutral)}>{displayLabel(row.power)}</span>:virtualContextLabel(t,row,c as 'dns'|'os')}</td>)
            : <><td>{displayLabel(row.item.type || "Not reported")}<div className={ops.subtext}>{displayLabel(row.item.platform || "Not reported")}</div></td><td>{virtualContextLabel(t,row,'manager')}<div className={ops.subtext}>{(['datacenter','cluster'] as const).filter(field=>row[field].key!=='unknown').map(field=>virtualContextLabel(t,row,field)).join(' / ') || t("Hierarchy not reported")}</div></td><td>{isVm(row.item) ? <Protection row={row}/>:<Coverage rows={memberships.get(row.key)||[]}/>}</td><td>{!isVm(row.item) && !memberships.get(row.key)?.length ? t("Not reported"):t("{count} failed last run",{count:formatNumber((isVm(row.item)?[row]:memberships.get(row.key)||[]).filter(r=>r.backupIssue).length)})}</td><td className={styles.size}>{row.item.size || t("Not reported")}{(isManager(row.item)||isHost(row.item)||['Cluster','Datacenter'].includes(row.item.type||'')) && <div><button className={ops.textLink} disabled={!memberships.get(row.key)?.length} onClick={()=>scope(row)}>{t("View VMs")}<ArrowUpRight size={12}/></button></div>}</td></>}
          <td><RowActions row={row} inspect={()=>setSelected(row.key)} quick={()=>setQuick(row)}/></td></tr>)}</tbody></table>)}</SortableGrid></div>:<Empty>{base.length ? t("No objects match these filters. Clear filters to explore the inventory."):t("No objects of this type were returned by the source.")}</Empty>}
<Pager page={current} count={matching.length} size={15} onChange={setPage} label={t("inventory objects")}/>
<p className={ops.panelFoot}>{t("Protected = matching backup objects. Counts cover loaded inventory; templates and other objects remain available in All inventory. Size is shown exactly as reported. Standalone ESXi registrations remain listed; their VMs are browsed through management servers to avoid duplicate production records.")}{" "}{t("{count} VMs have no reported host relationship; missing relationships do not mean a host is empty.",{count:formatNumber(vms.filter(r=>r.host.key==='unknown').length)})}</p>
</FilterWorkspace></Panel>
      <footer className={ops.footer}><span><span className={ops.dot}/>{t("Snapshot")}{" "}{date(data.fetchedAt)} · {loading ? t("Refreshing…"):t("Refreshes every 60 seconds while visible")}</span><span>VBR{" "}{data.apiRevision} · {data.inventory.complete && data.backups.complete && data.hostLinks?.complete!==false ? t("Collections complete"):t("Partial evidence")}</span></footer>
    </>}
    {selectedRow && <ObjectDetail row={selectedRow} rows={rows} onClose={()=>setSelected(null)} onScope={scope} onQuick={()=>{setSelected(null);setQuick(selectedRow)}}/>}
    <Dialog open={!!quick} onOpenChange={open=>{if(!open && !pending)setQuick(null)}}><DialogContent><DialogHeader><DialogTitle>{t("Start Quick Backup")}</DialogTitle><DialogDescription>{t("Submit an on-demand backup for this vSphere VM using its existing backup job configuration. Review the target before starting.")}</DialogDescription></DialogHeader><p className="text-sm break-words">{quick?.item.name} · {quick && virtualContextLabel(t,quick,'manager')}</p><code className="text-xs break-all">{quick?.item.objectId}</code><DialogFooter><Button variant="outline" disabled={pending} onClick={()=>setQuick(null)}><Trans>{"Cancel"}</Trans></Button><Button disabled={pending} onClick={runQuick}>{pending ? t("Submitting…"):t("Start backup")}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
