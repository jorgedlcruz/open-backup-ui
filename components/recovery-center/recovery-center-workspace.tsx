'use client'
// Open Backup UI v1.2.0
import {useMemo,useState} from 'react'
import Link from 'next/link'
import {Activity,ArrowDown,ArrowUp,ArrowUpDown,CheckCheck,ChevronLeft,ChevronRight,Clock3,Database,Files,FolderOpen,HardDrive,
  Layers3,MonitorPlay,RefreshCw,Server,TriangleAlert} from 'lucide-react'
import {useI18n} from '@/components/providers/i18n-provider'
import {useRecoveryPresentation} from '@/components/restore-points/use-presentation'
import {SearchBox} from '@/components/investigation/shared'
import {FilterWorkspace} from '@/components/operations/filter-workspace'
import {FilterFields} from '@/components/operations/filter-fields'
import {FilterFacet,FilterSelect} from '@/components/operations/filter-facet'
import {Button} from '@/components/ui/button'
import {DataLoading} from '@/components/ui/data-loading'
import {investigationLabel} from '@/lib/investigation/presentation'
import {defaultGridFilters,quickFilters,quickLabels,recoveryRows,selectRecoveryRows,type RecoveryGridFilters,type RecoverySort} from '@/lib/recovery-center/model'
import {RecoveryLauncherButton} from './recovery-launcher'
import {useRecoveryFeed} from './use-recovery-feed'
import {useRecoveryCatalog} from './use-recovery-catalog'
import ops from '@/components/operations/operations.module.css'
import css from './recovery-center.module.css'

const icons={all:Layers3,active:Activity,pending:Clock3,ready:FolderOpen,attention:TriangleAlert,completed:CheckCheck}
const labels:Record<string,string>={InstantRecovery:'Instant VM Recovery',RestoreVm:'Entire VM restore',FileLevelRestore:'Guest file restore',
  BrowseActiveDirectory:'Microsoft Active Directory',BrowseSql:'Microsoft SQL Server','Waiting for Explorer':'Waiting for Explorer',
  'Checking with VBR':'Checking with VBR','Browse session unconfirmed':'Browse session unconfirmed',
  LinuxFileLevelRestore:'Guest file restore · Linux',ApplicationLevelRestore:'Application item restore',PublishBackupContentViaMount:'Published disks',
  FirstClassDiskInstantRestore:'First Class Disk Recovery',CloudDirectorVmRestore:'Cloud Director VM restore',QuickMigration:'Quick Migration',
  Queued:'Queued',Submitting:'Submitting',Accepted:'Accepted','Not started':'Not started','Outcome unknown':'Outcome unknown',Mounted:'Mounted'}
