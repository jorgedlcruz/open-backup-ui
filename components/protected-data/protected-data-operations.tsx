"use client"
// Open Backup UI v1.2.0

import { Trans, useI18n } from '@/components/providers/i18n-provider'
import { inventoryDiagnostic, protectedRepositoryLabel } from '@/lib/protected-data/presentation'
import { useDisplayFormat } from "@/components/providers/use-display-format"
import { FilterFacet,FilterGroup,FilterSelect } from '@/components/operations/filter-facet'
import { FilterCondition,FilterFields,GridColumnChoice,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableGrid } from '@/components/ui/sortable-grid'
import { useMemo,useState } from 'react'

import { Empty,Loading,Notice,Pager,Panel,SearchBox } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { validId } from '@/lib/investigation/model'
import { defaults,issueMatch,matches,repositoryId,restoreHref,rowsFrom,rpoStatus,sorted,summary,type Filters,type Issue,type Rpo } from '@/lib/protected-data/model'
import { thresholdHours,type RpoThreshold } from '@/lib/protected-data/rpo'
import { enumLabel } from '@/lib/i18n/presentation'
import { cn } from '@/lib/utils'
import { ArrowUpRight,Database,Hexagon,Layers,RefreshCw,ShieldCheck,Table2 } from 'lucide-react'
import Link from 'next/link'
import { HexMap } from './hexmap'
import styles from './protected-data-operations.module.css'
import { RpoControl } from './rpo-control'
import { useProtectedData } from './use-protected-data'

const issues:{value:Issue;label:string}[]=[{value:'all',label:'All records'},{value:'failed',label:'Last run failed'},{value:'noPoints',label:'No restore points'},{value:'unknown',label:'Unknown protection'},{value:'sizeUnknown',label:'Size not reported'},{value:'copies',label:'Multiple backups'}]
const columns=[['name','Workload name'],['type','Type'],['platform','Platform'],['coverage','Backup coverage'],['points','Restore points'],['size','Object size'],['run','Last run'],['backup','Backup / location']] as const
type Column=typeof columns[number][0]
const rpoOptions:Rpo[]=['Within threshold','Outside threshold','No restore points','Unknown']
function Badge({value}:{value:string}) {
  const { t } = useI18n()
  const tone=['Failed'].includes(value) ? 'danger':['No restore points','Outside threshold'].includes(value) ? 'warning':['Restore points available','Within threshold'].includes(value) ? 'success':'neutral'
  return <span className={cn(ops.badge,ops[tone])}><span className={ops.dot}/>{enumLabel(t,value)}</span>
}
function Facet({label,options,selected,onChange}:{label:string;options:string[];selected:string[];onChange:(value:string[])=>void}) {
  const { t } = useI18n(); return <FilterFacet title={label} options={options.map(value=>({value,label:enumLabel(t,value)}))} selected={selected} onChange={onChange}/> }
