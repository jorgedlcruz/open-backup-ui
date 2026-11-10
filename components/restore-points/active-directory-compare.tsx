'use client'
// Open Backup UI v1.2.0
import {useEffect,useState} from 'react'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {adRequest,type AdScope,type AdEntry} from '@/lib/restore-points/ad-client'
import {canSendDirectoryCredentials,directoryTransportMessage} from '@/lib/restore-points/ad-cart'
import {useRecoveryPresentation} from './use-presentation'
import {RecoverySignal} from './recovery-signal'
import styles from './active-directory.module.css'

type ComparisonSource={available:false}|{available:true;domain:string;dn:string;reference:string}
type Result={found:boolean;controller:string;attributes:{name:string;backup:string[];current:string[]|null;state:'changed'|'same'|'unreported'}[]}
export function DirectoryComparison({scope,object,close}:{scope:AdScope;object:AdEntry;close:()=>void}){
  const {t,diagnostic}=useRecoveryPresentation(),{sessionId,sourceKey}=scope
  const [source,setSource]=useState<ComparisonSource>(),[result,setResult]=useState<Result>(),[unchanged,setUnchanged]=useState(false)
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{
    if(!canSendDirectoryCredentials(window.location.origin)){setError(directoryTransportMessage);return}
    const controller=new AbortController()
    adRequest<ComparisonSource>({action:'comparisonSource',sourceKey,sessionId,dnt:object.dnt},controller.signal)
      .then(setSource).catch(e=>{if(!controller.signal.aborted)setError(e.message)})
    return ()=>controller.abort()
  },[sourceKey,sessionId,object.dnt])
  async function compare(){
    if(!source?.available||!username.trim()||!password||busy)return
    if(!canSendDirectoryCredentials(window.location.origin)){setPassword('');setError(directoryTransportMessage);return}
    setBusy(true);setError('')
    try{
      setResult(await adRequest<Result>({action:'compareProduction',sourceKey,sessionId,dnt:object.dnt,reference:source.reference,username:username.trim(),password}))
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setPassword('');setBusy(false)}
  }
  const desktop=t('Open this restore point in Veeam Explorer for Microsoft Active Directory to compare with production.')
  const attributes=result?.attributes.filter(a=>unchanged||a.state!=='same')||[]
  return <Dialog open onOpenChange={open=>{if(!open)close()}}><DialogContent className={styles.compareDialog}><DialogHeader>
    <DialogTitle>{t('Compare with production')}</DialogTitle><DialogDescription>{object.name}{source?.available&&' · '+source.dn}</DialogDescription></DialogHeader>
    {error&&<p role="alert" className={styles.error}>{diagnostic(error)}</p>}
    {!source&&!error&&<RecoverySignal stage="data" compact/>}
    {source?.available===false&&<p role="status">{desktop}</p>}
    {source?.available&&!result&&<form className={styles.form} onSubmit={e=>{e.preventDefault();void compare()}}>
      <p>{t('Use a directory read account for {domain}.',{domain:source.domain})}</p>
      <label>{t('Username')}<input autoComplete="off" required value={username} onChange={e=>setUsername(e.target.value)} disabled={busy}/></label>
      <label>{t('Password')}<input type="password" autoComplete="off" required value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
      <div className={styles.actions}><Button type="submit" disabled={!username.trim()||!password||busy}>{busy?t('Working…'):t('Compare')}</Button></div>
    </form>}
    {result&&<><p className={styles.quiet}>{t('Domain controller')} · {result.controller}</p>
      {!result.found?<p role="status">{t('The production directory returned no visible object for this GUID.')}</p>:<>
        <label><input type="checkbox" checked={unchanged} onChange={e=>setUnchanged(e.target.checked)}/> {t('Show unchanged attributes')}</label>
        {attributes.length?<div className={styles.diffScroll}><table className={styles.diff}><thead><tr>
          <th>{t('Attribute')}</th><th>{t('Backup')}</th><th>{t('Production')}</th></tr></thead><tbody>
          {attributes.map(a=><tr key={a.name}><th scope="row">{a.name}<small>{a.state==='same'?t('Unchanged'):a.state==='changed'?t('Changed'):t('Not reported')}</small></th>
            <td>{a.backup.join('\n')||'—'}</td><td>{a.current===null?t('Not reported'):a.current.join('\n')||'—'}</td></tr>)}</tbody></table></div>:
          <p role="status">{t('The compared attributes match.')}</p>}
      </>}</>}
    <div className={styles.actions}><Button variant="outline" onClick={close}>{t('Close')}</Button></div>
  </DialogContent></Dialog>
}
