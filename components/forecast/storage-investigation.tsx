'use client'
// Open Backup UI v1.0.2

import { usePlanningFormat } from '@/components/forecast/localized-format'

import { Trans, useI18n } from '@/components/providers/i18n-provider'
import { localizedPolicy, planningMessage } from '@/lib/forecast/presentation'

import {useMemo,useState,type ReactNode} from 'react'
import Link from 'next/link'
import {Activity,ArrowUpRight,Clock3,Database,FileWarning,Layers3,Link2,Search,ShieldCheck} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {SortableGrid} from '@/components/ui/sortable-grid'
import {FilterWorkspace} from '@/components/operations/filter-workspace'
import {FilterSelect} from '@/components/operations/filter-facet'
import {hygieneAnalysis,retentionAnalysis,retentionCategories,type HygieneFlag} from '@/lib/forecast/investigation'
import {policyLabel,type ForecastSnapshot} from '@/lib/forecast/model'
import ops from '@/components/operations/operations.module.css'
import styles from './forecast.module.css'

const inspect=(id:string,name?:string|null)=>`/vbr/protected-data/restore-points?backupId=${encodeURIComponent(id)}&name=${encodeURIComponent(name||'Backup')}`
function Metric({label,value,detail,icon}:{label:string;value:ReactNode;detail:ReactNode;icon:ReactNode}) {
  const { t: localText, formatNumber: number } = useI18n()

  return <div className={`${ops.metric} ${styles.metric}`}><div className={ops.metricLabel}>{localText(label)}{icon}</div><strong className={ops.metricValue}>{typeof value === 'number' ? number(value) : value}</strong><p>{detail}</p></div>
}
function Pagination({count,page,setPage,noun}:{count:number;page:number;setPage:(n:number)=>void;noun:string}) {
  const { t: localText, formatNumber: number } = useI18n()

  return <div className={styles.pagination}><span>{localText("{count} {noun} · page {value} of {value2}", { count: number(count), noun: localText(noun), value: number(page+1), value2: number(Math.max(1,Math.ceil(count/10))) })}</span><Button size="sm" variant="ghost" disabled={!page} onClick={()=>setPage(page-1)}><Trans>{"Previous"}</Trans></Button><Button size="sm" variant="ghost" disabled={(page+1)*10>=count} onClick={()=>setPage(page+1)}><Trans>{"Next"}</Trans></Button></div>
}

export function CollectorStatusPanel({data}:{data:ForecastSnapshot}) {
  const { date } = usePlanningFormat()

  const { t: localText, formatNumber: number } = useI18n()

  const collector=data.collector
  const label=collector?{healthy:'Collecting',partial:'Partial collection',running:'Collecting now',waiting:'Waiting for first reading',stale:'Collection overdue',error:'Collection needs attention',disabled:'Collection disabled',unsupported:'Refresh-only history'}[collector.state]:'Status unavailable'
  return <details className={styles.collector}>
    <summary><Activity size={15}/><strong>{localText("Capacity collection")}</strong><span data-state={collector?.state}>{localText(label)}</span><small>{collector?.lastSuccess ? localText("Last success {value}", { value: date(collector.lastSuccess) }) : localText("No successful background reading yet")}</small></summary>
    <div className={styles.collectorBody}><p>{planningMessage(localText, collector?.message) || localText("Refresh to check the app server collector.")}</p><dl><div><dt>{localText("Interval")}</dt><dd>{localText("Every {value} minutes", { value: number(collector?.intervalMinutes || 15) })}</dd></div><div><dt>{localText("Last attempt")}</dt><dd>{date(collector?.lastAttempt||null)}</dd></div><div><dt>{localText("Next attempt")}</dt><dd>{collector?.nextAttempt ? date(collector.nextAttempt) : localText("Not scheduled yet")}</dd></div><div><dt>{localText("Last saved inventory")}</dt><dd>{collector ? localText("{measured} measured / {repositories} repositories", { measured: number(collector.measured), repositories: number(collector.repositories) }) : localText("Not reported")}</dd></div></dl><p>{localText("Runs while the app server is running, even with the browser closed. Requires saved VBR credentials and persistent app storage. History keeps hourly readings for up to 90 days (20,000 per source); trends need three daily readings spanning 48 hours. File and policy analysis refreshes with this view.")}</p><Link href="/administration/data-sources">{localText("Review data sources")} <ArrowUpRight size={12}/></Link></div>
  </details>
}

