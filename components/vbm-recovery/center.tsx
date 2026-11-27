'use client'
// Open Backup UI v1.3.0
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Activity, ArrowRight, CheckCheck, ChevronDown, FileText, FolderOpen, Layers3, Loader2, RefreshCw, RotateCcw, Search, Server, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataLoading } from '@/components/ui/data-loading'
import { FilterWorkspace } from '@/components/operations/filter-workspace'
import { FilterSelect } from '@/components/operations/filter-facet'
import { useI18n } from '@/components/providers/i18n-provider'
import { objectType } from '@/lib/vbm-protected/model'
import type { RecoveryCandidates } from '@/lib/vbm-recovery/candidates'
import { workloads, workloadSchema, type JsonRecord, type RecoverySession } from '@/lib/vbm-recovery/model'
import { recoveryCategory, recoveryFilters, recoveryLabels, recoverySummary, recoveryEndTime, recoverySessionReference } from '@/lib/vbm-recovery/presentation'
import { recoveryGet } from './client'
import { RecoveryPicker, recoveryGoals, type RecoveryEntry } from './picker'
import { RecoveryEventLog } from './session-events'
import { SessionStopControl,SessionStopFeedback } from './stop-session'
import { SourceActivityNotice } from './source-activity-notice'
import ops from '@/components/operations/operations.module.css'
import recovery from '@/components/recovery-center/recovery-center.module.css'
import css from './center.module.css'

const stateOf=recoveryCategory
const summaryIcons={all:Layers3,active:Activity,attention:TriangleAlert,completed:CheckCheck}
function sessionHref(session:RecoverySession) {return `/vbm/recovery-center/${encodeURIComponent(session.parentSessionId||session.id)}${session.parentSessionId?'#operations':''}`}

