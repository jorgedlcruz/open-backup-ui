'use client'
// Open Backup UI v1.2.0

import {useEffect,useState} from 'react'
import {ChevronDown,ChevronRight,Folder,HardDrive,Loader2} from 'lucide-react'
import type {StorageItem,StorageScope} from '@/lib/restore-points/unstructured-workspace'
import {pathWithin,sameStoragePath,storageFolders,storagePathKey} from '@/lib/restore-points/storage-navigation'
import {storageRequest} from './unstructured-session-controls'
import {useRecoveryPresentation} from './use-presentation'
import styles from './guest-files.module.css'

type Page={items:StorageItem[];total:number|null}
export type ObservedStoragePage=Page & {path:string;skip:number}
type Props={scope:StorageScope;path:string;separator:string;navigate:(path:string)=>void;rootLabel?:string;observed?:ObservedStoragePage;waitForCurrent?:boolean}
const pageSize=50

export function StorageFolderTree(props:Props){
  const {t}=useRecoveryPresentation()
  const key=props.scope.sourceKey+'/'+props.scope.sessionId+'/'+props.scope.view+'/'+props.separator
  return <nav className={styles.tree} aria-label={t('Folder tree')}><h4>{t('Folders')}</h4>
    <Branch key={key} {...props} folder="" name={props.rootLabel||t('Root')} isRoot/>
  </nav>
}

function Branch(props:Props & {folder:string;name:string;drive?:boolean;isRoot?:boolean}){
  const {scope,path,separator,navigate,folder,name,drive,isRoot,observed,waitForCurrent=true}=props
  const {t,diagnostic}=useRecoveryPresentation()
  const {sourceKey,sessionId,view}=scope
  const [open,setOpen]=useState(!!isRoot||pathWithin(path,folder,separator))
  const [skip,setSkip]=useState(0),[pages,setPages]=useState<Map<number,Page>>(()=>new Map())
  const [error,setError]=useState(''),[retry,setRetry]=useState(0)
  const shared=observed&&sameStoragePath(observed.path,folder,separator)?observed:undefined
  const available=new Map(pages)
  if(shared)available.set(shared.skip,shared)
  const loaded=available.has(skip)
  const active=sameStoragePath(path,folder,separator)

  useEffect(()=>{
    if(pathWithin(path,folder,separator))setOpen(true)
  },[path,folder,separator])
  useEffect(()=>{
    if(shared){setPages(current=>new Map(current).set(shared.skip,shared));setError('')}
  },[shared])
  useEffect(()=>{
    // The current directory is already being read by the grid. Reuse that first page.
    if(!open||loaded||waitForCurrent&&active&&skip===0&&!shared&&!retry)return
    const controller=new AbortController()
    storageRequest<Page>({sourceKey,sessionId,view},{action:'browse',path:folder,skip,limit:pageSize},controller.signal)
      .then(page=>{if(!controller.signal.aborted){setPages(current=>new Map(current).set(skip,page));setError('')}})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Request failed.')})
    return()=>controller.abort()
  },[open,loaded,waitForCurrent,active,shared,folder,sourceKey,sessionId,view,skip,retry])

  // A shared page may be a later grid page. Only advance from a contiguous prefix,
  // so loading a paged grid never hides folders in an earlier unseen page.
  let next=0,last:Page|undefined
  while(available.has(next)){
    last=available.get(next)!
    if(!last.items.length)break
    next+=last.items.length
  }
  const more=!!last&&last.items.length>0&&(last.total==null?last.items.length===pageSize:next<last.total)
  const children=storageFolders([...available].sort(([a],[b])=>a-b).flatMap(([,page])=>page.items),folder,separator)
  const empty=available.has(0)&&!more&&!children.length
  return <div>
    <div className={styles.node} data-active={active}>
      {empty?<span className={styles.chevron}/>:<button type="button" className={styles.chevron}
        aria-label={t(open?'Collapse {name}':'Expand {name}',{name})} aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
        {open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>}
      <button type="button" aria-current={active?'location':undefined} title={name} onClick={()=>{setOpen(true);navigate(folder)}}>
        {drive||isRoot?<HardDrive size={15}/>:<Folder size={15}/>}<span>{name}</span></button>
    </div>
    {open&&<div className={styles.children}>
      {children.map(child=><Branch key={storagePathKey(child.path,separator)} {...props} folder={child.path} name={child.name} drive={child.drive} isRoot={false}/>)}
      {!loaded&&!error&&<Loader2 size={14} aria-label={t('Loading…')} className="animate-spin"/>}
      {error&&<button className={styles.link} type="button" title={diagnostic(error)} onClick={()=>{setError('');setRetry(value=>value+1)}}>{t('Retry')}</button>}
      {loaded&&more&&<button type="button" className={styles.link} onClick={()=>{setError('');setSkip(next)}}>{t('Load more')}</button>}
    </div>}
  </div>
}