export function RetentionView({data,repositoryId}:{data:ForecastSnapshot;repositoryId:string}) {
  const { bytes, date } = usePlanningFormat()

  const { t: localText, formatNumber: number } = useI18n()

  const { t: uiText } = useI18n()

  const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[page,setPage]=useState(0)
  const result=useMemo(()=>retentionAnalysis(data,repositoryId),[data,repositoryId])
  const filtered=result.rows.filter(r=>(category==='all'||r.category===category)&&[r.file.name,r.backup.name,r.policy?.name,...r.workloads].join(' ').toLowerCase().includes(query.toLowerCase()))
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/10)-1))
  const outside=result.rows.filter(r=>r.outside===true),outsideBytes=outside.reduce((sum,r)=>sum+(r.bytes||0),0)
  const unresolved=result.rows.filter(r=>r.category==='unknown').length
  return <>
    <div className={ops.metrics}>
      <Metric label={localText("Retained file inventory")} value={localText(bytes(result.knownBytes))} detail={localText("{count} unique files · {unknownSizes} sizes unknown", { count: number(result.rows.length), unknownSizes: number(result.unknownSizes) })} icon={<Database size={17}/>}/>
      <Metric label={localText("Outside short-term window")} value={outside.length?bytes(outside.some(r=>r.bytes!==null)?outsideBytes:null):'—'} detail={localText("{count} files · may still support chains or archival retention", { count: number(outside.length) })} icon={<Layers3 size={17}/>}/>
      <Metric label={localText("Longer immutability period")} value={number(result.policyGaps.length)} detail={localText("Backups with a configured hold longer than day-based retention")} icon={<ShieldCheck size={17}/>}/>
      <Metric label={localText("Unresolved evidence")} value={number(unresolved)} detail={localText("{unmeasuredBackups} backups have incomplete or absent file inventory", { unmeasuredBackups: number(result.unmeasuredBackups) })} icon={<FileWarning size={17}/>}/>
    </div>
    <section className={`${ops.panel} ${styles.breakdown}`}><div className={ops.panelHeading}><div><h2>{localText("Why are these files retained?")}</h2><p>{localText("One primary reason per file. Sizes describe the loaded inventory, not reclaimable disk space.")}</p></div></div>
      <div className={styles.distribution} role="img" aria-label={result.categories.map(c=>localText('{category}: {count} files, {size} known size', { category: localText(c.label), count: number(c.count), size: bytes(c.bytes) })).join('; ')}>{result.categories.filter(c=>c.bytes>0).map(c=><div key={c.key} data-category={c.key} style={{flex:c.bytes}} title={`${localText(c.label)}: ${localText(bytes(c.bytes))}`}/>)}</div>
      <div className={styles.categoryLegend}>{result.categories.map(c=><div key={c.key}><i data-category={c.key}/><span>{localText(c.label)}<small>{localText("{count} files", { count: number(c.count) })}</small></span><strong>{c.count ? bytes(c.known?c.bytes:null) : '—'}</strong></div>)}</div>
      <p className={ops.panelFoot}>{localText("The hardened-repository hold uses the last file in a chain plus today’s configured period. This is an estimate, not an actual unlock date. VBR does not return per-file lock expiry here. Fast Clone and shared blocks mean file bytes can exceed physical volume use.")}</p>
    </section>
    {result.policyGaps.length>0&&<section className={`${ops.panel} ${styles.gaps}`}><div className={ops.panelHeading}><div><h2>{localText("Policy windows to review")}</h2><p>{localText("A longer configured immutability period can keep files beyond short-term retention.")}</p></div></div><ul>{result.policyGaps.map(g=><li key={g.backup.id}><Link href={inspect(g.backup.id,g.backup.name)}>{g.backup.name || g.backup.id} <ArrowUpRight size={12}/></Link><span>{localText("{retentionDays} days retention", { retentionDays: number(g.retentionDays) })} <span aria-hidden="true">→</span> {localText("{immutableDays} days immutability", { immutableDays: number(g.immutableDays) })} <strong>{localText("+{gapDays} days", { gapDays: number(g.gapDays) })}</strong></span></li>)}</ul></section>}
    <section className={ops.panel}><div className={ops.panelHeading}><div><h2>{localText("File retention evidence")}</h2><p>{localText("Open a reason to inspect the evidence. Dates and sizes are sortable.")}</p></div><span className={ops.smallTag}>{localText("{count} FILES", { count: number(filtered.length) })}</span></div>
      <FilterWorkspace label={localText("Retention evidence filters")} activeCount={Number(!!query)+Number(category!=='all')} onClear={()=>{setQuery('');setCategory('all');setPage(0)}} search={<label className={ops.search}><Search size={14}/><input aria-label={uiText("Search retention files")} placeholder={uiText("Search files, backups or workloads")} value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>} filters={<FilterSelect label={localText("Retention reason")} value={category} onValueChange={v=>{setCategory(v);setPage(0)}}><option value="all">{localText("All reasons")}</option>{Object.entries(retentionCategories).map(([key,label])=><option key={key} value={key}>{localText(label)}</option>)}</FilterSelect>}>
        <div className={ops.tableScroll}><SortableGrid rows={filtered} columns={[{id:'file',value:r=>r.file.name},{id:'size',value:r=>r.bytes},{id:'date',value:r=>r.at,kind:'date'},{id:'policy',value:r=>policyLabel(r.policy)},{id:'reason',value:r=>retentionCategories[r.category]}]} onSortChange={()=>setPage(0)}>{sorted=><table className={`${ops.table} ${styles.evidenceTable}`}><thead><tr><th>{localText("File / backup")}</th><th>{localText("File size")}</th><th>{localText("Created")}</th><th>{localText("Retention & immutability")}</th><th>{localText("Primary reason")}</th></tr></thead><tbody>{sorted.slice(currentPage*10,currentPage*10+10).map(r=><tr key={r.id}><td><strong className={styles.fileName} title={r.file.name || r.id}>{r.file.name?.split(/[\\/]/).at(-1) || r.id}</strong><Link className={styles.jobLink} href={inspect(r.backup.id,r.backup.name)}>{r.backup.name || r.backup.id} <ArrowUpRight size={12}/></Link><p className={ops.subtext}>{r.workloads.join(', ') || localText("{value} reported workload members", { value: number(r.file.objectIds?.length || 0) })}{(r.file.objectIds?.length||0)>1 ? localText("· shared file counted once") : ''}</p></td><td>{localText(bytes(r.bytes))}</td><td>{date(r.at)}</td><td><strong>{localizedPolicy(localText, r.policy, number)}</strong><p className={ops.subtext}>{planningMessage(localText, r.holdLabel)}</p>{r.policy&&<Link className={styles.jobLink} href={`/vbr/jobs/${r.policy.id}`}>{localText("Inspect job")} <ArrowUpRight size={12}/></Link>}</td><td><details className={styles.evidence}><summary><i data-category={r.category}/>{localText(retentionCategories[r.category])}</summary><p>{planningMessage(localText, r.reason)}</p><p className={styles.filePath}>{r.file.name || r.id}</p>{r.holdUntil!==null&&<p>{localText("Current-policy chain estimate: {value}. Actual lock expiry is not reported.", { value: date(r.holdUntil) })}</p>}</details></td></tr>)}</tbody></table>}</SortableGrid>{!filtered.length&&<div className={ops.empty}>{result.rows.length ? localText("No files match these filters.") : localText("No usable file inventory was returned for this repository.")}</div>}</div>
      </FilterWorkspace><Pagination count={filtered.length} page={currentPage} setPage={setPage} noun="files"/>
    </section>
    {result.conflicts>0&&<p className={styles.analysisNote}>{localText("{conflicts} conflicting file identities were excluded from totals and classification.", { conflicts: number(result.conflicts) })}</p>}
  </>
}

