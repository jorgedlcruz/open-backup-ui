'use client'

import {useEffect,useMemo,useState} from 'react'
import Link from 'next/link'
import {ArrowDownToLine,ArrowUpRight,Clock3,Database,HardDrive,RefreshCw,Search,TrendingUp,TriangleAlert} from 'lucide-react'
import {LensSwitcher} from '@/components/lens/lens-switcher'
import {Button} from '@/components/ui/button'
import {SortableGrid} from '@/components/ui/sortable-grid'
import {FilterWorkspace} from '@/components/operations/filter-workspace'
import {FilterSelect} from '@/components/operations/filter-facet'
import {capacityTrend,DAY,GB,dayStart,fullLabel,policyLabel,projectBackup,repositoryBackups,scheduleLabel,uniqueFiles,type ForecastSnapshot} from '@/lib/forecast/model'
import {formatBytes} from '@/lib/restore-points/model'
import ops from '@/components/operations/operations.module.css'
import styles from './forecast.module.css'
import {CollectorStatusPanel,HygieneView,RetentionView} from './storage-investigation'

const bytes=(value:number|null|undefined)=>value==null?'Not measured':formatBytes(Math.max(0,Math.round(value)))
const shortDate=(at:number)=>new Date(at).toLocaleDateString([],{month:'short',day:'numeric'})
type ChartPoint={at:number;bytes:number;peak?:number;fulls?:number}

function ForecastChart({history,future,now,capacity,mode}:{history:ChartPoint[];future:ChartPoint[];now:number;capacity?:number;mode:'files'|'capacity'}) {
  const [hover,setHover]=useState<number|null>(null)
  const all=[...history,...future], start=Math.min(now-7*DAY,...history.map(p=>p.at)),end=Math.max(now+30*DAY,...future.map(p=>p.at))
  const max=Math.max(GB,...all.map(p=>Math.max(p.bytes,p.peak||0)),capacity||0)*1.12
  const x=(at:number)=>76+(at-start)/(end-start)*884,y=(value:number)=>254-value/max*210
  const path=(points:ChartPoint[],peak=false)=>points.map((p,i)=>`${i?'L':'M'}${x(p.at).toFixed(2)},${y(peak?p.peak??p.bytes:p.bytes).toFixed(2)}`).join(' ')
  const active=hover===null?null:all[hover]
  return <div className={styles.chart}>
    <svg viewBox="0 0 1000 310" role="img" aria-label={mode==='files'?'Retained file inventory and dotted retention scenario. This is not historical volume utilization.':'Recorded repository usage and dotted capacity trend'} onPointerLeave={()=>setHover(null)}>
      <rect x={x(now)} y="28" width={960-x(now)} height="226" fill="var(--forecast-color)" opacity=".045"/>
      {[0,.25,.5,.75,1].map(t=><g key={t}><line x1="76" x2="960" y1={y(max*t)} y2={y(max*t)} stroke="var(--border)" strokeDasharray="3 6"/><text x="64" y={y(max*t)+4} textAnchor="end">{max*t>=1024*GB?`${(max*t/(1024*GB)).toFixed(1)} TiB`:`${(max*t/GB).toFixed(0)} GiB`}</text></g>)}
      {capacity!=null&&<g><line x1="76" x2="960" y1={y(capacity)} y2={y(capacity)} stroke="var(--ops-chart-danger)" strokeDasharray="4 5"/><text x="960" y={y(capacity)-7} textAnchor="end">Reported capacity</text><line x1="76" x2="960" y1={y(capacity*.8)} y2={y(capacity*.8)} stroke="var(--ops-chart-warning)" strokeDasharray="2 6"/></g>}
      {history.length>1&&<path d={path(history)} fill="none" stroke="var(--history-color)" strokeWidth="2.5"/>}
      {future.length>1&&<><path d={path(future)} fill="none" stroke="var(--forecast-color)" strokeWidth="3" strokeDasharray="3 6" strokeLinecap="round"/>{mode==='files'&&<path d={path(future,true)} fill="none" stroke="var(--forecast-color)" opacity=".35" strokeWidth="1.5" strokeDasharray="2 4"/>}</>}
      <line x1={x(now)} x2={x(now)} y1="28" y2="260" stroke="var(--muted-foreground)" strokeWidth="1.5"/>
      <text x={x(now)-8} y="17" textAnchor="end">{mode==='files'?'Retained file dates':'Recorded usage'}</text><text x={x(now)+8} y="17">Today → {mode==='files'?'Policy scenario':'Trend projection'}</text>
      {[start,now,end].map((at,i)=><text key={i} x={x(at)} y="282" textAnchor={i===0?'start':i===2?'end':'middle'}>{shortDate(at)}</text>)}
      {all.map((p,i)=><circle key={i} cx={x(p.at)} cy={y(p.bytes)} r={all.length===1?5:4} fill={i<history.length?'var(--history-color)':'var(--forecast-color)'} opacity={hover===i||all.length===1?1:.15} tabIndex={0} aria-label={`${shortDate(p.at)}: ${bytes(p.bytes)}${p.fulls?`, ${p.fulls} full files planned`:''}`} onPointerEnter={()=>setHover(i)} onFocus={()=>setHover(i)} onBlur={()=>setHover(null)}><title>{shortDate(p.at)} · {bytes(p.bytes)}{p.peak?` · before expiry ${bytes(p.peak)}`:''}</title></circle>)}
    </svg>
    <div className={styles.legend}><span><i/> {mode==='files'?'Currently retained file inventory':'Recorded volume usage'}</span><span className={styles.prediction}><i/> {mode==='files'?'Projected retained footprint':'Observed growth extrapolation'}</span>{mode==='files'&&<span>Faint dotted line: peak before expiry</span>}<strong aria-live="polite">{active?`${shortDate(active.at)} · ${bytes(active.bytes)}${active.fulls?` · ${active.fulls} full files`:''}`:'Hover or focus a point for details'}</strong></div>
  </div>
}

