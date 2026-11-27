'use client'
// Open Backup UI v1.3.0
import { Fragment,useCallback,useEffect,useMemo,useRef,useState } from 'react'
import Link from 'next/link'
import { Activity,ArrowLeft,Check,ChevronDown,CircleAlert,Clock,FileText,FolderOpen,Globe,HardDrive,Inbox,Loader2,RefreshCw,ShoppingCart,Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataLoading } from '@/components/ui/data-loading'
import ops from '@/components/operations/operations.module.css'
import { useI18n } from '@/components/providers/i18n-provider'
import type { JsonRecord,OperationReceipt,RecoveryContext,RecoverySession } from '@/lib/vbm-recovery/model'
import { RecoveryRequestError,recoveryGet } from './client'
import { SessionStopControl,SessionStopFeedback,useSessionStop } from './stop-session'
import { recoveryDurationSeconds,recoverySessionReference } from '@/lib/vbm-recovery/presentation'
import { type CartEntry,type ExplorerAvailability,ExplorerState,RecoveryBrowser,itemKey } from './browser'
import { RecoveryCart } from './cart'
import { BrowseActivityLog } from './browse-activity'
import type { BrowseActivityEvent,BrowseActivityAvailability } from '@/lib/vbm-recovery/browse-activity'
import { RecoveryEventLog,recoveryStatusTone } from './session-events'
import { ProviderRestoreSummary, RestoreAuditLog } from './restore-summary'
import { restoreItemResults, restoreResultCounts } from '@/lib/vbm-recovery/restore-results'
import type { RestoreAuditEntry } from '@/lib/vbm-recovery/restore-audit'
import css from './workspace.module.css'
import feedback from './restore-feedback.module.css'

type SessionData={historyLoaded?:boolean;browseCacheId?:string;restoreAudit?:RestoreAuditEntry[];restoreAuditAvailability?:'available'|'unavailable';applicationActivity?:BrowseActivityEvent[];activityAvailability?:BrowseActivityAvailability;session:RecoverySession;context?:RecoveryContext;statistics:JsonRecord|null;statisticsAvailability?:'notRequested'|'available'|'afterCompletion'|'unavailable';events:JsonRecord[];hasMore?:boolean;nextOffset?:number;warnings?:string[]}
const messages=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&!!item.trim()):[]
const eventKey=(event:JsonRecord)=>event.id!==undefined?`id:${event.id}`:event.order!==undefined?`order:${event.order}`:JSON.stringify(event)
type WorkspaceOperation=Omit<OperationReceipt,'status'> & {status:OperationReceipt['status']|'requested'; requestId?:string; rowKey?:string; itemName?:string; auditEntry?:RestoreAuditEntry}
const auditNotice='The application could not save the complete restore audit. Check the Veeam session log.'
const cleanupNotice='The operator explorer could not confirm it had stopped. Check its status in Recovery Center.'
export function submissionNotices(notice?:string) {
  if(notice===cleanupNotice+' '+auditNotice)return [cleanupNotice,auditNotice]
  if(notice===cleanupNotice || notice===auditNotice)return [notice]
  return []
}

export function operationsFromAudit(id:string,live:WorkspaceOperation[],entries:RestoreAuditEntry[]) {
  const operations=[...live]
  const selectionKey=(requestId:string|undefined,ids:string[])=>JSON.stringify([requestId,[...ids].sort()])
  const scoped=entries.filter(entry=>entry.browseSessionId===id).map(entry=>{
    const itemIds=entry.selection.map(item=>item.id)
    return {entry,itemIds,key:selectionKey(entry.requestId,itemIds)}
  })
  const auditGroups=new Map<string,number>()
  for(const {key} of scoped)auditGroups.set(key,(auditGroups.get(key)??0)+1)
  for(const {entry,itemIds,key} of scoped) {
    const child=entry.sessionId ? operations.findIndex(receipt=>receipt.sessionId===entry.sessionId) : -1
    // Equal item IDs can occur in different mailboxes. Reconcile an untracked receipt only for a unique audit group.
    const candidates=auditGroups.get(key)===1 ? operations.flatMap((receipt,index)=>
      !receipt.auditEntry && !(receipt.sessionId && entry.sessionId) && selectionKey(receipt.requestId,receipt.itemIds)===key ? [index] : []) : []
    const request=candidates.length===1 ? candidates[0] : -1
    const match=request>=0 ? request : child
    const existing=operations[match]
    // An interrupted audit update can leave a pending entry after a definitive Veeam response.
    const confirmedReceipt=existing && existing.status!=='requested' && existing.status!=='unknown' ? existing : undefined
    const status=existing?.sessionId || entry.sessionId ? 'accepted'
      : entry.status==='requested' || entry.status==='unknown' ? confirmedReceipt?.status ?? entry.status : entry.status
    const receipt:WorkspaceOperation={...existing,group:existing?.group||entry.workload,itemIds,itemCount:itemIds.length,status,
      error:status===existing?.status ? existing.error : undefined,
      itemName:entry.selection.find(item=>item.name && item.name!==item.id)?.name || existing?.itemName,
      sessionId:entry.sessionId||existing?.sessionId,requestId:entry.requestId,auditEntry:entry}
    if(match>=0)operations[match]=receipt
    else operations.push(receipt)
    // Session discovery and submission can deliver separate rows before the audit links the request to its child.
    if(child>=0 && request>=0 && child!==request)operations.splice(child,1)
  }
  return operations
}