const headers:Record<RecoverySort,string>={name:'Workload',type:'Recovery type',state:'Status',platform:'Platform',started:'Started',progress:'Progress'}
const columns:RecoverySort[]=['name','type','state','platform','started','progress']
const mountLabels:Record<string,string>={vSphere:'VMware vSphere',hyperV:'Microsoft Hyper-V',fcd:'First Class Disk Recovery',flr:'Guest file restore',publish:'Published disks'}
const limit=25
function typeIcon(type:string) {
  if(/FileLevel|NasRestore|Unstructured/.test(type))return Files
  if(/Application|EntraId|AdForest|^Browse/.test(type))return Database
  if(/InstantRecovery/.test(type))return MonitorPlay
  if(/Disk|Publish/.test(type))return HardDrive
  return Server
}
export function RecoveryCenterWorkspace({initialSearch=''}:{initialSearch?:string}) {
  const {t,locale,formatNumber,formatDate}=useI18n(),{diagnostic}=useRecoveryPresentation()
  const [revision,setRevision]=useState(0),{feed,busy,error,receipts}=useRecoveryFeed(revision)
  const catalog=useRecoveryCatalog(feed?.sourceKey)
  const [filters,setFilters]=useState({...defaultGridFilters,search:initialSearch}),[sort,setSort]=useState<RecoverySort>('started'),[ascending,setAscending]=useState(false),[offset,setOffset]=useState(0)
  const rows=useMemo(()=>feed?recoveryRows(feed.sourceKey,feed.history,feed.mounts,feed.batches,receipts,feed.explorerRequests):[],[feed,receipts])
  const label=(raw:string)=>labels[raw]?t(labels[raw]):investigationLabel(t,raw).replace(/([a-z])([A-Z])/g,'$1 $2')
  const matches=selectRecoveryRows(rows,filters,sort,ascending,locale,label)
  const current=Math.min(offset,Math.max(0,Math.floor((matches.length-1)/limit)*limit)),visible=matches.slice(current,current+limit)
  const counts={all:rows.length,active:0,pending:0,ready:0,attention:0,completed:0}
  for(const row of rows)if(row.category!=='other')counts[row.category]++
  function change(patch:Partial<RecoveryGridFilters>){setFilters(old=>({...old,...patch}));setOffset(0)}
  function order(field:RecoverySort){setAscending(sort===field?!ascending:!['started','progress'].includes(field));setSort(field);setOffset(0)}
  function options(field:'type'|'platform'|'state'){
    const tally=new Map<string,number>()
    for(const row of rows){const value=row[field];if(value)tally.set(value,(tally.get(value)||0)+1)}
    return [...tally].sort(([a],[b])=>label(a).localeCompare(label(b),locale)).map(([value,count])=>({value,label:label(value),searchText:value,count}))
  }
  const activeCount=filters.types.length+filters.states.length+filters.platforms.length+Number(!!filters.search)+Number(!!filters.window)+Number(filters.quick!=='all')
  return <main className={ops.console}>
    <header className={ops.header+' '+css.header}><div><h1>{t('Recovery Center')}</h1>
      {feed&&<p className={css.source}><Server size={13} aria-hidden/>{feed.sourceName}</p>}</div>
      <div className={css.headerActions}><Button variant="outline" size="sm" disabled={busy||catalog.refreshing} onClick={()=>{setRevision(v=>v+1);void catalog.refresh()}}>
        <RefreshCw size={15} aria-hidden className={busy||catalog.refreshing?'animate-spin':''}/>{t('Refresh')}</Button>
        {feed&&<RecoveryLauncherButton sourceKey={feed.sourceKey} onCreated={()=>setRevision(v=>v+1)}/>}</div>
    </header>
    {error&&<p role="alert" className={ops.notice}>{diagnostic(error)}</p>}
    {catalog.error&&<p role="alert" className={ops.notice}>{t('Recovery options could not be refreshed.')} {diagnostic(catalog.error)}</p>}
    {!!feed?.warnings.length&&<p className={ops.warnings} role="status">{t('Partial collection')} · {feed.warnings.map(text=>t(mountLabels[text]||text)).join(', ')}</p>}
    <div role="group" aria-label={t('Recovery status')} className={css.metrics}>
      {quickFilters.map(quick=>{const Icon=icons[quick]
        return <button key={quick} type="button" className={css.metric} data-tone={quick} aria-pressed={filters.quick===quick}
          onClick={()=>change({quick:filters.quick===quick?'all':quick})}><span className={css.metricLabel}><Icon size={16}/>{t(quickLabels[quick])}</span>
          <strong>{feed?formatNumber(counts[quick]):'—'}</strong></button>})}
    </div>
    <section className={ops.panel} aria-label={t('Recovery activity')}>
      <div className={css.panelHead}><h2>{t('Recovery activity')}</h2>{feed?.nextSkip!=null&&<span role="status">{t('Loading recovery history…')}</span>}</div>
      <FilterWorkspace label="Grid filters" activeCount={activeCount} search={<SearchBox label={t('Search recoveries')} value={filters.search} onChange={search=>change({search})}/>}
        onClear={()=>{setFilters(defaultGridFilters);setOffset(0)}} filters={<FilterFields>
          <FilterFacet title="Recovery type" options={options('type')} selected={filters.types} onChange={types=>change({types})} defaultOpen/>
          <FilterFacet title="Status" options={options('state')} selected={filters.states} onChange={states=>change({states})}/>
          <FilterFacet title="Platform" options={options('platform')} selected={filters.platforms} onChange={platforms=>change({platforms})}/>
          <FilterSelect label="Started" value={filters.window} onValueChange={window=>change({window})}>
            <option value="">{t('All')}</option><option value="1">{t('Last 24 hours')}</option><option value="7">{t('Last 7 days')}</option><option value="30">{t('Last 30 days')}</option>
          </FilterSelect></FilterFields>}>
        {!feed&&!error?<div className={ops.empty}><DataLoading status={t('Loading recovery history…')} compact/></div>:feed&&
          (visible.length?<div className={ops.tableScroll}><table className={ops.table+' '+css.table}>
            <thead><tr>{columns.map(field=>{const Icon=sort===field?ascending?ArrowUp:ArrowDown:ArrowUpDown
              return <th key={field} scope="col" aria-sort={sort===field?ascending?'ascending':'descending':undefined}><button type="button" onClick={()=>order(field)}>
                {t(headers[field])}<Icon size={12} aria-hidden/></button></th>})}</tr></thead>
            <tbody>{visible.map(row=>{const Icon=typeIcon(row.type)
              return <tr key={row.key}><td><div className={css.identity}><span className={css.workload}><Icon size={16} aria-hidden/></span><div>
                <Link prefetch={false} href={row.href} className={ops.jobName}>{row.name}</Link>
                {row.batchHref&&row.batchHref!==row.href?<Link className={css.metaLink} href={row.batchHref} prefetch={false}>{t('Mass recovery')}</Link>:
                  (row.batch||row.initiatedBy)&&<small>{row.batch?t('Mass recovery'):row.initiatedBy}</small>}
              </div></div></td><td>{label(row.type)}</td><td><span className={css.badge} data-tone={row.category}>
                <i aria-hidden/>{label(row.state)}</span></td><td>{row.platform?label(row.platform):'—'}</td>
              <td className={ops.dateCell}>{row.started&&Number.isFinite(Date.parse(row.started))?formatDate(row.started,{dateStyle:'medium',timeStyle:'short'}):'—'}</td>
              <td>{row.category==='active'&&row.progress!=null?<span className={css.progress}>
                <progress max={100} value={row.progress} aria-label={t('Progress')}/>{formatNumber(row.progress/100,{style:'percent'})}</span>:'—'}</td></tr>})}</tbody>
          </table></div>:<p className={ops.empty}>{t(activeCount?'No matching recoveries.':'No recovery activity reported.')}</p>)}
        <div className={ops.pagination}>{feed&&<span>{matches.length?t('{start}–{end} of {count}',{start:formatNumber(current+1),end:formatNumber(current+visible.length),count:formatNumber(matches.length)}):t('0 records')}</span>}
          <div><Button variant="outline" size="sm" disabled={!current} onClick={()=>setOffset(current-limit)}><ChevronLeft/>{t('Previous')}</Button>
            <Button variant="outline" size="sm" disabled={current+limit>=matches.length} onClick={()=>setOffset(current+limit)}>{t('Next')}<ChevronRight/></Button></div></div>
      </FilterWorkspace>
    </section>
  </main>
}
