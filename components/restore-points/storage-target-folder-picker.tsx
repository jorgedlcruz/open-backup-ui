'use client'
// Open Backup UI v1.2.0
import {useEffect,useState} from 'react'
import {ChevronRight,Folder,HardDrive,Link2,Loader2,Server} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {applicationRequest,ApplicationRequestError} from '@/lib/api/application-request'
import type {StorageScope} from '@/lib/restore-points/unstructured-workspace'
import type {TargetBrowseSession,TargetFolderPage} from '@/lib/restore-points/target-folders'
import {useRecoveryPresentation} from './use-presentation'

type Props={scope:StorageScope;destinationId:string;serverName:string;onClose:()=>void;onChoose:(path:string)=>void}
type Crumb={path:string;name:string}
export function StorageTargetFolderPicker({scope,destinationId,serverName,onClose,onChoose}:Props){
  const {t,diagnostic}=useRecoveryPresentation()
  const {sourceKey,sessionId,view}=scope
  const [session,setSession]=useState<TargetBrowseSession>(),[trail,setTrail]=useState<Crumb[]>([])
  const [page,setPage]=useState<TargetFolderPage>(),[offsets,setOffsets]=useState([0]),[reading,setReading]=useState(false)
  const [startError,setStartError]=useState(''),[error,setError]=useState(''),[restart,setRestart]=useState(0),[retry,setRetry]=useState(0)
  const [expired,setExpired]=useState(false)
  const path=trail.at(-1)?.path
  const skip=offsets.at(-1)??0
  useEffect(()=>{
    let disposed=false,lease:TargetBrowseSession|undefined
    const requestScope={sourceKey,sessionId,view},address={...requestScope,destinationId}
    const close=(value:TargetBrowseSession)=>applicationRequest('/api/vbr/restore/unstructured',{method:'POST',keepalive:true,
      headers:{'Content-Type':'application/json'},body:JSON.stringify({...address,action:'stopTargetBrowse',browseSessionId:value.browseSessionId,browseKey:value.browseKey})}).catch(()=>undefined)
    setSession(undefined);setTrail([]);setPage(undefined);setOffsets([0]);setStartError('');setError('')
    // Let an in-flight start return its ID even when the dialog closes, then stop
    // that exact temporary session. Aborting here could leave it undiscoverable.
    void applicationRequest<TargetBrowseSession & {sourceKey:string}>('/api/vbr/restore/unstructured',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({...address,action:'startTargetBrowse'})}).then(async result=>{
        if(result.sourceKey!==sourceKey||result.serverId!==destinationId)throw new Error('The selected data source has changed.')
        lease=result
        if(disposed){await close(result);return}
        setSession(result);setTrail([{path:result.rootPath,name:result.serverName||serverName}])
      }).catch(e=>{if(!disposed)setStartError(e instanceof Error?e.message:'Request failed.')})
    return ()=>{disposed=true;if(lease)void close(lease)}
  },[sourceKey,sessionId,view,destinationId,serverName,restart])
  useEffect(()=>{
    if(!session||path===undefined)return
    const controller=new AbortController()
    setReading(true);setError('');setExpired(false);setPage(undefined)
    void applicationRequest<TargetFolderPage & {sourceKey:string}>('/api/vbr/restore/unstructured',{method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceKey,sessionId,view,destinationId,action:'browseTarget',
        browseSessionId:session.browseSessionId,browseKey:session.browseKey,path,skip,limit:200})}).then(result=>{
        if(result.sourceKey!==sourceKey||result.path!==path||result.skip!==skip)throw new Error('This destination browser is unavailable. Open the folder browser again.')
        if(!controller.signal.aborted)setPage(result)
      }).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Request failed.');setExpired(e instanceof ApplicationRequestError&&(e.status===404||e.status===409))}})
      .finally(()=>{if(!controller.signal.aborted)setReading(false)})
    return ()=>controller.abort()
  },[sourceKey,sessionId,view,destinationId,session,path,skip,retry])
  const more=!!page&&page.count>0&&(page.total===null?page.count===200:skip+page.count<page.total)
  return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="flex max-h-[85dvh] min-h-0 max-w-2xl flex-col gap-4 overflow-hidden">
    <DialogHeader><DialogTitle>{t('Choose destination folder')}</DialogTitle><DialogDescription>{serverName}</DialogDescription></DialogHeader>
    <div className="min-h-0 overflow-auto rounded-lg border">
      {session&&<nav aria-label={t('Destination folder')} className="flex min-h-12 flex-wrap items-center gap-1 border-b px-3 py-2 text-sm">
        {trail.map((crumb,index)=><span key={crumb.path} className="inline-flex min-w-0 items-center gap-1">{index?<ChevronRight aria-hidden size={14}/>:<Server aria-hidden size={16}/>}
          <button type="button" className="rounded px-1 py-1 text-left break-all hover:text-primary focus-visible:outline-2 focus-visible:outline-ring" aria-current={index===trail.length-1?'location':undefined}
            onClick={()=>{setTrail(trail.slice(0,index+1));setOffsets([0])}}>{crumb.name}</button></span>)}
      </nav>}
      {(!session&&!startError||reading)&&<div role="status" className="flex min-h-48 items-center justify-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 aria-hidden size={18} className="animate-spin"/>{t('Loading folders…')}</div>}
      {(startError||error)&&<div role="alert" className="space-y-3 p-4 text-sm"><p>{diagnostic(startError||error)}</p>
        <Button variant="outline" size="sm" onClick={()=>startError||expired?setRestart(v=>v+1):setRetry(v=>v+1)}>{t('Retry')}</Button></div>}
      {page&&!reading&&!error&&<ul aria-label={t('Folders')} className="min-h-48 max-h-[42dvh] overflow-auto divide-y">
        {page.items.map(folder=><li key={folder.path}><button type="button" disabled={folder.isSymbolicLink} title={folder.isSymbolicLink?t('Symbolic link — enter a destination path manually'):folder.path}
          className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          onClick={()=>{setTrail([...trail,{path:folder.path,name:folder.name}]);setOffsets([0])}}>
          {folder.type==='Drive'?<HardDrive aria-hidden size={18} className="shrink-0 text-primary"/>:<Folder aria-hidden size={18} className="shrink-0 text-primary"/>}
          <span className="min-w-0 flex-1 break-all">{folder.name}</span>{folder.isSymbolicLink?<Link2 aria-label={t('Symbolic link')} size={15}/>:<ChevronRight aria-hidden size={15}/>}</button></li>)}
        {!page.items.length&&<li className="p-4 text-sm text-muted-foreground">{t('No subfolders in this location.')}</li>}
      </ul>}
      {page&&!reading&&(skip>0||more)&&<div className="flex items-center justify-between gap-3 border-t px-3 py-2">
        <Button variant="ghost" size="sm" disabled={offsets.length===1} onClick={()=>setOffsets(offsets.slice(0,-1))}>{t('Previous')}</Button>
        <span className="text-xs text-muted-foreground">{t('Page {page}',{page:offsets.length})}</span>
        <Button variant="ghost" size="sm" disabled={!more} onClick={()=>setOffsets([...offsets,skip+page.count])}>{t('Next')}</Button>
      </div>}
    </div>
    {path!==undefined&&<p className="min-w-0 break-all text-sm text-muted-foreground"><span className="font-medium text-foreground">{t('Destination folder')}:</span> {path||serverName}</p>}
    <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button><Button disabled={!path||!page||reading||!!error} onClick={()=>{if(path)onChoose(path)}}><Folder aria-hidden size={16}/>{t('Choose folder')}</Button></DialogFooter>
  </DialogContent></Dialog>
}
