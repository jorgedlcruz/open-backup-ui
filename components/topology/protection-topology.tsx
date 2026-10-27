'use client'
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterCondition,FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableGrid } from '@/components/ui/sortable-grid'
import dynamic from 'next/dynamic'

import { Empty,Loading,Notice,Pager,Panel,SearchBox,date } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { veeamApi } from '@/lib/api/veeam-client'
import { focusTopology,investigateTopology,pathsFor,topologySummary,type TopologyIssue } from '@/lib/topology/investigation'
import { relatedEntities,type EntityKind,type TopologyEntity,type TopologyGraph,type TopologyPath,type TopologySnapshot } from '@/lib/topology/model'
import { cn } from '@/lib/utils'
import { ArrowRight,ArrowUpRight,Box,BriefcaseBusiness,Database,Focus,GitBranch,List,RefreshCw,Scan,ShieldAlert,X } from 'lucide-react'
import Link from 'next/link'
import { useCallback,useEffect,useMemo,useRef,useState } from 'react'
import './topology.css'

const Canvas = dynamic(() => import('./topology-canvas'), { ssr: false, loading: () => <Loading>Loading relationship map…</Loading> })
const kinds: EntityKind[] = ['workload', 'job', 'repository']
const labels = { workload: 'Workloads', job: 'Jobs', repository: 'Repositories' }
const icons = { workload: Box, job: BriefcaseBusiness, repository: Database }
const EMPTY: TopologyGraph = { entities: [], links: [], paths: [] }
const MAP_LIMIT = 250
const issues: { value: TopologyIssue; label: string }[] = [{ value: 'all', label: 'All items' }, { value: 'attention', label: 'Needs attention' }, { value: 'unlinked', label: 'No known connections' }, { value: 'unknown', label: 'Missing status / details' }]