export function Microsoft365RecoveryCenter() {
  const {t,formatDate,formatNumber}=useI18n(),params=useSearchParams()
  const [sessions,setSessions]=useState<RecoverySession[]>([]),[sourceName,setSourceName]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const [hasMore,setHasMore]=useState(false),[nextOffset,setNextOffset]=useState(0),[loadingMore,setLoadingMore]=useState(false)
  const [query,setQuery]=useState(''),[status,setStatus]=useState('all'),[workloadFilter,setWorkloadFilter]=useState('all'),[page,setPage]=useState(0)
  const [expandedSession,setExpandedSession]=useState<string>()
  const [entry,setEntry]=useState<RecoveryEntry|null>(null),[preparing,setPreparing]=useState(false)
  const [inventory,setInventory]=useState<RecoveryCandidates>(),[inventoryLoading,setInventoryLoading]=useState(false),[inventoryError,setInventoryError]=useState('')
  const inventoryRef=useRef<RecoveryCandidates|undefined>(undefined),inventoryRequest=useRef<Promise<void>|null>(null),sourceRef=useRef(''),openedEntry=useRef(''),forceCandidatesRefresh=useRef(false)
  const loadInventory=useCallback(()=>{
    if((inventoryRef.current&&Date.now()-Date.parse(inventoryRef.current.fetchedAt)<30*60*1000)||inventoryRequest.current)return
    setInventoryLoading(true);setInventoryError('')
    inventoryRequest.current=(async()=>{try {
      const force=forceCandidatesRefresh.current;forceCandidatesRefresh.current=false
      const response=await fetch(`/api/vbm/recovery/candidates${force?'?refresh=1':''}`,{cache:'no-store'}),data=await response.json()
      if(!response.ok)throw new Error(data.error||'Protected objects could not be loaded.')
      inventoryRef.current=data;setInventory(data)
    }catch(e){setInventoryError((e as Error).message)}finally{setInventoryLoading(false);inventoryRequest.current=null}})()
  },[])
  useEffect(()=>{
    if(!inventory)return
    const timer=setTimeout(()=>{inventoryRef.current=undefined;loadInventory()},Math.max(1000,30*60*1000-(Date.now()-Date.parse(inventory.fetchedAt))))
    return()=>clearTimeout(timer)
  },[inventory,loadInventory])
  const refreshRequest=useRef<{controller:AbortController;promise:Promise<void>}|undefined>(undefined)
  const refresh=useCallback(()=>{
    if(refreshRequest.current)return refreshRequest.current.promise
    const controller=new AbortController()
    const promise=(async()=>{
    setLoading(true)
    try {const data=await recoveryGet<{sessions:RecoverySession[];sourceName:string;hasMore:boolean;nextOffset:number}>({action:'sessions',limit:200},controller.signal);if(controller.signal.aborted)return;setSessions(data.sessions);setHasMore(data.hasMore);setNextOffset(data.nextOffset);setSourceName(data.sourceName);setError('')
      if(sourceRef.current&&sourceRef.current!==data.sourceName){inventoryRef.current=undefined;setInventory(undefined)}sourceRef.current=data.sourceName
    }catch(e){if(!controller.signal.aborted)setError((e as Error).message)}finally{if(refreshRequest.current?.controller===controller){refreshRequest.current=undefined;setLoading(false)}}
})()
    refreshRequest.current={controller,promise}
    return promise
  },[])
  useEffect(()=>{void refresh();return()=>{refreshRequest.current?.controller.abort();refreshRequest.current=undefined}},[refresh])
  useEffect(()=>{if(nextOffset>200)return;const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer)},[refresh,nextOffset])
  useEffect(()=>{
    const key=params.toString(),workload=workloadSchema.safeParse(params.get('workload')),type=objectType.safeParse(params.get('type'))
    if(key&&key!==openedEntry.current&&workload.success){openedEntry.current=key;setEntry({workload:workload.data,objectId:params.get('objectId')||undefined,pointId:params.get('pointId')||undefined,type:type.success?type.data:undefined})}
  },[params])
  const filtered=useMemo(()=>sessions.filter(session=>(status==='all'||stateOf(session)===status)&&(workloadFilter==='all'||session.workload===workloadFilter)&&[session.id,session.name,session.context?.object.displayName,session.organization,session.initiatedBy].filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>new Date(b.creationTime||0).getTime()-new Date(a.creationTime||0).getTime()),[sessions,status,workloadFilter,query])
  const current=Math.min(page,Math.max(0,Math.ceil(filtered.length/15)-1)),counts=recoverySummary(sessions)
  const date=(value?:string)=>value&&Number.isFinite(new Date(value).getTime())?formatDate(value,{dateStyle:'medium',timeStyle:'short'}):'—'
  const manualRefresh=()=>{inventoryRef.current=undefined;setInventory(undefined);forceCandidatesRefresh.current=true;void refresh();loadInventory()}
  const loadMore=async()=>{setLoadingMore(true);try{const data=await recoveryGet<{sessions:RecoverySession[];hasMore:boolean;nextOffset:number}>({action:'sessions',offset:nextOffset,limit:200});setSessions(old=>[...new Map([...old,...data.sessions].map(session=>[session.id,session])).values()]);setHasMore(data.hasMore);setNextOffset(data.nextOffset)}catch(e){setError((e as Error).message)}finally{setLoadingMore(false)}}
  const close=()=>{setEntry(null);setPreparing(false);void refresh()}
  return <main className={ops.console+' '+css.shell}>
    <header className={ops.header+' '+css.header}>
      <div><h1>{t('Recovery Center')}</h1><p className={css.muted+' '+css.source}><Server size={13}/>{sourceName||t('Your recovery workspace for Microsoft 365')}</p></div>
      <div className={css.actions}><Button variant="outline" size="sm" disabled={loading} onClick={manualRefresh}><RefreshCw size={15} className={loading?css.spinner:undefined}/>{t('Refresh')}</Button>{!preparing&&<Button size="sm" onClick={()=>setEntry({})}><RotateCcw size={15}/>{t('Start recovery')}</Button>}</div>
    </header>
    <SourceActivityNotice sourceName={sourceName}/>
    {error&&<div className={css.error} role="alert">{error}</div>}
    <section className={recovery.metrics+' '+css.summary} aria-label={t('Recovery status')}>
      {recoveryFilters.map(key=>{const Icon=summaryIcons[key];return <button key={key} className={recovery.metric} data-tone={key} aria-pressed={status===key} onClick={()=>{setStatus(key);setPage(0)}}><span className={recovery.metricLabel}><Icon size={16}/>{t(recoveryLabels[key])}</span><strong>{sourceName?formatNumber(counts[key]):'—'}</strong></button>})}
    </section>
    {entry&&<RecoveryPicker entry={entry} inventory={inventory} inventoryLoading={inventoryLoading} inventoryError={inventoryError} onLoadInventory={loadInventory} onClose={close} onPreparing={setPreparing}/>}
    <section className={css.panel}>
      <header className={css.panelHeader}><h2>{t('Recovery sessions')}</h2><span className={css.muted}>{t('{count} sessions loaded',{count:sessions.length})}</span></header>
      <FilterWorkspace label="Recovery session filters" activeCount={Number(!!query)+Number(status!=='all')+Number(workloadFilter!=='all')} onClear={()=>{setQuery('');setStatus('all');setWorkloadFilter('all');setPage(0)}} search={<label className={css.search}><Search size={15}/><input aria-label={t('Search recovery sessions')} placeholder={t('Search objects, organizations or initiators')} value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>} filters={<><FilterSelect label="Workload" value={workloadFilter} onValueChange={value=>{setWorkloadFilter(value);setPage(0)}}><option value="all">{t('All workloads')}</option>{workloads.map(value=><option key={value}>{value}</option>)}</FilterSelect><FilterSelect label="Status" value={status} onValueChange={value=>{setStatus(value);setPage(0)}}>{recoveryFilters.map(key=><option key={key} value={key}>{t(recoveryLabels[key])}</option>)}</FilterSelect></>}>
        {loading&&!sessions.length&&!error?<div className={css.empty}><DataLoading status={t('Loading recovery sessions…')} compact/></div>:!filtered.length?<div className={css.empty}><FolderOpen size={36}/><strong>{t(sessions.length?'No sessions match these filters.':'Your next recovery starts here')}</strong><span>{t(sessions.length?'Change your search or filters to see more sessions.':'Choose what you need back to open its backup, explore items and start a restore.')}</span></div>:<div className={css.scroll}>
          <table className={css.table} aria-label={t('Recovery sessions')}>
            <thead><tr><th scope="col">{t('Object / session')}</th><th scope="col">{t('Workload')}</th><th scope="col">{t('Status')}</th><th scope="col">{t('Started')}</th><th scope="col">{t('Ended')}</th><th scope="col"><span className="sr-only">{t('Details')}</span></th></tr></thead>
            <tbody>{filtered.slice(current*15,current*15+15).map(session=>{
              const Icon=recoveryGoals[session.workload].icon,expanded=expandedSession===session.id
              return <Fragment key={session.id}>
                <tr data-expanded={expanded}>
                  <td><Link className={css.sessionLink} href={sessionHref(session)}><Icon size={20}/><span><strong title={session.name}>{session.context?.object.displayName||session.name}</strong><small><code title={`${t('Session ID')} · ${session.id}`}>{recoverySessionReference(session.id)}</code> · {session.parentSessionId?t('Item restore'):session.organization||session.initiatedBy||session.name}</small>{stateOf(session)==='attention'&&session.details&&<small className={css.sessionFailure} title={session.details}>{session.details}</small>}</span></Link><SessionStopFeedback session={session} inline/></td>
                  <td>{session.workload}</td><td><span className={recovery.badge} data-tone={stateOf(session)}>{session.state==='Stopped'?t(session.result||'Stopped'):t(session.state)}</span></td><td className={css.date}>{date(session.creationTime)}</td><td className={css.date}>{date(recoveryEndTime(session))}</td>
                  <td><div className={css.sessionActions}><Button size="sm" variant="ghost" aria-label={t('Session log')} aria-expanded={expanded} aria-controls={'session-log-'+session.id} onClick={()=>setExpandedSession(expanded?undefined:session.id)}><FileText size={14}/>{t('Details')}<ChevronDown size={14} className={expanded?css.expandedChevron:undefined}/></Button><SessionStopControl session={session} menu feedback={false} href={sessionHref(session)} operation={!!session.parentSessionId} onStopped={()=>void refresh()} disabledReason={sessions.some(child=>child.parentSessionId===session.id&&child.state!=='Stopped')?'Wait for recovery operations to finish before ending browsing.':undefined}/></div></td>
                </tr>
                {expanded&&<tr className={css.logRow}><td colSpan={6}><div id={'session-log-'+session.id}><SessionPreview session={session}/></div></td></tr>}
              </Fragment>
            })}</tbody>
          </table>
        </div>}
        <footer className={css.footer}><span>{t('Times shown in your local time zone')}</span><div className={css.row}>{hasMore&&<Button variant="outline" size="sm" disabled={loadingMore} onClick={loadMore}>{loadingMore&&<Loader2 size={13} className={css.spinner}/>} {t('Load older sessions')}</Button>}<Button variant="ghost" size="sm" disabled={!current} onClick={()=>setPage(current-1)}>{t('Previous')}</Button><span>{current+1} / {Math.max(1,Math.ceil(filtered.length/15))}</span><Button variant="ghost" size="sm" disabled={(current+1)*15>=filtered.length} onClick={()=>setPage(current+1)}>{t('Next')}</Button></div></footer>
      </FilterWorkspace>
    </section>
  </main>
}

