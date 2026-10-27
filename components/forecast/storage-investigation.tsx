'use client'

import {useMemo,useState,type ReactNode} from 'react'
import Link from 'next/link'
import {Activity,ArrowUpRight,Clock3,Database,FileWarning,Layers3,Link2,Search,ShieldCheck} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {SortableGrid} from '@/components/ui/sortable-grid'
import {FilterWorkspace} from '@/components/operations/filter-workspace'
import {FilterSelect} from '@/components/operations/filter-facet'
import {hygieneAnalysis,retentionAnalysis,retentionCategories,type HygieneFlag} from '@/lib/forecast/investigation'
import {policyLabel,type ForecastSnapshot} from '@/lib/forecast/model'
import {formatBytes} from '@/lib/restore-points/model'
import ops from '@/components/operations/operations.module.css'
import styles from './forecast.module.css'

const bytes=(value:number|null)=>value===null?'Not measured':formatBytes(Math.round(value))
const date=(at:number|string|null)=>at===null?'Not reported':new Date(at).toLocaleString()
const inspect=(id:string,name?:string|null)=>`/vbr/protected-data/restore-points?backupId=${encodeURIComponent(id)}&name=${encodeURIComponent(name||'Backup')}`
function Metric({label,value,detail,icon}:{label:string;value:ReactNode;detail:ReactNode;icon:ReactNode}) {
  return <div className={`${ops.metric} ${styles.metric}`}><div className={ops.metricLabel}>{label}{icon}</div><strong className={ops.metricValue}>{value}</strong><p>{detail}</p></div>
}
function Pagination({count,page,setPage,noun}:{count:number;page:number;setPage:(n:number)=>void;noun:string}) {
  return <div className={styles.pagination}><span>{count} {noun} · page {page+1} of {Math.max(1,Math.ceil(count/10))}</span><Button size="sm" variant="ghost" disabled={!page} onClick={()=>setPage(page-1)}>Previous</Button><Button size="sm" variant="ghost" disabled={(page+1)*10>=count} onClick={()=>setPage(page+1)}>Next</Button></div>
}

export function CollectorStatusPanel({data}:{data:ForecastSnapshot}) {
  const collector=data.collector
  const label=collector?{healthy:'Collecting',partial:'Partial collection',running:'Collecting now',waiting:'Waiting for first reading',stale:'Collection overdue',error:'Collection needs attention',disabled:'Collection disabled',unsupported:'Refresh-only history'}[collector.state]:'Status unavailable'
  return <details className={styles.collector}>
    <summary><Activity size={15}/><strong>Capacity collection</strong><span data-state={collector?.state}>{label}</span><small>{collector?.lastSuccess?`Last success ${date(collector.lastSuccess)}`:'No successful background reading yet'}</small></summary>
    <div className={styles.collectorBody}><p>{collector?.message||'Refresh to check the app server collector.'}</p><dl><div><dt>Interval</dt><dd>Every {collector?.intervalMinutes||15} minutes</dd></div><div><dt>Last attempt</dt><dd>{date(collector?.lastAttempt||null)}</dd></div><div><dt>Next attempt</dt><dd>{collector?.nextAttempt?date(collector.nextAttempt):'Not scheduled yet'}</dd></div><div><dt>Last saved inventory</dt><dd>{collector?`${collector.measured} measured / ${collector.repositories} repositories`:'Not reported'}</dd></div></dl><p>Runs while the app server is running, even with the browser closed. Requires saved VBR credentials and persistent app storage. History keeps hourly readings for up to 90 days (20,000 per source); trends need three daily readings spanning 48 hours. File and policy analysis refreshes with this view.</p><Link href="/administration/data-sources">Review data sources <ArrowUpRight size={12}/></Link></div>
  </details>
}