function Health({ entity }: { entity: TopologyEntity }) {
  return <span className={cn(ops.badge, entity.health === 'attention' ? ops.warning : entity.health === 'healthy' ? ops.success : ops.neutral)}><span className={ops.dot}/>{entity.status}</span>
}
function EntityButton({ entity, onSelect }: { entity?: TopologyEntity; onSelect: (id: string) => void }) {
  if (!entity) return <span className="topology-muted">Not reported</span>
  const Icon = icons[entity.kind]
  return <button className="topology-entity-link" onClick={() => onSelect(entity.id)} title={entity.sourceId}><Icon size={14}/><span>{entity.name}</span><ArrowRight size={12}/></button>
}
function PathTable({ paths, graph, onSelect, compact = false }: { paths: TopologyPath[]; graph: TopologyGraph; onSelect: (id: string) => void; compact?: boolean }) {
  const [page, setPage] = useState(0)
  const size = compact ? 8 : 100, current = Math.min(page, Math.max(0, Math.ceil(paths.length / size) - 1))
  const entities = new Map(graph.entities.map(entity => [entity.id, entity]))
  if (!paths.length) return <Empty>No backup relationships were returned for this scope.</Empty>
  return <>
    <div className={cn(ops.tableScroll, compact && 'topology-path-scroll')} tabIndex={0} role="region" aria-label="Backup relationship paths"><SortableGrid rows={paths} columns={[{id:'backup',value:r=>r.backupName},{id:'workload',value:r=>entities.get(r.workloadId || "")?.name},{id:'job',value:r=>entities.get(r.jobId || "")?.name},{id:'repository',value:r=>entities.get(r.repositoryId || "")?.name}]} onSortChange={()=>setPage(0)}>{(paths)=>(<table className={cn(ops.table, 'topology-path-table')}><thead><tr><th>Backup evidence</th><th>Workload</th><th>Job</th><th>Repository</th></tr></thead><tbody>{paths.slice(current * size, (current + 1) * size).map((path, index) => <tr key={`${path.backupId}:${path.workloadId || index}`}>
      <td><strong>{path.backupName}</strong><span className="topology-id">{path.backupId}</span></td>{[path.workloadId, path.jobId, path.repositoryId].map((id, i) => <td key={i}><EntityButton entity={id ? entities.get(id) : undefined} onSelect={onSelect}/></td>)}
    </tr>)}</tbody></table>)}</SortableGrid></div>
    <Pager page={current} count={paths.length} size={size} onChange={setPage} label={compact ? 'selected backup paths' : 'backup paths'}/>
  </>
}
function DetailPanel({ entity, graph, snapshot, onSelect, onClose, onFocus, focused }: {
  entity: TopologyEntity; graph: TopologyGraph; snapshot: TopologySnapshot; onSelect: (id: string) => void; onClose: () => void; onFocus: () => void; focused: boolean
}) {
  const connected = relatedEntities(graph, entity.id)
  const related = graph.entities.filter(item => item.id !== entity.id && connected.has(item.id))
  const paths = pathsFor(graph, entity.id), allPaths = pathsFor(snapshot, entity.id)
  const backups = [...new Map(paths.map(path => [path.backupId, path.backupName])).entries()]
  const Icon = icons[entity.kind]
  return <aside className="topology-details" aria-label="Selected item details">
    <div className="topology-detail-heading"><span>Connection investigation</span><Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}><X size={15}/></Button></div>
    <span className={`topology-kind-icon ${entity.kind}`}><Icon size={22}/></span><h2>{entity.name}</h2><p className="topology-muted">{entity.subtitle}</p>
    <div className="topology-status"><Health entity={entity}/></div>
    <Button variant="outline" size="sm" className="topology-focus-button" onClick={onFocus}><Focus size={14}/>{focused ? 'Show filtered environment' : 'Focus these connections'}</Button>
    <dl className="topology-facts">{entity.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}<div><dt>Source ID</dt><dd className="topology-id">{entity.sourceId}</dd></div><div><dt>Backups in this view</dt><dd>{backups.length}</dd></div></dl>
    <p className="topology-muted topology-scope-note">{paths.length} of {allPaths.length} recorded paths in the current scope.</p>
    {entity.kind === 'repository' && <div className="topology-impact"><strong>{related.filter(item => item.kind === 'workload').length}</strong><span>Known connected workloads</span><p>Backup records reference this repository. Other copies may exist.</p></div>}
    {kinds.filter(kind => kind !== entity.kind).map(kind => {
      const items = related.filter(item => item.kind === kind)
      return <section className="topology-related" key={kind}><h3>{labels[kind]}<span>{items.length}</span></h3>{items.length ? <div className="topology-related-list">{items.map(item => <div key={item.id}><EntityButton entity={item} onSelect={onSelect}/><Health entity={item}/></div>)}</div> : <p className="topology-muted">No relationship reported in this scope.</p>}</section>
    })}
    {!related.length && <p className="topology-muted">Missing connections do not establish that this item is unprotected.</p>}
    {!!backups.length && <details className="topology-backup-evidence"><summary>Based on {backups.length} backup(s)</summary><ul>{backups.map(([id, name]) => <li key={id}>{name}<span className="topology-id">{id}</span></li>)}</ul></details>}
    <div className="topology-detail-actions">
      {entity.kind === 'workload' && <><Link className={ops.textLink} href={`/vbr/workloads/${encodeURIComponent(entity.sourceId)}`}>Explore resilience<ArrowUpRight size={14}/></Link><Link className={ops.textLink} href={`/vbr/protected-data/restore-points?objectId=${encodeURIComponent(entity.sourceId)}&name=${encodeURIComponent(entity.name)}`}>Explore restore points<ArrowUpRight size={14}/></Link></>}
      {entity.kind === 'repository' && <Link className={ops.textLink} href={`/vbr/infrastructure/repositories/${encodeURIComponent(entity.sourceId)}`}>Investigate repository<ArrowUpRight size={14}/></Link>}
      {entity.href && <Link className={ops.textLink} href={entity.href}>Open {entity.kind === 'job' ? 'job' : entity.kind === 'repository' ? 'repositories' : 'protected data'}<ArrowUpRight size={14}/></Link>}
    </div>
  </aside>
}

