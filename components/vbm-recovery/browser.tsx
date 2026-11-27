'use client'
// Open Backup UI v1.3.0
import { useCallback,useEffect,useRef,useState } from 'react'
import Link from 'next/link'
import { Archive,ChevronDown,ChevronRight,FileText,FolderOpen,Loader2,RefreshCw,Search,ShoppingCart,TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BackupReadWait } from './backup-read-wait'
import { DataLoading } from '@/components/ui/data-loading'
import { useI18n } from '@/components/providers/i18n-provider'
import type { BrowseInput,RecoveryContext,RecoveryItem,RecoveryPage,Workload } from '@/lib/vbm-recovery/model'
import { formatBytes } from '@/lib/restore-points/model'
import { RecoveryRequestError,recoveryGet,recoveryPost } from './client'
import { initialOwnerRetryDelay } from '@/lib/vbm-recovery/read-retry'
import { createReadPool } from './read-pool'
import { combineReadPages,type BrowsePage } from './read-pages'
import { availableContent } from '@/lib/vbm-recovery/content-types'
import { ContentPane } from './content-pane'
import { ItemIcon } from './item-icon'
export { ItemIcon } from './item-icon'
import css from './workspace.module.css'

export type CartEntry=RecoveryItem & {ownerId:string;ownerName?:string;ownerEmail?:string}
export const itemKey=(item:Pick<RecoveryItem,'id'|'ownerId'|'kind'|'channelId'>)=>JSON.stringify([item.ownerId,item.channelId,item.kind,item.id])
type Scope=Omit<BrowseInput,'offset'|'limit'|'sessionId'|'workload'>
type Place={key:string;label:string;scope:Scope;ancestors:Place[];node?:RecoveryItem}
type GridPage = { key:string; page:RecoveryPage }
type ReadIssue={message:string;partial:boolean;append:boolean}
type FolderSelection = {
  items: Record<string, RecoveryItem>
  setChecked: (items: RecoveryItem[], checked: boolean) => void
}
export type ExplorerAvailability='loading'|'available'|'partial'|'unavailable'|'empty'|'ended'
const readMessage=(error:unknown)=>error instanceof Error?error.message:'Items could not be loaded.'
const mergeItems=(items:RecoveryItem[])=>[...new Map(items.map(item=>[itemKey(item),item])).values()]
function childrenFor(item:RecoveryItem,parent:Place|undefined,workload:Workload):Place {
  const ownerId=item.kind==='owner'?item.id:item.ownerId||parent?.scope.ownerId
  const area=workload==='SharePoint'&&item.raw.type==='ListFolder'?'items':workload==='SharePoint'&&item.raw.type==='LibraryFolder'?'documents':parent?.scope.kind==='items'&&workload==='SharePoint'?'items':workload==='Exchange'?'items':workload==='Teams'?'files':'documents'
  const scope:Scope=item.kind==='owner'?{kind:workload==='Teams'?'channels':workload==='SharePoint'?'libraries':area,ownerId,parentId:'root'}:item.kind==='channel'?{kind:'files',ownerId,channelId:item.id,parentId:'root'}:{kind:item.kind==='list'?'items':area,ownerId,channelId:item.channelId||parent?.scope.channelId,parentId:item.id}
  scope.scopeKind=['owner','folder','library','list','channel'].includes(item.kind)?item.kind as Scope['scopeKind']:parent?.scope.scopeKind
  return {key:itemKey(item),label:item.name,scope,ancestors:parent?[...parent.ancestors,parent]:[],node:item}
}
function candidateOwner(items:RecoveryItem[],context?:RecoveryContext) {
  if(!context)return undefined
  const object=context.object
  const components=context.workload==='Exchange'?object.mailboxes:context.workload==='OneDrive'?object.oneDrives:object.sites
  const identities=new Set([object.id,object.msid,object.url,...(components||[]).flatMap(c=>[c.id,c.email,c.url])].filter((v):v is string=>!!v).map(v=>v.toLowerCase().replace(/\/$/,'')))
  const matches=items.filter(item=>[item.id,item.email,item.url].some(v=>v&&identities.has(v.toLowerCase().replace(/\/$/,''))))
  return matches.length===1?matches[0]:undefined
}