export function ProtectedDataOperations() {
  const { t, formatNumber } = useI18n()
  const { label: displayLabel, date, bytes: formatBytes } = useDisplayFormat()
  const [timesEnabled,setTimesEnabled]=useState(false),[view,setView]=useState<'grid'|'hexmap'>('grid')
  const {data,error,recoveryError,loading,recoveryLoading,now,refresh}=useProtectedData(),rows=useMemo(()=>data ? rowsFrom(data):[],[data])
  const [filters,setFilters]=useState<Filters>(defaults),[order,setOrder]=useState('risk'),[page,setPage]=useState(0),[visible,setVisible]=useState<Column[]>(columns.map(([c])=>c))
  const [selectedKey,setSelectedKey]=useState<string|null>(null),[rpo,setRpo]=useState<RpoThreshold>({value:1,unit:'days'}),[mapMode,setMapMode]=useState<'rpo'|'coverage'>('rpo')
  const hours=thresholdHours(rpo)
  const filtered=useMemo(()=>sorted(rows.filter(r=>matches(r,filters,hours,now)),order),[rows,filters,hours,now,order])
  const stats=useMemo(()=>summary(rows),[rows]),scope=useMemo(()=>summary(filtered),[filtered]),current=Math.min(page,Math.max(0,Math.ceil(filtered.length/15)-1))
  const selected=rows.find(r=>r.key===selectedKey),repos=[...new Map(rows.map(r=>[repositoryId(r)||'unknown',protectedRepositoryLabel(t,r)])).entries()].sort((a,b)=>a[1].localeCompare(b[1]))
  function update(patch:Partial<Filters>){setFilters(f=>({...f,...patch}));setPage(0)}
  function clear(){setFilters(defaults);setPage(0)}
  function mode(next:'grid'|'hexmap'){setView(next);if(next==='hexmap')setTimesEnabled(true)}
  return <div className={cn(ops.console,styles.page)}>
    <header className={ops.header}><div><h1><Trans>{"Protected Data"}</Trans></h1><p>{t("Find recovery gaps, investigate backup copies, and explore protection in the HexMap.")}</p></div>
      <div className={ops.headerActions}><div className={styles.toggle} aria-label={t("Protected data view")}><button className={view==='grid' ? styles.selected:''} aria-pressed={view==='grid'} onClick={()=>mode('grid')}><Table2 size={14}/><Trans>{"Grid"}</Trans></button><button className={view==='hexmap' ? styles.selected:''} aria-pressed={view==='hexmap'} onClick={()=>mode('hexmap')}><Hexagon size={14}/><Trans>{"HexMap"}</Trans></button></div>{data && <span className={ops.source}><span className={ops.dot}/>{data.sourceName}</span>}<Button variant="outline" size="sm" disabled={loading} onClick={refresh}><RefreshCw size={14} className={loading ? 'animate-spin':''}/><Trans>{"Refresh"}</Trans></Button></div>
    </header>
    {error && <Notice error>{inventoryDiagnostic(t,error,formatNumber)}{data && t("Showing the previous snapshot; this refresh failed.")}</Notice>}
    {recoveryError && <Notice error>{t("Recovery times:")}{" "}{inventoryDiagnostic(t,recoveryError,formatNumber)} {" "}{t("Inventory remains available; use Refresh to retry.")}</Notice>}
    {!data ? loading ? <Loading>{t("Loading protected objects, backup locations, and file sizes…")}</Loading>:<Empty>{t("Protected data is unavailable. Refresh to retry.")}</Empty>:<>
      {!!data.warnings.length && <details className={ops.warnings}><summary>{t("{count} data coverage notices", { count: formatNumber(data.warnings.length) })}</summary><ul>{data.warnings.map(w=><li key={w}>{inventoryDiagnostic(t,w,formatNumber)}</li>)}</ul></details>}
      <div className={ops.metrics}>
        <button className={cn(ops.metric,styles.metric)} onClick={clear}><div className={ops.metricLabel}>{t("Workloads")}<Layers size={17}/></div><div className={ops.metricValue}>{formatNumber(stats.workloads)}</div><p>{t("{count} backup records · Top platform: {platform}", {count:formatNumber(stats.records),platform:displayLabel(stats.topPlatform)})}</p></button>
        <button className={cn(ops.metric,styles.metric)} onClick={()=>{clear();update({coverage:'Restore points available'})}}><div className={ops.metricLabel}>{t("With restore points")}<ShieldCheck size={17}/></div><div className={cn(ops.metricValue,ops.success)}>{formatNumber(stats.withPoints)}<small style={{fontSize:15,color:'var(--muted-foreground)'}}> / {formatNumber(stats.workloads)}</small></div><p>{t("Objects with points in at least one returned backup")}</p></button>
        <button className={cn(ops.metric,styles.metric)} onClick={()=>{clear();setOrder('points')}}><div className={ops.metricLabel}>{t("Reported restore points")}<Database size={17}/></div><div className={ops.metricValue}>{(stats.points.value == null ? t("Unknown") : formatNumber(stats.points.value))}</div><p>{stats.points.unknown ? t("Across backup records · {count} counts unknown",{count:formatNumber(stats.points.unknown)}):t("Across backup records · Copies may overlap")}</p></button>
        <div className={ops.metric}><div className={ops.metricLabel}>{t("Backup file storage")}<Database size={17}/></div><div className={ops.metricValue}>{formatBytes(data.consumption.physical)}</div><p>{t("{measurement} · {count} unique files",{measurement:t(data.consumption.complete ? "Measured total":"Measured subtotal"),count:formatNumber(data.consumption.files)})}</p></div>
      </div>
      <Panel title={view==='hexmap' ? t("Protection HexMap"):t("Backup coverage inventory")} subtitle={t("Each record is one workload in one backup. Filters apply to both Grid and HexMap.")} action={<span className={ops.smallTag}>{t("{count} matching", { count: formatNumber(filtered.length) })}</span>}>
        <FilterWorkspace label={t("Protection HexMap filters")} search={<><SearchBox label={t("Search workloads, backups, repositories, or IDs")} value={filters.query} onChange={query=>update({query})}/></>} onClear={clear} filters={<FilterFields><FilterCondition>{issues.map(issue=><button key={issue.value} aria-pressed={filters.issue===issue.value} className={filters.issue===issue.value ? styles.selected:''} onClick={()=>update({issue:issue.value})}>{t(issue.label)}<span>{formatNumber(rows.filter(r=>issueMatch(r,issue.value)).length)}</span></button>)}</FilterCondition>
<Facet label={t("Platform")} options={[...new Set(rows.map(r=>r.object.platformName || 'Not reported'))].sort()} selected={filters.platforms} onChange={platforms=>update({platforms})}/>
<Facet label={t("Type")} options={[...new Set(rows.map(r=>r.object.type || 'Not reported'))].sort()} selected={filters.types} onChange={types=>update({types})}/>
<FilterSelect label={t("Coverage")} value={filters.coverage} onValueChange={e=>update({coverage:e})}><option value="all"><Trans>{"All coverage"}</Trans></option>{['Restore points available','No restore points','Count not reported'].map(s=><option key={s} value={s}><Trans>{s}</Trans></option>)}</FilterSelect>
<FilterSelect label={t("Last run")} value={filters.run} onValueChange={e=>update({run:e})}><option value="all"><Trans>{"All results"}</Trans></option>{['Failed','Not failed','Not reported'].map(s=><option key={s} value={s}><Trans>{s}</Trans></option>)}</FilterSelect>
<FilterSelect label={t("Repository")} value={filters.repository} onValueChange={e=>update({repository:e})}><option value="all"><Trans>{"All repositories"}</Trans></option>{repos.map(([id,name])=><option key={id} value={id}>{name}</option>)}</FilterSelect>
{(timesEnabled || view==='hexmap') && <><FilterGroup title={t("Recovery threshold")}><RpoControl value={rpo} onChange={setRpo}/></FilterGroup></>}
{(timesEnabled || view==='hexmap') && <><Facet label={t("Recovery age")} options={rpoOptions} selected={filters.rpo} onChange={rpo=>update({rpo:rpo as Rpo[]})}/></>}
{(timesEnabled || view==='hexmap') && <><span className={ops.subtext}>{recoveryLoading ? t("Updating recovery times in the background…"):t("Latest API restore-point time for each backup copy. Missing times remain unknown.")}</span></>}</FilterFields>} actions={<><GridViewMenu><label>{t("Sort")}<select aria-label={t("Protected data sort")} value={order} onChange={e=>{setOrder(e.target.value);setPage(0)}}><option value="risk">{t("Issues first")}</option><option value="name">{t("Name A–Z")}</option><option value="nameDesc">{t("Name Z–A")}</option><option value="points">{t("Most restore points")}</option><option value="pointsAsc">{t("Fewest restore points")}</option><option value="size">{t("Largest object size")}</option></select></label>
{view==='grid' && <><fieldset className="grid-column-fields"><legend><Trans>{"Visible columns"}</Trans></legend>{columns.map(([c,label])=><GridColumnChoice key={c} checked={visible.includes(c)} onSelect={e=>e.preventDefault()} onCheckedChange={checked=>setVisible(v=>checked ? [...v,c]:v.filter(x=>x!==c))}>{t(label!)}</GridColumnChoice>)}</fieldset></>}
{((timesEnabled || view==='hexmap')) && (view==='hexmap') && <><label>{t("HexMap colors")}<select aria-label={t("HexMap color mode")} value={mapMode} onChange={e=>setMapMode(e.target.value as 'rpo'|'coverage')}><option value="rpo">{t("Recovery age (RPO)")}</option><option value="coverage">{t("Coverage & last run")}</option></select></label></>}</GridViewMenu></>}>
<div className={styles.summary}><span>{t('{workloads} workloads · {records} backup records · {points} reported points',{workloads:formatNumber(scope.workloads),records:formatNumber(filtered.length),points:scope.points.value==null?t('Unknown'):formatNumber(scope.points.value)})}</span><span>{t('Approximate object sizes: {size}',{size:formatBytes(scope.size.value)})}{scope.size.unknown>0 && <> · {t('{count} unknown',{count:formatNumber(scope.size.unknown)})}</>} · {t('Copies may overlap')}</span></div>
{view==='hexmap' ? <HexMap rows={filtered} hours={hours} now={now} mode={mapMode} onSelect={r=>setSelectedKey(r.key)}/>:<>
          {filtered.length ? <div className={ops.tableScroll} tabIndex={0} role="region" aria-label={t("Scrollable protected data")}><SortableGrid rows={filtered} columns={columns.filter(([id])=>visible.includes(id)).map(([id])=>({id:id,kind:([] as string[]).includes(id)?'date' as const:'auto' as const,value:(r:typeof filtered[number])=>({name:r.name,type:r.object.type,platform:r.object.platformName,coverage:r.coverage,points:r.points,size:r.size,run:r.run,backup:r.backup?.name || r.object.jobName || r.object.backupId} as Record<string,unknown>)[id]}))} key={order} onSortChange={()=>setPage(0)}>{(filtered)=>(<table className={cn(ops.table,styles.table)}><thead><tr>{columns.filter(([c])=>visible.includes(c)).map(([c,label])=><th key={c}>{t(label!)}</th>)}<th><span className="sr-only"><Trans>{"Actions"}</Trans></span></th></tr></thead><tbody>
            {filtered.slice(current*15,(current+1)*15).map(row=><tr key={row.key}>{columns.filter(([c])=>visible.includes(c)).map(([c])=><td key={c}>
              {c==='name' ? <><Link className={ops.jobName} href={restoreHref(row)}>{row.name}</Link><div className={styles.sub}>{row.copies>1 ? t("{count} backup records for this workload",{count:formatNumber(row.copies)}):t("Single backup record")}</div></>:c==='type' ? <Badge value={row.object.type || 'Not reported'}/>:c==='platform' ? displayLabel(row.object.platformName || 'Not reported'):c==='coverage' ? <Badge value={row.coverage}/>:c==='points' ? <span className={styles.number}>{(row.points == null ? t("Unknown") : formatNumber(row.points))}</span>:c==='size' ? <><span className={styles.number}>{formatBytes(row.size)}</span><div className={styles.sub}>{t("Approximate")}</div></>:c==='run' ? <Badge value={row.run}/>:<div className={styles.stack}><span>{row.backup?.name || row.object.jobName || row.object.backupId || t("Backup not reported")}</span>{validId(repositoryId(row)) ? <Link className={ops.textLink} href={`/vbr/infrastructure/repositories/${repositoryId(row)}`}>{protectedRepositoryLabel(t,row)}<ArrowUpRight size={12}/></Link>:<span className={styles.sub}>{protectedRepositoryLabel(t,row)}</span>}</div>}
            </td>)}<td><div className={styles.actions}><Button variant="ghost" size="sm" onClick={()=>setSelectedKey(row.key)} aria-label={t("Inspect {name} in {backup}",{name:row.name,backup:row.backup?.name || row.object.backupId || t("Unknown backup")})}><Trans>{"Inspect"}</Trans></Button><Link className={ops.inspect} href={restoreHref(row)} aria-label={t("Restore points for {name}",{name:row.name})}><ArrowUpRight size={16}/></Link></div></td></tr>)}
          </tbody></table>)}</SortableGrid></div>:<Empty>{rows.length ? t("No backup records match these filters."):t("No protected objects were returned by this connection.")}</Empty>}
          <Pager page={current} count={filtered.length} size={15} onChange={setPage} label={t("protected data")}/>
        </>}
<p className={ops.panelFoot}>{t("Coverage describes returned backup objects, not every production workload. “Not failed” is the reported last-run flag, not a recovery guarantee. Object sizes are approximate; physical storage above counts unique backup files across the source and does not change with filters.")}</p>
</FilterWorkspace></Panel>
      <footer className={ops.footer}><span><span className={ops.dot}/>{t("Snapshot")}{" "}{date(data.fetchedAt)} · {loading ? t("Refreshing…"):recoveryLoading ? t("Updating recovery times…"):t("Cached for 15 minutes · Refresh bypasses cache")}{data.recoveryTimesFetchedAt && <span> {" "}{t("· Recovery times")}{" "}{date(data.recoveryTimesFetchedAt)}</span>}</span><span>VBR{" "}{data.apiRevision} · {data.objectsComplete ? t("Object inventory complete"):t("Partial object inventory")}</span></footer>
    </>}
    <Dialog open={!!selected} onOpenChange={open=>{if(!open)setSelectedKey(null)}}><DialogContent className={styles.dialog}><DialogHeader><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>{t("Backup record details and recovery evidence.")}</DialogDescription></DialogHeader>{selected && <>
      <div className={styles.actions}><Badge value={selected.coverage}/><Badge value={selected.run}/>{timesEnabled && <Badge value={rpoStatus(selected,hours,now)}/>}</div>
      <dl className={styles.details}>
        <div><dt><Trans>{"Type"}</Trans></dt><dd>{displayLabel(selected.object.type || 'Not reported')}</dd></div><div><dt><Trans>{"Platform"}</Trans></dt><dd>{displayLabel(selected.object.platformName || 'Not reported')}</dd></div>
        <div><dt><Trans>{"Restore points"}</Trans></dt><dd>{(selected.points == null ? t("Unknown") : formatNumber(selected.points))}</dd></div><div><dt>{t("Approximate object size")}</dt><dd>{formatBytes(selected.size)}</dd></div>
        <div className={styles.full}><dt>{t("Latest restore point in this backup")}</dt><dd>{selected.latest?.state==='verified' ? date(selected.latest.creationTime):selected.latest?.state==='empty' ? t("No timestamp returned"):timesEnabled ? t("Unknown"):t("Open HexMap to load API recovery times")}{selected.latest?.reason && <p className={styles.sub}>{inventoryDiagnostic(t,selected.latest.reason,formatNumber)}</p>}</dd></div>
        <div className={styles.full}><dt>{t("Backup")}</dt><dd>{selected.backup?.name || selected.object.jobName || t("Not reported")}</dd></div>
        {selected.backup && selected.backup.id!==selected.object.backupId && <div className={styles.full}><dt>{t("Resolved parent backup ID")}</dt><dd>{selected.backup.id}<p className={styles.sub}>{t("Linked through explicit backup membership. The original object record reference is retained below.")}</p></dd></div>}
        <div className={styles.full}><dt><Trans>{"Repository"}</Trans></dt><dd>{validId(repositoryId(selected)) ? <Link className={ops.textLink} href={`/vbr/infrastructure/repositories/${repositoryId(selected)}`}>{protectedRepositoryLabel(t,selected)}<ArrowUpRight size={12}/></Link>:protectedRepositoryLabel(t,selected)}</dd></div>
        {validId(selected.backup?.jobId || selected.object.jobId) && <div className={styles.full}><dt>{t("Originating job")}</dt><dd><Link className={ops.textLink} href={`/vbr/jobs/${selected.backup?.jobId || selected.object.jobId}`}>{selected.backup?.name || selected.object.jobName || selected.backup?.jobId || selected.object.jobId}<ArrowUpRight size={12}/></Link></dd></div>}
        {(['id','backupId','objectId','path','platformId','viType','hostId','fileServerId'] as const).filter(key=>selected.object[key]).map(key=><div className={styles.full} key={key}><dt>{t({id:'Backup object ID',backupId:'Backup ID',objectId:'Production object ID',path:'Production path',platformId:'Platform ID',viType:'Virtual infrastructure type',hostId:'Host ID',fileServerId:'File server ID'}[key])}</dt><dd>{key==="viType" ? displayLabel(selected.object[key]!) : selected.object[key]}</dd></div>)}
      </dl><p className={ops.subtext}>{t("Each copy has independent counts and results. RPO is an age comparison against your selected threshold; it does not prove recoverability.")}{!selected.backup && t("The backup scope is unresolved; the link opens all restore points for this workload.")}</p><Link className={ops.textLink} href={restoreHref(selected)}>{selected.backup ? t("Explore restore points"):t("Explore all workload restore points")}<ArrowUpRight size={14}/></Link>
    </>}</DialogContent></Dialog>
  </div>
}