export function ProtectionTopology() {
  const [snapshot, setSnapshot] = useState<TopologySnapshot | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState(''), [repositoryId, setRepositoryId] = useState(''), [issue, setIssue] = useState<TopologyIssue>('all'), [kind, setKind] = useState<EntityKind | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null), [focusId, setFocusId] = useState<string | null>(null)
  const [mode, setMode] = useState<'map' | 'list' | 'paths'>('map'), [listPage, setListPage] = useState(0)
  const request = useRef<AbortController | null>(null), source = useRef<string | null>(null), detailsRef = useRef<HTMLDivElement>(null)
  const refresh = useCallback(async () => {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setLoading(true); setError(null)
    try {
      const result = await veeamApi.getProtectionTopology(controller.signal)
      if (!controller.signal.aborted) {
        if (source.current !== null && source.current !== result.sourceName) {
          setSelectedId(null); setFocusId(null); setRepositoryId(''); setQuery(''); setIssue('all'); setKind('all')
        }
        source.current = result.sourceName; setSnapshot(result)
      }
    } catch {
      if (!controller.signal.aborted) {
        setSnapshot(null); setSelectedId(null); setFocusId(null)
        setError('Protection data could not be loaded. Check your VBR connection and permissions, then retry.')
      }
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [])
  useEffect(() => { void refresh(); return () => request.current?.abort() }, [refresh])
  const filtered = useMemo(() => investigateTopology(snapshot || EMPTY, query, repositoryId, issue, kind), [snapshot, query, repositoryId, issue, kind])
  const focus = filtered.entities.find(entity => entity.id === focusId)
  const graph = useMemo(() => focus ? focusTopology(filtered, focus.id) : filtered, [filtered, focus])
  const selected = graph.entities.find(entity => entity.id === selectedId) || null
  const highlighted = useMemo(() => selected ? relatedEntities(graph, selected.id) : new Set<string>(), [graph, selected])
  const highlightedLinks = useMemo(() => new Set(selected ? focusTopology(graph, selected.id).links.map(link => link.id) : []), [graph, selected])
  const stats = useMemo(() => topologySummary(snapshot || EMPTY), [snapshot]), scope = useMemo(() => topologySummary(graph), [graph])
  const repositories = snapshot?.entities.filter(entity => entity.kind === 'repository') || []
  const showList = mode === 'list' || (mode === 'map' && graph.entities.length > MAP_LIMIT)
  const currentPage = Math.min(listPage, Math.max(0, Math.ceil(graph.entities.length / 100) - 1))
  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id && window.innerWidth < 1100) requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }))
  }, [])
  function resetSelection() { setSelectedId(null); setFocusId(null); setListPage(0) }
  function clear() { setQuery(''); setRepositoryId(''); setIssue('all'); setKind('all'); resetSelection() }
  function chooseIssue(value: TopologyIssue) { setIssue(value); resetSelection() }
  return <div className={cn(ops.console, 'topology-page')}>
    <header className={ops.header}><div><h1>Protection topology</h1><p>Trace workloads through their backup jobs and repositories. Investigate the evidence behind every connection.</p></div><div className={ops.headerActions}>{snapshot && <span className={ops.source}><span className={ops.dot}/>{snapshot.sourceName}</span>}<Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>Refresh data</Button></div></header>
    {error && <Notice error>{error} <Link href="/administration/data-sources" className={ops.textLink}>Data sources</Link></Notice>}
    {!!snapshot?.warnings.length && <details className={ops.warnings}><summary>{snapshot.warnings.length} data coverage {snapshot.warnings.length === 1 ? 'notice' : 'notices'}</summary><ul>{snapshot.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
    <div className={ops.metrics}>{kinds.map(entityKind => {
      const Icon = icons[entityKind]
      const caption = entityKind === 'workload' ? 'Unique workload IDs in returned backup records' : entityKind === 'job' ? 'Job states and references from backups' : 'Repository states and backup destinations'
      return <button className={cn(ops.metric, 'topology-metric')} key={entityKind} aria-pressed={kind === entityKind} onClick={() => { setKind(kind === entityKind ? 'all' : entityKind); resetSelection() }}><div className={ops.metricLabel}>{labels[entityKind]}<Icon size={17}/></div><div className={ops.metricValue}>{snapshot ? stats[entityKind].toLocaleString() : '—'}</div><p>{caption}</p></button>
    })}<button className={cn(ops.metric, 'topology-metric')} aria-pressed={issue === 'attention'} onClick={() => chooseIssue(issue === 'attention' ? 'all' : 'attention')}><div className={ops.metricLabel}>Needs attention<ShieldAlert size={17}/></div><div className={cn(ops.metricValue, ops.warning)}>{snapshot ? stats.attention : '—'}</div><p>Reported job, restore-point, or storage issues</p></button></div>
    <Panel title="Relationship explorer" subtitle="Search a workload, job, repository, or backup. Matching items retain their backup path context." action={<div className="topology-toggle" aria-label="View mode">{([{ key: 'map', label: 'Map', icon: Scan }, { key: 'list', label: 'List', icon: List }, { key: 'paths', label: 'Paths', icon: GitBranch }] as const).map(view => <button key={view.key} aria-pressed={mode === view.key} onClick={() => setMode(view.key)}><view.icon size={14}/>{view.label}</button>)}</div>}>
      <FilterWorkspace label="Relationship explorer filters" search={<><SearchBox label="Search topology" value={query} onChange={value => { setQuery(value); resetSelection() }}/></>} onClear={clear} filters={<FilterFields><FilterCondition>{issues.map(item => <button key={item.value} aria-pressed={issue === item.value} onClick={() => chooseIssue(item.value)}>{item.label}<span>{item.value === 'all' ? snapshot?.entities.length || 0 : stats[item.value]}</span></button>)}</FilterCondition>
<FilterSelect label={"Repository"} value={repositoryId} onValueChange={event => { setRepositoryId(event); resetSelection() }}><option value="">All repositories</option>{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</FilterSelect>
<FilterSelect label={"Match type"} value={kind} onValueChange={event => { setKind(event as EntityKind | 'all'); resetSelection() }}><option value="all">All item types</option>{kinds.map(entityKind => <option key={entityKind} value={entityKind}>{labels[entityKind]}</option>)}</FilterSelect></FilterFields>}>
<div className="topology-summary"><div className="topology-lanes">{kinds.map((entityKind, i) => <span key={entityKind}>{i > 0 && <ArrowRight size={12}/>}<i className={entityKind}/><strong>{scope[entityKind]}</strong>{labels[entityKind]}</span>)}</div><span aria-live="polite">{graph.entities.length} items · {graph.links.length} connections · {scope.backups} backups</span></div>
{focus && <div className="topology-focus-bar"><Focus size={14}/><span>Focused on <strong>{focus.name}</strong></span><Button size="sm" variant="ghost" onClick={() => setFocusId(null)}>Clear focus<X size={13}/></Button></div>}
<div className={cn('topology-body', selected && 'has-details')}>
        <div className={cn('topology-map', (showList || mode === 'paths') && 'is-list')}>
          {loading ? <Loading>Tracing protection paths and reading backup membership…</Loading> : !snapshot ? <Empty>Connect a VBR source to explore its protection.</Empty> : !graph.entities.length ? <Empty>{snapshot.entities.length ? 'No items match these filters.' : 'No backup records returned for this connection.'}<Button variant="outline" size="sm" onClick={clear}>Clear filters</Button></Empty> : mode === 'paths' ? <PathTable paths={graph.paths} graph={graph} onSelect={select}/> : showList ? <>
            {mode === 'map' && <p className="topology-fallback">Showing a list for this large environment. Filter to {MAP_LIMIT} items or fewer to explore the map.</p>}
            <div className={ops.tableScroll} tabIndex={0} role="region" aria-label="Topology inventory"><SortableGrid rows={graph.entities} columns={[{id:'name',value:r=>r.name},{id:'type',value:r=>r.kind},{id:'status',value:r=>r.status},{id:'relationships',value:r=>topologySummary(focusTopology(graph,r.id)).backups}]} onSortChange={()=>setListPage(0)}>{(sortedEntities)=>(<table className={cn(ops.table, 'topology-inventory')}><thead><tr><th>Item / platform</th><th>Type</th><th>Reported status</th><th>Backup relationships</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{sortedEntities.slice(currentPage * 100, (currentPage + 1) * 100).map(entity => {
              const summary = topologySummary(focusTopology(graph, entity.id))
              return <tr key={entity.id} data-selected={selected?.id === entity.id}><td><EntityButton entity={entity} onSelect={select}/><span className="topology-sub">{entity.subtitle}</span></td><td className="capitalize">{entity.kind}</td><td><Health entity={entity}/></td><td><span>{summary.backups} backups</span><span className="topology-sub">{kinds.filter(k => k !== entity.kind).map(k => `${summary[k]} ${labels[k].toLowerCase()}`).join(' · ')}</span></td><td><Button size="sm" variant="ghost" aria-label={`Inspect ${entity.kind}: ${entity.name}`} onClick={() => select(entity.id)}>Inspect<ArrowRight size={13}/></Button></td></tr>
            })}</tbody></table>)}</SortableGrid></div><Pager page={currentPage} count={graph.entities.length} size={100} onChange={setListPage} label="topology items"/>
          </> : <Canvas graph={graph} selectedId={selected?.id || null} highlightedIds={highlighted} highlightedLinkIds={highlightedLinks} onSelect={select}/>}
        </div>
        {selected && snapshot && <div ref={detailsRef} className="topology-detail-container"><DetailPanel entity={selected} graph={graph} snapshot={snapshot} onSelect={select} onClose={() => select(null)} onFocus={() => setFocusId(focusId === selected.id ? null : selected.id)} focused={focusId === selected.id}/></div>}
      </div>
<p className={ops.panelFoot}>{selected ? 'Highlighted connections follow the selected item’s backup membership.' : 'Select an item to inspect its backup paths, or use List for a compact inventory.'} {scope.unlinked > 0 && `${scope.unlinked} items have no known connections in this scope.`} Filters retain connected items for context.</p>
</FilterWorkspace></Panel>
    {selected && <Panel className="topology-evidence-panel" title={`Backup paths · ${selected.name}`} subtitle="Each row preserves a single backup’s workload, job, and repository relationship. Missing stages remain unreported."><PathTable key={selected.id + query + repositoryId + issue + kind} compact paths={pathsFor(graph, selected.id)} graph={graph} onSelect={select}/></Panel>}
    <footer className={ops.footer}><span><span className={ops.dot}/>{snapshot ? `Snapshot ${date(snapshot.fetchedAt)} · Refresh on demand` : 'Awaiting data'}</span><span>Relationships use API IDs and backup membership</span></footer>
    <p className="topology-disclaimer">Connections describe existing backup records, not every production workload or configured job scope. Restore-point counts do not establish recovery readiness or RPO compliance. Amber marks reported issues; grey marks unknown or unevaluated status.</p>
  </div>
}