export function RecoveryBrowser({sessionId,browseCacheId,onScopeChange,workload,context,cart,onAdd,onReview,ended,active,workingSince,onAvailabilityChange,onViewLog}:{sessionId:string;browseCacheId?:string;onScopeChange?:()=>void;workload:Workload;context?:RecoveryContext;cart:CartEntry[];onAdd:(items:CartEntry[])=>void;onReview:()=>void;ended:boolean;active:boolean;workingSince?:string;onAvailabilityChange?:(state:ExplorerAvailability)=>void;onViewLog?:()=>void}) {
  const {t,formatDate}=useI18n()
  const [owners,setOwners]=useState<RecoveryItem[]>([]),[ownerMore,setOwnerMore]=useState(false),[ownerOffset,setOwnerOffset]=useState(0),[ownerError,setOwnerError]=useState<{message:string;status?:number;code?:string}>(),[ownersLoaded,setOwnersLoaded]=useState(false),[ownersLoading,setOwnersLoading]=useState(false)
  const [waitingForOwners,setWaitingForOwners]=useState(false),ownerRetries=useRef(0)
  const [place,setPlace]=useState<Place>(),[query,setQuery]=useState(''),[activeQuery,setActiveQuery]=useState('')
  const [savedViews]=useState(()=>new Map<string, RecoveryPage>())
  const [savedBranches]=useState(()=>new Map<string, RecoveryPage>())
  const [display,setDisplay]=useState<GridPage>()
  const viewKey=JSON.stringify([workload,place?.scope,activeQuery])
  const currentPage=display?.key===viewKey ? display.page : savedViews.get(viewKey)
  const items=currentPage?.items??[],more=currentPage?.hasMore??false
  const [loading,setLoading]=useState(false),[error,setError]=useState<ReadIssue>(),[selection,setSelection]=useState<Record<string,RecoveryItem>>({}),[inspect,setInspect]=useState<RecoveryItem>()
  const [viewItem,setViewItem]=useState<RecoveryItem>()
  const contextRef=useRef(context);contextRef.current=context
  const [reads]=useState(()=>createReadPool({finishOnNavigate:true}))
  const didSelect=useRef(false),gridRead=useRef<AbortController|undefined>(undefined)
  const ownerRead=useRef<AbortController|undefined>(undefined),ownerGeneration=useRef(0),ownerPending=useRef(false),ownerRetryOffset=useRef(0)
  useEffect(()=>()=>{reads.dispose();savedViews.clear();savedBranches.clear()},[reads,savedViews,savedBranches,sessionId,workload,browseCacheId])
  const checkPage=useCallback((page:RecoveryPage & {browseCacheId?:string})=>{
    if(browseCacheId && page.browseCacheId!==browseCacheId) {
      onScopeChange?.()
      throw new RecoveryRequestError('Check the selected data source or reconnect if its session has expired.',409,false)
    }
    return page
  },[browseCacheId,onScopeChange])
  const fetchPage=useCallback((scope:Scope,skip=0,signal?:AbortSignal,recordRevisit=false)=>{
    const query={action:'browse',sessionId,workload,...scope,offset:skip,limit:100}
    // Cached navigation is already visible. Complete its audit even if the user moves on.
    if(recordRevisit)return recoveryGet<RecoveryPage>(query).then(checkPage)
    const key=JSON.stringify(Object.entries(query).filter(([,value])=>value!==undefined).sort(([a],[b])=>a.localeCompare(b)))
    return reads.run(key,sharedSignal=>recoveryGet<RecoveryPage>(query,sharedSignal).then(checkPage),signal)
  },[reads,sessionId,workload,checkPage])
  const loadBranches=useCallback(async (node:Place,skip=0,signal?:AbortSignal):Promise<BrowsePage>=>{
    const scope=node.scope
    let kinds:Scope['kind'][]=workload==='Teams'&&node.node?.kind==='owner'?['channels']:workload==='SharePoint'&&node.node?.kind==='owner'?['owners','libraries','lists']:['folders']
    if(workload==='Teams'&&node.node?.kind!=='owner')kinds=['files']
    const page=await combineReadPages(kinds.map(kind=>fetchPage({...scope,kind,...(kind==='owners'?{parentId:node.node?.id}: {})},skip,signal)),skip)
    return {...page,items:page.items.filter(item=>['owner','library','list','channel'].includes(item.kind)||item.isFolder)}
  },[fetchPage,workload])
  const loadOwners=useCallback(async(skip=0)=>{
    if(ended||ownerPending.current)return
    const controller=new AbortController(),current=++ownerGeneration.current
    ownerRead.current=controller;ownerPending.current=true;ownerRetryOffset.current=skip;setOwnersLoading(true)
    try {
      const page=await fetchPage({kind:'owners'},skip,controller.signal)
      if(current!==ownerGeneration.current)return
      setOwnersLoaded(true);setOwnerError(undefined);setOwners(old=>mergeItems(skip?[...old,...page.items]:page.items));setOwnerMore(page.hasMore);setOwnerOffset(page.nextOffset)
      if(!didSelect.current){const candidate=page.items.find(item=>item.id===page.suggestedOwnerId)||candidateOwner(page.items,contextRef.current);if(candidate){didSelect.current=true;setPlace(childrenFor(candidate,undefined,workload))}}
    }catch(e){if(current===ownerGeneration.current&&!controller.signal.aborted)setOwnerError({message:readMessage(e),...(e instanceof RecoveryRequestError?{status:e.status,code:e.code}:{})})}
    finally{if(current===ownerGeneration.current){ownerPending.current=false;setOwnersLoading(false)}}
  },[fetchPage,workload,ended])
  useEffect(()=>{
    void loadOwners()
    return()=>{ownerGeneration.current=ownerGeneration.current+1;ownerPending.current=false;ownerRead.current?.abort()}
  },[loadOwners])
  useEffect(()=>{
    setWaitingForOwners(false)
    if(!active||ended||ownersLoaded||ownersLoading||!ownerError||ownerRetryOffset.current!==0)return
    let timer:ReturnType<typeof setTimeout>|undefined
    function schedule(){
      clearTimeout(timer)
      const delay=document.visibilityState==='visible' && ownerError ? initialOwnerRetryDelay(ownerError,workingSince,ownerRetries.current) : null
      setWaitingForOwners(delay!==null)
      if(delay===null)return
      timer=setTimeout(()=>{
        setWaitingForOwners(false)
        if(document.visibilityState!=='visible'||ownerPending.current)return
        if(!ownerError || initialOwnerRetryDelay(ownerError,workingSince,ownerRetries.current)===null)return
        ownerRetries.current++
        void loadOwners()
      },delay)
    }
    schedule()
    document.addEventListener('visibilitychange',schedule)
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',schedule)}
  },[active,ended,ownersLoaded,ownersLoading,ownerError,workingSince,loadOwners])
  const navigate=(next:Place)=>{didSelect.current=true;setPlace(next);setQuery('');setActiveQuery('');setSelection({});setInspect(undefined)}
  const load=useCallback(async (append=false)=>{
    if(!place||ended)return
    const controller=new AbortController()
    gridRead.current?.abort();gridRead.current=controller
    const skip=append ? currentPage?.nextOffset??0 : 0
    const saved=savedViews.get(viewKey)
    const reopening=!append && saved!==undefined
    setLoading(!reopening)
    try {
      let page:BrowsePage
      if(activeQuery) {
        const search={action:'search',sessionId,workload,...place.scope,offset:skip,limit:100,query:activeQuery,...(append&&currentPage?.setId?{setId:currentPage.setId}:{})}
        const read=(signal?:AbortSignal)=>recoveryPost<RecoveryPage>(search,signal).then(checkPage)
        page=reopening ? await read() : await reads.run(JSON.stringify(search),read,controller.signal)
      }
      else if(place.node?.kind==='owner'&&workload==='SharePoint') {
        page=await combineReadPages(['owners','libraries','lists'].map(kind=>fetchPage({...place.scope,kind:kind as Scope['kind'],...(kind==='owners'?{parentId:place.node?.id}:{})},skip,controller.signal,reopening)),skip)
      } else page=await fetchPage(place.scope,skip,controller.signal,reopening)
      if(controller.signal.aborted)return
      const visibleItems=workload==='Exchange' ? page.items.filter(item=>!item.isFolder && item.kind!=='folder') : page.items
      // Every visit still reaches the authenticated recovery route for its audit entry.
      // Reading page zero again must not rewind the user's Load more position.
      const revisiting=!append && saved && (!activeQuery || saved.setId===page.setId)
      const previousItems=(append || page.readError) ? currentPage?.items??[] : []
      const next=revisiting ? saved : {...page,items:mergeItems([...previousItems,...visibleItems])}
      if(!page.readError) savedViews.set(viewKey,next)
      setDisplay({key:viewKey,page:next})
      setError(page.readError?{message:readMessage(page.readError),partial:true,append}:undefined)
    }catch(e){
      if(controller.signal.aborted)return
      if(e instanceof RecoveryRequestError && [401,403,404,409].includes(e.status)){
        if(e.status===404) savedViews.delete(viewKey)
        else savedViews.clear()
        setDisplay(undefined);setInspect(undefined);setSelection({})
      }
      setError({message:readMessage(e),partial:false,append})
    }
    finally{if(!controller.signal.aborted)setLoading(false)}
  },[place,ended,activeQuery,sessionId,workload,currentPage,savedViews,viewKey,fetchPage,checkPage,reads])
  const loader=useRef(load);loader.current=load
  useEffect(()=>{
    setDisplay(undefined);setSelection({});setInspect(undefined);setViewItem(undefined);setError(undefined)
    if(ended) savedViews.clear()
    else void loader.current(false)
    return()=>gridRead.current?.abort()
  },[place,activeQuery,ended,savedViews])
  const selected=Object.values(selection).filter((item):item is CartEntry=>!!item.ownerId)
  const add=(review=false)=>{
    const ancestry=place?[...place.ancestors,place]:[]
    onAdd(selected.map(item=>{
      const owner=owners.find(row=>row.id===item.ownerId)||ancestry.find(row=>row.node?.kind==='owner'&&row.node.id===item.ownerId)?.node
      return {...item,ownerName:owner?.name||item.ownerId,ownerEmail:workload==='Exchange'?owner?.email:undefined}
    }))
    setSelection({})
    if(review)onReview()
  }
  const selectedItems=items.filter(item=>item.selectable),allSelected=selectedItems.length>0&&selectedItems.every(item=>selection[itemKey(item)])
  function setChecked(rows: RecoveryItem[], checked: boolean) {
    setSelection(previous=>{
      const next={...previous}
      for(const row of rows) {
        const key=itemKey(row)
        if(checked) next[key]=row
        else delete next[key]
      }
      return next
    })
  }
  const folderSelection=workload==='Exchange' ? {items:selection,setChecked} : undefined
  const channelPlace=place&&[...place.ancestors,place].find(node=>node.node?.kind==='channel'&&node.node.id===place.scope.channelId)
  const fmt=(value?:string)=>value&&Number.isFinite(new Date(value).getTime())?formatDate(value,{dateStyle:'medium',timeStyle:'short'}):'—'
  const enter=(item:RecoveryItem)=>{if(item.isFolder||['owner','library','list','channel'].includes(item.kind))navigate(childrenFor(item,place,workload));else if(availableContent(item))setViewItem(item);else setInspect(item)}
  const availability:ExplorerAvailability=ended?'ended':!owners.length?(ownersLoading||waitingForOwners?'loading':ownerError?'unavailable':ownersLoaded?'empty':'loading'):place&&loading&&!currentPage?'loading':ownerError||error?'partial':'available'
  useEffect(()=>onAvailabilityChange?.(availability),[availability,onAvailabilityChange])
  return <>
    <div className={css.toolbar}><h2><FolderOpen size={19}/>{t(workload==='Exchange'?'Mailbox explorer':workload==='Teams'?'Teams explorer':'Files and items')}</h2><div className={css.actions}><span className={css.sub}>{selected.length>0&&t('{count} selected',{count:selected.length})}</span><Button size="sm" variant="outline" disabled={selected.length!==1||!availableContent(selected[0])||ended} onClick={()=>setViewItem(selected[0])}>{t('View')}</Button><Button size="sm" variant="outline" disabled={!selected.length||ended} onClick={()=>add()}><ShoppingCart size={15}/>{t('Add to cart')}</Button><Button size="sm" disabled={!selected.length||ended} onClick={()=>add(true)}>{t('Restore selected')}</Button><Button size="sm" variant="outline" onClick={onReview}><ShoppingCart size={15}/>{t('Recovery cart')}<span className={css.count}>{cart.length}</span></Button></div></div>
    {ended?<ExplorerState kind="ended" onViewLog={onViewLog}/>:!owners.length?<ExplorerState kind={ownersLoading||waitingForOwners?'loading':ownerError?'unavailable':ownersLoaded?'empty':'loading'} message={ownerError?.message} busy={ownersLoading} retry={()=>void loadOwners(ownerRetryOffset.current)} retryLabel="Retry browsing" onViewLog={onViewLog}/>:<>
    {ownerError&&<ReadFailure issue={{message:ownerError.message,partial:true,append:true}} title="Some backed-up objects could not be loaded." retryLabel="Retry browsing" busy={ownersLoading} retry={()=>void loadOwners(ownerRetryOffset.current)}/>}
    <form className={css.row} onSubmit={event=>{event.preventDefault();setActiveQuery(query.trim())}}><label className={css.search}><Search size={16}/><input aria-label={t('Search backup items')} placeholder={t('Search this mailbox, drive, site or team')} value={query} onChange={event=>setQuery(event.target.value)}/></label><Button size="sm" variant="outline" type="submit" disabled={!place||loading||ended}>{t('Search')}</Button>{activeQuery&&<Button size="sm" variant="ghost" onClick={()=>{setQuery('');setActiveQuery('')}}>{t('Clear')}</Button>}</form>
    <div className={css.explorer}><aside className={css.tree} aria-label={t('Backup folders')}><div className={css.treeTitle}>{t(workload==='Exchange'?'Mailboxes':workload==='OneDrive'?'OneDrives':workload==='SharePoint'?'Sites':'Teams')}</div>{owners.map(owner=><TreeBranch key={itemKey(owner)} node={childrenFor(owner,undefined,workload)} current={place?.key} workload={workload} load={loadBranches} navigate={navigate} ended={ended} folderSelection={folderSelection} savedBranches={savedBranches}/>)}{ownerMore&&!ownerError&&<Button size="sm" variant="ghost" disabled={ownersLoading||ended} onClick={()=>void loadOwners(ownerOffset)}>{t('Load more')}</Button>}</aside>
      <div className={css.grid}><nav className={css.crumbs} aria-label={t('Backup location')}><Archive size={15}/>{place?<>{place.ancestors.map(ancestor=><span className={css.row} key={ancestor.key}><button onClick={()=>navigate(ancestor)}>{ancestor.label}</button><ChevronRight size={12}/></span>)}<strong>{place.label}</strong></>:t('Choose a mailbox, drive, site or team')}</nav>
        {channelPlace&&<div className={css.tabs}>{(['files','posts','tabs'] as const).map(kind=><button className={css.tab} aria-pressed={place?.scope.kind===kind} key={kind} onClick={()=>navigate({...channelPlace,scope:{...channelPlace.scope,kind,parentId:kind==='posts'?'-1':'root'}})}>{t(kind==='files'?'Files':kind==='posts'?'Posts':'Tabs')}</button>)}</div>}
        {place?.scope.kind==='posts'&&<div className={css.notice}>{t('Posts can be inspected here. The API restores posts by channel and time range, so individual posts are not added to the recovery cart.')}</div>}
        {error&&items.length>0&&<ReadFailure issue={error} busy={loading} disabled={ended} retry={()=>void load(error.append)}/>}
        {!place?<ExplorerState kind="choose"/>:error&&!items.length?<ExplorerState kind="unavailable" location={place.label} message={error.message} busy={loading} retry={()=>void load(error.append)} retryLabel="Retry items" onViewLog={onViewLog}/>:loading&&!currentPage?(!activeQuery && workload==='Exchange' && place.node?.kind==='folder' ? <section className={css.explorerState}><BackupReadWait key={viewKey} initialLabel={t('Opening backup items…')} label={t('Waiting for the first {count} items in {folder}',{count:100,folder:place.label})}/></section> : <ExplorerState kind="loading" loadingLabel={activeQuery?'Searching…':'Opening backup items…'}/>):<><div className={css.tableScroll}><table className={css.table}><thead><tr><th><input type="checkbox" aria-label={t('Select displayed items')} disabled={!selectedItems.length||ended} checked={allSelected} onChange={event=>setChecked(selectedItems,event.target.checked)}/></th><th>{t(workload==='Exchange'?'Subject / name':'Name')}</th><th>{t(workload==='Exchange'?'From':'Type')}</th><th>{t('Modified')}</th></tr></thead><tbody>{items.map(item=><tr key={itemKey(item)} data-selected={!!selection[itemKey(item)]}><td>{item.selectable&&<input type="checkbox" aria-label={t('Select {name}',{name:item.name})} disabled={ended} checked={!!selection[itemKey(item)]} onChange={event=>setChecked([item],event.target.checked)}/>}</td><td><button onClick={()=>enter(item)} title={item.name}><ItemIcon item={item}/><span>{item.name}</span>{item.isFolder&&<ChevronRight size={13}/>}</button>{item.sizeBytes!==undefined&&!item.isFolder&&<small className={css.sub}>{formatBytes(item.sizeBytes)}</small>}</td><td title={item.from||item.kind}>{item.from||t(item.kind)}</td><td>{fmt(item.modified)}</td></tr>)}</tbody></table>{!items.length&&!more&&!error&&<div className={css.empty}><FolderOpen size={30}/>{t(activeQuery?'No items match this search.':'This folder has no items.')}</div>}</div><div className={css.foot}><span>{t('{count} items loaded',{count:items.length})}</span>{more&&!error&&<Button size="sm" variant="ghost" disabled={loading||ended} onClick={()=>load(true)}>{loading?<Loader2 size={14} className={css.spin}/>:null}{t('Load more items')}</Button>}</div></>}
      </div></div></>}
    {viewItem&&active&&!ended&&<ContentPane key={JSON.stringify([sessionId,itemKey(viewItem)])} sessionId={sessionId} item={viewItem} onClose={()=>setViewItem(undefined)}/>}
    {inspect&&<section className={css.section}><div className={css.toolbar}><h3><ItemIcon item={inspect}/>{inspect.name}</h3><Button size="sm" variant="ghost" onClick={()=>setInspect(undefined)}>{t('Close details')}</Button></div><dl className={css.details}>{Object.entries(inspect.raw).filter(([key,value])=>!key.startsWith('_')&&['string','number','boolean'].includes(typeof value)).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></section>}
  </>
}

export function ExplorerState({kind,message,location,busy=false,retry,retryLabel='Retry browsing',loadingLabel='Loading backup inventory…',onViewLog}:{kind:'loading'|'unavailable'|'empty'|'choose'|'ended';message?:string;location?:string;busy?:boolean;retry?:()=>void;retryLabel?:string;loadingLabel?:string;onViewLog?:()=>void}) {
  const {t}=useI18n()
  if(kind==='loading')return <section className={css.explorerState} aria-busy="true"><div className={css.explorerStateBody}><DataLoading status={t(loadingLabel)}/></div></section>
  const title=kind==='unavailable'?(location?'This location is unavailable':'Backup explorer unavailable'):kind==='empty'?'No backed-up objects found':kind==='ended'?'Browsing has ended':'Choose what to explore'
  const description=kind==='unavailable'?'The backup contents could not be read. Retry browsing or check the session log for details.':kind==='empty'?'Veeam returned no backed-up objects for this session. Check the session log or choose another restore point.':kind==='ended'?'This browse session has ended. Start a new recovery to explore its backup again.':'Choose the backed-up object in the tree to explore its items.'
  return <section className={css.explorerState} data-tone={kind} role={kind==='unavailable'?'alert':undefined} aria-busy={busy}>
    <div className={css.explorerStateBody}>
      <div className={css.explorerStateHeading}><span className={css.explorerStateIcon}>{kind==='unavailable'?<TriangleAlert size={24}/>:<FolderOpen size={25}/>}</span><div>{location&&<p className={css.explorerStateLocation} title={location}>{location}</p>}<h3>{t(title)}</h3></div></div>
      <p className={css.explorerStateDescription}>{t(description)}</p>
      {message&&<div className={css.explorerStateDetail}>{t(message)}</div>}
      {kind!=='choose'&&<div className={css.explorerStateActions}>
        {retry&&kind==='unavailable'&&<Button size="sm" disabled={busy} onClick={retry}>{busy?<Loader2 size={15} className={css.spin}/>:<RefreshCw size={15}/>} {t(retryLabel)}</Button>}
        {onViewLog?<Button size="sm" variant="outline" onClick={onViewLog}><FileText size={15}/>{t('View session log')}</Button>:<Button size="sm" variant="outline" asChild><a href="#log"><FileText size={15}/>{t('View session log')}</a></Button>}
        {(kind==='empty'||kind==='ended')&&<Button size="sm" variant="ghost" asChild><Link href="/vbm/recovery-center">{t('Recovery Center')} →</Link></Button>}
      </div>}
    </div>
  </section>
}

function ReadFailure({issue,folders=false,busy,disabled,retry,title:providedTitle,retryLabel}:{issue:ReadIssue;folders?:boolean;busy:boolean;disabled?:boolean;retry:()=>void;title?:string;retryLabel?:string}) {
  const {t}=useI18n()
  const title=providedTitle||(folders?(issue.partial?'Some folders could not be loaded.':'Folders could not be loaded.'):(issue.partial?'Some items could not be loaded.':'Items could not be loaded.'))
  if(folders)return <div className={css.explorerBranchFailure} role="alert">
    <div><TriangleAlert size={13}/><strong>{t(title)}</strong></div>
    <Button size="sm" variant="ghost" disabled={busy||disabled} onClick={retry}>{busy?<Loader2 size={13} className={css.spin}/>:<RefreshCw size={13}/>} {t('Retry folders')}</Button>
    {issue.message!==title&&<details><summary>{t('Details')}</summary><p>{t(issue.message)}</p></details>}
  </div>
  return <div className={`${css.notice} ${css.readFailure} ${issue.partial?'':css.error}`} role="alert">
    <div><strong>{t(title)}</strong>{issue.message!==title&&<span>{t(issue.message)}</span>}</div>
    <Button size="sm" variant="outline" disabled={busy||disabled} onClick={retry}>{busy&&<Loader2 size={14} className={css.spin}/>} {t(retryLabel||'Retry items')}</Button>
  </div>
}

function TreeBranch({node,current,workload,load,navigate,ended,folderSelection,savedBranches}:{node:Place;current?:string;workload:Workload;load:(node:Place,skip?:number,signal?:AbortSignal)=>Promise<BrowsePage>;navigate:(node:Place)=>void;ended:boolean;folderSelection?:FolderSelection;savedBranches:Map<string,RecoveryPage>}) {
  const {t}=useI18n(),[expanded,setExpanded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<ReadIssue>()
  const [display,setDisplay]=useState<BrowsePage>()
  const branch=display??savedBranches.get(node.key)
  const children=branch?.items??[],more=branch?.hasMore??false
  const request=useRef<AbortController|undefined>(undefined),generation=useRef(0),autoOpened=useRef(false)
  const read=async(append=false)=>{
    if(ended)return
    const current=++generation.current,controller=new AbortController()
    request.current?.abort();request.current=controller;setBusy(true)
    try {
      const page=await load(node,append?branch?.nextOffset:0,controller.signal)
      if(current!==generation.current)return
      const next={...page,items:mergeItems(append||page.readError?[...children,...page.items]:page.items)}
      if(!page.readError) savedBranches.set(node.key,next)
      setDisplay(next)
      setError(page.readError?{message:readMessage(page.readError),partial:true,append}:undefined)
    }catch(e){if(current===generation.current&&!controller.signal.aborted)setError({message:readMessage(e),partial:false,append})}
    finally{if(current===generation.current)setBusy(false)}
  }
  const readRef=useRef(read);readRef.current=read
  useEffect(()=>()=>{generation.current++;request.current?.abort();autoOpened.current=false},[])
  useEffect(()=>{if(current===node.key&&!autoOpened.current){autoOpened.current=true;setExpanded(true);if(!savedBranches.has(node.key))void readRef.current()}},[current,node.key,savedBranches])
  useEffect(()=>{if(ended){generation.current++;request.current?.abort();setBusy(false)}},[ended])
  const toggle=()=>{
    if(expanded){generation.current++;request.current?.abort();setBusy(false);setExpanded(false);return}
    autoOpened.current=true;setExpanded(true);if(!branch&&!error)void read()
  }
  const item=node.node!
  return <div>
    <div className={css.treeRow} data-current={current===node.key}>
      <button className={css.treeArrow} aria-label={t(expanded?'Collapse {name}':'Expand {name}',{name:node.label})} aria-expanded={expanded} onClick={toggle}>
        {busy?<Loader2 size={13} className={css.spin}/>:expanded?<ChevronDown size={13}/>:<ChevronRight size={13}/>}
      </button>
      <button onClick={()=>{navigate(node);if(!expanded)toggle()}} title={node.label}>
        <ItemIcon item={item} size={15}/><span className={css.treeLabel}>{node.label}</span>
      </button>
      {folderSelection && item.kind==='folder' && item.selectable &&
        <input className={css.folderCheckbox} type="checkbox" aria-label={t('Select {name}',{name:node.label})} disabled={ended}
          checked={!!folderSelection.items[node.key]} onChange={event=>folderSelection.setChecked([item],event.target.checked)}/>}
    </div>
    {expanded&&<div className={css.treeChildren}>
      {error&&<ReadFailure issue={error} folders busy={busy} disabled={ended} retry={()=>void read(error.append)}/>}
      {children.map(child=><TreeBranch key={itemKey(child)} node={childrenFor(child,node,workload)} current={current}
        workload={workload} load={load} navigate={navigate} ended={ended} folderSelection={folderSelection} savedBranches={savedBranches}/>)}
      {more&&!error&&<Button size="sm" variant="ghost" disabled={busy||ended} onClick={()=>void read(true)}>{t('More folders')}</Button>}
    </div>}
  </div>
}
