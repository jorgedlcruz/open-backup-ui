'use client'
// Open Backup UI v1.3.0
import { useEffect,useState } from 'react'
import { ArrowRight,Check,Copy,ExternalLink,KeyRound,Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/components/providers/i18n-provider'
import type { RestoreDeviceCode } from '@/lib/vbm-recovery/restore-auth'
import css from './microsoft-sign-in.module.css'

type Props={applicationId:string;detected:boolean;canRequest:boolean;preparing:boolean;disabled:boolean;code?:RestoreDeviceCode;expires:number;now:number;returned:boolean;error:string;onApplicationChange:(value:string)=>void;onRequest:()=>void;onReset:()=>void}

export function MicrosoftSignInStep({applicationId,detected,canRequest,preparing,disabled,code,expires,now,returned,error,onApplicationChange,onRequest,onReset}:Props) {
  const {t}=useI18n(),[copiedCode,setCopiedCode]=useState(''),[copyError,setCopyError]=useState('')
  useEffect(()=>{setCopiedCode('');setCopyError('')},[code?.userCode])
  const expired=!!code&&now>=expires,step=code||preparing?2:1
  const url=(()=>{try{const value=new URL(code?.verificationUrl||'');return value.protocol==='https:'?value.href:null}catch{return null}})()
  const copy=async()=>{
    if(!code||expired)return
    try {await navigator.clipboard.writeText(code.userCode);setCopiedCode(code.userCode);setCopyError('')}
    catch{setCopyError('Could not copy the code. Select and copy it manually.')}
  }
  return <div className={css.flow}>
    <ol className={css.steps} aria-label={t('Microsoft sign-in steps')}>
      {['Application','Sign in'].map((label,index)=><li key={label} aria-current={step===index+1?'step':undefined} data-complete={step>index+1}><span>{step>index+1?<Check size={12}/>:index+1}</span>{t(label)}</li>)}
    </ol>
    {step===1?<div className={css.setup}>
      <label>{t('Restore application ID')}<input value={applicationId} disabled={disabled||preparing} onChange={event=>onApplicationChange(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000"/></label>
      <p>{t('Use the Microsoft Entra application configured for restoring this organization.')}</p>
      {detected&&<p>{t('Detected from the organization connection settings.')}</p>}
      <Button className={css.primary} disabled={!canRequest||disabled||preparing} onClick={onRequest}><KeyRound size={16}/>{t('Get sign-in code')}<ArrowRight size={16}/></Button>
    </div>:<>
      <div className={css.application}><div><span>{t('Restore application ID')}</span><code title={applicationId}>{applicationId}</code></div><Button size="sm" variant="ghost" disabled={disabled||preparing} onClick={onReset}>{t('Change application')}</Button></div>
      <div className={css.stage} aria-live="polite">
        {preparing?<div className={css.waiting}><Loader2 size={22} className={css.spin}/><strong>{t('Preparing Microsoft sign-in…')}</strong></div>:expired?<>
          <strong>{t('This sign-in code expired. Request a new code and sign in again.')}</strong>
          <Button className={css.primary} disabled={!canRequest||disabled} onClick={onRequest}><KeyRound size={16}/>{t('Get a new sign-in code')}</Button>
        </>:code?<>
          <p>{t('Enter this code on the Microsoft sign-in page')}</p>
          <div className={css.code}><code>{code.userCode}</code><Button size="icon" variant="ghost" disabled={disabled} onClick={()=>void copy()} aria-label={t(copiedCode===code.userCode?'Code copied':'Copy code')} title={t(copiedCode===code.userCode?'Code copied':'Copy code')}>{copiedCode===code.userCode?<Check size={17}/>:<Copy size={17}/>}</Button></div>
          {url&&<Button className={css.primary} asChild><a href={url} target="_blank" rel="noopener noreferrer">{t('Open Microsoft sign-in')}<ExternalLink size={15}/></a></Button>}
          <p>{t('Complete Microsoft sign-in, then start the restore below.')}</p>
          {returned&&<p className={css.reminder}>{t('If Microsoft confirmed your sign-in, confirm the restore below.')}</p>}
          <small aria-live="off">{t('Code expires in {minutes}:{seconds}',{minutes:Math.floor(Math.max(0,expires-now)/60000),seconds:String(Math.floor(Math.max(0,expires-now)/1000)%60).padStart(2,'0')})}</small>
          {copyError&&<p className={css.error} role="alert">{t(copyError)}</p>}
        </>:null}
      </div>
    </>}
    {error&&<div className={css.error} role="alert">{t(error)}</div>}
  </div>
}
