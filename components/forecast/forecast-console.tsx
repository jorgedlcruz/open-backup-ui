'use client'
// Open Backup UI v1.0.2

import { usePlanningFormat } from '@/components/forecast/localized-format'
import { DataLoading } from '@/components/ui/data-loading'

import { Trans, useI18n } from '@/components/providers/i18n-provider'
import { localizedPolicy, localizedSchedule, localizedFull, planningMessage } from '@/lib/forecast/presentation'

import {useEffect,useMemo,useRef,useState} from 'react'
import Link from 'next/link'
import {ArrowDownToLine,ArrowUpRight,Clock3,Database,HardDrive,RefreshCw,Search,TrendingUp,TriangleAlert} from 'lucide-react'
import {LensSwitcher} from '@/components/lens/lens-switcher'
import {Button} from '@/components/ui/button'
import {SortableGrid} from '@/components/ui/sortable-grid'
import {FilterWorkspace} from '@/components/operations/filter-workspace'
import {FilterSelect} from '@/components/operations/filter-facet'
import {capacityTrend,DAY,GB,dayStart,policyLabel,projectBackup,repositoryBackups,uniqueFiles,type ForecastSnapshot} from '@/lib/forecast/model'
import ops from '@/components/operations/operations.module.css'
import styles from './forecast.module.css'
import {CollectorStatusPanel,HygieneView,RetentionView} from './storage-investigation'

type ChartPoint={at:number;bytes:number;peak?:number;fulls?:number}

