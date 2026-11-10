'use client'
// Open Backup UI v1.2.0

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { adRequest, type AdEntry, type AdScope, type AdWorkflow } from '@/lib/restore-points/ad-client'
import { uncertainRestore } from '@/lib/restore-points/workflow'
import { useRecoveryPresentation } from './use-presentation'
import styles from './active-directory.module.css'

type Check = {step:string; fields?:Record<string,unknown>}
type SelectionRights = {hasAccountObjects?:boolean;canRestoreDeletedObjects?:boolean;mergeModeAllowed?:boolean}
type CheckResult = SelectionRights & {ok?:boolean; proof?:string; question?:boolean|string; message?:string; certificateKey?:string;
  certificate?:{subject?:string; thumbprint:string; serviceUri:string}}
type Challenge = {certificate?:CheckResult['certificate']; message:string; proceed:(remember:boolean)=>Promise<void>}
type Props = {scope:AdScope;workflow:AdWorkflow;selected:AdEntry[];onClose:()=>void;onAccepted:(message:string)=>void}

export function DirectoryWorkflow({scope,workflow,selected,onClose,onAccepted}:Props) {
  const {t,diagnostic,formatNumber}=useRecoveryPresentation()
  const restore=workflow.intent==='restore'
  const [stage,setStage]=useState<'target'|'options'|'review'>('target'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false)
  const [server,setServer]=useState(''),[gc,setGc]=useState(''),[ssl,setSsl]=useState(false),[username,setUsername]=useState(''),[password,setPassword]=useState('')
  const [servers,setServers]=useState<string[]>([]),[catalogs,setCatalogs]=useState<string[]>([]),[containers,setContainers]=useState<{name:string;distinguishedName:string}[]>([])
  const [targetDn,setTargetDn]=useState(''),[attrs,setAttrs]=useState<string[]>([]),[skipAttributes,setSkipAttributes]=useState<string[]>([]),[full,setFull]=useState(true)
  const [lockedAttrs,setLockedAttrs]=useState<string[]>([])
  const [rights,setRights]=useState<SelectionRights>({}),[attributeProof,setAttributeProof]=useState('')
  const [changed,setChanged]=useState(true),[deleted,setDeleted]=useState(true),[merge,setMerge]=useState(false),[links,setLinks]=useState(true)
  const [state,setState]=useState('KeepStateFromBackup'),[passwordAction,setPasswordAction]=useState('DoNotRestorePassword'),[replacement,setReplacement]=useState(''),[changeAtLogon,setChangeAtLogon]=useState(false)
  const [path,setPath]=useState(''),[filename,setFilename]=useState(''),[overwrite,setOverwrite]=useState(false),[filter,setFilter]=useState(''),[ldap,setLdap]=useState(false)
  const [proofs,setProofs]=useState<string[]>([]),[targetProofs,setTargetProofs]=useState<string[]>([])
  const [challenge,setChallenge]=useState<Challenge>(),[remember,setRemember]=useState(false)
  const lock=useRef(false),{sessionId,sourceKey}=scope
  const request=<T,>(action:string, fields:Record<string,unknown>={})=>adRequest<T>({action,sourceKey,sessionId,workflow,...fields})
  const destinationValid=!!server.trim()&&!!username.trim()&&!!password&&(restore||!!path.trim())
  const optionsValid=!restore||((changed||deleted)&&(passwordAction!=='SetPasswordTo'||!!replacement)&&
    (full||(attrs.length>0&&skipAttributes.length<attrs.length)))
  useEffect(()=>{
    if(!restore)return
    const controller=new AbortController()
    const list=(step:string)=>adRequest<{servers:string[]}>({action:'check',sourceKey,sessionId,workflow,step},controller.signal)
    void list('targets').then(result=>{if(!controller.signal.aborted)setServers(result.servers||[])}).catch(()=>{})
    void list('catalogs').then(result=>{if(!controller.signal.aborted)setCatalogs(result.servers||[])}).catch(()=>{})
    return ()=>controller.abort()
  },[sessionId,sourceKey,workflow,restore])

  async function run(job:()=>Promise<void>,committing=false) {
    if(lock.current)return
    lock.current=true;setBusy(true);setError('')
    try{await job()}catch(err){setError(diagnostic(err instanceof Error?err.message:String(err)));if(committing&&uncertainRestore(err))setUncertain(true)}
    finally{lock.current=false;setBusy(false)}
  }
  function cancel() {
    if(busy)return
    if(uncertain){onClose();return}
    void run(async()=>{await request('cancelWorkflow');onClose()})
  }
  async function validate(steps:Check[], gathered:string[], done:(values:string[])=>void):Promise<void> {
    const [next,...rest]=steps
    if(!next){done(gathered);return}
    const result=await request<CheckResult>('check',{step:next.step,...next.fields})
    const certified=result.proof?[...gathered,result.proof]:gathered
    if(result.certificate){
      const {certificate,certificateKey}=result
      if(!certificateKey||!certificate.serviceUri||!certificate.thumbprint)throw Error(t('Certificate details are unavailable.'))
      setRemember(false);setChallenge({certificate,message:result.message||t('Verify the server certificate before continuing.'),proceed:async save=>{
        await request('trust',{certificateKey,serviceUri:certificate.serviceUri,thumbprint:certificate.thumbprint,remember:save})
        await validate(steps,gathered,done)
      }});return
    }
    if(result.ok===false)throw Error(result.message||result.question?.toString()||t('Validation failed.'))
    if(next.step==='items'){
      setRights(result)
      if(result.canRestoreDeletedObjects===false)setDeleted(false)
      if(result.mergeModeAllowed===false)setMerge(false)
      if(result.hasAccountObjects===false){setPasswordAction('DoNotRestorePassword');setChangeAtLogon(false);setState('KeepStateFromBackup');setReplacement('')}
    }
    if(result.question){
      setChallenge({message:typeof result.question==='string'?result.question:result.message||t('VBR requests confirmation.'),proceed:()=>validate(rest,certified,done)})
      return
    }
    await validate(rest,certified,done)
  }
  function next(){
    if(stage==='target')void run(async()=>{
      const settings={server:server.trim(),gcServer:gc.trim()||undefined,useSsl:ssl,username:username.trim(),password}
      const checks:Check[]=restore?[
        ...(ssl?[{step:'certificate',fields:{server:settings.server}}]:[]),
        ...(ssl&&settings.gcServer?[{step:'catalogCertificate',fields:settings}]:[]),
        {step:'credentials',fields:settings},{step:'items'},
      ]:[{step:'exportServer',fields:{server:settings.server,username:settings.username,password}},
        {step:'exportPath',fields:{path:path.trim(),filename:filename.trim()||undefined,overwrite}}]
      await validate(checks,[],values=>{setTargetProofs(values);setProofs(values);setFull(true);setAttributeProof('');setStage('options')})
    })
    else if(stage==='options')void run(async()=>{
      const checks:Check[]=restore&&rights.hasAccountObjects!==false?[{step:'passwordAccess'}]:[]
      await validate(checks,!full&&attributeProof?[...targetProofs,attributeProof]:targetProofs,values=>{setProofs(values);setStage('review')})
    })
    else void run(async()=>{
      if(restore)await request('restore',{proofs,targetContainer:targetDn.trim()||undefined,fullRestore:full,skipAttributes:full?undefined:skipAttributes,
        mergeMultivalues:merge,restoreChangedObjects:changed,restoreDeletedObjects:deleted,restoreLinkExpirationTime:links,accountState:state,
        passwordAction,newPassword:passwordAction==='SetPasswordTo'?replacement:undefined,changePasswordAtLogon:changeAtLogon})
      else await request('export',{proofs,filter:filter.trim()||undefined,ldap:!!filter.trim()&&ldap})
      onAccepted(restore?t('VBR accepted the request.'):t('Export requested on {server} in {path}.',{server:server.trim(),path:path.trim()}))
    },true)
  }
  function getAttributes(){
    void run(async()=>{
      const response=await request<{attributes?:string[];attributeOptions?:{name:string;isMandatory?:boolean;isChangeable?:boolean}[];message?:string;proof?:string}>('check',{step:'attributes'})
      if(!response.attributes)throw Error(response.message||t('Attributes are unavailable.'))
      setAttributeProof(response.proof||'')
      const options=response.attributeOptions||[],fixed=options.filter(attr=>attr.isMandatory||attr.isChangeable===false).map(attr=>attr.name)
      const excluded=options.filter(attr=>!attr.isMandatory&&attr.isChangeable===false).map(attr=>attr.name)
      setLockedAttrs(fixed);setAttrs(response.attributes)
      setSkipAttributes(old=>[...old.filter(attr=>response.attributes!.includes(attr)&&!fixed.includes(attr)),...excluded]);setFull(false)
    })
  }
  function getContainers(){
    void run(async()=>{const result=await request<{containers?:{name:string;distinguishedName:string}[];message?:string}>('check',{step:'containers',rootDn:targetDn.trim()||undefined})
      if(!result.containers)throw Error(result.message||t('Validation failed.'))
      setContainers(result.containers)})
  }
  const check=(label:string,value:boolean,setter:(value:boolean)=>void,disabled=false)=><label className={styles.check}>
    <input type="checkbox" checked={value} disabled={disabled} onChange={e=>setter(e.target.checked)}/>{label}</label>
  const passwordLabel=passwordAction==='RestorePassword'?t('Restore backed-up password'):passwordAction==='SetPasswordTo'?t('Set a new password'):t('Do not restore password')
  return <Dialog open onOpenChange={value=>{if(!value)cancel()}}><DialogContent className={styles.dialog} onEscapeKeyDown={e=>{if(busy)e.preventDefault()}} onInteractOutside={e=>e.preventDefault()}>
    <DialogHeader><DialogTitle>{restore?t('Restore directory objects'):t('Export directory objects')}</DialogTitle>
      <DialogDescription>{t('{count} selected',{count:formatNumber(selected.length)})} · {stage==='target'?t('Destination'):stage==='options'?t('Options'):t('Review')}</DialogDescription></DialogHeader>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {uncertain&&<p role="alert">{t('Check Sessions before submitting another request.')}</p>}
    {challenge?<div className={styles.form}>
      <p>{challenge.message}</p>
      {challenge.certificate&&<><dl className={styles.attributes}>{[
        [t('Server'),challenge.certificate.serviceUri],[t('Subject'),challenge.certificate.subject],[t('Thumbprint'),challenge.certificate.thumbprint],
      ].map(([key,value])=>value&&<div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        {check(t('Remember this certificate for my account'),remember,setRemember)}</>}
      <div className={styles.actions}><Button variant="outline" disabled={busy} onClick={()=>setChallenge(undefined)}>{t('Back')}</Button>
        <Button disabled={busy} onClick={()=>void run(async()=>{const current=challenge;setChallenge(undefined);await current.proceed(remember)})}>
          {challenge.certificate?t('Trust certificate'):t('Confirm')}</Button></div>
    </div>:<form className={styles.form} onSubmit={e=>{e.preventDefault();if(!uncertain)next()}}>
      <fieldset disabled={busy||uncertain}>
      {stage==='target'&&<>
        <label>{restore?t('Domain controller'):t('Export server')}<input required list="ad-targets" value={server} onChange={e=>setServer(e.target.value)}/></label>
        <datalist id="ad-targets">{servers.map(name=><option key={name} value={name}/>)}</datalist>
        {restore&&<><label>{t('Global catalog server (optional)')}<input list="ad-catalogs" value={gc} onChange={e=>setGc(e.target.value)}/></label>
          <datalist id="ad-catalogs">{catalogs.map(name=><option key={name} value={name}/>)}</datalist>{check(t('Use SSL'),ssl,setSsl)}</>}
        <label>{t('Username')}<input autoComplete="off" required value={username} onChange={e=>setUsername(e.target.value)}/></label>
        <label>{t('Password')}<input type="password" autoComplete="off" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
        {!restore&&<><label>{t('Destination folder')}<input required value={path} onChange={e=>setPath(e.target.value)}/></label>
          <label>{t('File name (optional)')}<input value={filename} onChange={e=>setFilename(e.target.value)}/></label>
          {check(t('Overwrite existing file'),overwrite,setOverwrite)}</>}
      </>}
      {stage==='options'&&(restore?<>
        <label>{t('Target container (optional)')}<input value={targetDn} onChange={e=>setTargetDn(e.target.value)} placeholder={t('Original location')}/></label>
        <Button type="button" size="sm" variant="outline" onClick={getContainers}>{t('Browse target containers')}</Button>
        {!!containers.length&&<select aria-label={t('Containers')} value="" onChange={e=>{setTargetDn(e.target.value);setContainers([])}}><option value="">{t('Select')}</option>
          {containers.map(c=><option key={c.distinguishedName} value={c.distinguishedName}>{c.distinguishedName}</option>)}</select>}
        {check(t('Restore changed objects'),changed,setChanged)}{check(t('Restore deleted objects'),deleted,setDeleted,rights.canRestoreDeletedObjects===false)}
        <label className={styles.check}><input type="checkbox" checked={!full} onChange={e=>{if(e.target.checked)getAttributes();else setFull(true)}}/>{t('Choose attributes to restore')}</label>
        {!full&&<fieldset><legend>{t('Attributes')}</legend>{attrs.map(attr=><label className={styles.check} key={attr}><input type="checkbox" disabled={lockedAttrs.includes(attr)} checked={!skipAttributes.includes(attr)}
          onChange={e=>setSkipAttributes(old=>e.target.checked?old.filter(v=>v!==attr):[...old,attr])}/>{attr}</label>)}</fieldset>}
        {check(t('Merge multivalued attributes'),merge,setMerge,rights.mergeModeAllowed===false)}{check(t('Restore link expiration time'),links,setLinks)}
        {rights.hasAccountObjects!==false&&<><label>{t('Account state')}<select value={state} onChange={e=>setState(e.target.value)}>
          <option value="KeepStateFromBackup">{t('Use state from backup')}</option><option value="Enable">{t('Enable')}</option><option value="Disable">{t('Disable')}</option></select></label>
        <label>{t('Password')}<select value={passwordAction} onChange={e=>{setPasswordAction(e.target.value);setReplacement('')}}>
          <option value="DoNotRestorePassword">{t('Do not restore password')}</option><option value="RestorePassword">{t('Restore backed-up password')}</option>
          <option value="SetPasswordTo">{t('Set a new password')}</option></select></label>
        {passwordAction==='SetPasswordTo'&&<label>{t('New password')}<input type="password" required autoComplete="new-password" value={replacement} onChange={e=>setReplacement(e.target.value)}/></label>}
        {check(t('Require password change at next sign-in'),changeAtLogon,setChangeAtLogon)}</>}
      </>:<><label>{t('Export filter (optional)')}<input value={filter} onChange={e=>setFilter(e.target.value)}/></label>{check(t('LDAP filter'),ldap,setLdap)}</>)}
      {stage==='review'&&<dl className={styles.attributes}>
        <div><dt>{t('Selected objects')}</dt><dd>{selected.map(row=>row.name).join(', ')}</dd></div>
        <div><dt>{t('Server')}</dt><dd>{server}</dd></div>
        <div><dt>{t('Destination')}</dt><dd>{restore?targetDn||t('Original location'):[path,filename].filter(Boolean).join('\\')}</dd></div>
        {restore?<><div><dt>{t('Recovery options')}</dt><dd>{[changed&&t('Restore changed objects'),deleted&&t('Restore deleted objects')].filter(Boolean).join(' · ')}</dd></div>
          <div><dt>{t('Attributes')}</dt><dd>{full?t('All') :attrs.filter(a=>!skipAttributes.includes(a)).join(', ')}</dd></div>
          <div><dt>{t('Merge multivalued attributes')}</dt><dd>{merge?t('Yes'):t('No')}</dd></div>
          <div><dt>{t('Restore link expiration time')}</dt><dd>{links?t('Yes'):t('No')}</dd></div>
          {rights.hasAccountObjects!==false&&<><div><dt>{t('Account state')}</dt><dd>{state==='Enable'?t('Enable'):state==='Disable'?t('Disable'):t('Use state from backup')}</dd></div>
          <div><dt>{t('Password')}</dt><dd>{passwordLabel}{changeAtLogon&&' · '+t('Require password change at next sign-in')}</dd></div></>}</>:
          <><div><dt>{t('Overwrite existing file')}</dt><dd>{overwrite?t('Yes'):t('No')}</dd></div>
            {filter&&<div><dt>{ldap?t('LDAP filter'):t('Export filter (optional)')}</dt><dd>{filter}</dd></div>}</>}
      </dl>}
      </fieldset>
      <div className={styles.actions}><Button type="button" variant="ghost" onClick={cancel} disabled={busy}>{uncertain?t('Close'):t('Cancel')}</Button>
        {stage!=='target'&&!uncertain&&<Button type="button" variant="outline" disabled={busy} onClick={()=>{setError('');setStage(stage==='review'?'options':'target')}}>{t('Back')}</Button>}
        {!uncertain&&<Button type="submit" disabled={busy||(stage==='target'&&!destinationValid)||(stage==='options'&&!optionsValid)}>
          {busy?t('Working…'):stage==='target'?t('Continue'):stage==='options'?t('Review'):restore?t('Restore'):t('Export')}</Button>}
      </div>
    </form>}
  </DialogContent></Dialog>
}