export function RetentionView({data,repositoryId}:{data:ForecastSnapshot;repositoryId:string}) {
  const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[page,setPage]=useState(0)
  const result=useMemo(()=>retentionAnalysis(data,repositoryId),[data,repositoryId])
  const filtered=result.rows.filter(r=>(category==='all'||r.category===category)&&[r.file.name,r.backup.name,r.policy?.name,...r.workloads].join(' ').toLowerCase().includes(query.toLowerCase()))
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/10)-1))
  const outside=result.rows.filter(r=>r.outside===true),outsideBytes=outside.reduce((sum,r)=>sum+(r.bytes||0),0)
  const unresolved=result.rows.filter(r=>r.category==='unknown').length
  return <>
    <div className={ops.metrics}>
      <Metric label="Retained file inventory" value={bytes(result.knownBytes)} detail={`${result.rows.length} unique files · ${result.unknownSizes} sizes unknown`} icon={<Database size={17}/>}/>
      <Metric label="Outside short-term window" value={outside.length?bytes(outside.some(r=>r.bytes!==null)?outsideBytes:null):'—'} detail={`${outside.length} files · may still support chains or archival retention`} icon={<Layers3 size={17}/>}/>
      <Metric label="Longer immutability period" value={result.policyGaps.length} detail="Backups with a configured hold longer than day-based retention" icon={<ShieldCheck size={17}/>}/>
      <Metric label="Unresolved evidence" value={unresolved} detail={`${result.unmeasuredBackups} backups have incomplete or absent file inventory`} icon={<FileWarning size={17}/>}/>
    </div>
    <section className={`${ops.panel} ${styles.breakdown}`}><div className={ops.panelHeading}><div><h2>Why are these files retained?</h2><p>One primary reason per file. Sizes describe the loaded inventory, not reclaimable disk space.</p></div></div>
      <div className={styles.distribution} role="img" aria-label={result.categories.map(c=>`${c.label}: ${c.count} files, ${bytes(c.bytes)} known bytes`).join('; ')}>{result.categories.filter(c=>c.bytes>0).map(c=><div key={c.key} data-category={c.key} style={{flex:c.bytes}} title={`${c.label}: ${bytes(c.bytes)}`}/>)}</div>
      <div className={styles.categoryLegend}>{result.categories.map(c=><div key={c.key}><i data-category={c.key}/><span>{c.label}<small>{c.count} files</small></span><strong>{c.count?bytes(c.known?c.bytes:null):'—'}</strong></div>)}</div>
      <p className={ops.panelFoot}>The hardened-repository hold uses the last file in a chain plus today’s configured period. This is an estimate, not an actual unlock date. VBR does not return per-file lock expiry here. Fast Clone and shared blocks mean file bytes can exceed physical volume use.</p>
    </section>
    {result.policyGaps.length>0&&<section className={`${ops.panel} ${styles.gaps}`}><div className={ops.panelHeading}><div><h2>Policy windows to review</h2><p>A longer configured immutability period can keep files beyond short-term retention.</p></div></div><ul>{result.policyGaps.map(g=><li key={g.backup.id}><Link href={inspect(g.backup.id,g.backup.name)}>{g.backup.name||g.backup.id} <ArrowUpRight size={12}/></Link><span>{g.retentionDays} days retention <span aria-hidden="true">→</span> {g.immutableDays} days immutability <strong>+{g.gapDays} days</strong></span></li>)}</ul></section>}
    <section className={ops.panel}><div className={ops.panelHeading}><div><h2>File retention evidence</h2><p>Open a reason to inspect the evidence. Dates and sizes are sortable.</p></div><span className={ops.smallTag}>{filtered.length} FILES</span></div>
      <FilterWorkspace label="Retention evidence filters" activeCount={Number(!!query)+Number(category!=='all')} onClear={()=>{setQuery('');setCategory('all');setPage(0)}} search={<label className={ops.search}><Search size={14}/><input aria-label="Search retention files" placeholder="Search files, backups or workloads" value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>} filters={<FilterSelect label="Retention reason" value={category} onValueChange={v=>{setCategory(v);setPage(0)}}><option value="all">All reasons</option>{Object.entries(retentionCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</FilterSelect>}>
        <div className={ops.tableScroll}><SortableGrid rows={filtered} columns={[{id:'file',value:r=>r.file.name},{id:'size',value:r=>r.bytes},{id:'date',value:r=>r.at,kind:'date'},{id:'policy',value:r=>policyLabel(r.policy)},{id:'reason',value:r=>retentionCategories[r.category]}]} onSortChange={()=>setPage(0)}>{sorted=><table className={`${ops.table} ${styles.evidenceTable}`}><thead><tr><th>File / backup</th><th>File size</th><th>Created</th><th>Retention & immutability</th><th>Primary reason</th></tr></thead><tbody>{sorted.slice(currentPage*10,currentPage*10+10).map(r=><tr key={r.id}><td><strong className={styles.fileName} title={r.file.name||r.id}>{r.file.name?.split(/[\\/]/).at(-1)||r.id}</strong><Link className={styles.jobLink} href={inspect(r.backup.id,r.backup.name)}>{r.backup.name||r.backup.id} <ArrowUpRight size={12}/></Link><p className={ops.subtext}>{r.workloads.join(', ')||`${r.file.objectIds?.length||0} reported workload members`}{(r.file.objectIds?.length||0)>1?' · shared file counted once':''}</p></td><td>{bytes(r.bytes)}</td><td>{date(r.at)}</td><td><strong>{policyLabel(r.policy)}</strong><p className={ops.subtext}>{r.holdLabel}</p>{r.policy&&<Link className={styles.jobLink} href={`/vbr/jobs/${r.policy.id}`}>Inspect job <ArrowUpRight size={12}/></Link>}</td><td><details className={styles.evidence}><summary><i data-category={r.category}/>{retentionCategories[r.category]}</summary><p>{r.reason}</p><p className={styles.filePath}>{r.file.name||r.id}</p>{r.holdUntil!==null&&<p>Current-policy chain estimate: {date(r.holdUntil)}. Actual lock expiry is not reported.</p>}</details></td></tr>)}</tbody></table>}</SortableGrid>{!filtered.length&&<div className={ops.empty}>{result.rows.length?'No files match these filters.':'No usable file inventory was returned for this repository.'}</div>}</div>
      </FilterWorkspace><Pagination count={filtered.length} page={currentPage} setPage={setPage} noun="files"/>
    </section>
    {result.conflicts>0&&<p className={styles.analysisNote}>{result.conflicts} conflicting file identities were excluded from totals and classification.</p>}
  </>
}

const flags:Record<HygieneFlag['key'],string>={stale:'Old recovery points',empty:'No restore points returned',unlinked:'No job reference','missing-job':'Job absent from inventory','job-unknown':'Job linkage unresolved',disabled:'Automatic runs disabled',chain:'Full baseline not reported',membership:'Unmapped workload files',evidence:'Evidence gaps'}
export function HygieneView({data,repositoryId}:{data:ForecastSnapshot;repositoryId:string}) {
  const [staleDays,setStaleDays]=useState(14),[query,setQuery]=useState(''),[condition,setCondition]=useState('all'),[page,setPage]=useState(0)
  const rows=useMemo(()=>hygieneAnalysis(data,repositoryId,staleDays),[data,repositoryId,staleDays])
  const has=(key:HygieneFlag['key'])=>rows.filter(r=>r.flags.some(f=>f.key===key)).length
  const filtered=rows.filter(r=>(condition==='all'||condition==='attention'&&r.attention||r.flags.some(f=>f.key===condition))&&[r.backup.name,r.policy?.name,...r.workloads].join(' ').toLowerCase().includes(query.toLowerCase()))
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/10)-1))
  return <>
    <div className={ops.metrics}>
      <Metric label="Backups to investigate" value={rows.filter(r=>r.attention).length} detail={`${rows.length} backups in the returned repository inventory`} icon={<FileWarning size={17}/>}/>
      <Metric label={`No recovery point in ${staleDays} days`} value={has('stale')} detail="Based on the latest scoped restore-point query" icon={<Clock3 size={17}/>}/>
      <Metric label="Job links to review" value={has('unlinked')+has('missing-job')} detail="Unlinked backups or job IDs absent from a complete inventory" icon={<Link2 size={17}/>}/>
      <Metric label="Recovery age unknown" value={rows.filter(r=>r.latestPoint===null).length} detail="No verified latest restore-point date was returned" icon={<Database size={17}/>}/>
    </div>
    <section className={ops.panel}><div className={ops.panelHeading}><div><h2>Backup hygiene</h2><p>Investigate old recovery points, detached job references and incomplete chain evidence.</p></div><label className={styles.ageThreshold}>Flag recovery age over<select aria-label="Recovery age threshold" value={staleDays} onChange={e=>{setStaleDays(Number(e.target.value));setPage(0)}}>{[7,14,30,60,90].map(n=><option key={n} value={n}>{n} days</option>)}</select></label></div>
      {(!data.policies.available||!data.policies.complete)&&<p className={styles.analysisNote}>Job inventory is partial or unavailable. Missing job matches are shown as unresolved; they are not classified as orphan candidates.</p>}
      <FilterWorkspace label="Backup hygiene filters" activeCount={Number(!!query)+Number(condition!=='all')} onClear={()=>{setQuery('');setCondition('all');setPage(0)}} search={<label className={ops.search}><Search size={14}/><input aria-label="Search backup hygiene" placeholder="Search backups, workloads or jobs" value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>} filters={<FilterSelect label="Investigation status" value={condition} onValueChange={v=>{setCondition(v);setPage(0)}}><option value="all">All backups</option><option value="attention">Needs investigation</option>{Object.entries(flags).map(([key,label])=><option key={key} value={key}>{label}</option>)}</FilterSelect>}>
        <div className={ops.tableScroll}><SortableGrid rows={filtered} columns={[{id:'backup',value:r=>r.backup.name},{id:'size',value:r=>r.bytes},{id:'point',value:r=>r.latestPoint,kind:'date'},{id:'file',value:r=>r.latestFile,kind:'date'},{id:'job',value:r=>r.policy?.name},{id:'flags',value:r=>r.flags.length}]} onSortChange={()=>setPage(0)}>{sorted=><table className={`${ops.table} ${styles.evidenceTable}`}><thead><tr><th>Backup / workloads</th><th>File subtotal</th><th>Latest restore point</th><th>Latest file</th><th>Linked job</th><th>Investigation evidence</th></tr></thead><tbody>{sorted.slice(currentPage*10,currentPage*10+10).map(r=><tr key={r.backup.id}><td><Link className={ops.jobName} href={inspect(r.backup.id,r.backup.name)}>{r.backup.name||r.backup.id}</Link><p className={ops.subtext}>{r.workloads.join(', ')||'Workload names not reported'}</p></td><td>{bytes(r.bytes)}<p className={ops.subtext}>{r.shared?r.shared+' shared files · counted once':'Loaded file subtotal'}</p></td><td>{date(r.latestPoint)}</td><td>{date(r.latestFile)}</td><td>{r.policy?<Link className={styles.jobLink} href={`/vbr/jobs/${r.policy.id}`}>{r.policy.name||r.policy.id}<ArrowUpRight size={12}/></Link>:<span>{r.flags.some(f=>f.key==='unlinked')?'No job reference':r.flags.some(f=>f.key==='missing-job')?'Not in inventory':'Unresolved'}</span>}</td><td>{r.flags.length?<details className={styles.evidence}><summary data-attention={r.attention}>{r.flags[0].label}{r.flags.length>1?` +${r.flags.length-1}`:''}</summary><ul>{r.flags.map((f,i)=><li key={i}><strong>{f.label}</strong><p>{f.detail}</p></li>)}</ul></details>:<span className={styles.modeled}>No flagged conditions in returned evidence</span>}</td></tr>)}</tbody></table>}</SortableGrid>{!filtered.length&&<div className={ops.empty}>{rows.length?'No backups match these filters.':'No backups were returned for this repository.'}</div>}</div>
      </FilterWorkspace><Pagination count={filtered.length} page={currentPage} setPage={setPage} noun="backups"/><p className={ops.panelFoot}>Old files can contain recent recovery points after merges. Recovery age uses the restore-point endpoint, not file age. Archive-only, imported and manually run backups can legitimately appear here. Review candidates in VBR; this view does not delete data.</p>
    </section>
  </>
}
