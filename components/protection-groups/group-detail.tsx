"use client"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterCondition,FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { Empty,Pager,Panel,SearchBox,Status,date } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { recordStatus,validId } from '@/lib/investigation/model'
import { entityIssues,groupIssues,groupType,matchesEntity,scheduleText,statusLabel,type EntityIssue,type GroupRow } from '@/lib/protection-groups/model'
import { cn } from '@/lib/utils'
import { ArrowUpRight,Server } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { EntityDetail } from './entity-detail'
import styles from './protection-operations.module.css'
import { Actions,Badge,Discovery,Enabled,flag,type Action } from './shared'

const entityFilters: { value: EntityIssue; label: string }[] = [
  {value:'all',label:'All entities'},{value:'attention',label:'Needs attention'},{value:'offline',label:'Offline'},
  {value:'agent',label:'Agent issues'},{value:'updates',label:'Component updates'},{value:'driver',label:'Driver issues'},
  {value:'reboot',label:'Reboot required'},{value:'trust',label:'Trust issues'},{value:'missingAgent',label:'Agent not installed'},{value:'unknown',label:'Missing evidence'},
]
export function GroupDetail({ row, onAction }: { row: GroupRow; onAction: (action: Action) => void }) {
  const [query,setQuery] = useState(''), [issue,setIssue] = useState<EntityIssue>('all'), [type,setType] = useState('all'), [agent,setAgent] = useState('all'), [page,setPage] = useState(0), [historyPage,setHistoryPage] = useState(0)
  const [entityId,setEntityId] = useState<string | null>(null)
  const g = row.group, o = g.options, issues = groupIssues(row)
  const matching = row.entities.filter(e => matchesEntity(e,query,issue,type,agent)).sort((a,b) => Number(entityIssues(b).attention) - Number(entityIssues(a).attention) || (a.name || a.id).localeCompare(b.name || b.id))
  const current = Math.min(page,Math.max(0,Math.ceil(matching.length/10)-1)), historyCurrent = Math.min(historyPage,Math.max(0,Math.ceil(row.sessions.length/10)-1))
  const count = (v:EntityIssue) => row.entities.filter(e => v === 'all' || entityIssues(e)[v]).length
  function reset() { setQuery(''); setIssue('all'); setType('all'); setAgent('all'); setPage(0) }
  return <>
    {(issues.attention || !row.complete) && <div className={styles.finding}>
      {issues.disabled && <p>This protection group is disabled.</p>}{issues.discovery && <p>The latest linked discovery session needs investigation. Open its session and task logs below.</p>}
      {count('attention') > 0 && <p>{count('attention')} computers have connectivity, component, trust, or reboot issues.</p>}
      {!row.complete && <p>Discovered-entity coverage is incomplete. Counts describe loaded entities only.</p>}
    </div>}
    <div className={styles.detailGrid}>
      <Panel title="Discovery & group" subtitle="The latest linked run is separate from current computer connectivity."><dl className={styles.facts}>
        <div><dt>Group state</dt><dd><Enabled group={g}/></dd></div><div><dt>Type</dt><dd>{groupType(g.type)}</dd></div>
        <div><dt>Description</dt><dd>{g.description || 'Not reported'}</dd></div><div><dt>Group ID</dt><dd><code>{g.id}</code></dd></div>
        <div><dt>Latest discovery · 30 days</dt><dd><Discovery row={row}/></dd></div>
        <div><dt>Rescan schedule</dt><dd>{scheduleText(g)}</dd></div>
        <div><dt>Loaded membership</dt><dd>{row.entities.filter(e => e.type === 'Computer').length} computers · {row.entities.filter(e => ['Cluster','ActiveDirectory'].includes(e.type || '')).length} containers</dd></div>
      </dl></Panel>
      <Panel title="Deployment & maintenance" subtitle="Configured policy; installation and update results are shown per computer."><dl className={styles.facts}>
        <div><dt>Deploy backup agent</dt><dd>{flag(o?.installBackupAgent)}</dd></div><div><dt>Deploy CBT driver</dt><dd>{flag(o?.installCBTDriver)}</dd></div>
        <div><dt>Deploy application plug-ins</dt><dd>{flag(o?.installApplicationPlugins)}{o?.applicationPlugins?.length ? ` · ${o.applicationPlugins.join(', ')}` : ''}</dd></div>
        <div><dt>Automatic upgrades</dt><dd>{flag(o?.updateAutomatically)}</dd></div><div><dt>Reboot if required</dt><dd>{flag(o?.rebootIfRequired)}</dd></div>
        <div><dt>Distribution server</dt><dd>{validId(o?.distributionServerId) ? <Link className={ops.textLink} href={`/vbr/infrastructure/managed-servers/${o.distributionServerId}`}>{o.distributionServerId}<ArrowUpRight size={13}/></Link> : 'Not reported'}</dd></div>
        <div><dt>Distribution repository</dt><dd>{validId(o?.distributionRepositoryId) ? <Link className={ops.textLink} href={`/vbr/infrastructure/repositories/${o.distributionRepositoryId}`}>{o.distributionRepositoryId}<ArrowUpRight size={13}/></Link> : 'Not reported'}</dd></div>
      </dl></Panel>
    </div>
    <Panel title="Discovered entities" subtitle="Computer connectivity, agent installation, and component health retain their own status." action={<span className={ops.smallTag}>{matching.length} MATCHING</span>}>
      <FilterWorkspace label="Discovered entities filters" search={<><SearchBox label="Search computers, IPs, OS, or versions" value={query} onChange={v=>{setQuery(v);setPage(0)}}/></>} onClear={reset} filters={<FilterFields><FilterCondition>{entityFilters.map(f => <button key={f.value} className={cn(styles.chip,issue===f.value && styles.selected)} aria-pressed={issue===f.value} onClick={() => {setIssue(f.value);setPage(0)}}>{f.label}<span>{count(f.value)}</span></button>)}</FilterCondition>
<FilterSelect label={"Entity type"} value={type} onValueChange={e=>{setType(e);setPage(0)}}><option value="all">All types</option>{[...new Set(row.entities.map(e=>e.type || 'Unknown'))].sort().map(t=><option key={t} value={t}>{statusLabel(t)}</option>)}</FilterSelect>
<FilterSelect label={"Agent status"} value={agent} onValueChange={e=>{setAgent(e);setPage(0)}}><option value="all">All agent states</option>{['Installed','NotInstalled','UpgradeRequired','Failed','UnsupportedOperatingSystem','Unknown','NotInitialized'].map(s=><option key={s} value={s}>{statusLabel(s)}</option>)}</FilterSelect></FilterFields>}>
{matching.length ? <div className={ops.tableScroll}><SortableGrid rows={matching} columns={[{id:'name',value:r=>r.name || r.id},{id:'state',value:r=>r.state},{id:'agent',value:r=>r.agentStatus},{id:'driver',value:r=>r.driverStatus},{id:'signals',value:r=>entityIssues(r).attention},{id:'connected',value:r=>r.lastConnected,kind:'date'}]} onSortChange={()=>setPage(0)}>{(matching)=>(<table className={cn(ops.table,styles.table)}><thead><tr><th>Entity / operating system</th><th>Connectivity</th><th>Backup agent</th><th>CBT driver</th><th>Other signals</th><th>Last agent connection</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{matching.slice(current*10,(current+1)*10).map(e=>{
        const computer=e.type==='Computer', i=entityIssues(e)
        return <tr key={e.id}><td><div className={styles.identity}><Server size={17}/><div><button className={ops.jobName} onClick={()=>setEntityId(e.id)}>{e.name || e.id}</button><div className={ops.subtext}>{computer ? e.operatingSystemVersion || e.operatingSystem || 'OS not reported' : statusLabel(e.type)}</div><div className={styles.description}>{e.ipAddresses?.join(', ')}</div></div></div></td>
          <td>{computer ? <Badge value={e.state}/> : <span className={styles.muted}>Container</span>}</td>
          <td><div className={styles.stack}>{computer ? <><Badge value={e.agentStatus}/><small>{e.agentVersion || 'Version not reported'}</small></> : 'Not applicable'}</div></td>
          <td><div className={styles.stack}>{computer ? <><Badge value={e.driverStatus}/><small>{e.driverVersion || 'Version not reported'}</small></> : 'Not applicable'}</div></td>
          <td><div className={styles.badges}>{i.reboot && <Badge value="Reboot required" tone="warning"/>}{i.trust && <Badge value="Not trusted" tone="warning"/>}{e.plugins?.some(p=>p.status==='UpgradeRequired') && <Badge value="Plug-in updates" tone="warning"/>}{i.unknown && <Badge value="Missing evidence"/>}{!i.reboot && !i.trust && !i.unknown && !e.plugins?.some(p=>p.status==='UpgradeRequired') && <span className={styles.muted}>{computer ? 'None reported' : 'Container'}</span>}</div></td>
          <td>{computer ? date(e.lastConnected) : 'Not applicable'}</td><td><div className={styles.actions}><Button variant="ghost" size="icon" aria-label={`Inspect ${e.name || e.id}`} onClick={()=>setEntityId(e.id)}><ArrowUpRight size={17}/></Button><Actions group={g} entity={e} onAction={onAction}/></div></td></tr>
      })}</tbody></table>)}</SortableGrid></div> : <Empty>{row.entities.length ? 'No entities match these filters.' : row.complete ? 'No discovered entities were returned for this group.' : 'Discovered entities are unavailable or incomplete.'}</Empty>}
<Pager page={current} count={matching.length} onChange={setPage} label="entities"/>
<p className={ops.panelFoot}>Clusters and Active Directory containers are excluded from computer health counts. A missing agent or optional CBT driver is shown separately; it does not automatically mean deployment failed. Last connection is a timestamp, not the discovery result.</p>
</FilterWorkspace></Panel>
    <Panel title="Discovery sessions" subtitle="Last 30 days · matched by group ID, never by name. Open a session for task results and logs." action={<span className={ops.smallTag}>{row.sessions.length} LINKED</span>}>
      {row.sessions.length ? <div className={ops.tableScroll}><SortableGrid rows={row.sessions} columns={[{id:'name',value:r=>r.name},{id:'result',value:r=>r.result?.result || r.state},{id:'started',value:r=>r.creationTime,kind:'date'},{id:'ended',value:r=>r.endTime,kind:'date'},{id:'message',value:r=>r.result?.message}]} onSortChange={()=>setHistoryPage(0)}>{(sortedSessions)=>(<table className={ops.table}><thead><tr><th>Discovery session</th><th>Result / state</th><th>Started</th><th>Ended</th><th>Message</th></tr></thead><tbody>{sortedSessions.slice(historyCurrent*10,(historyCurrent+1)*10).map(s=><tr key={s.id}><td><Link className={ops.textLink} href={`/vbr/sessions/${s.id}`}>{s.name || s.id}<ArrowUpRight size={13}/></Link></td><td><Status value={recordStatus(s)}/></td><td>{date(s.creationTime)}</td><td>{date(s.endTime)}</td><td>{s.result?.message || 'No message reported'}</td></tr>)}</tbody></table>)}</SortableGrid></div> : <Empty>{row.historyComplete ? 'No discovery sessions could be linked to this group in the last 30 days. This does not establish that the group has never been scanned.' : 'Discovery history is unavailable or incomplete.'}</Empty>}
      <Pager page={historyCurrent} count={row.sessions.length} onChange={setHistoryPage} label="discovery sessions"/>
    </Panel>
    <EntityDetail entity={row.entities.find(e=>e.id===entityId) || null} entities={row.entities} close={()=>setEntityId(null)}/>
  </>
}