const flags:Record<HygieneFlag['key'],string>={stale:'Old recovery points',empty:'No restore points returned',unlinked:'No job reference','missing-job':'Job absent from inventory','job-unknown':'Job linkage unresolved',disabled:'Automatic runs disabled',chain:'Full baseline not reported',membership:'Unmapped workload files',evidence:'Evidence gaps'}
export function HygieneView({data,repositoryId}:{data:ForecastSnapshot;repositoryId:string}) {
  const { bytes, date } = usePlanningFormat()

  const { t: localText, formatNumber: number } = useI18n()

  const { t: uiText } = useI18n()

  const [staleDays,setStaleDays]=useState(14),[query,setQuery]=useState(''),[condition,setCondition]=useState('all'),[page,setPage]=useState(0)
  const rows=useMemo(()=>hygieneAnalysis(data,repositoryId,staleDays),[data,repositoryId,staleDays])
  const has=(key:HygieneFlag['key'])=>rows.filter(r=>r.flags.some(f=>f.key===key)).length
  const filtered=rows.filter(r=>(condition==='all'||condition==='attention'&&r.attention||r.flags.some(f=>f.key===condition))&&[r.backup.name,r.policy?.name,...r.workloads].join(' ').toLowerCase().includes(query.toLowerCase()))
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/10)-1))
  return <>
    <div className={ops.metrics}>
      <Metric label={localText("Backups to investigate")} value={number(rows.filter(r=>r.attention).length)} detail={localText("{count} backups in the returned repository inventory", { count: number(rows.length) })} icon={<FileWarning size={17}/>}/>
      <Metric label={localText("No recovery point in {staleDays} days", { staleDays: number(staleDays) })} value={number(has('stale'))} detail={localText("Based on the latest scoped restore-point query")} icon={<Clock3 size={17}/>}/>
      <Metric label={localText("Job links to review")} value={number(has('unlinked')+has('missing-job'))} detail={localText("Unlinked backups or job IDs absent from a complete inventory")} icon={<Link2 size={17}/>}/>
      <Metric label={localText("Recovery age unknown")} value={number(rows.filter(r=>r.latestPoint===null).length)} detail={localText("No verified latest restore-point date was returned")} icon={<Database size={17}/>}/>
    </div>
    <section className={ops.panel}><div className={ops.panelHeading}><div><h2>{localText("Backup hygiene")}</h2><p>{localText("Investigate old recovery points, detached job references and incomplete chain evidence.")}</p></div><label className={styles.ageThreshold}>{localText("Flag recovery age over")}<select aria-label={localText("Recovery age threshold")} value={staleDays} onChange={e=>{setStaleDays(Number(e.target.value));setPage(0)}}>{[7,14,30,60,90].map(n=><option key={n} value={n}>{localText("{n} days", { n: number(n) })}</option>)}</select></label></div>
      {(!data.policies.available||!data.policies.complete)&&<p className={styles.analysisNote}>{localText("Job inventory is partial or unavailable. Missing job matches are shown as unresolved; they are not classified as orphan candidates.")}</p>}
      <FilterWorkspace label={localText("Backup hygiene filters")} activeCount={Number(!!query)+Number(condition!=='all')} onClear={()=>{setQuery('');setCondition('all');setPage(0)}} search={<label className={ops.search}><Search size={14}/><input aria-label={uiText("Search backup hygiene")} placeholder={uiText("Search backups, workloads or jobs")} value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>} filters={<FilterSelect defaultOpen label={localText("Investigation status")} value={condition} onValueChange={v=>{setCondition(v);setPage(0)}}><option value="all">{localText("All backups")}</option><option value="attention">{localText("Needs investigation")}</option>{Object.entries(flags).map(([key,label])=><option key={key} value={key}>{localText(label)}</option>)}</FilterSelect>}>
        <div className={ops.tableScroll}><SortableGrid rows={filtered} columns={[{id:'backup',value:r=>r.backup.name},{id:'size',value:r=>r.bytes},{id:'point',value:r=>r.latestPoint,kind:'date'},{id:'file',value:r=>r.latestFile,kind:'date'},{id:'job',value:r=>r.policy?.name},{id:'flags',value:r=>r.flags.length}]} onSortChange={()=>setPage(0)}>{sorted=><table className={`${ops.table} ${styles.evidenceTable}`}><thead><tr><th>{localText("Backup / workloads")}</th><th>{localText("File subtotal")}</th><th>{localText("Latest restore point")}</th><th>{localText("Latest file")}</th><th>{localText("Linked job")}</th><th>{localText("Investigation evidence")}</th></tr></thead><tbody>{sorted.slice(currentPage*10,currentPage*10+10).map(r=><tr key={r.backup.id}><td><Link className={ops.jobName} href={inspect(r.backup.id,r.backup.name)}>{r.backup.name || r.backup.id}</Link><p className={ops.subtext}>{r.workloads.join(', ') || localText("Workload names not reported")}</p></td><td>{localText(bytes(r.bytes))}<p className={ops.subtext}>{r.shared ? localText('{count} shared files · counted once', { count: number(r.shared) }) : localText("Loaded file subtotal")}</p></td><td>{date(r.latestPoint)}</td><td>{date(r.latestFile)}</td><td>{r.policy?<Link className={styles.jobLink} href={`/vbr/jobs/${r.policy.id}`}>{r.policy.name || r.policy.id}<ArrowUpRight size={12}/></Link>:<span>{r.flags.some(f=>f.key==='unlinked') ? localText("No job reference") : r.flags.some(f=>f.key==='missing-job') ? localText("Not in inventory") : localText("Unresolved")}</span>}</td><td>{r.flags.length?<details className={styles.evidence}><summary data-attention={r.attention}>{planningMessage(localText, r.flags[0].label)}{r.flags.length>1 ? ` +${number(r.flags.length-1)}` : ''}</summary><ul>{r.flags.map((f,i)=><li key={i}><strong>{planningMessage(localText, f.label)}</strong><p>{planningMessage(localText, f.detail)}</p></li>)}</ul></details>:<span className={styles.modeled}>{localText("No flagged conditions in returned evidence")}</span>}</td></tr>)}</tbody></table>}</SortableGrid>{!filtered.length&&<div className={ops.empty}>{rows.length ? localText("No backups match these filters.") : localText("No backups were returned for this repository.")}</div>}</div>
      </FilterWorkspace><Pagination count={filtered.length} page={currentPage} setPage={setPage} noun="backups"/><p className={ops.panelFoot}>{localText("Old files can contain recent recovery points after merges. Recovery age uses the restore-point endpoint, not file age. Archive-only, imported and manually run backups can legitimately appear here. Review candidates in VBR; this view does not delete data.")}</p>
    </section>
  </>
}