function ForecastChart({history,future,now,capacity,mode}:{history:ChartPoint[];future:ChartPoint[];now:number;capacity?:number;mode:'files'|'capacity'}) {
  const { bytes, shortDate, number } = usePlanningFormat()

  const { t: localText } = useI18n()

  const [hover,setHover]=useState<number|null>(null)
  const all=[...history,...future], start=Math.min(now-7*DAY,...history.map(p=>p.at)),end=Math.max(now+30*DAY,...future.map(p=>p.at))
  const max=Math.max(GB,...all.map(p=>Math.max(p.bytes,p.peak||0)),capacity||0)*1.12
  const x=(at:number)=>76+(at-start)/(end-start)*884,y=(value:number)=>254-value/max*210
  const path=(points:ChartPoint[],peak=false)=>points.map((p,i)=>`${i?'L':'M'}${x(p.at).toFixed(2)},${y(peak?p.peak??p.bytes:p.bytes).toFixed(2)}`).join(' ')
  const active=hover===null?null:all[hover]
  return <div className={styles.chart}>
    <svg viewBox="0 0 1000 310" role="img" aria-label={mode==='files' ? localText("Retained file inventory and dotted retention scenario. This is not historical volume utilization.") : localText("Recorded repository usage and dotted capacity trend")} onPointerLeave={()=>setHover(null)}>
      <rect x={x(now)} y="28" width={960-x(now)} height="226" fill="var(--forecast-color)" opacity=".045"/>
      {[0,.25,.5,.75,1].map(t=><g key={t}><line x1="76" x2="960" y1={y(max*t)} y2={y(max*t)} stroke="var(--border)" strokeDasharray="3 6"/><text x="64" y={y(max*t)+4} textAnchor="end">{max*t>=1024*GB ? localText("{value} TiB", { value: number(max*t/(1024*GB), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : localText("{value} GiB", { value: number(max*t/GB, { maximumFractionDigits: 0 }) })}</text></g>)}
      {capacity!=null&&<g><line x1="76" x2="960" y1={y(capacity)} y2={y(capacity)} stroke="var(--ops-chart-danger)" strokeDasharray="4 5"/><text x="960" y={y(capacity)-7} textAnchor="end">{localText("Reported capacity")}</text><line x1="76" x2="960" y1={y(capacity*.8)} y2={y(capacity*.8)} stroke="var(--ops-chart-warning)" strokeDasharray="2 6"/></g>}
      {history.length>1&&<path d={path(history)} fill="none" stroke="var(--history-color)" strokeWidth="2.5"/>}
      {future.length>1&&<><path d={path(future)} fill="none" stroke="var(--forecast-color)" strokeWidth="3" strokeDasharray="3 6" strokeLinecap="round"/>{mode==='files'&&<path d={path(future,true)} fill="none" stroke="var(--forecast-color)" opacity=".35" strokeWidth="1.5" strokeDasharray="2 4"/>}</>}
      <line x1={x(now)} x2={x(now)} y1="28" y2="260" stroke="var(--muted-foreground)" strokeWidth="1.5"/>
      <text x={x(now)-8} y="17" textAnchor="end">{mode==='files' ? localText("Retained file dates") : localText("Recorded usage")}</text><text x={x(now)+8} y="17">{localText("Today → {value}", { value: mode==='files' ? localText("Policy scenario") : localText("Trend projection") })}</text>
      {[start,now,end].map((at,i)=><text key={i} x={x(at)} y="282" textAnchor={i===0?'start':i===2?'end':'middle'}>{shortDate(at)}</text>)}
      {all.map((p,i)=><circle key={i} cx={x(p.at)} cy={y(p.bytes)} r={all.length===1?5:4} fill={i<history.length?'var(--history-color)':'var(--forecast-color)'} opacity={hover===i||all.length===1?1:.15} tabIndex={0} aria-label={`${shortDate(p.at)}: ${localText(bytes(p.bytes))}${p.fulls ? ', ' + localText('{count} full files planned', { count: number(p.fulls) }) : ''}`} onPointerEnter={()=>setHover(i)} onFocus={()=>setHover(i)} onBlur={()=>setHover(null)}><title>{shortDate(p.at)} · {localText(bytes(p.bytes))}{p.peak ? localText("· before expiry {value}", { value: bytes(p.peak) }) : ''}</title></circle>)}
    </svg>
    <div className={styles.legend}><span><i/> {mode==='files' ? localText("Currently retained file inventory") : localText("Recorded volume usage")}</span><span className={styles.prediction}><i/> {mode==='files' ? localText("Projected retained footprint") : localText("Observed growth extrapolation")}</span>{mode==='files'&&<span>{localText("Faint dotted line: peak before expiry")}</span>}<strong aria-live="polite">{active ? `${shortDate(active.at)} · ${localText(bytes(active.bytes))}${active.fulls ? ' · ' + localText('{count} full files', { count: number(active.fulls) }) : ''}` : localText("Hover or focus a point for details")}</strong></div>
  </div>
}

export function ForecastConsole({initialRepository='',initialMode='files'}:{initialRepository?:string;initialMode?:'files'|'capacity'}={}) {
  const { bytes, date, number } = usePlanningFormat()

  const { t: localText } = useI18n()

  const { t: uiText } = useI18n()

  const [view,setView]=useState<'forecast'|'retention'|'hygiene'>('forecast')
  const [data,setData]=useState<ForecastSnapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const [request,setRequest]=useState({version:0,force:false})
  const requestPending=useRef(false)
  const [selected,setSelected]=useState(initialRepository),[horizon,setHorizon]=useState(30),[change,setChange]=useState(0),[retention,setRetention]=useState(''),[mode,setMode]=useState<'files'|'capacity'>(initialMode)
  useEffect(()=>{setSelected(initialRepository);setMode(initialMode)},[initialRepository,initialMode])
  const [query,setQuery]=useState(''),[condition,setCondition]=useState('all'),[page,setPage]=useState(0)
  useEffect(()=>{
    const controller=new AbortController();requestPending.current=true;setLoading(true);setError('')
    fetch(request.force?'/api/vbr/forecast?refresh=1':'/api/vbr/forecast',{signal:controller.signal,cache:'no-store'}).then(async response=>{
      if([401,403,409].includes(response.status)&&!controller.signal.aborted)setData(null)
      const body=await response.json();if(!response.ok)throw new Error(body.error||'Forecast evidence is unavailable.');return body as ForecastSnapshot
    }).then(value=>{if(!controller.signal.aborted)setData(value)}).catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Forecast evidence is unavailable.')}).finally(()=>{if(!controller.signal.aborted){requestPending.current=false;setLoading(false)}})
    return ()=>{controller.abort();requestPending.current=false}
  },[request])
  useEffect(()=>{
    const checkCache=()=>{if(!document.hidden&&!requestPending.current)setRequest(previous=>({version:previous.version+1,force:false}))}
    const timer=setInterval(checkCache,60000)
    document.addEventListener('visibilitychange',checkCache)
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',checkCache)}
  },[])
  useEffect(()=>{
    if(!data?.cache?.refreshing)return
    const timer=setTimeout(()=>{if(!document.hidden&&!requestPending.current)setRequest(previous=>({version:previous.version+1,force:false}))},5000)
    return ()=>clearTimeout(timer)
  },[data])
  const repositories=useMemo(()=>{
    const map=new Map(data?.repositories.data.map(r=>[r.id,{id:r.id,name:r.name}])||[])
    data?.scaleOut.data.forEach(r=>map.set(r.id,{id:r.id,name:uiText('{name} · scale-out group', { name: r.name })}))
    return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name))
  },[data,uiText])
  const preferred=data?.backups.data.filter(b=>repositories.some(r=>r.id===b.repositoryId)).sort((a,b)=>b.files.length-a.files.length)[0]?.repositoryId
  const id=repositories.some(r=>r.id===selected)?selected:preferred||repositories[0]?.id||''
  const now=data?Date.parse(data.fetchedAt):Date.now(),repo=data?.repositories.data.find(r=>r.id===id),parent=data?.scaleOut.data.find(r=>r.id===id)
  const rows=useMemo(()=>{
    if(!data)return []
    return repositoryBackups(data,id).map(backup=>{
      const policy=data.policies.data.find(p=>p.id===backup.jobId),config=data.configs.data.find(c=>c.id===backup.repositoryId)
      const unique=uniqueFiles(backup.files),members=new Set(unique.files.flatMap(f=>f.objectIds||[]))
      const workloads=backup.workloads?.length?backup.workloads:data.objects.data.filter(o=>o.backupId===backup.id||!o.backupId&&members.has(o.id)),names=[...new Set(workloads.map(w=>w.name||w.id))]
      const projection=projectBackup(backup,policy,config,now,horizon,change,retention?Number(retention):undefined)
      const dates=unique.files.map(f=>Date.parse(f.creationTime||'')).filter(Number.isFinite)
      const shared=unique.files.some(f=>(f.objectIds?.length||0)>1)
      return {backup,policy,projection,names,shared,points:workloads.length&&workloads.every(w=>w.restorePointsCount!=null&&w.restorePointsCount>=0)?workloads.reduce((sum,w)=>sum+w.restorePointsCount!,0):null,
        latest:dates.length?Math.max(...dates):null,modeled:projection.values.length>0,footprint:projection.current}
    })
  },[data,id,now,horizon,change,retention])
  const modeled=rows.filter(r=>r.modeled),allFiles=uniqueFiles(rows.flatMap(r=>r.backup.files))
  const filesKnown=allFiles.files.filter(f=>typeof f.backupSize==='number'&&f.backupSize>=0),footprint=filesKnown.length?filesKnown.reduce((sum,f)=>sum+f.backupSize!,0):null
  const future:ChartPoint[]=modeled.length?Array.from({length:horizon+1},(_,i)=>({at:modeled[0].projection.values[i].at,bytes:modeled.reduce((sum,r)=>sum+r.projection.values[i].bytes,0),peak:modeled.reduce((sum,r)=>sum+r.projection.values[i].peak,0),fulls:modeled.reduce((sum,r)=>sum+r.projection.values[i].fulls,0)})):[]
  const modeledFiles=uniqueFiles(modeled.flatMap(r=>r.backup.files.filter(f=>r.projection.modeledFileIds?.includes(f.id)))).files
  const history:ChartPoint[]=modeled.length?Array.from({length:31},(_,i)=>{
    const at=i===30?now:dayStart(now)-(30-i)*DAY
    return {at,bytes:modeledFiles.filter(f=>Date.parse(f.creationTime||'')<=at).reduce((sum,f)=>sum+(f.backupSize||0),0)}
  }):[]
  const trend=capacityTrend(data?.observations||[],id,now,horizon)
  const validCapacity=repo?.capacityGB!=null&&repo.capacityGB>0&&repo.freeGB!=null&&repo.freeGB>=0&&repo.freeGB<=repo.capacityGB
  const filtered=rows.filter(r=>(condition==='all'||condition==='modeled'&&r.modeled||condition==='unmodeled'&&!r.modeled||condition==='shared'&&r.shared)&&[r.backup.name,r.policy?.name,...r.names].join(' ').toLowerCase().includes(query.toLowerCase()))
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/10)-1))
  const notes=[...new Set(modeled.flatMap(r=>r.projection.notes))]
  const maximum=future.length?Math.max(...future.map(p=>p.peak||p.bytes)):null
  const reset=()=>{setQuery('');setCondition('all');setPage(0)}
  function exportProjection(){
    const points:ChartPoint[]=mode==='files'?future:trend.values
    const csv=['Date,Basis,Projected bytes,Peak before expiry bytes',...points.map(p=>[new Date(p.at).toISOString(),mode==='files'?'Modeled file footprint':'Measured capacity trend',Math.round(p.bytes),Math.round(p.peak??p.bytes)].join(','))].join('\r\n')
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='capacity-forecast.csv';a.click();URL.revokeObjectURL(url)
  }
  return <div className={ops.console}>
    <header className={ops.header}><div><h1><Trans>{"Capacity Forecast"}</Trans></h1><p>{localText("See what is consuming storage. Plan for the next full, the next cycle, and the next quarter.")}</p></div><div className={ops.headerActions}><div className={ops.headerControls}><LensSwitcher view="forecast" snapshot={null} loading={false} stale={false}/><Button size="sm" variant="outline" disabled={loading} onClick={()=>setRequest(previous=>({version:previous.version+1,force:true}))}><RefreshCw size={14} className={loading?'animate-spin':''}/>{loading ? localText("Reading evidence…") : localText("Refresh")}</Button></div><span className={ops.source}>{localText("{value} · Read-only planning", { value: data?.sourceName || localText("Selected VBR source") })}</span></div></header>
    {error&&<div className={ops.notice} role="alert"><TriangleAlert size={18}/><div><strong>{data ? localText("Previous snapshot · refresh failed") : localText("Forecast could not load")}</strong><p>{planningMessage(localText, error)}</p></div><Link href="/connect"><Trans>{"Connect"}</Trans></Link></div>}
    {!data?<div className={ops.empty}>{loading ? <DataLoading status={localText("Collecting repositories, workload files and job policies…")}/> : localText("No forecast evidence available.")}</div>:<>
      {data.cache&&<div role="status" className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2 font-medium text-foreground"><Clock3 size={14} aria-hidden="true"/>{localText("Cached planning snapshot")}</span>
        <span>{localText("Updated {time}",{time:date(data.cache.updatedAt||data.fetchedAt)})}</span>
        {data.cache.background?<><span>{localText("Background refresh every {minutes} minutes",{minutes:number(data.cache.intervalMinutes)})}</span>{data.cache.nextRefreshAt&&<span>{localText("Next refresh: {time}",{time:date(data.cache.nextRefreshAt)})}</span>}</>:<span>{localText("Automatic background refresh is unavailable. Use Refresh to update this snapshot.")}</span>}
        {data.cache.refreshing?<span className="flex items-center gap-2"><RefreshCw size={12} className="animate-spin" aria-hidden="true"/>{localText("Refreshing planning data in the background…")}</span>:data.cache.refreshFailed?<span>{localText("Refresh failed. Showing the last available planning snapshot.")}</span>:data.cache.stale?<span>{localText("Planning snapshot is out of date.")}</span>:null}
      </div>}
      <CollectorStatusPanel data={data}/>
      <div className={styles.views} role="group" aria-label={localText("Storage investigation views")}><button aria-pressed={view==='forecast'} onClick={()=>setView('forecast')}>{localText("Forecast")}</button><button aria-pressed={view==='retention'} onClick={()=>setView('retention')}>{localText("Retention & immutability")}</button><button aria-pressed={view==='hygiene'} onClick={()=>setView('hygiene')}>{localText("Backup hygiene")}</button></div>
      <div className={styles.scope}><label><Trans>{"Repository"}</Trans><select aria-label={localText("Repository")} value={id} onChange={e=>{setSelected(e.target.value);setPage(0);setRetention('')}}>{repositories.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>{view==='forecast'&&<label>{localText("Look ahead")}<select value={horizon} onChange={e=>setHorizon(Number(e.target.value))}>{[30,60,90].map(n=><option key={n} value={n}>{localText("{n} days", { n: number(n) })}</option>)}</select></label>}{id&&<Link href={`/vbr/infrastructure/repositories/${id}`}>{localText("Inspect repository")} <ArrowUpRight size={14}/></Link>}</div>
      {view==='retention'?<RetentionView key={id} data={data} repositoryId={id}/>:view==='hygiene'?<HygieneView key={id} data={data} repositoryId={id}/>:<>
      <div className={ops.metrics}>
        <div className={`${ops.metric} ${styles.metric}`}><div className={ops.metricLabel}>{localText("Reported volume usage")}<HardDrive size={17}/></div><strong className={ops.metricValue}>{validCapacity ? number((repo!.capacityGB!-repo!.freeGB!)/repo!.capacityGB!, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }) : localText("Not measured")}</strong><p>{validCapacity ? localText("{value} free of {value2}", { value: bytes(repo!.freeGB!*GB), value2: bytes(repo!.capacityGB!*GB) }) : localText("Scale-out / object storage may not report a finite capacity")}</p></div>
        <div className={`${ops.metric} ${styles.metric}`}><div className={ops.metricLabel}>{localText("Retained file footprint")}<Database size={17}/></div><strong className={ops.metricValue}>{localText(bytes(footprint))}</strong><p>{localText("{count} unique files · {count2} backups · known subtotal", { count: number(allFiles.files.length), count2: number(rows.length) })}</p></div>
        <div className={`${ops.metric} ${styles.metric}`}><div className={ops.metricLabel}>{localText("Peak file scenario")}<TrendingUp size={17}/></div><strong className={ops.metricValue}>{localText(bytes(maximum))}</strong><p>{localText("{count} of {count2} backups modeled · before expiry · {horizon} days", { count: number(modeled.length), count2: number(rows.length), horizon: number(horizon) })}</p></div>
        <div className={`${ops.metric} ${styles.metric}`}><div className={ops.metricLabel}>{localText("Time to 80% used")}<Clock3 size={17}/></div><strong className={ops.metricValue}>{trend.slope===null ? localText("Learning") : trend.daysTo80===null ? localText("No crossing") : trend.daysTo80===0 ? localText("Already ≥80%") : localText("{daysTo80} days", { daysTo80: number(trend.daysTo80) })}</strong><p>{trend.slope===null ? localText("Needs three daily measurements spanning at least 48 hours") : localText("{value} GB/day observed trend · unchanged conditions", { value: number(trend.slope, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</p></div>
      </div>
      <section className={ops.panel}><div className={ops.panelHeading}><div><h2>{mode==='files' ? localText("Backup footprint outlook") : localText("Repository capacity outlook")}</h2><p>{mode==='files' ? localText("Modeled backups only · file sizes after compression and deduplication") : localText("Real capacity samples recorded by this app · no invented historical usage")}</p></div><Button variant="outline" size="sm" disabled={!(mode==='files'?future:trend.values).length} onClick={exportProjection}><ArrowDownToLine size={14}/>{localText("Export projection")}</Button></div>
        <div className={styles.chartControls}><div role="group" aria-label={localText("Forecast basis")}><button aria-pressed={mode==='files'} onClick={()=>setMode('files')}>{localText("Backup files & retention")}</button><button aria-pressed={mode==='capacity'} onClick={()=>setMode('capacity')}>{localText("Recorded volume usage")}</button></div><span>{modeled.length===rows.length&&modeled.every(r=>!r.projection.excludedFiles)&&data.backups.complete&&rows.length ? localText("File model coverage complete") : localText("Partial model coverage")} · {data.historyAvailable ? localText("History recording active") : localText("History unavailable")}</span></div>
        {mode==='files'&&!future.length?<div className={ops.empty}><TrendingUp size={28}/><strong>{localText("More evidence is needed for this repository")}</strong><p>{localText("The consumers below explain which file history or policy settings are missing. Other repositories may have enough evidence.")}</p></div>:<ForecastChart mode={mode} now={now} history={mode==='files'?history:trend.history.map(p=>({at:Date.parse(p.at),bytes:(p.capacityGB-p.freeGB)*GB}))} future={mode==='files'?future:trend.values} capacity={mode==='capacity'&&validCapacity?repo!.capacityGB!*GB:undefined}/>}
        <p className={ops.panelFoot}>{mode==='files' ? localText("The solid segment groups files that still exist today by creation date; deleted files are absent, so it is not past disk usage. The colored dotted segment simulates current retention and scheduled fulls. File sizes may share Fast Clone blocks and cannot be directly compared with free volume space.") : localText("The app server collects capacity every 15 minutes using saved credentials and stores hourly readings. {value} See Capacity collection above for the latest background status.", { value: trend.slope===null ? localText("A projection appears after three daily samples spanning 48 hours.") : localText("The dotted line extends the median observed daily change; it is a trend, not a guarantee.") })}</p>
      </section>
      <section className={`${ops.panel} ${styles.scenario}`}><div className={ops.panelHeading}><div><h2>{localText("What if?")}</h2><p>{localText("Adjust the file scenario without changing VBR configuration.")}</p></div><Button variant="ghost" size="sm" onClick={()=>{setChange(0);setRetention('')}}>{localText("Reset scenario")}</Button></div><div className={styles.scenarioFields}><label>{localText("Incremental data change")} <strong>{number(change/100, { style: 'percent', signDisplay: 'exceptZero' })}</strong><input type="range" min="-50" max="200" step="10" value={change} onChange={e=>setChange(Number(e.target.value))}/><small>{localText("Relative to the median of up to 14 retained increments per workload chain. Full sizes stay constant.")}</small></label><label>{localText("Retention quantity override")}<input type="number" aria-label={localText("Retention quantity override")} min="1" max="9999" placeholder={localText("Use each job’s setting")} value={retention} onChange={e=>{const v=e.target.value;if(!v||Number.isInteger(Number(v))&&Number(v)>=1&&Number(v)<=9999)setRetention(v)}}/><small>{localText("Each job keeps its own unit: days or restore points. GFS and immutability holds remain in place.")}</small></label></div></section>
      <section className={ops.panel}><div className={ops.panelHeading}><div><h2>{localText("Consumers & retention policies")}</h2><p>{localText("Workloads grouped by backup. Shared files count once; per-workload allocation is not invented.")}</p></div><span className={ops.smallTag}>{localText("{count} BACKUPS", { count: number(filtered.length) })}</span></div>
        <FilterWorkspace label={localText("Forecast consumer filters")} activeCount={Number(!!query)+Number(condition!=='all')} onClear={reset} search={<label className={ops.search}><Search size={14}/><input aria-label={uiText("Search forecast consumers")} placeholder={uiText("Search workloads, backups or jobs")} value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>} filters={<FilterSelect defaultOpen label={localText("Model status")} value={condition} onValueChange={v=>{setCondition(v);setPage(0)}}><option value="all">{localText("All consumers")}</option><option value="modeled">{localText("Included in scenario")}</option><option value="unmodeled">{localText("Needs more evidence")}</option><option value="shared">{localText("Shared workload files")}</option></FilterSelect>}>
          <div className={ops.tableScroll}><SortableGrid rows={filtered} columns={[{id:'name',value:r=>r.backup.name},{id:'size',value:r=>r.footprint},{id:'points',value:r=>r.points},{id:'policy',value:r=>policyLabel(r.policy)},{id:'latest',value:r=>r.latest,kind:'date'},{id:'forecast',value:r=>r.projection.values.at(-1)?.bytes},{id:'evidence',value:r=>r.projection.reason||'Modeled'}]} onSortChange={()=>setPage(0)}>{sorted=><table className={ops.table}><thead><tr><th>{localText("Backup / workloads")}</th><th>{localText("File footprint")}</th><th><Trans>{"Restore points"}</Trans></th><th>{localText("Retention & schedule")}</th><th>{localText("Latest file")}</th><th>{localText("Day {horizon}", { horizon: number(horizon) })}</th><th>{localText("Model evidence")}</th></tr></thead><tbody>{sorted.slice(currentPage*10,currentPage*10+10).map(row=><tr key={row.backup.id}><td><Link className={ops.jobName} href={`/vbr/protected-data/restore-points?backupId=${row.backup.id}&name=${encodeURIComponent(row.backup.name||'Backup')}`}>{row.backup.name || row.backup.id}</Link><p className={ops.subtext} title={row.names.join(', ')}>{row.names.slice(0,2).join(', ') || localText("Workload names not reported")}{row.names.length>2 ? localText("+{value} more", { value: number(row.names.length-2) }) : ''}</p>{row.shared&&<small>{localText("Shared files · counted once")}</small>}</td><td>{localText(bytes(row.footprint))}<p className={ops.subtext}>{localText("{count} unique files", { count: number(uniqueFiles(row.backup.files).files.length) })}</p></td><td>{row.points == null ? localText("Unknown") : number(row.points)}</td><td><strong>{localizedPolicy(localText, row.policy, number)}</strong><p className={ops.subtext}>{localizedSchedule(localText, row.policy)}</p><p className={ops.subtext}>{localizedFull(localText, row.policy)}</p>{row.policy&&<Link className={styles.jobLink} href={`/vbr/jobs/${row.policy.id}`}>{row.policy.name || localText("Inspect job")} <ArrowUpRight size={12}/></Link>}</td><td>{row.latest ? date(row.latest) : localText("Not reported")}</td><td>{localText(bytes(row.projection.values.at(-1)?.bytes))}</td><td><span className={row.modeled?styles.modeled:styles.unmodeled}>{row.modeled ? row.projection.excludedFiles ? localText("Partial scenario · incomplete chains") : localText("Included in scenario") : planningMessage(localText, row.projection.reason)}</span><p className={ops.subtext}>{planningMessage(localText, row.backup.issue) || localText("{value} / incremental run", { value: bytes(row.projection.incremental) })}</p></td></tr>)}</tbody></table>}</SortableGrid>{!filtered.length&&<div className={ops.empty}>{rows.length ? localText("No consumers match these filters.") : localText("No backups in the returned inventory are linked to this repository.")}</div>}</div>
        </FilterWorkspace><div className={styles.pagination}><span>{localText("{count} backups · page {value} of {value2}", { count: number(filtered.length), value: number(currentPage+1), value2: number(Math.max(1,Math.ceil(filtered.length/10))) })}</span><Button size="sm" variant="ghost" disabled={!currentPage} onClick={()=>setPage(currentPage-1)}><Trans>{"Previous"}</Trans></Button><Button size="sm" variant="ghost" disabled={(currentPage+1)*10>=filtered.length} onClick={()=>setPage(currentPage+1)}><Trans>{"Next"}</Trans></Button></div>
      </section>
      <details className={`${ops.panel} ${styles.assumptions}`}><summary>{localText("Evidence, assumptions & coverage")} <span>{localText("{count} collection notices", { count: number(data.warnings.length) })}</span></summary><ul>{[...data.warnings,...notes, 'Forecasts cover loaded backup consumers only. New jobs or workloads have no file-size baseline.', ...(parent?['Scale-out group file totals include its loaded extents. Files assigned to the parent are not guessed onto individual extents; no aggregate physical runway is calculated.']:[]), ...(repo?.scaleOutRepositoryDetails?.scaleOutRepositoryId?['Parent-assigned scale-out backups cannot be attributed to this extent. Inspect the scale-out group for its file consumers.']:[])].map((note,index)=><li key={index}>{planningMessage(localText, note)}</li>)}</ul><p>{localText("Retention estimates preserve full-chain dependencies. Archive holds with unknown expiry receive no deletion credit. Measured capacity trends include other data on the same volume; repository totals must not be summed across shared storage.")}</p><p><a href="https://helpcenter.veeam.com/docs/vbr/userguide/forward_incremental_backup.html" target="_blank" rel="noreferrer">{localText("Veeam chain retention")}</a> · <a href="https://helpcenter.veeam.com/docs/vbr/userguide/backup_repository_block_cloning.html" target="_blank" rel="noreferrer">{localText("Fast Clone and shared blocks")}</a></p></details>
      </>}
      {view!=='forecast'&&<details className={`${ops.panel} ${styles.assumptions}`}><summary>{localText("Collection coverage")} <span>{localText("{count} notices", { count: number(data.warnings.length) })}</span></summary><ul>{data.warnings.map((note,i)=><li key={i}>{planningMessage(localText, note)}</li>)}</ul><p>{localText("Analysis covers returned inventory. Up to 60 backups receive file and latest-point enrichment, with a maximum of 3,000 files per backup. Other backups stay visible with unresolved evidence. Scale-out parent files are not assigned to an extent without API evidence.")}</p></details>}
      <footer className={ops.footer}><span>{localText("Updated {time}", { time: date(data.fetchedAt) })}</span><span>{localText("No settings or backup files are changed")}</span></footer>
    </>}
  </div>
}
