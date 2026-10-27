"use client"

import Link from 'next/link'
import { ArrowUpRight, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, Pager, Panel, SearchBox, date } from '@/components/investigation/shared'
import { backupKey, credentialRef, sourcePath, type Row } from '@/lib/unstructured-data/model'
import { validId } from '@/lib/investigation/model'
import { formatBytes } from '@/lib/restore-points/model'
import { Badge, Cache, CredentialCell, Protection, copyId } from './shared'
import { useState } from 'react'
import ops from '@/components/operations/operations.module.css'
import styles from './unstructured-operations.module.css'

const report=(value?:boolean|null)=>value===true ? 'Enabled':value===false ? 'Disabled':'Not reported'
export function SourceDetail({row}:{row:Row}) {
  const s=row.server,ref=credentialRef(s),proxies=s.processing?.backupProxies
  const [query,setQuery]=useState(''),[jobPage,setJobPage]=useState(0),[backupPage,setBackupPage]=useState(0)
  const jobs=row.jobs.filter(j=>[j.job.name,j.job.id,...j.scopes.flatMap(o=>[o.path,o.container])].join(' ').toLowerCase().includes(query.toLowerCase()))
  const current=Math.min(jobPage,Math.max(0,Math.ceil(jobs.length/5)-1)),currentBackup=Math.min(backupPage,Math.max(0,Math.ceil(row.backups.length/5)-1))
  return <>
    <div className={styles.summary}><Protection row={row}/><p>{row.note}</p><Button variant="outline" size="sm" onClick={()=>copyId(s.id)}><Copy size={13}/>Copy ID</Button></div>
    <div className={styles.detailGrid}><div>
      <Panel title="Source configuration" subtitle="Connection and processing settings reported by VBR."><dl className={styles.details}>
        <div><dt>Type</dt><dd>{s.type || 'Not reported'}</dd></div><div><dt>Category</dt><dd>{row.category}</dd></div>
        <div className={styles.full}><dt>Path / endpoint</dt><dd>{sourcePath(s)}</dd></div>
        <div><dt>Friendly name</dt><dd>{s.friendlyName || s.account?.friendlyName || s.name || 'Not reported'}</dd></div>
        <div><dt>Region</dt><dd>{s.regionDisplayName || s.account?.regionDisplayName || s.account?.regionId || s.regionType || s.account?.regionType || 'Not reported'}</dd></div>
        <div className={styles.full}><dt>Description</dt><dd>{s.description || 'Not reported'}</dd></div>
        <div><dt>Source ID</dt><dd>{s.id}</dd></div><div><dt>Managed host</dt><dd>{validId(s.hostId) ? <Link className={ops.textLink} href={`/vbr/infrastructure/managed-servers/${s.hostId}`}>{s.hostId}<ArrowUpRight size={12}/></Link>:s.hostId || 'Not reported'}</dd></div>
        {s.storageHostId && <div><dt>Storage host ID</dt><dd>{s.storageHostId}</dd></div>}{s.hostType && <div><dt>Host type</dt><dd>{s.hostType}</dd></div>}
        <div><dt>I/O control</dt><dd>{s.processing?.backupIOControlLevel || 'Not reported'}</dd></div>
        <div><dt>Native change tracking</dt><dd>{report(s.processing?.nativeChangeTrackingEnabled)}</dd></div>
        <div><dt>Processing mode</dt><dd>{s.advancedSettings?.processingMode || 'Not reported'}</dd></div>
        <div><dt>Direct backup fallback</dt><dd>{report(s.advancedSettings?.directBackupFailoverEnabled)}</dd></div>
        {s.advancedSettings?.storageSnapshotPath && <div className={styles.full}><dt>Storage snapshot path</dt><dd>{s.advancedSettings.storageSnapshotPath}</dd></div>}
        <div className={styles.full}><dt>Backup proxy selection</dt><dd>{proxies?.autoSelectEnabled===true ? 'Automatic':proxies?.autoSelectEnabled===false ? 'Manual':'Not reported'}
          {proxies?.autoSelectEnabled===false && <div className={styles.badges}>{proxies.proxyIds?.length ? proxies.proxyIds.map(id=>validId(id) ? <Link key={id} className={ops.textLink} href={`/vbr/infrastructure/proxies/${id}`}>{id}<ArrowUpRight size={12}/></Link>:<span key={id}>{id}</span>):'No selected proxy IDs returned'}</div>}</dd></div>
      </dl><p className={ops.panelFoot}>An inventory registration does not prove source reachability. Proxy selection and I/O controls describe configuration, not current throughput.</p></Panel>
      <Panel title="Access metadata" subtitle="Existing credential details and the configured reference."><dl className={styles.details}>
        <div className={styles.full}><dt>Credential record</dt><dd><CredentialCell row={row}/></dd></div>
        <div><dt>Credential ID</dt><dd>{ref.id || 'Not reported'}</dd></div><div><dt>Access credentials required</dt><dd>{s.accessCredentialsRequired===true ? 'Yes':s.accessCredentialsRequired===false ? 'No':'Not reported'}</dd></div>
      </dl></Panel>
      <Panel title="Cache repository" subtitle="Cache configuration and repository state are independent evidence."><div className={styles.card}><Cache row={row}/>{(row.repository?.description || row.repositoryState?.description) && <p>{row.repository?.description || row.repositoryState?.description}</p>}</div>
        <dl className={styles.details}><div><dt>Repository ID</dt><dd>{s.processing?.cacheRepositoryId || 'Not reported'}</dd></div><div><dt>Component update required</dt><dd>{row.repositoryState?.isOutOfDate===true ? 'Yes':row.repositoryState?.isOutOfDate===false ? 'No':'Not reported'}</dd></div><div><dt>Capacity</dt><dd>{row.repositoryState?.capacityGB!=null && row.repositoryState.capacityGB>=0 ? `${row.repositoryState.capacityGB.toLocaleString()} GB`:'Not reported'}</dd></div><div><dt>Free space</dt><dd>{row.repositoryState?.freeGB!=null && row.repositoryState.freeGB>=0 ? `${row.repositoryState.freeGB.toLocaleString()} GB`:'Not reported'}</dd></div></dl><p className={ops.panelFoot}>Capacity pressure begins at 85% used. Cache repository health is not a source availability check.</p>
      </Panel>
    </div><div>
      <Panel title="Linked backup jobs" subtitle="Explicit source references, selected scope, and latest job results." action={<span className={ops.smallTag}>{row.jobs.length} JOBS</span>}>
        <div className={styles.filters}><SearchBox label="Search linked jobs, paths, or containers" value={query} onChange={v=>{setQuery(v);setJobPage(0)}}/></div>
        {jobs.length ? jobs.slice(current*5,(current+1)*5).map(({job,state,scopes})=><article className={styles.card} key={job.id}><header><Link className={ops.jobName} href={`/vbr/jobs/${job.id}${validId(state?.sessionId) ? `?session=${state.sessionId}`:''}`}>{job.name || job.id}</Link><Badge value={state?.lastResult || 'Result not reported'} tone={state?.lastResult==='Failed' ? 'danger':state?.lastResult==='Warning' ? 'warning':state?.lastResult==='Success' ? 'success':'neutral'}/></header><p>{job.type} · {state?.status || (job.isDisabled===true ? 'Disabled':'State not reported')}</p><small>Last run {date(state?.lastRun)} · Next run {date(state?.nextRun)}</small>
          {scopes.map((scope,i)=><div className={styles.scope} key={i}><strong>{scope.container || scope.path || 'Scope path not reported'}</strong><div className={styles.muted}>{scope.type || 'Scope type not reported'}</div>
            {!!scope.path && !!scope.container && <div>{scope.path}</div>}
            {(['inclusionMask','exclusionMask','inclusionTagMask','exclusionTagMask','exclusionPathMask'] as const).filter(key=>scope[key]?.length).map(key=><details key={key}><summary>{{inclusionMask:'Included paths',exclusionMask:'Excluded paths',inclusionTagMask:'Included tags',exclusionTagMask:'Excluded tags',exclusionPathMask:'Excluded paths'}[key]} ({scope[key]!.length})</summary><ul>{scope[key]!.map((m,index)=><li key={index}>{m.path || `${m.name || 'Tag'} = ${m.value ?? 'Not reported'}`}{m.type && ` · ${m.type}`}{m.isObjectTag!=null && ` · ${m.isObjectTag ? 'object tag':'bucket tag'}`}</li>)}</ul></details>)}
          </div>)}
        </article>):<Empty>{row.jobs.length ? 'No linked jobs match this search.':'No linked jobs returned. Check data coverage before assuming this source is unconfigured.'}</Empty>}
        <Pager page={current} count={jobs.length} size={5} onChange={setJobPage} label="linked jobs"/>
        <p className={ops.panelFoot}>A job may include only selected paths, prefixes, or containers. Job results describe the whole run; per-workload errors are available in job investigation.</p>
      </Panel>
      <Panel title="Backup evidence" subtitle="Distinct backup copies and their reported recovery points." action={<span className={ops.smallTag}>{row.backups.length} RECORDS</span>}>
        {row.backups.length ? row.backups.slice(currentBackup*5,(currentBackup+1)*5).map(b=><article className={styles.card} key={backupKey(b)}><header><strong>{b.name || b.id}</strong><Badge value={b.lastRunFailed===true ? 'Last run failed':b.lastRunFailed===false ? 'Last run not failed':'Result not reported'} tone={b.lastRunFailed===true ? 'danger':'neutral'}/></header><p>{b.restorePointsCount ?? 'Unknown'} restore points · {b.size!=null && b.size>=0 ? formatBytes(b.size):'Size not reported'} approximate object size</p><p><Link className={ops.textLink} href={`/vbr/protected-data/restore-points?objectId=${encodeURIComponent(b.id)}&name=${encodeURIComponent(b.name || row.name)}`}>Explore restore points<ArrowUpRight size={13}/></Link></p><p><small>Object {b.id}<br/>Backup {b.backupId || 'Not reported'}</small></p></article>):<Empty>No matching backup objects returned. {row.note}</Empty>}
        <Pager page={currentBackup} count={row.backups.length} size={5} onChange={setBackupPage} label="backup records"/>
        <p className={ops.panelFoot}>Counts and sizes are per backup object and may overlap across copies. A backup match alone does not establish full source coverage, freshness, or recovery readiness.</p>
      </Panel>
    </div></div>
  </>
}
