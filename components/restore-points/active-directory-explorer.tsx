'use client'
// Open Backup UI v1.2.0

import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronRight, FileOutput, FileText, Folder, FolderTree, GitCompareArrows, Info, ListPlus, Network, RefreshCw, RotateCcw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { adParent, adRequest, type AdEntry, type AdPage, type AdScope, type AdWorkflow } from '@/lib/restore-points/ad-client'
import {adCartLimit,mergeDirectoryItems,readDirectoryCart,saveDirectoryCart,selectableDirectoryItem} from '@/lib/restore-points/ad-cart'
import { useRecoveryPresentation } from './use-presentation'
import { RecoverySignal } from './recovery-signal'
import { DirectoryWorkflow } from './active-directory-workflow'
import {DirectoryCart} from './active-directory-cart'
import {DirectoryComparison} from './active-directory-compare'
import { DirectoryNavigation, directoryPathKey } from './active-directory-navigation'
import browse from './sql-browse-workspace.module.css'
import styles from './active-directory.module.css'

const limit = 40

function DirectoryPage({scope, view, parent, search, recursive, ldap, revision, selected, onSelect, onPageSelect, open, branchKey, onBranchPage}: {
  scope:AdScope; view:'domains'|'containers'|'items'|'attributes'; parent?:AdEntry; search?:string; recursive?:boolean; ldap?:boolean
  revision:number; selected?:AdEntry[]; onSelect?:(row:AdEntry)=>void; onPageSelect?:(rows:AdEntry[],add:boolean)=>void; open?:(row:AdEntry)=>void
  branchKey?:string; onBranchPage?:(key:string,rows:AdEntry[])=>void
}) {
  const {t,formatNumber,diagnostic}=useRecoveryPresentation()
  const [skip,setSkip]=useState(0),[page,setPage]=useState<AdPage>(),[error,setError]=useState('')
  const {sourceKey,sessionId}=scope
  useEffect(()=>{
    const controller=new AbortController()
    setPage(undefined);setError('')
    adRequest<AdPage>({action:'browse',sourceKey,sessionId,view,parent:adParent(parent),query:search||undefined,ldap,recurse:recursive,skip,limit},controller.signal)
      .then(next=>{
        if(controller.signal.aborted)return
        setPage(next)
        if(branchKey)onBranchPage?.(branchKey,next.items)
      }).catch(err=>{if(!controller.signal.aborted)setError(err.message)})
    return ()=>controller.abort()
  },[sourceKey,sessionId,view,parent,search,ldap,recursive,skip,revision,branchKey,onBranchPage])
  if(error)return <p role="alert" className={styles.error}>{diagnostic(error)}</p>
  if(!page)return <RecoverySignal stage="data" compact status={t('Loading…')}/>
  if(!page.items.length)return <p className={styles.empty}>{t('No results')}</p>
  const eligible=page.items.filter(selectableDirectoryItem)
  const marked=eligible.filter(row=>selected?.some(s=>s.dnt===row.dnt)).length
  return <>
    {view==='attributes' ? <dl className={styles.attributes}>{page.items.map(row=><div key={row.id}><dt>{row.name}</dt>
      <dd>{row.values?.join('\n') || '—'}</dd></div>)}</dl> :
    <table className={styles.table}><thead><tr>{onSelect&&<th scope="col"><input type="checkbox" aria-label={t('Select this page')} checked={!!eligible.length&&marked===eligible.length}
      ref={el=>{if(el)el.indeterminate=marked>0&&marked<eligible.length}} disabled={!eligible.length} onChange={e=>onPageSelect?.(eligible,e.target.checked)}/></th>}
      <th scope="col">{t('Name')}</th>{view==='items'&&<th scope="col">{t('Type')}</th>}</tr></thead>
      <tbody>{page.items.map(row=>{
        const checked=!!selected?.some(item=>item.dnt===row.dnt)
        const Icon=row.type==='domain'?Network:row.type==='container'?Folder:FileText
        return <tr key={row.id} data-selected={checked||undefined}>
          {onSelect&&<td><input type="checkbox" aria-label={t('Select {name}',{name:row.name})} checked={checked} disabled={!selectableDirectoryItem(row)} onChange={()=>onSelect(row)}/></td>}
          <td><button type="button" className={styles.object} onClick={()=>open?.(row)}><Icon size={15}/>{row.name}</button></td>
          {view==='items'&&<td>{row.itemType||'—'}</td>}
        </tr>
      })}</tbody></table>}
    {page.total>limit&&<div className={styles.pager}><span>{t('{start}–{end} of {count}',{start:formatNumber(skip+1),end:formatNumber(skip+page.items.length),count:formatNumber(page.total)})}</span>
      <Button size="sm" variant="outline" disabled={!skip} onClick={()=>setSkip(Math.max(0,skip-limit))}>{t('Previous')}</Button>
      <Button size="sm" variant="outline" disabled={skip+page.items.length>=page.total} onClick={()=>setSkip(skip+limit)}>{t('Next')}</Button></div>}
  </>
}