export function presentSubmission(receipts:OperationReceipt[],cart:CartEntry[],requestId?:string,notice?:string) {
  const namesByKey=new Map(cart.map(item=>[itemKey(item),item.name!==item.id ? item.name : undefined]))
  const namesById=new Map<string,string|undefined>()
  for(const item of cart)namesById.set(item.id,namesById.has(item.id) ? undefined : namesByKey.get(itemKey(item)))
  const notices=submissionNotices(notice)
  const allUnsent=receipts.length>0 && receipts.every(receipt=>receipt.status==='notSubmitted' && !receipt.sessionId)
  const auditBlocked=notices.includes(auditNotice) && allUnsent
  const operations=receipts.map((receipt,index)=>{
    const names=receipt.itemKeys?.length ? receipt.itemKeys.map(key=>namesByKey.get(key)) : receipt.itemIds.map(id=>namesById.get(id))
    return {...receipt,requestId,rowKey:JSON.stringify([requestId,receipt.group,receipt.itemIds]),
      itemName:names.find(Boolean),error:receipt.error || (auditBlocked && index===0 ? 'The restore audit could not be saved.' : undefined)}
  })
  const remainingNotices=auditBlocked ? notices.filter(message=>message!==auditNotice) : notices
  const cartError=allUnsent && remainingNotices.length===0
    ? operations[0].error || 'Review the recovery cart before retrying.'
    : undefined
  return {operations,notices:remainingNotices,cartError}
}

