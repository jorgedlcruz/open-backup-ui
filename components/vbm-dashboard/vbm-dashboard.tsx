'use client'
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterCondition,FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { useCallback,useMemo,useState } from 'react'

import { date,Empty,Loading,Notice,Pager,Panel,SearchBox,useEvidence } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { veeamApi } from '@/lib/api/veeam-client'
import { formatBytes } from '@/lib/restore-points/model'
import { cn } from '@/lib/utils'
import { cacheObjectUsage,jobMatches,kinds,latestSession,repositoryIssues,status,type JobIssue } from '@/lib/vbm-dashboard/model'
import { Activity,ArrowUpRight,Building2,Database,HardDrive,Mail,RefreshCw,ShieldCheck,Users } from 'lucide-react'
import Link from 'next/link'
import { CapacityPanel,CoverageCards,CoveragePanel,number,orgName,repoName,RepositorySummary,repoUnknown,SystemPanels,value } from './evidence-panels'
import { InvestigationDialog,type Selection } from './investigation-dialog'
import { SessionHistory,Tone } from './session-history'
import styles from './vbm-dashboard.module.css'

const issueOptions:{key:JobIssue;label:string}[]=[{key:'all',label:'All jobs'},{key:'attention',label:'Needs attention'},{key:'failed',label:'Failed'},{key:'warning',label:'Warnings'},{key:'running',label:'Running'},{key:'disabled',label:'Disabled'},{key:'unscheduled',label:'Unscheduled'},{key:'unknown',label:'Unknown state'}]
export function VbmDashboard() {
  const [days,setDays]=useState<7|30>(7),[revision,setRevision]=useState(0)
  const load=useCallback((signal:AbortSignal)=>veeamApi.getVBMDashboard(days,signal),[days])
  const {data,error,loading}=useEvidence(load,revision)
  const [tab,setTab]=useState('jobs'),[issue,setIssue]=useState<JobIssue>('all'),[query,setQuery]=useState(''),[org,setOrg]=useState('all'),[repoId,setRepoId]=useState('all'),[page,setPage]=useState(0)
  const [capacityRequest,setCapacityRequest]=useState({issue:'all',version:0}),[selected,setSelected]=useState<Selection>(null)
  const usage=useMemo(()=>data ? cacheObjectUsage(data):null,[data])
  const countLabel=(available:boolean,complete:boolean,count:number)=>available ? `${number(count)}${complete ? '':'+'}`:'Unknown'
  function selectIssue(next:JobIssue){setIssue(next);setPage(0);setTab('jobs')}
  if(!data) return <div className={ops.console}><header className={ops.header}><div><h1>Microsoft 365 operations</h1></div><Button disabled={loading} variant="outline" onClick={()=>setRevision(n=>n+1)}>Refresh</Button></header>{error && <Notice error>{error}</Notice>}{loading ? <Loading>Reading Microsoft 365 jobs, protection evidence, repository usage, and service health…</Loading>:<Empty>Dashboard data is unavailable. Connect your Microsoft 365 source and refresh.</Empty>}</div>
  const jobs=data.jobs.data,repositories=data.repositories.data
  const visibleJobs=jobs.filter(job=>jobMatches(job,issue) && (org==='all'||job.organizationId===org) && (repoId==='all'||job.repositoryId===repoId) && [job.name,job.id,job.description,orgName(data,job.organizationId),repoName(data,job.repositoryId)].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a,b)=>Number(jobMatches(b,'attention'))-Number(jobMatches(a,'attention')) || (a.name || a.id).localeCompare(b.name || b.id))
  const current=Math.min(page,Math.max(0,Math.ceil(visibleJobs.length/10)-1))
  const protectedCount=kinds.reduce((n,kind)=>n+data.protected[kind].data.length,0),coverageComplete=kinds.every(kind=>data.protected[kind].complete)
  const atRisk=repositories.filter(repo=>repositoryIssues(repo,data).length)
  const inspectRepo=(id:string)=>setSelected({kind:'repository',id})
  return <div className={cn(ops.console,styles.page)}>
    <header className={ops.header}><div><h1>Microsoft 365 operations</h1><p>Job health, backup coverage, and storage headroom in one operational view.</p></div><div className={ops.headerActions}><span className={ops.source}><span className={ops.dot}/>{data.sourceName}</span><label className={styles.range}>Session history<select aria-label="Session history window" value={days} onChange={event=>setDays(Number(event.target.value) as 7|30)}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label><Button variant="outline" size="sm" disabled={loading} onClick={()=>setRevision(n=>n+1)}><RefreshCw size={14} className={loading ? 'animate-spin':''}/>Refresh</Button></div></header>
    {error && <Notice error>{error} Showing the previous snapshot.</Notice>}
    {!!data.warnings.length && <details className={ops.warnings}><summary>{data.warnings.length} data coverage {data.warnings.length===1 ? 'notice':'notices'}</summary><ul>{data.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details>}
    {loading && <p className={styles.refreshing} role="status">Refreshing · the previous {data.days}-day snapshot remains visible.</p>}
    <div className={ops.metrics}>
      <button className={cn(ops.metric,styles.metric)} onClick={()=>selectIssue('attention')}><div className={ops.metricLabel}>Jobs needing attention<Activity size={17}/></div><div className={cn(ops.metricValue,jobs.some(job=>jobMatches(job,'attention')) ? ops.warning:ops.neutral)}>{countLabel(data.jobs.available,data.jobs.complete,jobs.filter(job=>jobMatches(job,'attention')).length)}</div><p>{countLabel(data.jobs.available,data.jobs.complete,jobs.length)} backup jobs · {data.jobs.available ? jobs.filter(job=>status(job.lastStatus)==='Running').length:'Unknown'} reported running</p></button>
      <button className={cn(ops.metric,styles.metric)} onClick={()=>setTab('coverage')}><div className={ops.metricLabel}>Protected object records<ShieldCheck size={17}/></div><div className={ops.metricValue}>{kinds.some(kind=>data.protected[kind].available) ? `${number(protectedCount)}${coverageComplete ? '':'+'}`:'Unknown'}</div><p>Users, groups, sites & teams · retained backup evidence</p></button>
      <button className={cn(ops.metric,styles.metric)} onClick={()=>setTab('coverage')}><div className={ops.metricLabel}>Cache + object usage<Database size={17}/></div><div className={ops.metricValue}>{formatBytes(usage!.total)}</div><p>{usage?.complete ? 'Organization usage total':'Measured subtotal'} · {usage?.rows} repository {usage?.rows===1 ? 'assignment':'assignments'}</p></button>
      <button className={cn(ops.metric,styles.metric)} onClick={()=>{setCapacityRequest(old=>({issue:'attention',version:old.version+1}));setTab('capacity')}}><div className={ops.metricLabel}>Repositories needing attention<HardDrive size={17}/></div><div className={cn(ops.metricValue,atRisk.length ? ops.warning:ops.neutral)}>{countLabel(data.repositories.available,data.repositories.complete,atRisk.length)}</div><p>{countLabel(data.repositories.available,data.repositories.complete,repositories.length)} repositories · {repositories.filter(repoUnknown).length} with unknown capacity</p></button>
    </div>
    <div className={styles.context}><span><Building2 size={14}/>{countLabel(data.organizations.available,data.organizations.complete,data.organizations.data.length)} {data.organizations.data.length===1 ? 'organization':'organizations'}</span><span>Service <Tone value={value(data.health?.status)}/></span><span>License <strong>{number(data.license?.usedNumber)} / {number(data.license?.totalNumber)}</strong> · {value(data.license?.type)}</span><span>Build <strong>{value(data.version?.version)}</strong></span></div>
    <div className={styles.tabs} aria-label="Microsoft 365 dashboard views">{[{key:'jobs',label:'Job health',icon:Activity},{key:'sessions',label:'Session history',icon:Mail},{key:'coverage',label:'Backup coverage',icon:Users},{key:'capacity',label:'Repository capacity',icon:HardDrive}].map(item=><button key={item.key} aria-pressed={tab===item.key} onClick={()=>setTab(item.key)}><item.icon size={14}/>{item.label}</button>)}</div>
    <div hidden={tab!=='jobs'}><div className={styles.overviewGrid}><Panel title="Job health" subtitle="Backup-job status and schedule configuration, with recent session evidence." action={<Link href="/vbm/jobs" className={ops.textLink}>Manage jobs<ArrowUpRight size={13}/></Link>}>
      <FilterWorkspace label="Job health filters" search={<><SearchBox label="Search jobs, organizations, or repositories" value={query} onChange={v=>{setQuery(v);setPage(0)}}/></>} onClear={()=>{setIssue('all');setQuery('');setOrg('all');setRepoId('all');setPage(0)}} filters={<FilterFields><FilterCondition>{issueOptions.map(option=><button key={option.key} aria-pressed={issue===option.key} onClick={()=>selectIssue(option.key)}>{option.label}<span>{jobs.filter(job=>jobMatches(job,option.key)).length}</span></button>)}</FilterCondition>
<FilterSelect label={"Organization"} value={org} onValueChange={event=>{setOrg(event);setPage(0)}}><option value="all">All organizations</option>{data.organizations.data.map(org=><option key={org.id} value={org.id}>{org.name || org.id}</option>)}</FilterSelect>
<FilterSelect label={"Repository"} value={repoId} onValueChange={event=>{setRepoId(event);setPage(0)}}><option value="all">All repositories</option>{repositories.map(repo=><option key={repo.id} value={repo.id}>{repo.name || repo.id}</option>)}</FilterSelect></FilterFields>}>
{!data.jobs.available ? <Empty>Job inventory is unavailable.</Empty>:visibleJobs.length ? <div className={ops.tableScroll} tabIndex={0} role="region" aria-label="Microsoft 365 jobs table"><SortableGrid rows={visibleJobs} columns={[{id:'name',value:r=>r.name || r.id},{id:'status',value:r=>r.lastStatus},{id:'lastRun',value:r=>r.lastRun,kind:'date'},{id:'nextRun',kind:'date',value:r=>r.nextRun},{id:'target',value:r=>repoName(data,r.repositoryId)}]} onSortChange={()=>setPage(0)}>{(visibleJobs)=>(<table className={cn(ops.table,styles.jobTable)}><thead><tr><th>Job / organization</th><th>Last status</th><th>Last run</th><th>Next run</th><th>Target / latest evidence</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visibleJobs.slice(current*10,current*10+10).map(job=>{const last=latestSession(job,data.sessions.data);return <tr key={job.id}><td><button className={ops.jobName} onClick={()=>setSelected({kind:'job',id:job.id})}>{job.name || job.id}</button><span className={styles.sub}>{orgName(data,job.organizationId)}</span><span className={styles.sub}>{job.isEnabled===false ? 'Disabled':job.isEnabled===true ? 'Enabled':'Enablement not reported'} · {value(job.backupType)}</span></td><td><Tone value={status(job.lastStatus)}/>{job.schedulePolicy?.scheduleEnabled===false && <span className={styles.sub}>Schedule disabled</span>}</td><td>{date(job.lastRun)}</td><td>{date(job.nextRun)}</td><td><span>{repoName(data,job.repositoryId)}</span><p className={styles.excerpt}>{last?.details || (last ? `Latest session: ${status(last.status)}`:'No session in the loaded window')}</p></td><td><Button size="sm" variant="ghost" aria-label={`Inspect job ${job.name || job.id}`} onClick={()=>setSelected({kind:'job',id:job.id})}>Inspect<ArrowUpRight size={13}/></Button></td></tr>})}</tbody></table>)}</SortableGrid></div>:<Empty>No jobs match these filters.</Empty>}
<Pager page={current} count={visibleJobs.length} onChange={setPage} label="Microsoft 365 jobs"/>
<p className={ops.panelFoot}>Job status is retained from the API; recent sessions are separate evidence. Failed/warning results, disabled jobs, and disabled schedules are independent review signals.</p>
</FilterWorkspace></Panel><div className={styles.side}><Panel title="Repository headroom" subtitle="Local disk and object-storage quota are measured separately." action={<button className={ops.textLink} onClick={()=>setTab('capacity')}>View all<ArrowUpRight size={13}/></button>}><div className={styles.repoList}>{repositories.slice(0,4).map(repo=><RepositorySummary key={repo.id} repo={repo} data={data} onInspect={inspectRepo}/>)}{!repositories.length && <Empty>No repository evidence returned.</Empty>}</div></Panel><Panel title="Backup coverage" subtitle="Protected objects returned by the backup API." action={<button className={ops.textLink} onClick={()=>setTab('coverage')}>Investigate<ArrowUpRight size={13}/></button>}><CoverageCards data={data}/><p className={ops.panelFoot}>These categories may overlap. Counts do not measure coverage of all production tenant objects.</p></Panel></div></div></div>
    <div hidden={tab!=='sessions'}><SessionHistory data={data} onInspect={session=>setSelected({kind:'session',id:session.id})}/></div>
    <div hidden={tab!=='capacity'}><CapacityPanel key={capacityRequest.version} data={data} onInspect={inspectRepo} initialIssue={capacityRequest.issue}/></div>
    <div hidden={tab!=='coverage'}><CoveragePanel data={data} onInspect={inspectRepo}/></div>
    <SystemPanels data={data}/>
    <footer className={ops.footer}><span><span className={ops.dot}/>Snapshot {date(data.fetchedAt)} · {data.sourceName}</span><span>Refresh on demand · {data.days}-day session window · API v8</span></footer>
    <InvestigationDialog data={data} selected={selected} onSelect={setSelected}/>
  </div>
}