type PreviewData={session:RecoverySession;events:JsonRecord[];warnings?:string[];hasMore?:boolean}
function SessionPreview({session}:{session:RecoverySession}) {
  const {t}=useI18n(),[data,setData]=useState<PreviewData>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0)
  useEffect(()=>{
    const controller=new AbortController()
    let timer:ReturnType<typeof setTimeout>
    const load=async()=>{
      setLoading(true)
      try {
        const value=await recoveryGet<PreviewData>({action:'session',sessionId:session.id,limit:50},controller.signal)
        if(controller.signal.aborted)return
        setData(value);setError('')
        if(value.session.state!=='Stopped')timer=setTimeout(()=>void load(),10000)
      }catch(e){if(!controller.signal.aborted)setError((e as Error).message)}
      finally{if(!controller.signal.aborted)setLoading(false)}
    }
    void load()
    return()=>{controller.abort();clearTimeout(timer)}
  },[session.id,revision])
  return <section className={css.sessionDetails} aria-label={t('Session log')}>
    <header className={css.logToolbar}><h3><FileText size={15}/>{t('Session log')}</h3><div className={css.actions}><Button variant="ghost" size="sm" disabled={loading} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={14} className={loading?css.spinner:undefined}/>{t('Refresh')}</Button><Button asChild variant="outline" size="sm"><Link href={sessionHref(session)}>{t('Open session')}<ArrowRight size={14}/></Link></Button></div></header>
    {error&&<p className={css.error} role="alert">{error}</p>}
    {data?.session.details&&<p className={css.notice}>{data.session.details}</p>}
    {data?.warnings?.map(warning=><p key={warning} className={css.notice}>{warning}</p>)}
    {loading&&!data?<DataLoading status={t('Opening recovery workspace…')} compact/>:data&&<RecoveryEventLog events={data.events}/>}
    {data?.hasMore&&<Link className={css.moreEvents} href={sessionHref(session).split('#')[0]+'#log'}>{t('Load more events')}<ArrowRight size={14}/></Link>}
  </section>
}