export function ForecastConsole() {
  const [view,setView]=useState<'forecast'|'retention'|'hygiene'>('forecast')
  const [data,setData]=useState<ForecastSnapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0)
  const [selected,setSelected]=useState(''),[horizon,setHorizon]=useState(30),[change,setChange]=useState(0),[retention,setRetention]=useState(''),[mode,setMode]=useState<'files'|'capacity'>('files')
  const [query,setQuery]=useState(''),[condition,setCondition]=useState('all'),[page,setPage]=useState(0)
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('')
    fetch('/api/vbr/forecast',{signal:controller.signal,cache:'no-store'}).then(async response=>{
      const body=await response.json();if(!response.ok)throw new Error(body.error||'Forecast evidence is unavailable.');return body as ForecastSnapshot
    }).then(value=>{if(!controller.signal.aborted)setData(value)}).catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Forecast evidence is unavailable.')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[refresh])
  useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)setRefresh(n=>n+1)},300000);return()=>clearInterval(timer)},[])
  const repositories=useMemo(()=>{
    const map=new Map(data?.repositories.data.map(r=>[r.id,{id:r.id,name:r.name}])||[])
    data?.scaleOut.data.forEach(r=>map.set(r.id,{id:r.id,name:`${r.name} · scale-out group`}))
    return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name))
  },[data])
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
    <header className={ops.header}><div><h1>Capacity Forecast</h1><p>See what is consuming storage. Plan for the next full, the next cycle, and the next quarter.</p></div><div className={ops.headerActions}><div className={ops.headerControls}><LensSwitcher view="forecast" snapshot={null} loading={false} stale={false}/><Button size="sm" variant="outline" disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={14} className={loading?'animate-spin':''}/>{loading?'Reading evidence…':'Refresh'}</Button></div><span className={ops.source}>{data?.sourceName||'Selected VBR source'} · Read-only planning</span></div></header>
    {error&&<div className={ops.notice} role="alert"><TriangleAlert size={18}/><div><strong>{data?'Previous snapshot · refresh failed':'Forecast could not load'}</strong><p>{error}</p></div><Link href="/connect">Connect</Link></div>}
    {!data?<div className={ops.empty}>{loading?'Collecting repositories, workload files and job policies…':'No forecast evidence available.'}</div>:<>
      <CollectorStatusPanel data={data}/>
      <div className={styles.views} role="group" aria-label="Storage investigation views"><button aria-pressed={view==='forecast'} onClick={()=>setView('forecast')}>Forecast</button><button aria-pressed={view==='retention'} onClick={()=>setView('retention')}>Retention & immutability</button><button aria-pressed={view==='hygiene'} onClick={()=>setView('hygiene')}>Backup hygiene</button></div>
      <div className={styles.scope}><label>Repository<select aria-label="Repository" value={id} onChange={e=>{setSelected(e.target.value);setPage(0);setRetention('')}}>{repositories.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>{view==='forecast'&&<label>Look ahead<select value={horizon} onChange={e=>setHorizon(Number(e.target.value))}>{[30,60,90].map(n=><option key={n} value={n}>{n} days</option>)}</select></label>}{id&&<Link href={`/vbr/infrastructure/repositories/${id}`}>Inspect repository <ArrowUpRight size={14}/></Link>}</div>
      {view==='retention'?<RetentionView key={id} data={data} repositoryId={id}/>:view==='hygiene'?<HygieneView key={id} data={data} repositoryId={id}/>:<>
      <div className={ops.metrics}>
        <div className={`${ops.metric} ${styles.metric}`}><div className={ops.metricLabel}>Reported volume usage<HardDrive size={17}/></div><strong className={ops.metricValue}>{validCapacity?`${((repo!.capacityGB!-repo!.freeGB!)/repo!.capacityGB!*100).toFixed(1)}%`:'Not measured'}</strong><p>{validCapacity?`${bytes(repo!.freeGB!*GB)} free of ${bytes(repo!.capacityGB!*GB)}`:'Scale-out / object storage may not report a finite capacity'}</p></div>
        <div className={`${ops.metric} ${styles.metric}`}><div className={ops.metricLabel}>Retained file footprint<Database size={17}/></div><strong className={ops.metricValue}>{bytes(footprint)}</strong><p>{allFiles.files.length} unique files · {rows.length} backups · known subtotal</p></div>
        <div className={`${ops.metric} ${styles.metric}`}><div className={ops.metricLabel}>Peak file scenario<TrendingUp size={17}/></div><strong className={ops.metricValue}>{bytes(maximum)}</strong><p>{modeled.length} of {rows.length} backups modeled · before expiry · {horizon} days</p></div>
        <div className={`${ops.metric} ${styles.metric}`}><div className={ops.metricLabel}>Time to 80% used<Clock3 size={17}/></div><strong className={ops.metricValue}>{trend.slope===null?'Learning':trend.daysTo80===null?'No crossing':trend.daysTo80===0?'Already ≥80%':`${trend.daysTo80} days`}</strong><p>{trend.slope===null?'Needs three daily measurements spanning at least 48 hours':`${trend.slope.toFixed(1)} GB/day observed trend · unchanged conditions`}</p></div>
      </div>
      <section className={ops.panel}><div className={ops.panelHeading}><div><h2>{mode==='files'?'Backup footprint outlook':'Repository capacity outlook'}</h2><p>{mode==='files'?'Modeled backups only · file sizes after compression and deduplication':'Real capacity samples recorded by this app · no invented historical usage'}</p></div><Button variant="outline" size="sm" disabled={!(mode==='files'?future:trend.values).length} onClick={exportProjection}><ArrowDownToLine size={14}/>Export projection</Button></div>
        <div className={styles.chartControls}><div role="group" aria-label="Forecast basis"><button aria-pressed={mode==='files'} onClick={()=>setMode('files')}>Backup files & retention</button><button aria-pressed={mode==='capacity'} onClick={()=>setMode('capacity')}>Recorded volume usage</button></div><span>{modeled.length===rows.length&&modeled.every(r=>!r.projection.excludedFiles)&&data.backups.complete&&rows.length?'File model coverage complete':'Partial model coverage'} · {data.historyAvailable?'History recording active':'History unavailable'}</span></div>
        {mode==='files'&&!future.length?<div className={ops.empty}><TrendingUp size={28}/><strong>More evidence is needed for this repository</strong><p>The consumers below explain which file history or policy settings are missing. Other repositories may have enough evidence.</p></div>:<ForecastChart mode={mode} now={now} history={mode==='files'?history:trend.history.map(p=>({at:Date.parse(p.at),bytes:(p.capacityGB-p.freeGB)*GB}))} future={mode==='files'?future:trend.values} capacity={mode==='capacity'&&validCapacity?repo!.capacityGB!*GB:undefined}/>}
        <p className={ops.panelFoot}>{mode==='files'?'The solid segment groups files that still exist today by creation date; deleted files are absent, so it is not past disk usage. The colored dotted segment simulates current retention and scheduled fulls. File sizes may share Fast Clone blocks and cannot be directly compared with free volume space.':`The app server collects capacity every 15 minutes using saved credentials and stores hourly readings. ${trend.slope===null?'A projection appears after three daily samples spanning 48 hours.':'The dotted line extends the median observed daily change; it is a trend, not a guarantee.'} See Capacity collection above for the latest background status.`}</p>
      </section>
      <section className={`${ops.panel} ${styles.scenario}`}><div className={ops.panelHeading}><div><h2>What if?</h2><p>Adjust the file scenario without changing VBR configuration.</p></div><Button variant="ghost" size="sm" onClick={()=>{setChange(0);setRetention('')}}>Reset scenario</Button></div><div className={styles.scenarioFields}><label>Incremental data change <strong>{change>0?'+':''}{change}%</strong><input type="range" min="-50" max="200" step="10" value={change} onChange={e=>setChange(Number(e.target.value))}/><small>Relative to the median of up to 14 retained increments per workload chain. Full sizes stay constant.</small></label><label>Retention quantity override<input type="number" aria-label="Retention quantity override" min="1" max="9999" placeholder="Use each job’s setting" value={retention} onChange={e=>{const v=e.target.value;if(!v||Number.isInteger(Number(v))&&Number(v)>=1&&Number(v)<=9999)setRetention(v)}}/><small>Each job keeps its own unit: days or restore points. GFS and immutability holds remain in place.</small></label></div></section>
      <section className={ops.panel}><div className={ops.panelHeading}><div><h2>Consumers & retention policies</h2><p>Workloads grouped by backup. Shared files count once; per-workload allocation is not invented.</p></div><span className={ops.smallTag}>{filtered.length} BACKUPS</span></div>
        <FilterWorkspace label="Forecast consumer filters" activeCount={Number(!!query)+Number(condition!=='all')} onClear={reset} search={<label className={ops.search}><Search size={14}/><input aria-label="Search forecast consumers" placeholder="Search workloads, backups or jobs" value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>} filters={<FilterSelect label="Model status" value={condition} onValueChange={v=>{setCondition(v);setPage(0)}}><option value="all">All consumers</option><option value="modeled">Included in scenario</option><option value="unmodeled">Needs more evidence</option><option value="shared">Shared workload files</option></FilterSelect>}>
          <div className={ops.tableScroll}><SortableGrid rows={filtered} columns={[{id:'name',value:r=>r.backup.name},{id:'size',value:r=>r.footprint},{id:'points',value:r=>r.points},{id:'policy',value:r=>policyLabel(r.policy)},{id:'latest',value:r=>r.latest,kind:'date'},{id:'forecast',value:r=>r.projection.values.at(-1)?.bytes},{id:'evidence',value:r=>r.projection.reason||'Modeled'}]} onSortChange={()=>setPage(0)}>{sorted=><table className={ops.table}><thead><tr><th>Backup / workloads</th><th>File footprint</th><th>Restore points</th><th>Retention & schedule</th><th>Latest file</th><th>Day {horizon}</th><th>Model evidence</th></tr></thead><tbody>{sorted.slice(currentPage*10,currentPage*10+10).map(row=><tr key={row.backup.id}><td><Link className={ops.jobName} href={`/vbr/protected-data/restore-points?backupId=${row.backup.id}&name=${encodeURIComponent(row.backup.name||'Backup')}`}>{row.backup.name||row.backup.id}</Link><p className={ops.subtext} title={row.names.join(', ')}>{row.names.slice(0,2).join(', ')||'Workload names not reported'}{row.names.length>2?` +${row.names.length-2} more`:''}</p>{row.shared&&<small>Shared files · counted once</small>}</td><td>{bytes(row.footprint)}<p className={ops.subtext}>{uniqueFiles(row.backup.files).files.length} unique files</p></td><td>{row.points??'Unknown'}</td><td><strong>{policyLabel(row.policy)}</strong><p className={ops.subtext}>{scheduleLabel(row.policy)}</p><p className={ops.subtext}>{fullLabel(row.policy)}</p>{row.policy&&<Link className={styles.jobLink} href={`/vbr/jobs/${row.policy.id}`}>{row.policy.name||'Inspect job'} <ArrowUpRight size={12}/></Link>}</td><td>{row.latest?new Date(row.latest).toLocaleString():'Not reported'}</td><td>{bytes(row.projection.values.at(-1)?.bytes)}</td><td><span className={row.modeled?styles.modeled:styles.unmodeled}>{row.modeled?row.projection.excludedFiles?'Partial scenario · incomplete chains':'Included in scenario':row.projection.reason}</span><p className={ops.subtext}>{row.backup.issue||`${bytes(row.projection.incremental)} / incremental run`}</p></td></tr>)}</tbody></table>}</SortableGrid>{!filtered.length&&<div className={ops.empty}>{rows.length?'No consumers match these filters.':'No backups in the returned inventory are linked to this repository.'}</div>}</div>
        </FilterWorkspace><div className={styles.pagination}><span>{filtered.length} backups · page {currentPage+1} of {Math.max(1,Math.ceil(filtered.length/10))}</span><Button size="sm" variant="ghost" disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>Previous</Button><Button size="sm" variant="ghost" disabled={(currentPage+1)*10>=filtered.length} onClick={()=>setPage(currentPage+1)}>Next</Button></div>
      </section>
      <details className={`${ops.panel} ${styles.assumptions}`}><summary>Evidence, assumptions & coverage <span>{data.warnings.length} collection notices</span></summary><ul>{[...data.warnings,...notes, 'Forecasts cover loaded backup consumers only. New jobs or workloads have no file-size baseline.', ...(parent?['Scale-out group file totals include its loaded extents. Files assigned to the parent are not guessed onto individual extents; no aggregate physical runway is calculated.']:[]), ...(repo?.scaleOutRepositoryDetails?.scaleOutRepositoryId?['Parent-assigned scale-out backups cannot be attributed to this extent. Inspect the scale-out group for its file consumers.']:[])].map((note,index)=><li key={index}>{note}</li>)}</ul><p>Retention estimates preserve full-chain dependencies. Archive holds with unknown expiry receive no deletion credit. Measured capacity trends include other data on the same volume; repository totals must not be summed across shared storage.</p><p><a href="https://helpcenter.veeam.com/docs/vbr/userguide/forward_incremental_backup.html" target="_blank" rel="noreferrer">Veeam chain retention</a> · <a href="https://helpcenter.veeam.com/docs/vbr/userguide/backup_repository_block_cloning.html" target="_blank" rel="noreferrer">Fast Clone and shared blocks</a></p></details>
      </>}
      {view!=='forecast'&&<details className={`${ops.panel} ${styles.assumptions}`}><summary>Collection coverage <span>{data.warnings.length} notices</span></summary><ul>{data.warnings.map((note,i)=><li key={i}>{note}</li>)}</ul><p>Analysis covers returned inventory. Up to 60 backups receive file and latest-point enrichment, with a maximum of 3,000 files per backup. Other backups stay visible with unresolved evidence. Scale-out parent files are not assigned to an extent without API evidence.</p></details>}
      <footer className={ops.footer}><span>Evidence collected {new Date(data.fetchedAt).toLocaleString()} · Refreshes every five minutes while visible</span><span>No settings or backup files are changed</span></footer>
    </>}
  </div>
}
