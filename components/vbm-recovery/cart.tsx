'use client'
// Open Backup UI v1.3.0
import { useCallback,useEffect,useRef,useState } from 'react'
import { ArrowRight,ChevronDown,ChevronRight,FileKey2,KeyRound,Loader2,Search,ShieldCheck,ShoppingCart,Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/components/providers/i18n-provider'
import type { OperationReceipt,RecoveryItem,RecoveryPage,RestoreAuth,RestoreOptions,Workload } from '@/lib/vbm-recovery/model'
import type { RestoreAuthenticationSettings,RestoreDeviceCode } from '@/lib/vbm-recovery/restore-auth'
import { recoveryGet,recoveryPost,recoverReceipt } from './client'
import { certificateFileError,readRestoreCertificate } from './certificate-file'
import { type CartEntry,ItemIcon,itemKey } from './browser'
import { MicrosoftSignInStep } from './microsoft-sign-in'
import css from './workspace.module.css'
import signInCss from './microsoft-sign-in.module.css'

const isApplicationId=(value:string)=>/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.trim())
const isMailboxAddress=(value:string)=>/^[^\s<>@;,]+@[^\s<>@;,]+\.[^\s<>@;,]+$/.test(value.trim())
type ExchangeDestination='original'|'sameMailboxFolder'|'alternate'
const defaults:RestoreOptions={destination:'original',documentAction:'Keep',documentVersion:'Last',documentLastVersionAction:'Merge',restorePermissions:false,sendSharedLinksNotification:false,restoreChangedItems:false,restoreMissingItems:true}
export function RecoveryCart({sessionId,workload,entries,remove,clear,onSubmitted,ended,mailboxScoped,submissionBlocked,checkingOperations}:{sessionId:string;workload:Workload;mailboxScoped:boolean;entries:CartEntry[];remove:(keys:string[])=>void;clear:()=>void;onSubmitted:(receipts:OperationReceipt[],notice?:string,requestId?:string)=>string|void;ended:boolean;submissionBlocked?:boolean;checkingOperations?:boolean}) {
  const {t}=useI18n(),[query,setQuery]=useState(''),[formOptions,setOptions]=useState<RestoreOptions>(defaults)
  const [selectedMode,setMode]=useState<RestoreAuth['mode']>()
  const [chosenExchangeDestination,setExchangeDestination]=useState<ExchangeDestination>()
  const [editingOrganization,setEditingOrganization]=useState(false)
  const [enteredOriginalAddress,setEnteredOriginalAddress]=useState<{ownerId:string;address:string}>()
  const [applicationId,setApplicationId]=useState(''),[code,setCode]=useState<RestoreDeviceCode>(),[expires,setExpires]=useState(0),[userName,setUserName]=useState(''),[password,setPassword]=useState(''),[impersonation,setImpersonation]=useState('')
  const [certificate,setCertificate]=useState<File|null>(null),[certificateError,setCertificateError]=useState('')
  const certificateInput=useRef<HTMLInputElement>(null),certificatePassphrase=useRef<HTMLInputElement>(null)
  const clearPassphrase=useCallback(()=>{if(certificatePassphrase.current)certificatePassphrase.current.value=''},[])
  const [useImpersonation,setUseImpersonation]=useState(false)
  const [busy,setBusy]=useState(false),[authBusy,setAuthBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[targets,setTargets]=useState<RecoveryItem[]>([]),[targetsMore,setTargetsMore]=useState(false),[targetOffset,setTargetOffset]=useState(0)
  const [authSettings,setAuthSettings]=useState<RestoreAuthenticationSettings>(),[settingsLoading,setSettingsLoading]=useState(false),[settingsError,setSettingsError]=useState(''),[settingsRefresh,setSettingsRefresh]=useState(0),[authError,setAuthError]=useState(''),[now,setNow]=useState(Date.now)
  const hasEntries=entries.length>0
  const singleMailbox=workload==='Exchange'&&hasEntries&&entries.every(item=>item.ownerId===entries[0].ownerId)
  const mode=selectedMode ?? (workload==='Exchange'&&!authSettings?.passwordAllowed?'certificate':'deviceCode')
  const preferMailboxFolder=mailboxScoped && singleMailbox && !authSettings?.passwordAllowed && entries.every(item=>item.kind==='item')
  const exchangeDestination=chosenExchangeDestination??(preferMailboxFolder?'sameMailboxFolder':'original')
  const sameMailboxFolder=workload==='Exchange'&&exchangeDestination==='sameMailboxFolder'
  const ownerId=singleMailbox?entries[0].ownerId:undefined
  const addresses=new Set(entries.map(item=>item.ownerEmail?.trim().toLowerCase()).filter((value): value is string=>!!value&&isMailboxAddress(value)))
  const ownerAddress=singleMailbox&&addresses.size===1?[...addresses][0]:undefined
  const originalAddress=ownerAddress||(enteredOriginalAddress&&enteredOriginalAddress.ownerId===ownerId?enteredOriginalAddress.address:'')
  const targetLocation=workload==='Exchange'?(exchangeDestination==='original'?'original':'alternate'):formOptions.destination
  const allowCloudOverrides=targetLocation==='alternate'&&(mode==='certificate'||mode==='deviceCode')
  const options:RestoreOptions={
    ...formOptions,destination:targetLocation,
    organizationName:(allowCloudOverrides?formOptions.organizationName:undefined)??authSettings?.organizationName,
    officeRegion:(allowCloudOverrides?formOptions.officeRegion:undefined)??authSettings?.region??'Worldwide',
    ...(sameMailboxFolder?{originalMailboxFolder:true,mailbox:originalAddress}:{}),
  }
  const authGeneration=useRef(0),submitting=useRef(false)
  const invalidateAuth=useCallback(()=>{authGeneration.current++},[])
  const [signInReturned,setSignInReturned]=useState(false),[submission,setSubmission]=useState<{count:number;destination:string;startedAt:number}>()
  const resetSignIn=()=>{authGeneration.current++;setAuthBusy(false);setCode(undefined);setExpires(0);setSignInReturned(false);setAuthError('')}
  const change=(patch:Partial<RestoreOptions>)=>{setOptions(old=>({...old,...patch}));if(['destination','officeRegion','organizationName','siteURL'].some(key=>key in patch))resetSignIn()}
  const changeAuthentication=(nextMode:RestoreAuth['mode'])=>{
    resetSignIn()
    if(workload==='Exchange')setExchangeDestination(exchangeDestination)
    setMode(nextMode)
    setUseImpersonation(false)
    setImpersonation('')
    setPassword('')
    setCertificate(null)
    setCertificateError('')
    clearPassphrase()
  }
  const codeExpired=!!code&&now>=expires
  const impersonating=mode==='certificate' && workload==='Exchange' && useImpersonation
  const authReady=mode==='deviceCode'?!!code&&!codeExpired&&isApplicationId(applicationId):mode==='credentials'?!!authSettings?.passwordAllowed&&!!userName.trim()&&!!password:isApplicationId(applicationId)&&!!certificate&&(!impersonating||!!impersonation.trim())
  const matchesBackupApplication=!!authSettings?.applicationId && authSettings.applicationId.toLowerCase()===applicationId.trim().toLowerCase()
  const showAuthSetup=mode!=='deviceCode'||!code&&!authBusy
  useEffect(()=>{
    if(hasEntries&&!ended)return
    authGeneration.current++
    setCode(undefined);setExpires(0);setAuthError('');setAuthBusy(false)
    setPassword('');setCertificate(null);clearPassphrase();setCertificateError('');setUseImpersonation(false);setImpersonation('')
  },[hasEntries,ended,clearPassphrase])
  useEffect(()=>{
    if(!hasEntries||ended||authSettings)return
    const controller=new AbortController();setSettingsLoading(true);setSettingsError('')
    recoveryGet<RestoreAuthenticationSettings>({action:'authSettings',sessionId},controller.signal).then(settings=>{
      if(controller.signal.aborted)return
      setAuthSettings(settings);setApplicationId(old=>old||settings.applicationId||'')
    }).catch(e=>{if(!controller.signal.aborted)setSettingsError((e as Error).message)}).finally(()=>{if(!controller.signal.aborted)setSettingsLoading(false)})
    return()=>controller.abort()
  },[sessionId,settingsRefresh,hasEntries,ended,authSettings])
  useEffect(()=>{if(authSettings&&!authSettings.passwordAllowed&&mode==='credentials'){setMode('deviceCode');setPassword('')}},[authSettings,mode])
  useEffect(()=>{
    setSignInReturned(false)
    if(!code&&!busy)return
    const tick=()=>setNow(Date.now())
    const onReturn=()=>{if(document.visibilityState==='hidden')return;tick();if(code&&!busy)setSignInReturned(true)}
    tick();const timer=setInterval(tick,1000)
    window.addEventListener('focus',onReturn);document.addEventListener('visibilitychange',onReturn)
    return()=>{clearInterval(timer);window.removeEventListener('focus',onReturn);document.removeEventListener('visibilitychange',onReturn)}
  },[code,busy])
  useEffect(()=>{
    setCertificate(null);clearPassphrase();setCertificateError('')
    return invalidateAuth
  },[sessionId,mode,invalidateAuth,clearPassphrase])
  const hasFolders=entries.some(item=>item.kind==='folder')
  const supportsPermissions=workload==='SharePoint'&&options.destination==='original'||workload==='OneDrive'&&options.destination==='alternate'&&hasFolders
  const supportsSharedLinks=workload==='SharePoint'||workload==='OneDrive'&&options.destination==='alternate'&&hasFolders
  const teamsReady=workload!=='Teams'||options.restoreMissingItems||options.restoreChangedItems
  const exchangeOptionsSupported=workload==='Exchange' && options.destination==='alternate'
  const exchangeSettings={
    deletedItems:options.deletedItems??true,
    changedItems:options.changedItems??false,
    markRestoredAsUnread:options.markRestoredAsUnread??false,
  }
  const categorySelected=!exchangeOptionsSupported||exchangeSettings.deletedItems||exchangeSettings.changedItems
  const alternateReady=options.destination==='original'||(workload==='Exchange'?
    (!sameMailboxFolder||singleMailbox)&&isMailboxAddress(options.mailbox||'')&&!!options.folder?.trim():
    workload==='OneDrive'?!!options.targetOneDriveId&&!!options.folder?.trim():!!options.siteURL?.trim())
  const shown=entries.filter(item=>[item.name,item.ownerId].join(' ').toLowerCase().includes(query.toLowerCase()))
  const deviceTargetReady=options.destination==='original'||!!options.organizationName?.trim()
  const missingOrganization=mode==='deviceCode'&&!deviceTargetReady&&!settingsLoading&&Boolean(authSettings||settingsError)
  const showOrganizationFields=editingOrganization||missingOrganization
  const requestCode=async()=>{
    if(!isApplicationId(applicationId)||!deviceTargetReady||settingsLoading||authBusy||busy||ended)return
    resetSignIn();const current=authGeneration.current;setAuthBusy(true);setError('')
    try {
      const result=await recoveryPost<RestoreDeviceCode>({action:'deviceCode',sessionId,targetApplicationId:applicationId.trim(),...(options.destination==='alternate'?{targetOrganizationName:options.organizationName?.trim(),targetRegion:options.officeRegion||'Worldwide'}:{})})
      if(current!==authGeneration.current)return
      setCode(result);setExpires(Date.now()+result.expiresIn*1000);setNow(Date.now())
    }catch(e){if(current===authGeneration.current)setAuthError((e as Error).message)}finally{if(current===authGeneration.current)setAuthBusy(false)}
  }
  const loadTargets=async(append=false)=>{setError('');try{const result=await recoveryGet<RecoveryPage>({action:'browse',sessionId,workload:'OneDrive',kind:'owners',offset:append?targetOffset:0,limit:100});setTargets(old=>append?[...old,...result.items]:result.items);setTargetsMore(result.hasMore);setTargetOffset(result.nextOffset)}catch(e){setError((e as Error).message)}}
  const canSubmit = hasEntries && entries.length <= 100 && authReady && alternateReady && teamsReady && categorySelected && !ended && !busy && !uncertain && !submissionBlocked && !checkingOperations
  let destination = t('Original location')
  if (sameMailboxFolder) {
    destination = [originalAddress||entries[0]?.ownerName||entries[0]?.ownerId,options.folder?.trim()].filter(Boolean).join(' / ')
  } else if (options.destination === 'alternate') {
    const target = workload === 'OneDrive'
      ? targets.find(item => item.id === options.targetOneDriveId)?.name || options.targetOneDriveId
      : workload === 'Exchange' ? options.mailbox : options.siteURL
    destination = [target, workload === 'SharePoint' ? options.list : options.folder].filter(Boolean).join(' / ')
  }
  const submit=async()=>{
    if(!canSubmit||submitting.current)return
    if(mode==='deviceCode'&&Date.now()>=expires){setNow(Date.now());setError(t('This sign-in code expired. Request a new code and sign in again.'));return}
    const certificatePassword=mode==='certificate' ? certificatePassphrase.current?.value ?? '' : ''
    clearPassphrase()
    submitting.current=true;setBusy(true);setError('')
    const snapshot=entries.slice(),requestId=crypto.randomUUID(),startedAt=Date.now()
    setSubmission({count:snapshot.length,destination,startedAt});setNow(startedAt)
    let receiptsPublished=false
    const items=snapshot.map(item=>({id:item.id,ownerId:item.ownerId,kind:item.kind,channelId:item.channelId,parentId:item.parentId,name:item.name}))
    try {
      let encodedCertificate=''
      if(mode==='certificate'){
        const generation=authGeneration.current
        try {encodedCertificate=await readRestoreCertificate(certificate!)}
        catch {
          if(generation===authGeneration.current)setCertificateError(t('The certificate file could not be read. Select the file again.'))
          return
        }
        // A changed session, destination, or auth method invalidates the selection before the POST.
        if(generation!==authGeneration.current)return
      }
      let result:{operations:OperationReceipt[];notice?:string}
      try {
        const auth:RestoreAuth=mode==='deviceCode'?{mode,userCode:code!.userCode,applicationId:applicationId.trim()}:mode==='credentials'?{mode,userName:userName.trim(),userPassword:password}:{mode,applicationId:applicationId.trim(),applicationCertificate:encodedCertificate,applicationCertificatePassword:certificatePassword,...(impersonating?{impersonationAccountName:impersonation.trim()}:{})}
        const submittedOptions=exchangeOptionsSupported?{...options,...exchangeSettings,...(sameMailboxFolder?{mailbox:originalAddress.trim(),folder:options.folder?.trim()}:{})}:options
        result=await recoveryPost({action:'restore',requestId,sessionId,workload,items,auth,options:submittedOptions})
      }
      catch(firstError){if((firstError as {outcomeUnknown?:boolean}).outcomeUnknown===false)throw firstError;result=await recoverReceipt(requestId)}
      const accepted=result.operations.filter(receipt=>receipt.status==='accepted')
      const acceptedKeys=new Set(accepted.flatMap(receipt=>receipt.itemKeys||[]))
      remove(snapshot.filter(item=>acceptedKeys.has(itemKey(item))).map(itemKey))
      const unconfirmed=result.operations.some(receipt=>receipt.status==='unknown')
      setUncertain(unconfirmed)
      receiptsPublished=true
      const cartError=onSubmitted(result.operations,typeof result.notice==='string'?result.notice:undefined,requestId)
      if(typeof cartError==='string')setError(`${t('Not submitted')}. ${t(cartError)}`)
      else if(result.operations.some(receipt=>receipt.status!=='accepted'))setError(t('Some items were not accepted. Open Operations for the result of each group before trying again.'))
    }catch(e){
      const unknown=(e as {outcomeUnknown?:boolean}).outcomeUnknown!==false
      const message=`${(e as Error).message}${unknown?` ${t('Check Operations before submitting another restore.')}`:''} ${t('Request')}: ${requestId}`
      setError(message);setUncertain(unknown)
      if(unknown&&!receiptsPublished)onSubmitted([{group:`${t('Unconfirmed restore request')} · ${requestId}`,itemIds:snapshot.map(item=>item.id),itemKeys:snapshot.map(itemKey),itemCount:snapshot.length,status:'unknown',error:message}],undefined,requestId)
    }
    finally{submitting.current=false;setBusy(false);setSubmission(undefined);setPassword('');setCertificate(null);clearPassphrase();setCode(undefined)}
  }
  const elapsedSeconds=submission?Math.floor(Math.max(0,now-submission.startedAt)/1000):0
  const chooseCertificate=(input:HTMLInputElement)=>{
    if(submitting.current)return
    const file=input.files?.[0]
    if(!file)return
    authGeneration.current++
    clearPassphrase()
    const issue=certificateFileError(file)
    setCertificate(issue?null:file)
    setCertificateError(issue?t(issue):'')
    input.value=''
  }
  return <><div className={css.toolbar}><h2><ShoppingCart size={19}/>{t('Recovery cart')} <span className={css.count}>{entries.length}</span></h2><Button size="sm" variant="ghost" disabled={!entries.length||busy} onClick={clear}><Trash2 size={14}/>{t('Remove all')}</Button></div>
    {!hasEntries&&error&&<div className={`${css.notice} ${css.error}`} role="alert">{error}</div>}
    {checkingOperations&&hasEntries&&<p className={css.notice} role="status">{t('Checking recovery operations…')}</p>}
    {submissionBlocked&&<p className={css.notice} role="status">{t('Check Operations before submitting another restore.')}</p>}
    {busy&&submission?<section className={signInCss.submission} aria-label={t('Submitting restore request')}>
      <div className={signInCss.submissionHeader} role="status"><Loader2 size={26} className={signInCss.spin}/><div><h3>{t('Submitting restore request')}</h3><p>{t('Waiting for Veeam to acknowledge the restore request.')}</p></div></div>
      <dl className={signInCss.submissionFacts}><div><dt>{t('Selected items')}</dt><dd>{submission.count}</dd></div><div><dt>{t('Destination')}</dt><dd>{submission.destination}</dd></div><div><dt>{t('Elapsed time')}</dt><dd aria-live="off">{Math.floor(elapsedSeconds/60)}:{String(elapsedSeconds%60).padStart(2,'0')}</dd></div></dl>
    </section>:!entries.length?<div className={css.empty}><ShoppingCart size={38}/><strong>{t('A little empty. Full of possibilities.')}</strong><span>{t('Browse your backup and add the items you want to recover.')}</span></div>:<><div className={css.cartLayout}><section><label className={css.search}><Search size={15}/><input aria-label={t('Search recovery cart')} placeholder={t('Find an item in this cart')} value={query} onChange={e=>setQuery(e.target.value)}/></label><div className={css.cartList}>{shown.map(item=><div className={css.cartRow} key={itemKey(item)}><ItemIcon item={item}/><div><strong title={item.name}>{item.name}</strong><span className={css.sub}>{item.ownerName||item.ownerId} · {t(item.isFolder?'Folder and its contents':item.kind)}</span></div><Button size="icon" variant="ghost" disabled={busy} aria-label={t('Remove {name}',{name:item.name})} onClick={()=>remove([itemKey(item)])}><Trash2 size={14}/></Button></div>)}</div>
      <section className={css.section}><h3><ArrowRight size={17}/>{t('Restore destination')}</h3><div className={css.formGrid}><label className={css.field}>{t('Destination')}<select value={workload==='Exchange'?exchangeDestination:options.destination} disabled={busy||ended} onChange={e=>{
        if(workload==='Exchange'){
          setExchangeDestination(e.target.value as ExchangeDestination)
          resetSignIn()
          return
        }
        const destination=e.target.value as 'original'|'alternate'
        change({destination})
        if(destination==='alternate'&&workload==='OneDrive')void loadTargets()
      }}><option value="original">{t('Original location')}</option>{(singleMailbox||sameMailboxFolder)&&<option value="sameMailboxFolder" disabled={!singleMailbox}>{t('Folder in the original mailbox')}</option>}{workload!=='Teams'&&<option value="alternate">{t('Another location')}</option>}</select></label>
      {workload==='OneDrive'&&options.destination==='original'&&<label className={css.field}>{t('Existing documents')}<select value={options.documentAction} onChange={e=>change({documentAction:e.target.value as 'Keep'|'Overwrite'})}><option value="Keep">{t('Keep existing documents')}</option><option value="Overwrite">{t('Overwrite existing documents')}</option></select></label>}
      {(workload==='SharePoint'||workload==='OneDrive'&&options.destination==='alternate')&&<><label className={css.field}>{t('Existing documents')}<select value={options.documentLastVersionAction} onChange={e=>change({documentLastVersionAction:e.target.value as 'Merge'|'Overwrite'})}><option value="Merge">{t('Merge versions')}</option><option value="Overwrite">{t('Overwrite latest version')}</option></select></label><label className={css.field}>{t('Versions to restore')}<select value={options.documentVersion} onChange={e=>change({documentVersion:e.target.value as 'Last'|'All'})}><option value="Last">{t('Latest version')}</option><option value="All">{t('All versions')}</option></select></label></>}
      {workload==='Exchange'&&options.destination==='alternate'&&<label className={css.field}>{t('Target mailbox')}
        {sameMailboxFolder&&ownerAddress?<span>{ownerAddress}</span>:<input type="email" placeholder="user@example.com" disabled={busy||ended||sameMailboxFolder&&!ownerId} value={options.mailbox||''} onChange={e=>{
          if(sameMailboxFolder&&ownerId)setEnteredOriginalAddress({ownerId,address:e.target.value})
          else change({mailbox:e.target.value})
        }}/>}
      </label>}
      {options.destination==='alternate'&&workload==='OneDrive'&&<label className={css.field}>{t('Target OneDrive')}<select value={options.targetOneDriveId||''} onChange={e=>change({targetOneDriveId:e.target.value})}><option value="">{t('Select a OneDrive')}</option>{targets.map(target=><option key={target.id} value={target.id}>{target.name}</option>)}</select>{targetsMore&&<Button size="sm" variant="ghost" onClick={()=>loadTargets(true)}>{t('More OneDrives')}</Button>}</label>}
      {options.destination==='alternate'&&['Exchange','OneDrive'].includes(workload)&&<label className={css.field}>{t('Target folder')}<input disabled={busy||ended} maxLength={2048} placeholder={t('Restored items')} value={options.folder||''} onChange={e=>{if(workload==='Exchange')setExchangeDestination(exchangeDestination);change({folder:e.target.value})}}/></label>}
      {options.destination==='alternate'&&workload==='SharePoint'&&<><label className={css.field}>{t('Target site URL')}<input type="url" placeholder="https://tenant.sharepoint.com/sites/team" value={options.siteURL||''} onChange={e=>change({siteURL:e.target.value})}/></label><label className={css.field}>{t('Target library or list')}<input value={options.list||''} onChange={e=>change({list:e.target.value})}/></label></>}
      </div>
      <div style={{display:'grid',gap:12,marginTop:16}}>
        {exchangeOptionsSupported&&<>
          <label className={css.check}><input type="checkbox" disabled={ended} checked={exchangeSettings.deletedItems} onChange={e=>change({deletedItems:e.target.checked})}/>{t('Restore missing items')}</label>
          <label className={css.check}><input type="checkbox" disabled={ended} checked={exchangeSettings.changedItems} onChange={e=>change({changedItems:e.target.checked})}/>{t('Restore changed items')}</label>
          <label className={css.check}><input type="checkbox" disabled={ended} checked={exchangeSettings.markRestoredAsUnread} onChange={e=>change({markRestoredAsUnread:e.target.checked})}/>{t('Mark restored items as unread')}</label>
          {!categorySelected&&<p className={css.sub} role="status">{t('Choose missing items, changed items, or both to restore.')}</p>}
        </>}
        {workload==='Teams'&&<><label className={css.check}><input type="checkbox" checked={options.restoreMissingItems} onChange={e=>change({restoreMissingItems:e.target.checked})}/>{t('Restore missing items')}</label><label className={css.check}><input type="checkbox" checked={options.restoreChangedItems} onChange={e=>change({restoreChangedItems:e.target.checked})}/>{t('Restore changed items')}</label></>}
        {supportsPermissions&&<label className={css.check}><input type="checkbox" checked={options.restorePermissions} onChange={e=>change({restorePermissions:e.target.checked})}/>{t('Restore permissions')}</label>}
        {supportsSharedLinks&&<label className={css.check}><input type="checkbox" checked={options.sendSharedLinksNotification} onChange={e=>change({sendSharedLinksNotification:e.target.checked})}/>{t('Notify users about restored shared links')}</label>}
      </div>
      </section></section>
      <section className={css.section} style={{marginTop:0}}><h3><KeyRound size={17}/>{t('Connect to the restore destination')}</h3><p className={css.sub}>{t('Browsing uses the backup connection. Restoring signs in to the destination Microsoft 365 organization.')}</p>
      {showAuthSetup&&settingsLoading&&<p className={css.sub} style={{marginTop:12}}><Loader2 size={14} className={css.spin} style={{display:'inline',marginRight:6}}/>{t('Finding the restore application…')}</p>}
      {showAuthSetup&&settingsError&&<div className={css.notice}><p>{t('Enter the restore application ID manually, or retry detection.')}</p><Button size="sm" variant="ghost" disabled={settingsLoading||busy||ended} onClick={()=>setSettingsRefresh(value=>value+1)}>{t('Retry')}</Button></div>}
      {showAuthSetup&&<label className={css.field} style={{marginTop:14}}>{t('Authentication')}<select value={mode} disabled={busy||authBusy||ended} onChange={e=>changeAuthentication(e.target.value as RestoreAuth['mode'])}><option value="certificate">{t('Application certificate')}</option><option value="deviceCode">{t('Microsoft sign-in')}</option>{authSettings?.passwordAllowed&&<option value="credentials">{t('Username and password')}</option>}</select></label>}
      {allowCloudOverrides&&showAuthSetup&&<div style={{marginTop:14}}>
        <button type="button" className={css.back} aria-expanded={showOrganizationFields} aria-controls={showOrganizationFields?'restore-organization-fields':undefined}
          disabled={busy||authBusy||ended||missingOrganization} onClick={()=>setEditingOrganization(!showOrganizationFields)}>
          {showOrganizationFields?<ChevronDown size={15} aria-hidden="true"/>:<ChevronRight size={15} aria-hidden="true"/>}
          {t('Organization and region')}
        </button>
        {!showOrganizationFields&&<span className={css.sub} style={{marginInlineStart:8,overflowWrap:'anywhere'}}>
          {[options.organizationName,options.officeRegion].filter(Boolean).join(' · ')}
        </span>}
        {showOrganizationFields&&<div id="restore-organization-fields" className={css.formGrid} style={{marginTop:10}}>
          <label className={`${css.field} ${css.full}`}>{t('Destination organization')}
            <input disabled={busy||authBusy||ended} required={mode==='deviceCode'} value={options.organizationName||''}
              onChange={e=>{setEditingOrganization(true);change({organizationName:e.target.value})}} placeholder="tenant.onmicrosoft.com"/>
          </label>
          <label className={`${css.field} ${css.full}`}>{t('Microsoft 365 region')}
            <select disabled={busy||authBusy||ended} value={options.officeRegion} onChange={e=>change({officeRegion:e.target.value as RestoreOptions['officeRegion']})}>
              {(['Worldwide','Germany','China','USDefence','USGovernment'] as const).map(region=><option key={region} value={region}>{region}</option>)}
            </select>
          </label>
        </div>}
      </div>}
      {mode==='deviceCode'?<MicrosoftSignInStep applicationId={applicationId} detected={authSettings?.applicationId===applicationId} canRequest={isApplicationId(applicationId)&&deviceTargetReady&&!settingsLoading} preparing={authBusy} disabled={busy||ended} code={code} expires={expires} now={now} returned={signInReturned} error={authError} onApplicationChange={value=>{resetSignIn();setApplicationId(value)}} onRequest={()=>void requestCode()} onReset={resetSignIn}/>:mode==='credentials'?<div className={css.formGrid} style={{marginTop:14}}><label className={`${css.field} ${css.full}`}>{t('Username')}<input disabled={busy||ended} autoComplete="username" value={userName} onChange={e=>setUserName(e.target.value)}/></label><label className={`${css.field} ${css.full}`}>{t('Password')}<input disabled={busy||ended} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><p className={`${css.sub} ${css.full}`}>{t('Use this only when your destination supports password authentication.')}</p></div>:
        <div style={{display:'grid',gap:12,marginTop:14}}>
          <div className={css.field}>
            <label htmlFor="restore-certificate-app">{t('Application ID')}</label>
            <input id="restore-certificate-app" disabled={busy||ended} value={applicationId} onChange={e=>setApplicationId(e.target.value)} aria-describedby={matchesBackupApplication?'restore-certificate-app-hint':undefined}/>
            {matchesBackupApplication&&<p id="restore-certificate-app-hint" className={css.sub}>{t('Detected from the backup settings. You can enter a different application ID.')}</p>}
          </div>
          {workload==='Exchange'&&authSettings?.certificateThumbprint&&matchesBackupApplication&&<dl className={css.facts}><div><dt>{t('Backup certificate thumbprint')}</dt><dd style={{overflowWrap:'anywhere'}}>{authSettings.certificateThumbprint}</dd></div></dl>}
          <div className={css.field}>
            <span id="restore-certificate-label">{t('Certificate file (.pfx or .p12)')}</span>
            <div className={css.certificateChooser}>
              <input type="file" hidden ref={certificateInput} accept=".pfx,.p12" disabled={busy||ended} aria-labelledby="restore-certificate-label" onChange={e=>chooseCertificate(e.currentTarget)}/>
              <Button type="button" size="sm" variant="outline" disabled={busy||ended} aria-invalid={certificateError?true:undefined}
                aria-describedby={['restore-certificate-label','restore-certificate-name',certificateError&&'restore-certificate-error'].filter(Boolean).join(' ')}
                onClick={()=>certificateInput.current?.click()}><FileKey2 aria-hidden="true"/>{t(certificate?'Change certificate':'Select certificate')}</Button>
              <span id="restore-certificate-name" className={css.certificateName} data-selected={certificate?true:undefined} role="status" title={certificate?.name}>{certificate?.name||t('No certificate selected')}</span>
            </div>
          </div>
          {certificateError&&<p id="restore-certificate-error" className={css.error} role="alert">{certificateError}</p>}
          <form autoComplete="off" onSubmit={e=>e.preventDefault()}>
            <label className={css.field}>{t('Certificate passphrase')}
              <input ref={certificatePassphrase} disabled={busy||ended} type="password" autoComplete="section-certificate one-time-code"
                spellCheck={false} autoCapitalize="none"/>
            </label>
          </form>{workload==='Exchange'&&<>
        <label className={css.check}><input type="checkbox" disabled={busy||ended} checked={useImpersonation} onChange={e=>{setUseImpersonation(e.target.checked);setImpersonation('')}}/>{t('Use an impersonation account')}</label>
        {useImpersonation&&<label className={css.field}>{t('Impersonation account')}<input disabled={busy||ended} maxLength={512} autoComplete="off" value={impersonation} onChange={e=>setImpersonation(e.target.value)}/></label>}
      </>}</div>}
      <p className={css.sub} style={{marginTop:18}}><ShieldCheck size={14} style={{display:'inline',marginRight:6}}/>{t('Credentials are used for this request and are not saved in the cart.')}</p></section></div>
      {error&&<div className={`${css.notice} ${css.error}`} role="alert">{error}</div>}
      <div className={css.reviewFooter}><dl className={css.facts}><div><dt>{t('Selected items')}</dt><dd>{entries.length}</dd></div><div><dt>{t('Destination')}</dt><dd>{destination||'—'}</dd></div></dl><Button disabled={!canSubmit} onClick={submit}>{busy?<Loader2 size={16} className={css.spin}/>:<ArrowRight size={16}/>} {t(busy?'Starting restore…':'Start restore')}</Button></div>{entries.length>100&&<p className={css.notice}>{t('Restore up to 100 selected items at a time. Selected folders include their contents.')}</p>}
    </>}
  </>
}