type ExplorerProps=AdScope&{showFinish?:boolean;onClose?:()=>void;onOperation?:()=>void}
export function ActiveDirectoryExplorer(props:ExplorerProps) {
  return <DirectorySession key={props.sourceKey+props.sessionId} {...props}/>
}
function DirectorySession({sourceKey,sessionId,onClose,onOperation,showFinish=true}:ExplorerProps) {
  const {t,diagnostic,formatNumber}=useRecoveryPresentation()
  const scope={sourceKey,sessionId}
  const [path,setPath]=useState<AdEntry[]>([]),[selected,setSelected]=useState<AdEntry[]>([]),[inspect,setInspect]=useState<AdEntry>()
  const branchKey=directoryPathKey(path)
  const [branches,setBranches]=useState(() => new Map<string,AdEntry[]>())
  const selectionId=useId()
  const [cart,setCart]=useState<AdEntry[]>([]),[cartOpen,setCartOpen]=useState(false),[compare,setCompare]=useState<AdEntry>()
  const [cartReady,setCartReady]=useState(false)
  const [input,setInput]=useState(''),[query,setQuery]=useState({text:'',ldap:false,recursive:false}),[advanced,setAdvanced]=useState(false),[subtree,setSubtree]=useState(true)
  const [plan,setPlan]=useState<{workflow:AdWorkflow;objects:AdEntry[];fromCart:boolean}>(),[revision,setRevision]=useState(0),[finish,setFinish]=useState(false),[closed,setClosed]=useState(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[unconfirmed,setUnconfirmed]=useState(false)
  const latch=useRef(false),parent=path[path.length-1]
  useEffect(()=>{setCart(readDirectoryCart(sourceKey,sessionId));setCartReady(true)},[sourceKey,sessionId])
  useEffect(()=>{if(cartReady)saveDirectoryCart(sourceKey,sessionId,cart)},[sourceKey,sessionId,cart,cartReady])
  useEffect(()=>{
    if(closed)return
    const controller=new AbortController()
    let running=false
    async function pulse(){
      if(document.hidden||running||controller.signal.aborted)return
      running=true
      try{await adRequest({action:'keepAlive',sessionId,sourceKey},controller.signal)}
      catch(err){if(!controller.signal.aborted)setError(err instanceof Error?err.message:String(err))}
      finally{running=false}
    }
    const timer=setInterval(pulse,60000)
    document.addEventListener('visibilitychange',pulse)
    return ()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',pulse)}
  },[closed,sessionId,sourceKey])
  const rememberPage=useCallback((key:string,rows:AdEntry[])=>{
    setBranches(previous=>new Map(previous).set(key,rows))
  },[])
  function navigate(next:AdEntry[]) {
    const ancestors = new Set([directoryPathKey([]), ...next.map((_, index) => directoryPathKey(next.slice(0,index+1)))])
    setBranches(previous => new Map([...previous].filter(([key]) => ancestors.has(key))))
    setPath(next)
    setInput('')
    setQuery({text:'',ldap:false,recursive:false})
    setSelected([])
    setMessage('')
  }
  function select(row:AdEntry) {setSelected(prior=>prior.some(item=>item.dnt===row.dnt)?prior.filter(item=>item.dnt!==row.dnt):[...prior,row])}
  function pageSelect(rows:AdEntry[],add:boolean){setSelected(prior=>add?mergeDirectoryItems(prior,rows):prior.filter(p=>!rows.some(r=>r.dnt===p.dnt)))}
  async function launch(intent:'restore'|'export'|'finish',fromCart=false){
    if(latch.current||closed||unconfirmed)return
    const objects=fromCart?cart:selected
    if(intent!=='finish'&&(!objects.length||objects.length>adCartLimit))return
    latch.current=true;setBusy(true);setError('');setMessage('')
    try{
      if(intent==='finish'){await adRequest({...scope,action:'finish'});saveDirectoryCart(sourceKey,sessionId,[]);setClosed(true);setFinish(false);onClose?.()}
      else {
        const {workflow:next}=await adRequest<{workflow:AdWorkflow}>({...scope,action:'prepare',intent,dntIds:objects.map(item=>item.dnt)})
        setCartOpen(false);setPlan({workflow:next,objects,fromCart})
      }
    }catch(err){setError(err instanceof Error?err.message:String(err));if(err instanceof TypeError||(err&&typeof err==='object'&&'uncertain' in err&&err.uncertain===true))setUnconfirmed(true)}
    finally{latch.current=false;setBusy(false)}
  }
  if(closed)return <p role="status" className={styles.feedback}>{t('The directory browsing session has ended.')}</p>
  const location=branchKey+JSON.stringify(query)
  const selectionCount=selected.length,locked=busy||unconfirmed||!selectionCount||selectionCount>adCartLimit
  const union=mergeDirectoryItems(cart,selected)
  const one=selected.length===1?selected[0]:undefined
  return <section className={styles.explorer} aria-label={t('Microsoft Active Directory')}>
    <header className={styles.commandBar}>
      <div className={styles.commandHeading}>
        <h3><FolderTree size={18} aria-hidden/>{t('Microsoft Active Directory')}</h3>
        <Button size="icon-sm" variant="ghost" type="button" aria-label={t('Refresh')} title={t('Refresh')} onClick={()=>setRevision(n=>n+1)}><RefreshCw size={15}/></Button>
        {showFinish&&<Button size="sm" variant="outline" disabled={busy||unconfirmed} onClick={()=>setFinish(true)}><X size={15}/>{t('End browsing')}</Button>}
      </div>
      <div className={styles.commandButtons} role="group" aria-label={t('Directory object actions')}>
        <Button size="sm" variant="outline" disabled={locked} aria-describedby={selectionId} onClick={()=>void launch('restore')}><RotateCcw/>{t('Restore')}</Button>
        <Button size="sm" variant="outline" disabled={locked} aria-describedby={selectionId} onClick={()=>void launch('export')}><FileOutput/>{t('Export')}</Button>
        <Button size="sm" variant="outline" disabled={busy||!one||one.type!=='item'} aria-describedby={selectionId} onClick={()=>setCompare(one)}><GitCompareArrows/>{t('Compare with production')}</Button>
        <DirectoryCart items={cart} ready={cartReady} open={cartOpen} onOpenChange={setCartOpen} setItems={setCart}
          busy={busy||unconfirmed} error={error && diagnostic(error)} launch={intent=>void launch(intent,true)}/>
      </div>
    </header>
    {error&&<p role="alert" className={styles.error}>{diagnostic(error)}</p>}
    {unconfirmed&&<p role="status">{t('Check Sessions before submitting another request.')}</p>}
    {message&&<p role="status" className={styles.feedback}>{message}</p>}
    {(selectionCount>adCartLimit||union.length>adCartLimit)&&<p className={styles.quiet}>{t('Select up to {count} directory objects.',{count:formatNumber(adCartLimit)})}</p>}
    <div className={browse.workspace}>
      <DirectoryNavigation path={path} branches={branches} navigate={navigate}/>
      <div className={styles.directoryGrid}>
        <div className={styles.gridBar}>
          <nav className={styles.crumbs} aria-label={t('Directory location')}><button onClick={()=>navigate([])} aria-current={!parent?'location':undefined}>{t('Domains')}</button>
            {path.map((node,i)=><Fragment key={node.id}><ChevronRight aria-hidden size={12}/><button aria-current={i===path.length-1?'location':undefined} onClick={()=>navigate(path.slice(0,i+1))}>{node.name}</button></Fragment>)}</nav>
          <span className={styles.count} id={selectionId} aria-live="polite">{t('{count} selected',{count:formatNumber(selectionCount)})}</span>
        </div>
        {!!selectionCount && <div className={styles.selection} role="group" aria-label={t('Selected objects')}>
          <Button size="sm" variant="outline" disabled={!cartReady||locked||union.length>adCartLimit||union.length===cart.length} onClick={()=>{setCart(union);setSelected([])}}><ListPlus size={15}/>{t('Add to cart')}</Button>
          <Button size="sm" variant="ghost" disabled={busy||!one} onClick={()=>setInspect(one)}><Info size={15}/>{t('Properties')}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={()=>setSelected([])}>{t('Clear selection')}</Button>
        </div>}
        {!parent ? <DirectoryPage scope={scope} revision={revision} view="domains" branchKey={branchKey}
          onBranchPage={rememberPage} open={row=>navigate([row])}/> : <>
          {parent.type==='container' && <form className={styles.toolbar} onSubmit={event=>{
            event.preventDefault()
            setQuery({text:input.trim(),ldap:advanced,recursive:subtree})
            setSelected([])
          }}>
            <div className={styles.search}>
              <input aria-label={t('Search directory objects')} placeholder={t('Search directory objects')} value={input} onChange={event=>setInput(event.target.value)}/>
              <Button size="sm" variant="outline" type="submit"><Search size={15}/>{t('Search')}</Button>
            </div>
            <label><input type="checkbox" checked={subtree} onChange={event=>setSubtree(event.target.checked)}/> {t('Include subcontainers')}</label>
            <label><input type="checkbox" checked={advanced} onChange={event=>setAdvanced(event.target.checked)}/> {t('LDAP filter')}</label>
          </form>}
          {!query.text && <div className={styles.area}>
            <h4>{t('Containers')}</h4>
            <DirectoryPage key={location+'containers'} scope={scope} revision={revision} view="containers" parent={parent}
              branchKey={branchKey} onBranchPage={rememberPage} selected={selected} onSelect={select}
              onPageSelect={pageSelect} open={row=>navigate([...path,row])}/>
          </div>}
          {parent.type==='container' && <div className={styles.area}>
            <h4>{t('Directory objects')}</h4>
            <DirectoryPage key={location+'items'} scope={scope} revision={revision} view="items" parent={parent}
              search={query.text} ldap={query.ldap} recursive={!!query.text&&query.recursive} selected={selected}
              onSelect={select} onPageSelect={pageSelect} open={setInspect}/>
          </div>}
        </>}
      </div>
    </div>
    {busy&&<RecoverySignal stage="data" compact status={t('Loading…')}/>}
    {inspect&&<Dialog open onOpenChange={open=>{if(!open)setInspect(undefined)}}><DialogContent className={styles.dialog}><DialogHeader><DialogTitle>{inspect.name}</DialogTitle>
      <DialogDescription>{inspect.description||inspect.itemType||t('Properties')}</DialogDescription></DialogHeader>
      <DirectoryPage scope={scope} revision={revision} view="attributes" parent={inspect}/></DialogContent></Dialog>}
    {compare&&<DirectoryComparison scope={scope} object={compare} close={()=>setCompare(undefined)}/>}
    {plan&&<DirectoryWorkflow key={plan.workflow.id} scope={scope} workflow={plan.workflow} selected={plan.objects} onClose={()=>setPlan(undefined)}
      onAccepted={result=>{if(plan.fromCart)setCart(rows=>rows.filter(row=>!plan.objects.some(o=>o.dnt===row.dnt)));setSelected([]);setPlan(undefined);setMessage(result);onOperation?.()}}/>}
    {finish&&<Dialog open onOpenChange={open=>{if(!busy)setFinish(open)}}><DialogContent><DialogHeader><DialogTitle>{t('End browsing')}</DialogTitle>
      <DialogDescription>{t('Close this Active Directory browsing session?')}</DialogDescription></DialogHeader>
      {error&&<p role="alert" className={styles.error}>{diagnostic(error)}</p>}<div className={styles.actions}>
        <Button variant="outline" disabled={busy} onClick={()=>setFinish(false)}>{t('Cancel')}</Button>
        <Button disabled={busy||unconfirmed} onClick={()=>void launch('finish')}>{t('End browsing')}</Button></div></DialogContent></Dialog>}
  </section>
}