export function operationStatus(receipt:WorkspaceOperation,session?:RecoverySession) {
  if(session?.state==='Stopped')return session.result || receipt.auditEntry?.outcome?.result || 'Stopped'
  if(receipt.auditEntry?.outcome)return receipt.auditEntry.outcome.result || 'Stopped'
  if(receipt.sessionId || receipt.status==='accepted')return session?.state || 'Accepted'
  if(receipt.status==='requested')return 'Waiting for Veeam'
  return receipt.status==='unknown' ? 'Restore status unknown' : receipt.status==='notSubmitted' ? 'Not submitted' : 'Failed'
}
function mergeEvents(previous:JsonRecord[],incoming:JsonRecord[]) {
  const merged=new Map(previous.map(event=>[eventKey(event),event]))
  for(const event of incoming)merged.set(eventKey(event),event)
  return [...merged.values()].sort((a,b)=>typeof a.order==='number'&&typeof b.order==='number'?a.order-b.order:0)
}
export function RecoverySessionWorkspace({id}:{id:string}) {
  const {t,formatDate}=useI18n(),[data,setData]=useState<SessionData>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[loadingEvents,setLoadingEvents]=useState(false),[tab,setTab]=useState('browse'),[cart,setCart]=useState<CartEntry[]>([]),[operations,setOperations]=useState<WorkspaceOperation[]>([]),[active,setActive]=useState(0)
  const [notices,setNotices]=useState<string[]>([])
  const [explorerAvailability,setExplorerAvailability]=useState<ExplorerAvailability>()
  const tabRef=useRef(tab);tabRef.current=tab
  const initialSession=useRef(true)
  const workspaceScope=useRef<string|undefined>(undefined)
  const stop=useSessionStop({id,state:data?.session.state || 'Unknown'},false)
  const clearScope=useCallback(()=>{
    initialSession.current=true
    workspaceScope.current=undefined
    setData(undefined)
    setExplorerAvailability(undefined)
    setCart([])
    setOperations([])
    setNotices([])
    setActive(0)
  },[])
  const refreshRequest=useRef<{controller:AbortController;promise:Promise<void>}|undefined>(undefined)
  const refresh=useCallback(()=>{
    if(refreshRequest.current)return refreshRequest.current.promise
    const controller=new AbortController()
    const promise=(async()=>{
      setLoading(true)
      try {
        const read=(view?:'workspace'|'operations')=>recoveryGet<SessionData>({action:'session',sessionId:id,...(view?{view}:{})},controller.signal)
        const applyScope=(value:SessionData)=>{
          const scope=JSON.stringify([value.session.id,value.browseCacheId])
          if(workspaceScope.current!==undefined && workspaceScope.current!==scope && value.session.state!=='Stopped')clearScope()
          workspaceScope.current=scope
          if(initialSession.current) {
            initialSession.current=false
            if(!value.context&&!value.session.context&&!window.location.hash){tabRef.current='log';setTab('log')}
          }
        }
        if(workspaceScope.current===undefined) {
          const head=await read('workspace')
          if(controller.signal.aborted)return
          applyScope(head)
          setData({...head,events:[],statistics:null})
          setError('')
        }
        const includeHistory=tabRef.current==='log'
        const value=await read(includeHistory?undefined:'operations')
        if(controller.signal.aborted)return
        applyScope(value)
        setData(old=>{
          const previous=old?.session.id===value.session.id && old.browseCacheId===value.browseCacheId ? old : undefined
          if(!includeHistory)return {...previous,...value,statistics:previous?.statistics??null,events:previous?.events??[]}
          return {...value,historyLoaded:true,events:mergeEvents(previous?.events??[],value.events),nextOffset:Math.max(previous?.nextOffset||0,value.nextOffset||0),hasMore:(previous?.nextOffset||0)>(value.nextOffset||0)?previous?.hasMore:value.hasMore}
        })
        setError('')
      }catch(e) {
        if(controller.signal.aborted)return
        if(e instanceof RecoveryRequestError && [401,403,404,410].includes(e.status))clearScope()
        setError((e as Error).message)
      }finally {
        if(refreshRequest.current?.controller===controller){refreshRequest.current=undefined;setLoading(false)}
      }
    })()
    refreshRequest.current={controller,promise}
    return promise
  },[id,clearScope])
  useEffect(()=>{void refresh();return()=>{refreshRequest.current?.controller.abort();refreshRequest.current=undefined}},[refresh])
  useEffect(()=>{const choose=()=>{if(['#browse','#cart','#operations','#log'].includes(window.location.hash))setTab(window.location.hash.slice(1))};choose();window.addEventListener('hashchange',choose);return()=>window.removeEventListener('hashchange',choose)},[])
  // A tab switch can race the background operation check. Fetch the log once that check settles.
  useEffect(()=>{if(tab==='log' && data && !data.historyLoaded && !loading && !error)void refresh()},[tab,data,loading,error,refresh])
  const sessionScope=data && JSON.stringify([data.session.id,data.browseCacheId])
  const resetBrowseScope=useCallback(()=>{
    if(workspaceScope.current!==sessionScope)return
    refreshRequest.current?.controller.abort()
    refreshRequest.current=undefined
    clearScope()
    void refresh()
  },[sessionScope,clearScope,refresh])
  const selfReceipt=useMemo<WorkspaceOperation[]>(()=>{
    const child:WorkspaceOperation={group:id,itemName:data?.session.name,itemIds:[],itemCount:0,status:'accepted',sessionId:id}
    const audit=data?.restoreAudit?.find(entry=>entry.sessionId===id)
    return audit ? operationsFromAudit(audit.browseSessionId,[child],[audit]) : [child]
  },[id,data?.session.name,data?.restoreAudit])
  const sessionOperations=useMemo(()=>operationsFromAudit(id,operations,data?.restoreAudit||[]),[id,operations,data?.restoreAudit])
  const waitingForVeeam=sessionOperations.some(receipt=>receipt.status==='requested')
  useEffect(()=>{if(data?.session.state==='Stopped'&&!waitingForVeeam)return;const check=()=>{if(document.visibilityState==='visible')void refresh()};const timer=setInterval(check,10000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);return()=>{clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)}},[refresh,data?.session.state,waitingForVeeam])
  useEffect(()=>{
    let canceled=false
    if(!sessionScope)return
    recoveryGet<{sessions:RecoverySession[]}>({action:'sessions'}).then(result=>{if(!canceled)setOperations(old=>{const existing=new Set(old.flatMap(item=>item.sessionId?[item.sessionId]:[]));return [...old,...result.sessions.filter(session=>session.parentSessionId===id&&!existing.has(session.id)).map(session=>({group:session.id,itemName:session.name,itemIds:[],itemCount:0,status:'accepted' as const,sessionId:session.id}))]})}).catch(()=>{})
    return()=>{canceled=true}
  },[id,sessionScope])
  const add=(items:CartEntry[])=>setCart(old=>[...new Map([...old,...items].map(item=>[itemKey(item),item])).values()])
  const onSubmitted=(receipts:OperationReceipt[],notice?:string,requestId?:string)=>{
    if(workspaceScope.current!==sessionScope)return
    const {operations:submitted,notices:submissionMessages,cartError}=presentSubmission(receipts,cart,requestId,notice)
    setOperations(old=>[...submitted,...old.filter(previous=>!submitted.some(next=>next.sessionId && next.sessionId===previous.sessionId))])
    setNotices(submissionMessages)
    if(!cartError)setTab('operations')
    void refresh()
    return cartError
  }
  const unresolved=sessionOperations.filter(receipt=>receipt.status==='unknown').length
  const blockedSelection=sessionOperations.some(receipt=>(receipt.status==='requested' || receipt.status==='unknown') && cart.some(item=>receipt.itemIds.includes(item.id)))
  const loadMoreEvents=async()=>{
    if(!data||loadingEvents)return
    setLoadingEvents(true)
    try {const page=await recoveryGet<SessionData>({action:'session',sessionId:id,offset:data.nextOffset??data.events.length});setData(old=>old?.session.id===id && old.browseCacheId===page.browseCacheId?{...old,events:mergeEvents(old.events,page.events),nextOffset:Math.max(old.nextOffset||0,page.nextOffset||0),hasMore:page.hasMore}:old)}
    catch(e){setError((e as Error).message)}finally{setLoadingEvents(false)}
  }
  const fmt=(value?:string|null)=>value&&Number.isFinite(new Date(value).getTime())?formatDate(value,{dateStyle:'medium',timeStyle:'short'}):'—'
  const context=data?.context||data?.session.context
  const operationParent=data?.session.parentSessionId||data?.restoreAudit?.find(entry=>entry.sessionId===id && entry.browseSessionId!==id)?.browseSessionId
  const name=operationParent ? data?.session.name : context?.object.displayName||context?.object.name||data?.session.name
  const heading=<h1>{name && name!==id ? name : t('Recovery session')} <span className="whitespace-nowrap font-medium text-muted-foreground" title={`${t('Session ID')} · ${id}`}>· <code className="text-[0.8em]">{recoverySessionReference(id)}</code></span></h1>
  if(!data)return <div className={`${ops.console} ${css.shell}`}><Link href="/vbm/recovery-center" className={css.back}><ArrowLeft size={14}/>{t('Recovery Center')}</Link><header className={css.header}>{heading}</header><div className={css.panel}><div className={css.empty}>{error?<><strong>{error}</strong><Button onClick={refresh}>{t('Retry')}</Button></>:<DataLoading status={t('Opening recovery workspace…')}/>}</div></div></div>
  const session=data.session,ended=session.state==='Stopped'||stop.phase==='stopped',explorerLabel=explorerAvailability==='unavailable'?'Backup explorer unavailable':explorerAvailability==='loading'?'Opening backup explorer…':explorerAvailability==='partial'?'Some backup items are unavailable':explorerAvailability==='empty'?'No backed-up objects found':explorerAvailability?'Browsing':'Recovery session in progress',Icon={Exchange:Inbox,OneDrive:HardDrive,SharePoint:Globe,Teams:Users}[session.workload]
  const checkingOperations=data.restoreAuditAvailability===undefined
  const stopAcknowledged=stop.phase==='waiting'
  const browseClosed=ended || stopAcknowledged
  const showStopStatus=!ended && stop.requestedAt!==undefined
  if(operationParent)return <div className={`${ops.console} ${css.shell}`}><Link href={`/vbm/recovery-center/${operationParent}#operations`} className={css.back}><ArrowLeft size={14}/>{t('Back to recovery workspace')}</Link><header className={css.header}><div>{heading}<p className={css.sub}>{session.workload} · {t('Recovery operation')}</p></div></header><section className={css.panel}><div className={css.content}><Operations receipts={selfReceipt} setActive={setActive}/></div></section></div>
  return <div className={`${ops.console} ${css.shell}`}>
    <Link href="/vbm/recovery-center" className={css.back}><ArrowLeft size={14}/>{t('Recovery Center')}</Link>
    <header className={`${css.header} ${css.workspaceHeader}`}>
      <div>{heading}<p className={css.sub}>{session.workload} · {t('Recovery workspace')}{context?.sourceName?` · ${context.sourceName}`:''}</p></div>
      <div className={css.row}>
        <SessionStopControl session={session} feedback={false} onStopped={()=>void refresh()} disabledReason={checkingOperations?'Checking recovery operations…':unresolved?'Check the unconfirmed restore in Recovery Center before ending browsing.':waitingForVeeam||active>0?'Wait for recovery operations to finish before ending browsing.':undefined}/>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading?css.spin:''}/>{t('Refresh')}</Button>
      </div>
    </header>
    {error&&<div className={`${css.notice} ${css.error}`} role="alert">{error}</div>}{data.warnings?.filter(warning=>warning!=='Restore statistics are not available yet.').map(warning=><div key={warning} className={css.notice}>{warning}</div>)}
    {unresolved>0&&!ended&&<div className={css.notice} role="status">{t('A restore outcome is unconfirmed. The backup explorer stays open because that operation may still be running.')} <Link className={css.back} href="/vbm/recovery-center" target="_blank" rel="noopener noreferrer">{t('Check recovery sessions')} →</Link></div>}
    <section className={css.hero}><div className={css.heroIcon}><Icon size={26}/></div>
      <div className={css.heroInfo}><span className={css.sub}>{t('Current state')}</span>
        {showStopStatus ? <SessionStopFeedback session={session} className={css.stopSummary}/> : <>
          <strong role="status">{t(ended?'Recovery session ended':explorerLabel)}</strong>
          {ended && session.result && <span className={css.status} data-tone={recoveryStatusTone(session.result)}><i/>{t(session.result)}</span>}
          {session.details ? <p className={css.sub}>{session.details}</p> : !ended && <span className={css.sub}>{t(explorerAvailability==='unavailable'?'The backup could not be opened. Review the session log or retry browsing.':'Your backup selection stays with this workspace.')}</span>}
        </>}
      </div>
      <dl className={css.facts}><div><dt>{t('Started')}</dt><dd>{fmt(session.creationTime)}</dd></div>{context?.point.backupTime&&<div><dt>{t('Restore point')}</dt><dd>{fmt(context.point.backupTime)}</dd></div>}{session.initiatedBy&&<div><dt>{t('Initiated by')}</dt><dd>{session.initiatedBy}</dd></div>}</dl>
    </section>
    <section className={css.panel}>{active>0&&<div className={css.activityStrip}><Loader2 size={16} className={css.spin}/><span>{t('{count} recovery operations in progress',{count:active})}</span><button onClick={()=>setTab('operations')}>{t('View progress')} →</button></div>}
      <div className={css.tabs} role="tablist" aria-label={t('Recovery workspace')}>
        {[{id:'log',label:'Session log',icon:FileText,count:null},{id:'browse',label:'Explore backup',icon:FolderOpen,count:null},{id:'operations',label:'Restores',icon:Activity,count:checkingOperations?null:sessionOperations.length},{id:'cart',label:'Recovery cart',icon:ShoppingCart,count:cart.length}].map(item=><button key={item.id} role="tab" id={`tab-${item.id}`} aria-controls={`panel-${item.id}`} aria-selected={tab===item.id} className={css.tab} onClick={()=>setTab(item.id)}><item.icon size={16}/>{t(item.label)}{item.count!==null&&<span className={css.count}>{item.count}</span>}</button>)}
      </div>
      <div id="panel-browse" aria-labelledby="tab-browse" role="tabpanel" hidden={tab!=='browse'} className={css.content}>
        {stopAcknowledged && !ended ? <Button size="sm" variant="outline" onClick={()=>setTab('log')}><FileText size={14}/>{t('View session log')}</Button> : browseClosed
          ? <ExplorerState kind="ended" onViewLog={()=>setTab('log')}/>
          : !context&&checkingOperations ? <p className={css.notice} role="status">{t('Checking recovery operations…')}</p>
          : (context||tab==='browse'||explorerAvailability) && <RecoveryBrowser key={sessionScope} sessionId={id} browseCacheId={data.browseCacheId} onScopeChange={resetBrowseScope}
              workload={session.workload} active={tab==='browse'} workingSince={session.state==='Working'?session.creationTime:undefined} context={context}
              cart={cart} onAdd={add} onReview={()=>setTab('cart')} ended={false} onAvailabilityChange={setExplorerAvailability} onViewLog={()=>setTab('log')}/>}
      </div>
      <div id="panel-cart" aria-labelledby="tab-cart" role="tabpanel" hidden={tab!=='cart'} className={css.content}><RecoveryCart key={sessionScope} mailboxScoped={context?.object.type==='User'} sessionId={id} workload={session.workload} entries={cart} remove={keys=>setCart(old=>old.filter(item=>!keys.includes(itemKey(item))))} clear={()=>setCart([])} onSubmitted={onSubmitted} checkingOperations={checkingOperations} submissionBlocked={blockedSelection} ended={browseClosed}/></div>
      <div id="panel-operations" aria-labelledby="tab-operations" role="tabpanel" hidden={tab!=='operations'} className={css.content}>{data.restoreAuditAvailability==='unavailable'&&!notices.includes(auditNotice)&&<p className={css.notice} role="status">{t('Some restore audit records could not be loaded.')}</p>}{notices.map(notice=><p role="status" className={css.notice} key={notice}>{t(notice)}</p>)}{checkingOperations ? <p className={css.notice} role="status">{t('Checking recovery operations…')}</p> : <Operations key={sessionScope} receipts={sessionOperations} setActive={setActive} browseFailure={ended && session.result?.toLowerCase()==='failed' ? session.details : undefined}/>}</div>
      <div id="panel-log" aria-labelledby="tab-log" role="tabpanel" hidden={tab!=='log'} className={css.content}>
        {!data.historyLoaded ? <p className={css.notice} role="status">{error||t('Loading session history…')}</p> : <>
          <RecoveryEventLog events={data.events}/>
          {data.hasMore && <Button size="sm" variant="outline" disabled={loadingEvents} onClick={loadMoreEvents}>
            {loadingEvents && <Loader2 size={13} className={css.spin}/>} {t('Load more events')}
          </Button>}
          <BrowseActivityLog events={data.applicationActivity||[]} availability={data.activityAvailability}/>
        </>}
      </div>
    </section><div className={css.foot}><span>{t('Microsoft 365 recovery')} · {session.id}</span><span>{t('Times shown in your local time zone')}</span></div>
  </div>
}
function sessionDuration(session?: RecoverySession) {
  const seconds=session?recoveryDurationSeconds(session):undefined
  if(seconds===undefined)return '—'
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(value=>String(value).padStart(2,'0')).join(':')
}

