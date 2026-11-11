'use client'
// Open Backup UI v1.2.0
import {useEffect,useRef,useState} from 'react'
import {ChevronRight,File,Folder,FolderOpen,History,Search,ShoppingCart,X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {finishedStorageTask,isFolder,itemIdentity,mergeStorageCart,readStorageCart,readStorageValue,storageEntry,storageSelectionValid,writeStorageValue,
  type StorageAction,type StorageEntry,type StorageItem,type StorageStatus,type StorageTask,type StorageTransfer} from '@/lib/restore-points/unstructured-workspace'
import {StorageCommand,storageActionLabels,storageRequest} from './unstructured-session-controls'
import {useRecoveryPresentation} from './use-presentation'
import {control} from './workload-launch-shared'
import {StorageFolderTree} from './storage-folder-tree'
import {storageCrumbs} from '@/lib/restore-points/storage-navigation'
import files from './guest-files.module.css'
import styles from './unstructured-browser.module.css'

const pageSize=50
type Search=StorageTask & {query:string}
type TaskState={state:string;result?:string|null;progressPercent?:number|null}
type Version={id:string;creationTime:string;fileSize?:number|null}
function useTask(status:StorageStatus,task:StorageTask|undefined){
  const {sourceKey,sessionId,view}=status,[state,setState]=useState<TaskState>(),[error,setError]=useState(''),[tick,setTick]=useState(0)
  const taskId=task?.taskId,taskKey=task?.taskKey
  useEffect(()=>{
    setState(undefined);setError('')
    if(!taskId||!taskKey)return
    const controller=new AbortController()
    let timer:ReturnType<typeof setTimeout>|undefined
    async function read(){
      try{
        const result=await storageRequest<TaskState>({sourceKey,sessionId,view},{action:'task',taskId,taskKey},controller.signal)
        if(controller.signal.aborted)return
        setState(result)
        if(finishedStorageTask(result)==='working')timer=setTimeout(read,2500)
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Request failed.')}
    }
    void read()
    return ()=>{controller.abort();clearTimeout(timer)}
  },[sourceKey,sessionId,view,taskId,taskKey,tick])
  return {state,error,retry:()=>setTick(i=>i+1)}
}
function Pager({skip,count,total,move}:{skip:number;count:number;total:number|null;move:(skip:number)=>void}){
  const {t,formatNumber}=useRecoveryPresentation()
  if(!skip&&(total==null?count<pageSize:total<=pageSize))return null
  return <div className="flex flex-wrap items-center justify-end gap-3 text-sm"><span>{formatNumber(skip+(count?1:0))}–{formatNumber(skip+count)}{total!=null?' / '+formatNumber(total):''}</span>
    <Button variant="outline" size="sm" disabled={!skip} onClick={()=>move(Math.max(0,skip-pageSize))}>{t('Previous')}</Button>
    <Button variant="outline" size="sm" disabled={total==null?count<pageSize:skip+count>=total} onClick={()=>move(skip+pageSize)}>{t('Next')}</Button></div>
}
function Versions({status,entry,onSelect,close}:{status:StorageStatus;entry:StorageEntry;onSelect:(entry:StorageEntry)=>void;close:()=>void}){
  const {t,date,size,diagnostic}=useRecoveryPresentation(),[skip,setSkip]=useState(0),[page,setPage]=useState<{versions:Version[];total:number|null}>(),[error,setError]=useState('')
  const {sourceKey,sessionId,view}=status
  useEffect(()=>{
    const controller=new AbortController();setPage(undefined);setError('')
    storageRequest<{versions:Version[];total:number|null}>({sourceKey,sessionId,view},{action:'versions',path:entry.path,skip,limit:pageSize},controller.signal)
      .then(r=>{if(!controller.signal.aborted)setPage(r)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Request failed.')})
    return ()=>controller.abort()
  },[sourceKey,sessionId,view,entry.path,skip])
  return <Dialog open onOpenChange={open=>{if(!open)close()}}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader>
    <DialogTitle>{t('Versions')}</DialogTitle><DialogDescription className="break-all">{entry.path}</DialogDescription></DialogHeader>
    {error?<p role="alert">{diagnostic(error)}</p>:!page?<p role="status">{t('Loading…')}</p>:<>
      <ul className="divide-y">{page.versions.map(v=><li key={v.id}><button className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:text-primary" onClick={()=>onSelect({...entry,version:v.creationTime})}>
        <span>{date(v.creationTime)}</span><span>{v.fileSize!=null&&size(v.fileSize)}</span><ChevronRight size={15}/></button></li>)}</ul>
      {!page.versions.length&&<p>{t('No versions found.')}</p>}<Pager skip={skip} count={page.versions.length} total={page.total} move={setSkip}/></>}
  </DialogContent></Dialog>
}
function StorageBrowser({status}:{status:StorageStatus}){
  const {t,date,size,diagnostic,formatNumber,label}=useRecoveryPresentation()
  const {sourceKey,sessionId,view}=status,scope={sourceKey,sessionId,view},may=(value:string)=>status.actions.includes(value)
  const [path,setPath]=useState(''),[query,setQuery]=useState(''),[search,setSearch]=useState<Search>(),[searchBusy,setSearchBusy]=useState(false)
  const [skip,setSkip]=useState(0),[version,setVersion]=useState<StorageEntry>(),[selected,setSelected]=useState<StorageEntry[]>([])
  const [cart,setCart]=useState(()=>readStorageCart(scope)),[cartOpen,setCartOpen]=useState(false),[cartQuery,setCartQuery]=useState('')
  const [command,setCommand]=useState<{action:'copy'|'restore';items:StorageEntry[]}>(),[error,setError]=useState(''),[listError,setListError]=useState('')
  const [page,setPage]=useState<{items:StorageItem[];total:number|null}>(),[revision,setRevision]=useState(0)
  const [roots,setRoots]=useState<{path:string;label:string}[]>([])
  const [transfer,setTransfer]=useState(()=>readStorageValue<StorageTransfer>(scope,'transfer'))
  const separator=status.pathSeparator||'/',searchTask=useTask(status,search),transferTask=useTask(status,transfer)
  const searchState=search&&searchTask.state?finishedStorageTask(searchTask.state):undefined
  const searchId=search?.taskId,searchKey=search?.taskKey,canBrowse=may('browse'),canSearch=may('search')
  const working=!!transfer&&(!transferTask.state||finishedStorageTask(transferTask.state)==='working')
  const searchController=useRef<AbortController|null>(null)
  useEffect(()=>()=>searchController.current?.abort(),[])
  useEffect(()=>{
    if(!canBrowse||searchId&&(!canSearch||searchState!=='ready')){setPage(undefined);return}
    const controller=new AbortController();setPage(undefined);setListError('')
    const action=searchId?{action:'results',taskId:searchId,taskKey:searchKey}:{action:'browse',path}
    storageRequest<{items:StorageItem[];total:number|null}>({sourceKey,sessionId,view},{...action,skip,limit:pageSize},controller.signal)
      .then(r=>{if(!controller.signal.aborted){
        setPage(r)
        if(!searchId&&!path)setRoots(previous=>[...new Map([...previous,...r.items.flatMap(item=>{
          const entry=storageEntry(item,'',separator)
          return entry&&isFolder(entry)?[{path:entry.path,label:item.name}]:[]
        })].map(root=>[root.path,root])).values()])
      }}).catch(e=>{if(!controller.signal.aborted)setListError(e instanceof Error?e.message:'Request failed.')})
    return ()=>controller.abort()
  },[sourceKey,sessionId,view,path,skip,searchId,searchKey,searchState,revision,canBrowse,canSearch,separator])
  function navigate(next:string){
    if(next===path&&!search&&!searchBusy)return
    searchController.current?.abort();setPage(undefined);setPath(next);setQuery('');setSearch(undefined);setSearchBusy(false);setSkip(0);setSelected([]);setError('')
    setRevision(value=>value+1)
  }
  async function searchFiles(){
    if(!query.trim()||searchBusy||!canSearch)return
    searchController.current?.abort()
    const controller=new AbortController();searchController.current=controller;setSearchBusy(true);setError('')
    try {
      const result=await storageRequest<StorageTask>(scope,{action:'search',path,query:query.trim()},controller.signal)
      if(!controller.signal.aborted){setPage(undefined);setSkip(0);setSearch({...result,query:query.trim()});setSelected([])}
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Request failed.')}
    finally{if(!controller.signal.aborted)setSearchBusy(false)}
  }
  function saveCart(items:StorageEntry[]){setCart(items);writeStorageValue(scope,'cart',items.length?items:undefined)}
  function add(){
    const next=mergeStorageCart(cart,selected)
    if(next.length>200){setError('Select up to 200 files or folders.');return}
    saveCart(next);setSelected([]);setError('')
  }
  function openAction(action:'copy'|'restore',items:StorageEntry[]){setCartOpen(false);setCommand({action,items})}
  function actions(items:StorageEntry[]){
    const valid=storageSelectionValid(items)&&!working
    return <>{may('restore')&&<Button size="sm" variant="outline" disabled={!valid} onClick={()=>openAction('restore',items)}>{t(storageActionLabels.restore)}</Button>}
      {may('copy')&&<Button size="sm" variant="outline" disabled={!valid} onClick={()=>openAction('copy',items)}>{t(storageActionLabels.copy)}</Button>}</>
  }
  const rows=(page?.items||[]).map(item=>({item,entry:storageEntry(item,path,separator,!!search)}))
  const cartShown=cart.filter(e=>e.path.toLocaleLowerCase().includes(cartQuery.trim().toLocaleLowerCase()))
  return <section className={files.explorer} aria-label={t('Files and folders')}>
    <div className={styles.toolbar}><h3><FolderOpen size={18}/>{t('Files and folders')}</h3>
    <div className={styles.actions} role="group" aria-label={t('Recovery actions')}>{actions(selected)}
      {may('versions')&&<Button size="sm" variant="outline" disabled={selected.length!==1||selected[0].type!=='File'} onClick={()=>setVersion(selected[0])}><History size={14}/>{t('Versions')}</Button>}
      <Button size="sm" variant="outline" disabled={!selected.length} onClick={add}><ShoppingCart size={14}/>{t('Add to cart')}</Button>
      <Button size="sm" variant="secondary" onClick={()=>setCartOpen(true)}><ShoppingCart size={14}/>{t('Recovery cart')} · {formatNumber(cart.length)}</Button></div></div>
    {canSearch&&<form className={files.searchForm} onSubmit={e=>{e.preventDefault();void searchFiles()}}><label className={files.searchBox}><Search size={16}/><input className={control} type="search" maxLength={256} aria-label={t('Search files and folders')} placeholder={t('Search files and folders')} value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <Button type="submit" size="sm" variant="outline" disabled={!query.trim()||searchBusy}>{t('Search')}</Button></form>}
    {error&&<p role="alert">{diagnostic(error)}</p>}
    {transfer&&<div className="rounded-md border px-3 py-2 text-sm" role="status">{t(storageActionLabels[transfer.action])} · {transferTask.error?diagnostic(transferTask.error):transferTask.state?
      label(transferTask.state.result&&transferTask.state.result!=='None'?transferTask.state.result:transferTask.state.state):t('Checking with VBR')}
      {transferTask.state&&finishedStorageTask(transferTask.state)==='working'&&typeof transferTask.state.progressPercent==='number'&&' · '+formatNumber(transferTask.state.progressPercent)+'%'}
      {transferTask.error&&<Button size="sm" variant="ghost" onClick={transferTask.retry}>{t('Retry')}</Button>}</div>}
    <div className={files.layout}>
      {canBrowse&&<StorageFolderTree scope={scope} path={path} separator={separator} navigate={navigate} rootLabel={t('Root')} waitForCurrent={!search}
        observed={!search&&page?{path,skip,...page}:undefined}/>}
      <div className={files.content}>
      <nav className={files.crumbs} aria-label={t('Path')}>
        <button type="button" aria-current={!path&&!search?'location':undefined} onClick={()=>navigate('')}><FolderOpen size={15}/>{t('Root')}</button>
        {storageCrumbs(path,separator,roots).map((crumb,index,all)=><span key={crumb.path}><ChevronRight size={12}/><button type="button"
          aria-current={!search&&index===all.length-1?'location':undefined} onClick={()=>navigate(crumb.path)}>{crumb.label}</button></span>)}
        {search&&<span><ChevronRight size={12}/>{t('Search results')} · {search.query}<button type="button" aria-label={t('Dismiss search')} className={files.iconButton} onClick={()=>navigate(path)}><X size={14}/></button></span>}
      </nav>
      <div className={styles.directory}>
    {searchTask.error?<p role="alert">{diagnostic(searchTask.error)} <Button size="sm" variant="outline" onClick={searchTask.retry}>{t('Retry')}</Button></p>:
      searchState==='failed'?<p role="alert">{t('Search failed.')}</p>:listError?<p role="alert">{diagnostic(listError)} <Button size="sm" variant="outline" onClick={()=>setRevision(i=>i+1)}>{t('Retry')}</Button></p>:
      !canBrowse?null:!page?<p className={files.reading} role="status">{t('Loading…')}</p>:<div className={styles.scroll}>
      <table className="w-full text-left text-sm"><thead className="bg-muted/40"><tr><th className="p-2"><span className="sr-only">{t('Select')}</span></th><th className="p-2">{t('Name')}</th><th className="p-2">{t('Size')}</th><th className="p-2">{t('Modified')}</th></tr></thead>
        <tbody>{rows.map(({item,entry},index)=>{
          const chosen=selected.find(r=>r.path===entry?.path),folder=entry&&isFolder(entry)
          return <tr className={styles.row} data-selected={!!chosen} key={entry?.path||index}><td className="p-2"><input type="checkbox" checked={!!chosen} disabled={!entry||!storageSelectionValid([entry])} aria-label={t('Select {name}',{name:item.name})}
            onChange={()=>entry&&setSelected(prev=>chosen?prev.filter(r=>r.path!==entry.path):[...prev,entry])}/></td>
            <td className="p-2"><div className="flex items-start gap-2">{folder?<Folder size={16}/>:<File size={16}/>}
              {folder?<button className="break-all text-left text-primary hover:underline" onClick={()=>navigate(entry.path)}>{item.name}</button>:<span className="break-all">{item.name}</span>}</div>
              {search&&<small className="break-all text-muted-foreground">{item.location}</small>}{chosen?.version&&<small className="block">{date(chosen.version)}</small>}</td>
            <td className="p-2 whitespace-nowrap">{item.size!=null?size(item.size):'—'}</td><td className="p-2">{item.modifiedDate?date(item.modifiedDate):'—'}</td></tr>})}</tbody></table>
        {!rows.length&&<p className="p-3 text-sm">{t('No items found.')}</p>}</div>}
    {page&&<div className={styles.pagination}><Pager skip={skip} count={page.items.length} total={page.total} move={v=>{setPage(undefined);setSkip(v);setSelected([])}}/></div>}
      </div></div></div>
    {version&&may('versions')&&<Versions status={status} entry={version} close={()=>setVersion(undefined)} onSelect={entry=>{setSelected([entry]);setVersion(undefined)}}/>}
    {cartOpen&&<Dialog open onOpenChange={open=>{if(!open)setCartOpen(false)}}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{t('Recovery cart')}</DialogTitle><DialogDescription>{t('{count} items',{count:cart.length})}</DialogDescription></DialogHeader>
      <input className={control} type="search" aria-label={t('Search cart')} placeholder={t('Search cart')} value={cartQuery} onChange={e=>setCartQuery(e.target.value)}/>
      <div className="flex flex-wrap gap-2">{actions(cart)}</div>
      {cart.some(r=>r.version)&&cart.length>1&&<p className="text-sm">{t('Select a single item version.')}</p>}
      <ul className="divide-y">{cartShown.map(row=><li key={itemIdentity(row)} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="break-all">{row.path}{row.version&&' · '+date(row.version)}</span>
        <Button size="icon-sm" variant="ghost" aria-label={t('Remove {name}',{name:row.path})} onClick={()=>saveCart(cart.filter(r=>itemIdentity(r)!==itemIdentity(row)))}><X size={14}/></Button></li>)}</ul>
      {!cartShown.length&&<p>{cart.length?t('No matches'):t('The cart is empty.')}</p>}</DialogContent></Dialog>}
    {command&&may(command.action)&&<StorageCommand status={status} {...command} onClose={()=>setCommand(undefined)} onAccepted={result=>{
      const task:StorageTransfer={taskId:result.taskId!,taskKey:result.taskKey!,action:command.action}
      setTransfer(task);writeStorageValue(scope,'transfer',task);setSelected([]);setCommand(undefined)
    }}/>}
  </section>
}
export function UnstructuredSession({status,onSession}:{status:StorageStatus;onSession:(id?:string)=>void}){
  const {t,label}=useRecoveryPresentation(),[operation,setOperation]=useState<StorageAction>()
  if(status.view==='browse')return <StorageBrowser key={status.sourceKey+'/'+status.sessionId} status={status}/>
  return <section className="grid gap-4"><div><h2 className="text-base font-semibold">{status.name||t('Published share')}</h2>
    {status.state&&<p className="text-sm text-muted-foreground">{label(status.state)}</p>}</div>
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('Recovery actions')}>{(['migrate','switchover'] as const).filter(op=>status.actions.includes(op)).map(op=>
      <Button variant="outline" size="sm" key={op} onClick={()=>setOperation(op)}>{t(storageActionLabels[op])}</Button>)}</div>
    {operation&&status.actions.includes(operation)&&<StorageCommand action={operation} status={status} onClose={()=>setOperation(undefined)} onAccepted={r=>{setOperation(undefined);onSession(r.sessionId)}}/>}
  </section>
}
