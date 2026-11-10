'use client'
// Open Backup UI v1.0.2

import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ArrowLeft, ArrowRight, Check, File, Folder, Loader2, Search, ShoppingCart, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { veeamApi } from '@/lib/api/veeam-client'
import { guestRestoreBusy, isTaskRunning, type CartEntry, type GuestWorkspace } from '@/lib/restore-points/guest-workspace'
import { uncertainRestore, type GuestRestoreCheck, type GuestRestorePlan } from '@/lib/restore-points/workflow'
import { GuestDownloadPanel } from './guest-download'
import { useRecoveryPresentation } from './use-presentation'
import styles from './guest-cart.module.css'

type Step = 'items' | 'review' | 'progress'
type Policy = 'Keep' | 'Overwrite'
type Checked = { plan: GuestRestorePlan; result: GuestRestoreCheck | { status: 'error'; message: string } }
type Props = { sessionId: string; sourceKey: string; workspace: GuestWorkspace; setWorkspace: Dispatch<SetStateAction<GuestWorkspace>>; ready: boolean }

export function GuestRecoveryCart({ sessionId, sourceKey, workspace, setWorkspace, ready }: Props) {
  const { t, label, diagnostic, locale } = useRecoveryPresentation()
  const { cart, task, restore } = workspace
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('items')
  const [query, setQuery] = useState('')
  const [cleared, setCleared] = useState<CartEntry[]>()
  const [folder, setFolder] = useState('')
  const [policy, setPolicy] = useState<Policy>('Keep')
  const [checked, setChecked] = useState<Checked>()
  const [recheck, setRecheck] = useState(0)
  const [credentials, setCredentials] = useState<{id: string; name: string}[]>()
  const [credentialsError, setCredentialsError] = useState('')
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
  const restoreKey = task?.restoreKey
  const count = cart.length
  const counts = new Intl.NumberFormat(locale)
  const stateText = restore?.phase === 'sending' ? t('Recovery requested') : restore?.phase === 'unconfirmed' ? t('Recovery status unconfirmed')
    : label(task?.result && task.result !== 'None' ? task.result : task?.state || 'Starting')
  const policyText = (value: Policy | 'PermissionOnly') => value === 'Overwrite' ? t('Overwrite existing files') : value === 'PermissionOnly' ? t('Restore permissions only') : t('Keep both copies')
  const filtered = cart.filter(entry => entry.path.toLowerCase().includes(query.trim().toLowerCase()))
  const plan: GuestRestorePlan = useMemo(() => ({ sessionId, sourceKey, sourcePaths: cart.map(entry => entry.path),
    restoreType: policy, ...(credentialsId && { credentialsId }) }), [sessionId, sourceKey, cart, policy, credentialsId])
  const check = checked?.plan === plan ? checked.result : undefined
  const chooseCredentials = check?.status === 'credentialsRequired' || !!credentialsId
  const needsFolder = check?.status === 'targetPathRequired'
  const valid = count > 0 && ready && !busy && !restoreActive && (check?.status === 'ready' || (needsFolder && !!folder.trim()))

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
    if (!open || step !== 'review' || !ready || !count) return
    const controller = new AbortController()
    setChecked(undefined)
    veeamApi.guestRestoreCheck(plan, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (result.status === 'targetPathRequired') setFolder(result.targetPath)
      setChecked({plan, result})
    }).catch(err => {
      if (!controller.signal.aborted) setChecked({plan, result:{status:'error', message:err instanceof Error ? err.message : t('Recovery request failed.')}})
    })
    return () => controller.abort()
  }, [open, step, ready, count, plan, recheck, t])
  useEffect(() => {
    if (!open || step !== 'review' || !chooseCredentials) return
    const controller = new AbortController()
    setCredentials(undefined); setCredentialsError('')
    veeamApi.guestCredentials(sessionId, sourceKey, controller.signal).then(result => {
      if (!controller.signal.aborted) setCredentials(result.credentials)
    }).catch(err => {
      if (!controller.signal.aborted) setCredentialsError(err instanceof Error ? err.message : t('Recovery request failed.'))
    })
    return () => controller.abort()
  }, [open, step, chooseCredentials, sessionId, sourceKey, recheck, t])
  useEffect(() => {
    if (!running || !taskId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const currentTask = await veeamApi.guestTask(sessionId, sourceKey, taskId!, controller.signal, restoreKey)
        if (controller.signal.aborted) return
        setTaskError('')
        setWorkspace(current => current.task?.id === taskId ? { ...current, task: { ...currentTask, restoreKey } } : current)
        if (!isTaskRunning(currentTask)) return
      } catch (err) { if (!controller.signal.aborted) setTaskError(err instanceof Error ? err.message : t('Recovery request failed.')) }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000)
    }
    timer = setTimeout(poll, 1200)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [running, taskId, restoreKey, sessionId, sourceKey, setWorkspace, t])

  function show(next: Step, trigger: HTMLButtonElement) {
    opener.current = trigger
    setStep(next); setOpen(true); setError(''); setQuery(''); setCleared(undefined)
  }
  async function submit() {
    if (!valid || submission.current || step !== 'review') return
    submission.current = true
    setBusy(true); setError(''); setTaskError('')
    const paths = cart.map(entry => entry.path)
    const targetPath = needsFolder ? folder.trim() : undefined
    const receipt = { count, policy, ...(targetPath && {folder:targetPath}) }
    setWorkspace(current => ({ ...current, restore: { ...receipt, phase: 'sending' }, task: undefined }))
    try {
      const accepted = await veeamApi.restoreGuestFiles({ ...plan, ...(targetPath && {targetPath}) })
      if ('status' in accepted) {
        setWorkspace(current => ({...current, restore:undefined}))
        if (accepted.status === 'targetPathRequired') setFolder(accepted.targetPath)
        setChecked({plan, result:accepted})
        setStep('review')
        return
      }
      const submitted = new Set(paths)
      setWorkspace(current => ({ ...current, task: accepted, restore: { ...receipt, phase: 'accepted' }, cart: current.cart.filter(item => !submitted.has(item.path)) }))
      setStep('progress')
    } catch (err) {
      const uncertain = uncertainRestore(err)
      setError(err instanceof Error ? err.message : t('Recovery request failed.'))
      setWorkspace(current => ({ ...current, restore: uncertain ? { ...receipt, phase: 'unconfirmed' } : undefined }))
      setStep(uncertain ? 'progress' : 'review')
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
          <fieldset className={styles.choices} disabled={busy}><legend>{t('Restore to original location')}</legend>
            <label><input type="radio" name={dialogId} value="Keep" checked={policy === 'Keep'} onChange={() => setPolicy('Keep')}
              aria-labelledby={dialogId + '-keep'} aria-describedby={dialogId + '-keep-description'}/>
              <span><strong id={dialogId + '-keep'}>{policyText('Keep')}</strong>
                <small id={dialogId + '-keep-description'}>{t('If a name already exists, VBR adds {suffix} to the restored copy.', {suffix:'RESTORED_YYYYMMDD_HHMMSS'})}</small></span></label>
            <label><input type="radio" name={dialogId} value="Overwrite" checked={policy === 'Overwrite'} onChange={() => setPolicy('Overwrite')}
              aria-labelledby={dialogId + '-overwrite'} aria-describedby={dialogId + '-overwrite-description'}/>
              <span><strong id={dialogId + '-overwrite'}>{policyText('Overwrite')}</strong>
                <small id={dialogId + '-overwrite-description'}>{t('Replace matching files and folders with the versions from the backup.')}</small></span></label>
          </fieldset>
          {chooseCredentials && <div className={styles.field}>
            <label className={styles.field}>{t('Guest credentials')}
              <select value={credentialsId} disabled={busy || !credentials?.length} onChange={event => { setCredentialsId(event.target.value); setError('') }}>
                <option value="">{t('Use job credentials')}</option>
                {credentials?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></label>
            {check?.status === 'credentialsRequired' && <p role="status">{t('Choose a saved account that can write to the original guest.')}</p>}
            {check?.status === 'credentialsRequired' && check.message && <p className={styles.error}>{diagnostic(check.message)}</p>}
            {credentialsError ? <p role="alert" className={styles.error}>{diagnostic(credentialsError)}</p>
              : credentials?.length === 0 ? <p role="status">{t('No saved credentials')}</p> : null}
          </div>}
          {needsFolder && <div className={styles.field}><label className={styles.field}>{t('Target folder')}
            <Input value={folder} required disabled={busy} aria-describedby={dialogId + '-folder'} onChange={event => {setFolder(event.target.value); setError('')}}/></label>
            <small id={dialogId + '-folder'}>{t('VBR needs a folder on the original guest for these items.')}</small></div>}
          {!check && <p className={styles.checking} role="status"><Loader2 size={14} className="motion-safe:animate-spin"/>{t('Checking your selections against VBR…')}</p>}
          {check?.status === 'error' && <p role="alert" className={styles.error}>{diagnostic(check.message)}</p>}
          {(check?.status === 'error' || check?.status === 'credentialsRequired' || credentialsError || error) && <button type="button" disabled={busy} className={styles.textButton} onClick={() => {
            setChecked(undefined); setError(''); setRecheck(value => value + 1)
          }}>{t('Retry')}</button>}
        </div>}
        {step === 'progress' && <div className={styles.progress} role="status" aria-live="polite">
          <div className={styles.progressLabel}>{running || restore?.phase === 'sending' ? <Loader2 size={18} className="animate-spin"/> : task?.result === 'Success' ? <Check size={18}/> : null}
            <strong>{stateText}</strong>{progress != null && <span>{counts.format(progress)}%</span>}</div>
          {(running || restore?.phase === 'sending') && <progress max={100} value={progress} aria-label={t('File restore task')}/>}
          {restore && <dl>
            <div><dt>{t('Selected items')}</dt><dd>{counts.format(restore.count)}</dd></div>
            <div><dt>{t('Destination')}</dt><dd>{restore.target || t('Original location')}{restore.folder && <><br/>{restore.folder}</>}</dd></div>
            <div><dt>{t('Existing files')}</dt><dd>{policyText(restore.policy)}</dd></div>
          </dl>}
          {task?.message && <p>{diagnostic(task.message)}</p>}
          {(restore?.phase === 'unconfirmed' || task?.result === 'Failed' || task?.result === 'Warning' || taskError) &&
            <a className={styles.textButton} href="#session-log" onClick={() => setOpen(false)}>{t('Session log')}</a>}
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
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setStep('items')}><ArrowLeft size={14}/>{t('Back to cart')}</Button>
          <Button type="button" size="sm" disabled={!valid} onClick={submit}>{busy ? <><Loader2 size={14} className="motion-safe:animate-spin"/>{t('Recovery requested')}</> : <>{t('Start restore')}<ArrowRight size={14}/></>}</Button>
        </> : <>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('Continue browsing')}</Button>
          {step === 'items' && (restoreActive ? <Button type="button" size="sm" variant="outline" onClick={() => setStep('progress')}>{t('File restore task')}<ArrowRight size={14}/></Button>
            : <Button type="button" size="sm" disabled={!count || !ready} onClick={() => { setError(''); setCredentialsId(''); setChecked(undefined); setPolicy('Keep'); setStep('review') }}>{t('Review restore')}<ArrowRight size={14}/></Button>)}
          {step === 'progress' && <Button type="button" size="sm" variant="outline" onClick={() => {
            setStep('items'); setError('')
          }}>{t('Back to cart')}</Button>}
        </>}
      </footer>
    </dialog>
  </>
}