/** A stopped session can precede its final statistics/events becoming readable. */
export function createFinalDiagnosticsRetryPolicy() {
  const attempts=new Map<string,number>()
  return {
    shouldRead(id:string,value:SessionData|undefined,failedRead=false) {
      if(!value || value.session.state!=='Stopped')return true
      const incomplete=failedRead || value.statistics===null || value.statisticsAvailability==='unavailable' || value.statisticsAvailability==='afterCompletion' || value.warnings?.includes('Session events could not be loaded.')
      return !!incomplete && (attempts.get(id)||0)<3
    },
    attempted(id:string,value:SessionData|undefined) {if(value?.session.state==='Stopped')attempts.set(id,(attempts.get(id)||0)+1)},
    reset(id:string) {attempts.delete(id)},
  }
}

export function Operations({ receipts, setActive, browseFailure }: { receipts: WorkspaceOperation[]; setActive: (count: number) => void; browseFailure?: string }) {
  const { t, formatDate } = useI18n()
  const [states, setStates] = useState<Record<string, SessionData>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [loadingEvents, setLoadingEvents] = useState<Record<string, boolean>>({})
  const [checkedAt,setCheckedAt]=useState<Record<string,number>>({})
  const [refreshing,setRefreshing]=useState<Record<string,boolean>>({})
  const [now,setNow]=useState(Date.now)
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer)},[])
  const latestStates = useRef(states); latestStates.current = states
  const latestErrors = useRef(errors); latestErrors.current = errors
  const [finalDiagnostics]=useState(createFinalDiagnosticsRetryPolicy)
  const readRequests=useRef(new Map<string,{controller:AbortController;promise:Promise<void>}>())
  const mergeSession = useCallback((key: string, value: SessionData) => {
    setCheckedAt(old=>({...old,[key]:Date.now()}))
    setStates(old => ({ ...old, [key]: old[key] ? { ...value, events: mergeEvents(old[key].events, value.events), nextOffset: Math.max(old[key].nextOffset || 0, value.nextOffset || 0), hasMore: (old[key].nextOffset || 0) > (value.nextOffset || 0) ? old[key].hasMore : value.hasMore } : value }))
  }, [])
  const refreshOperation=useCallback((id:string,manual=false)=>{
    const existing=readRequests.current.get(id)
    if(existing)return existing.promise
    if(manual)finalDiagnostics.reset(id)
    finalDiagnostics.attempted(id,latestStates.current[id])
    const controller=new AbortController()
    setRefreshing(old=>({...old,[id]:true}))
    const promise=(async()=>{
      try {
        const value=await recoveryGet<SessionData>({action:'session',sessionId:id,includeStatistics:'true'},controller.signal)
        if(!controller.signal.aborted){mergeSession(id,value);setErrors(old=>({...old,[id]:''}))}
      }catch(e){if(!controller.signal.aborted)setErrors(old=>({...old,[id]:(e as Error).message}))}
      finally {
        if(readRequests.current.get(id)?.controller===controller)readRequests.current.delete(id)
        if(!controller.signal.aborted)setRefreshing(old=>({...old,[id]:false}))
      }
    })()
    readRequests.current.set(id,{controller,promise})
    return promise
  },[finalDiagnostics,mergeSession])
  useEffect(()=>{const requests=readRequests.current;return()=>{requests.forEach(request=>request.controller.abort());requests.clear()}},[])
  useEffect(() => {
    const load = async () => {
      await Promise.all(receipts.filter(receipt=>receipt.sessionId&&finalDiagnostics.shouldRead(receipt.sessionId,latestStates.current[receipt.sessionId],!!latestErrors.current[receipt.sessionId])).map(receipt=>refreshOperation(receipt.sessionId!)))
    }
    const check=()=>{if(document.visibilityState==='visible')void load()}
    void load(); const timer = setInterval(check, 10000)
    window.addEventListener('focus',check);document.addEventListener('visibilitychange',check)
    return () => { clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check) }
  }, [receipts,finalDiagnostics,refreshOperation])
  useEffect(() => setActive(receipts.filter(receipt => receipt.sessionId && !receipt.auditEntry?.outcome && states[receipt.sessionId]?.session.state !== 'Stopped').length), [receipts, states, setActive])
  const loadMoreEvents = async (key: string) => {
    const current = states[key]
    if (!current || loadingEvents[key]) return
    setLoadingEvents(old => ({ ...old, [key]: true }))
    try {
      const page = await recoveryGet<SessionData>({ action: 'session', sessionId: key, includeStatistics: 'true', offset: current.nextOffset ?? current.events.length })
      setStates(old => old[key] ? { ...old, [key]: { ...old[key], events: mergeEvents(old[key].events, page.events), nextOffset: Math.max(old[key].nextOffset || 0, page.nextOffset || 0), hasMore: page.hasMore } } : old)
    } catch (e) { setErrors(old => ({ ...old, [key]: (e as Error).message })) }
    finally { setLoadingEvents(old => ({ ...old, [key]: false })) }
  }
  if (!receipts.length) return <div className={css.empty}><Activity size={30} /><span>{t('Restores started here will appear in this tab. You can keep browsing while they run.')}</span></div>
  const initiallyLoading = receipts.some(receipt => receipt.sessionId && !states[receipt.sessionId] && !errors[receipt.sessionId])
  return <>
    {initiallyLoading && <div className={css.sessionLoading}><DataLoading status={t('Loading recovery sessions…')} compact /></div>}
    <div className={css.sessionScroll}><table className={css.sessionTable} aria-label={t('Restores')}>
      <thead><tr><th scope="col">{t('Restore')}</th><th scope="col">{t('Status')}</th><th scope="col">{t('Progress')}</th><th scope="col">{t('Started')}</th><th scope="col">{t('Duration')}</th><th scope="col"><span className="sr-only">{t('Actions')}</span></th></tr></thead>
      <tbody>{receipts.map((receipt, index) => {
        const key = receipt.sessionId || receipt.rowKey || receipt.auditEntry?.id || receipt.group
        const value = receipt.sessionId ? states[receipt.sessionId] : undefined, stats = value?.statistics || {}
        const childAudit=value?.restoreAudit?.find(entry=>entry.sessionId===receipt.sessionId && entry.outcome)
        const outcome=childAudit?.outcome ?? receipt.auditEntry?.outcome
        const providerCounts=restoreResultCounts(value?.statistics)
        const total=providerCounts.total ?? outcome?.counts.total, restored=providerCounts.restored ?? outcome?.counts.restored
        const failed=providerCounts.failed ?? outcome?.counts.failed, skipped=providerCounts.skipped ?? outcome?.counts.skipped
        const hasCounts=[total,restored,failed,skipped].some(count=>count!==undefined)
        const done = restored !== undefined && failed !== undefined && skipped !== undefined ? restored + failed + skipped : undefined
        const ended=value?.session.state==='Stopped' || !!outcome
        const isExpanded=expanded[key] ?? false
        const running = !!value?.session && !ended, percent = total && done!==undefined ? Math.min(100, Math.round(done / total * 100)) : null
        const status=operationStatus(receipt,value?.session)
        const tone=receipt.status==='requested' ? 'active' : recoveryStatusTone(status)
        const eventFailures=(value?.events||[]).filter(event=>/failed|error/i.test(String(event.status||event.result||''))).map(event=>String(event.message||event.title||'')).filter(message=>message&&!/^Restore session failed\.?$/i.test(message))
        const itemError=tone==='error' ? restoreItemResults(value?.statistics,[]).find(item=>item.error)?.error : undefined
        const failureMessages = [...new Set([receipt.error || receipt.auditEntry?.error, ...messages(stats.errors),itemError,...eventFailures.slice().reverse(),tone==='error' ? value?.session.details : undefined].filter((message): message is string => !!message))]
        const submissionMessage=receipt.error || receipt.auditEntry?.error
        const genericUnknown=receipt.status==='unknown' && (submissionMessage==='The operation outcome is unconfirmed. Check restore sessions before retrying.' || submissionMessage==='The restore outcome is unconfirmed. Check restore sessions before retrying.')
        const rowMessage=genericUnknown ? undefined : submissionMessage ? t(submissionMessage) : failureMessages[0] ||
          (receipt.status==='notSubmitted' ? t('Review the recovery cart before retrying.') : receipt.status==='failed' ? t('No result message reported.') : undefined)
        const eventTime=(event?:JsonRecord)=>{for(const field of [event?.endTime,event?.startTime]){const date=new Date(String(field||'')),ms=date.getTime();if(Number.isFinite(ms)&&date.getUTCFullYear()<9999&&ms<=now)return ms}return NaN}
        const lastEvent=(value?.events||[]).slice().sort((a,b)=>(eventTime(b)||0)-(eventTime(a)||0))[0]
        const lastEventLabel=lastEvent?String(lastEvent.title||lastEvent.message||''):''
        const lastTime=Number.isFinite(eventTime(lastEvent))?eventTime(lastEvent):Date.parse(value?.session.creationTime||'')
        const completeEvents=!value?.hasMore&&!value?.warnings?.includes('Session events could not be loaded.')&&!errors[key]
        const quietMinutes=running&&completeEvents&&Number.isFinite(lastTime)?Math.max(0,Math.floor((now-lastTime)/60000)):0
        const warnings = [...new Set([...(errors[key]?[errors[key]]:[]),...messages(stats.warnings), ...(value?.warnings || [])])]
        const started = value?.session.creationTime
        const detailsId = `operation-details-${receipt.sessionId || index}`
        return <Fragment key={key}>
          <tr data-expanded={isExpanded}>
            <td><div className={css.sessionIdentity}>
              {receipt.status==='requested' || (running && quietMinutes<2) ? <Loader2 size={17} className={css.spin}/> : tone==='success' ? <Check size={17}/> : tone==='error' || tone==='warning' || receipt.status==='notSubmitted' ? <CircleAlert size={17}/> : <Clock size={17}/>}
              <div><strong>{receipt.itemName || value?.session.name || t('Item restore')}</strong>
                {receipt.itemCount>1 && <span className={css.sub}>{t('{count} selected',{count:receipt.itemCount})}</span>}
                {rowMessage && <span className={`${css.sessionMessage} ${tone==='error' ? css.error : ''}`}>{rowMessage}</span>}
                {receipt.status==='unknown' && <>
                  <span className={css.sessionMessage}>{t('No restore session ID was recorded. Check the destination and Veeam restore history before retrying.')}</span>
                  {browseFailure && <span className={css.sessionMessage}><strong>{t('Browse session failed')}</strong> · {browseFailure}</span>}
                </>}
                {running && quietMinutes>=2 && <span className={feedback.quiet}>{t('No new events for {minutes} min',{minutes:quietMinutes})}</span>}
                {!rowMessage && !isExpanded && warnings.length>0 && <span className={css.sessionMessage}>{t('Warning')}: {warnings[0]}</span>}
              </div></div></td>
            <td><span className={css.status} data-tone={tone}><i />{t(status)}</span></td>
            <td className={css.sessionProgress}>
              {percent!==null && done!==undefined && total!==undefined ? <>
                <span>{t('{done} / {total} items processed',{done,total})}</span>
                {running && <div className={css.bar} role="progressbar" aria-label={t('Items processed')} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{width:percent+'%'}}/></div>}
              </> : hasCounts ? <span>{t('Restored {restored} · Skipped {skipped} · Failed {failed}',{restored:restored??'—',skipped:skipped??'—',failed:failed??'—'})}</span> : '—'}
            </td>
            <td className={css.cellDate} data-label={t('Started')}>{started && Number.isFinite(new Date(started).getTime()) ? <time dateTime={started}>{formatDate(started, { dateStyle: 'medium', timeStyle: 'short' })}</time> : '—'}</td>
            <td className={css.cellDate} data-label={t('Duration')}>{sessionDuration(value?.session)}</td>
            <td><div className={css.sessionActions}>
              {running && value && <SessionStopControl session={value.session} operation onStopped={()=>{void refreshOperation(key,true)}}/>}
              <Button variant="ghost" size="sm" aria-expanded={isExpanded} aria-controls={isExpanded ? detailsId : undefined} onClick={() => setExpanded(old => ({ ...old, [key]: !isExpanded }))}>{t(isExpanded ? 'Close details' : 'Details')}<ChevronDown size={14} className={isExpanded ? css.expandedChevron : undefined}/></Button>
            </div></td>
          </tr>
          {isExpanded && <tr className={css.expandedSession}><td colSpan={6}><section id={detailsId} className={css.sessionDetails} aria-label={t('Details')}>
            {hasCounts && percent!==null && <p className={css.sub}>{t('Restored {restored} · Skipped {skipped} · Failed {failed}',{restored:restored??'—',skipped:skipped??'—',failed:failed??'—'})}</p>}
            {!hasCounts && value && <p className={css.sub}>{t(value.statisticsAvailability==='afterCompletion'?'Item totals are reported when this session ends.':running?'Veeam has not reported item progress.':'No item totals reported.')}</p>}
            {ended && <ProviderRestoreSummary statistics={value?.statistics} events={value?.events} saved={outcome}/>}
            {running && lastEventLabel && lastEventLabel!==rowMessage && <p className={css.sub}>{t('Latest event')} · {lastEventLabel}</p>}
            {running&&quietMinutes>=2&&<p className={css.notice}>{t('Veeam still reports this session as running, but has sent no new events. This does not confirm that items are being restored.')}</p>}
            {failureMessages.slice(1).map(message => <p key={message} className={`${css.notice} ${css.error}`}><strong>{t('Error')}: </strong>{message}</p>)}
            {warnings.map((message, warningIndex) => <p key={`warning-${warningIndex}`} className={css.notice}><strong>{t('Warning')}: </strong>{message}</p>)}
            {value && <details className={css.historyDisclosure}>
              <summary>{t('Session log')}</summary>
              <RecoveryEventLog events={value.events}/>
              {value.hasMore && <Button size="sm" variant="outline" disabled={!!loadingEvents[key]} onClick={() => void loadMoreEvents(key)}>{loadingEvents[key] && <Loader2 size={13} className={css.spin}/>} {t('Load more events')}</Button>}
            </details>}
            <RestoreAuditLog entries={value?.restoreAudit?.length?value.restoreAudit:receipt.auditEntry?[receipt.auditEntry]:[]} unavailable={value?.restoreAuditAvailability==='unavailable'}/>
            <div className={css.toolbar}><small className={css.sub}>{receipt.sessionId ? t('Session ID')+' · '+receipt.sessionId : receipt.requestId}</small>
              {receipt.sessionId && <div className={css.row}>
                {checkedAt[key] && <small className={css.sub}>{t('Checked at {time}',{time:formatDate(checkedAt[key],{timeStyle:'medium'})})}</small>}
                <Button variant="ghost" size="sm" disabled={!!refreshing[key]} onClick={()=>void refreshOperation(key,true)}><RefreshCw size={14} className={refreshing[key]?css.spin:undefined}/>{t('Refresh')}</Button>
              </div>}
            </div>
          </section></td></tr>}
        </Fragment>
      })}</tbody>
    </table></div>
  </>
}
