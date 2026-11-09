'use client'

import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ArrowLeft, ArrowRight, Check, File, Folder, Loader2, Search, ShoppingCart, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { veeamApi } from '@/lib/api/veeam-client'
import { guestRestoreBusy, isTaskRunning, type CartEntry, type GuestWorkspace } from '@/lib/restore-points/guest-workspace'
import { uncertainRestore, type GuestRestoreRequest, type RestoreInventoryItem, type RestorePlatform } from '@/lib/restore-points/workflow'
import { GuestDownloadPanel } from './guest-download'
import { TargetPicker } from './target-picker'
import { useRecoveryPresentation } from './use-presentation'
import styles from './guest-cart.module.css'

type Step = 'items' | 'review' | 'progress'
type Policy = NonNullable<GuestRestoreRequest['restoreType']>
type Props = { sessionId: string; sourceKey: string; workspace: GuestWorkspace; setWorkspace: Dispatch<SetStateAction<GuestWorkspace>>; ready: boolean }

export function GuestRecoveryCart({ sessionId, sourceKey, workspace, setWorkspace, ready }: Props) {
  const { t, label, diagnostic, locale } = useRecoveryPresentation()
  const { cart, task, restore } = workspace
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('items')
  const [query, setQuery] = useState('')
  const [cleared, setCleared] = useState<CartEntry[]>()
  const [custom, setCustom] = useState(false)
  const [platform, setPlatform] = useState<RestorePlatform>('VSphere')
  const [server, setServer] = useState<RestoreInventoryItem>()
  const [host, setHost] = useState<RestoreInventoryItem>()
  const [folder, setFolder] = useState('')
  const [policy, setPolicy] = useState<Policy>('Keep')
  const [advanced, setAdvanced] = useState(false)
  const [credentials, setCredentials] = useState<{id: string; name: string}[]>([])
  const [credentialsId, setCredentialsId] = useState('')
  const [error, setError] = useState('')
  const [taskError, setTaskError] = useState('')
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const submission = useRef(false)
  const titleId = useId()
  const dialogId = useId()
  const restoreActive = guestRestoreBusy(workspace)
  const running = isTaskRunning(task)
  const taskId = task?.id
  const count = cart.length
  const counts = new Intl.NumberFormat(locale)
  const stateText = restore?.phase === 'sending' ? t('Recovery requested') : restore?.phase === 'unconfirmed' ? t('Recovery status unconfirmed')
    : label(task?.result && task.result !== 'None' ? task.result : task?.state || 'Starting')
  const policyText = (value: Policy) => value === 'Overwrite' ? t('Overwrite existing files') : value === 'PermissionOnly' ? t('Restore permissions only') : t('Keep both copies')
  const filtered = cart.filter(entry => entry.path.toLowerCase().includes(query.trim().toLowerCase()))
  const valid = count > 0 && ready && !busy && !restoreActive && (!custom || (!!host && !!folder.trim()))

  useEffect(() => {
    const element = dialog.current
    if (!open || !element) return
    if (!element.open) element.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      if (element.open) element.close()
      opener.current?.focus({ preventScroll: true })
    }
  }, [open])
  useEffect(() => { if (open) heading.current?.focus({ preventScroll: true }) }, [open, step])
  useEffect(() => {
    if (!open || step !== 'review' || !advanced) return
    const controller = new AbortController()
    veeamApi.guestCredentials(sessionId, sourceKey, controller.signal).then(result => {
      if (!controller.signal.aborted) setCredentials(result.credentials)
    }).catch(() => { /* The automatic guest credential remains available. */ })
    return () => controller.abort()
  }, [open, step, advanced, sessionId, sourceKey])
  useEffect(() => {
    if (!running || !taskId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const currentTask = await veeamApi.guestTask(sessionId, sourceKey, taskId!, controller.signal)
        if (controller.signal.aborted) return
        setTaskError('')
        setWorkspace(current => current.task?.id === taskId ? { ...current, task: currentTask } : current)
        if (!isTaskRunning(currentTask)) return
      } catch (err) { if (!controller.signal.aborted) setTaskError(err instanceof Error ? err.message : t('Recovery request failed.')) }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000)
    }
    timer = setTimeout(poll, 1200)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [running, taskId, sessionId, sourceKey, setWorkspace, t])

  function show(next: Step, trigger: HTMLButtonElement) {
    opener.current = trigger
    setStep(next); setOpen(true); setError(''); setQuery(''); setCleared(undefined)
  }
  async function submit() {
    if (!valid || submission.current || step !== 'review') return
    submission.current = true
    setBusy(true); setError(''); setTaskError(''); setStep('progress')
    const paths = cart.map(entry => entry.path)
    const receipt = { count, policy, target: custom ? host?.name : undefined, folder: custom ? folder.trim() : undefined }
    setWorkspace(current => ({ ...current, restore: { ...receipt, phase: 'sending' }, task: undefined }))
    try {
      const accepted = await veeamApi.modifyGuestFiles({ action: 'restore', sessionId, sourceKey, sourcePaths: paths, restoreType: policy,
        credentialsId: credentialsId || undefined, ...(custom && { targetHost: host, targetPath: folder.trim() }) })
      const submitted = new Set(paths)
      setWorkspace(current => ({ ...current, task: accepted, restore: { ...receipt, phase: 'accepted' }, cart: current.cart.filter(item => !submitted.has(item.path)) }))
    } catch (err) {
      const uncertain = uncertainRestore(err)
      setError(err instanceof Error ? err.message : t('Recovery request failed.'))
      setWorkspace(current => ({ ...current, restore: uncertain ? { ...receipt, phase: 'unconfirmed' } : undefined }))
      if (!uncertain) setStep('review')
    } finally { submission.current = false; setBusy(false) }
  }
  const title = step === 'items' ? t('Recovery cart') : step === 'review' ? t('Review restore') : t('File restore task')
  const progress = task?.progressPercent == null ? undefined : Math.max(0, Math.min(100, task.progressPercent))

  return <>
    {(task || restore) && <button type="button" className={styles.taskPill} onClick={e => show('progress', e.currentTarget)} aria-label={t('File restore task') + ' · ' + stateText}>
      {running || restore?.phase === 'sending' ? <Loader2 size={14} className="animate-spin"/> : null}{stateText}{running && progress != null ? ' · ' + progress + '%' : ''}
    </button>}
    <Button type="button" variant="outline" size="sm" aria-haspopup="dialog" aria-controls={dialogId} aria-expanded={open}
      className={styles.trigger} onClick={e => show('items', e.currentTarget)}><ShoppingCart size={16}/>{t('Recovery cart')}<span className={styles.count}>{counts.format(count)}</span></Button>
    <dialog id={dialogId} ref={dialog} aria-labelledby={titleId} data-slot="dialog-content" className={styles.drawer}
      onCancel={event => { event.preventDefault(); setOpen(false) }} onClick={event => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false)
      }}>
      <header className={styles.header}>
        <div className={styles.title}><ShoppingCart size={19}/><h2 tabIndex={-1} ref={heading} id={titleId}>{title}</h2></div>
        <button type="button" className={styles.iconButton} aria-label={t('Close')} onClick={() => setOpen(false)}><X size={17}/></button>
      </header>
      <div className={styles.body}>
        <div hidden={step !== 'items'}>
          <div className={styles.listTools}><span aria-live="polite">{t('{count} selected', {count: counts.format(count)})}</span>
            {count > 0 && <button type="button" className={styles.textButton} onClick={() => {
              setCleared(cart); setQuery(''); setWorkspace(current => ({ ...current, cart: [] }))
            }}>{t('Remove all')}</button>}
            {cleared && !count && <button type="button" className={styles.textButton} onClick={() => {
              setWorkspace(current => ({...current, cart: cleared})); setCleared(undefined)
            }}>{t('Undo')}</button>}
          </div>
          {count > 0 ? <>
            <label className={styles.search}><Search size={15}/><Input type="search" value={query} placeholder={t('Search cart paths')} aria-label={t('Search cart paths')} onChange={e => setQuery(e.target.value)}/></label>
            <ul className={styles.paths}>{filtered.map(entry => {
              const split = Math.max(entry.path.lastIndexOf('/'), entry.path.lastIndexOf('\\'))
              return <li key={entry.path}>{entry.type === 'Folder' ? <Folder size={17}/> : <File size={17}/>}
                <div title={entry.path}><strong>{entry.path.slice(split + 1) || entry.path}</strong><small>{entry.path.slice(0, split + 1)}</small></div>
                <button type="button" className={styles.iconButton} aria-label={t('Remove {name}', {name: entry.path})} onClick={() => {
                  setCleared(undefined); setWorkspace(current => ({ ...current, cart: current.cart.filter(item => item.path !== entry.path) }))
                }}><X size={15}/></button></li>
            })}</ul>
            {!filtered.length && <p className={styles.empty} role="status">{t('No results')}</p>}
          </> : <p className={styles.empty}>{t('Select files or folders to add them to the cart.')}</p>}
          {(count > 0 || workspace.download) && <GuestDownloadPanel sessionId={sessionId} sourceKey={sourceKey} workspace={workspace} setWorkspace={setWorkspace} enabled={ready}/>}
        </div>
        {step === 'review' && <div className={styles.review}>
          <details className={styles.summary}><summary>{t('{count} selected', {count: counts.format(count)})}</summary>
            <ul>{cart.map(entry => <li key={entry.path}>{entry.path}</li>)}</ul>
          </details>
          <fieldset className={styles.destinations}><legend>{t('Destination')}</legend>
            <label><input type="radio" name={dialogId} checked={!custom} onChange={() => { setCustom(false); setPolicy('Keep') }}/>{t('Original location')}</label>
            <label><input type="radio" name={dialogId} checked={custom} onChange={() => { setCustom(true); setPolicy('Keep') }}/>{t('New location')}</label>
          </fieldset>
          {custom && <div className={styles.targets}>
            <label>{t('Platform')}<select value={platform} onChange={event => { setPlatform(event.target.value as RestorePlatform); setServer(undefined); setHost(undefined) }}>
              <option value="VSphere">VMware vSphere</option><option value="HyperV">Microsoft Hyper-V</option></select></label>
            <TargetPicker label={t('Inventory server')} platform={platform} kind="Server" sourceKey={sourceKey} value={server} onChange={item => { setServer(item); setHost(undefined) }} required/>
            {server && <TargetPicker label={t('Virtual machine')} platform={platform} kind="VirtualMachine" server={server.hostName} sourceKey={sourceKey} value={host} onChange={setHost} required/>}
            <label>{t('Target folder')}<Input value={folder} onChange={event => setFolder(event.target.value)} required/></label>
          </div>}
          <label className={styles.field}>{t('Existing files')}<select value={policy} onChange={event => setPolicy(event.target.value as Policy)}>
            <option value="Keep">{policyText('Keep')}</option><option value="Overwrite">{policyText('Overwrite')}</option>
            {!custom && <option value="PermissionOnly">{policyText('PermissionOnly')}</option>}</select></label>
          <details open={advanced} className={styles.advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
            <summary>{t('Guest credentials')}</summary><label className={styles.field}>{t('Credentials')}<select value={credentialsId} onChange={event => setCredentialsId(event.target.value)}>
              <option value="">{t('Automatic selection')}</option>{credentials.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></details>
        </div>}
        {step === 'progress' && <div className={styles.progress} role="status" aria-live="polite">
          <div className={styles.progressLabel}>{running || restore?.phase === 'sending' ? <Loader2 size={18} className="animate-spin"/> : task?.result === 'Success' ? <Check size={18}/> : null}
            <strong>{stateText}</strong>{progress != null && <span>{counts.format(progress)}%</span>}</div>
          {(running || restore?.phase === 'sending') && <progress max={100} value={progress} aria-label={t('File restore task')}/>}
          {restore && <dl>
            <div><dt>{t('Selected items')}</dt><dd>{counts.format(restore.count)}</dd></div>
            <div><dt>{t('Destination')}</dt><dd>{restore.target ? <>{restore.target}<br/>{restore.folder}</> : t('Original location')}</dd></div>
            <div><dt>{t('Existing files')}</dt><dd>{policyText(restore.policy)}</dd></div>
          </dl>}
          {restore?.phase === 'unconfirmed' && <><p>{t('Check Sessions before submitting another request.')}</p>
            <button type="button" className={styles.textButton} onClick={() => {
              setWorkspace(current => current.restore?.phase === 'unconfirmed' ? { ...current, restore: undefined } : current)
              setStep('items'); setError('')
            }}>{t('I checked the session log')}</button></>}
        </div>}
        {error && <p role="alert" className={styles.error}>{diagnostic(error)}</p>}
        {taskError && step === 'progress' && <p role="alert" className={styles.error}>{diagnostic(taskError)}</p>}
      </div>
      <footer className={styles.footer}>
        {step === 'review' ? <>
          <Button type="button" size="sm" variant="ghost" onClick={() => setStep('items')}><ArrowLeft size={14}/>{t('Back to cart')}</Button>
          <Button type="button" size="sm" disabled={!valid} onClick={submit}>{t('Start restore')}<ArrowRight size={14}/></Button>
        </> : <>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('Continue browsing')}</Button>
          {step === 'items' && (restoreActive ? <Button type="button" size="sm" variant="outline" onClick={() => setStep('progress')}>{t('File restore task')}<ArrowRight size={14}/></Button>
            : <Button type="button" size="sm" disabled={!count || !ready} onClick={() => { setError(''); setPolicy('Keep'); setStep('review') }}>{t('Review restore')}<ArrowRight size={14}/></Button>)}
          {step === 'progress' && <Button type="button" size="sm" variant="outline" onClick={() => {
            setStep('items'); setError('')
          }}>{t('Back to cart')}</Button>}
        </>}
      </footer>
    </dialog>
  </>
}
