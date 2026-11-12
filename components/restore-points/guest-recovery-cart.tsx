'use client'
// Open Backup UI v1.2.0

import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, File, Folder, FolderOpen, Loader2, Search, ShoppingCart, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { veeamApi } from '@/lib/api/veeam-client'
import { guestRestoreBusy, isTaskRunning, type CartEntry, type GuestWorkspace } from '@/lib/restore-points/guest-workspace'
import { uncertainRestore, type GuestRestoreCheck, type GuestRestorePlan } from '@/lib/restore-points/workflow'
import { GuestDownloadPanel } from './guest-download'
import { useRecoveryPresentation } from './use-presentation'
import styles from './guest-cart.module.css'

type Step = 'items' | 'review'
type Policy = 'Keep' | 'Overwrite'
type Checked = { plan: GuestRestorePlan; result: GuestRestoreCheck | { status: 'error'; message: string } }
type Props = { sessionId: string; sourceKey: string; workspace: GuestWorkspace; setWorkspace: Dispatch<SetStateAction<GuestWorkspace>>; ready: boolean; children: ReactNode }

export function GuestRecoveryCart({ sessionId, sourceKey, workspace, setWorkspace, ready, children }: Props) {
  const { t, label, diagnostic, locale } = useRecoveryPresentation()
  const { cart, task, restore } = workspace
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState(false)
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
  const heading = useRef<HTMLHeadingElement>(null)
  const browseButton = useRef<HTMLButtonElement>(null)
  const taskHeading = useRef<HTMLHeadingElement>(null)
  const focusTask = useRef(false)
  const reviewVisible = useRef(false)
  const submission = useRef(false)
  const titleId = useId()
  const panelId = useId()
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

  useEffect(() => { if (open) heading.current?.focus({ preventScroll: true }) }, [open, step])
  useEffect(() => { reviewVisible.current = open }, [open])
  useEffect(() => {
    if (!open && focusTask.current && taskHeading.current) {
      taskHeading.current.focus({ preventScroll: true }); focusTask.current = false
    }
  }, [open, taskId, restore?.phase])
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

  function browse() {
    setOpen(false); browseButton.current?.focus({ preventScroll: true })
  }
  function show() {
    setStep('items'); setOpen(true); setError(''); setQuery(''); setCleared(undefined)
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
        setStep('review'); setOpen(true)
        return
      }
      const submitted = new Set(paths)
      setWorkspace(current => ({ ...current, task: accepted, restore: { ...receipt, phase: 'accepted' }, cart: current.cart.filter(item => !submitted.has(item.path)) }))
      focusTask.current = reviewVisible.current
      setDetails(false); setStep('items'); setOpen(false)
    } catch (err) {
      const uncertain = uncertainRestore(err)
      setError(err instanceof Error ? err.message : t('Recovery request failed.'))
      setWorkspace(current => ({ ...current, restore: uncertain ? { ...receipt, phase: 'unconfirmed' } : undefined }))
      if (uncertain) { focusTask.current = reviewVisible.current; setDetails(true); setOpen(false); setStep('items') }
      else { setStep('review'); setOpen(true) }
    } finally { submission.current = false; setBusy(false) }
  }
  const title = step === 'items' ? t('Recovery cart') : t('Review restore')
  const progress = task?.progressPercent == null ? undefined : Math.max(0, Math.min(100, task.progressPercent))

  return <div className={styles.workspace}>
    <div className={styles.toolbar}><h3>{t('Guest file restore')}</h3>
      <div className={styles.navigation}>
        <Button ref={browseButton} type="button" variant={!open ? 'secondary' : 'ghost'} size="sm" aria-pressed={!open} onClick={browse}><FolderOpen size={16}/>{t('Browse files')}</Button>
        <Button type="button" variant={open ? 'secondary' : 'ghost'} size="sm" aria-controls={panelId} aria-expanded={open}
          className={styles.trigger} onClick={show}><ShoppingCart size={16}/>{t('Recovery cart')}<span className={styles.count}>{counts.format(count)}</span></Button>
      </div>
    </div>
    {(task || restore) && <section className={styles.operation} aria-label={t('File restore task')} data-result={restore?.phase === 'unconfirmed' ? 'Warning' : task?.result}>
      <div className={styles.operationBar}>
        <div className={styles.operationIcon}>{running || restore?.phase === 'sending' ? <Loader2 size={18} className={styles.spinner}/> : task?.result === 'Success' ? <Check size={18}/> : <File size={18}/>}</div>
        <div className={styles.operationTitle}><h4 ref={taskHeading} tabIndex={-1}>{t('File restore task')}</h4>
          {restore && <small>{t('{count} selected', {count:counts.format(restore.count)})} · {restore.target || t('Original location')}</small>}
        </div>
        <div className={styles.operationState} role="status" aria-live="polite"><strong>{stateText}</strong>{progress != null && <span>{counts.format(progress)}%</span>}</div>
        <Button type="button" variant="ghost" size="sm" aria-expanded={details} aria-controls={panelId + '-task'} onClick={() => setDetails(value => !value)}>{t('Details')}<ChevronDown size={14} className={details ? styles.rotated : undefined}/></Button>
      </div>
      {(running || restore?.phase === 'sending') && <progress max={100} value={progress} aria-label={t('File restore task')}/>}
      <div id={panelId + '-task'} hidden={!details} className={styles.taskDetails}>
        {restore && <dl>
          <div><dt>{t('Selected items')}</dt><dd>{counts.format(restore.count)}</dd></div>
          <div><dt>{t('Destination')}</dt><dd>{restore.target || t('Original location')}{restore.folder && <><br/>{restore.folder}</>}</dd></div>
          <div><dt>{t('Existing files')}</dt><dd>{policyText(restore.policy)}</dd></div>
        </dl>}
        {task?.message && <p>{diagnostic(task.message)}</p>}
        <a className={styles.textButton} href="#session-log">{t('Session log')}</a>
      </div>
      {(restore?.phase === 'unconfirmed' || taskError || error && !open) && <div className={styles.operationNotice}>
        {error && <p role="alert" className={styles.error}>{diagnostic(error)}</p>}
        {taskError && <p role="alert" className={styles.error}>{diagnostic(taskError)}</p>}
        {restore?.phase === 'unconfirmed' && <><p>{t('Check Sessions before submitting another request.')}</p>
          <a className={styles.textButton} href="#session-log">{t('Session log')}</a>
          <button type="button" className={styles.textButton} onClick={() => {
            setWorkspace(current => current.restore?.phase === 'unconfirmed' ? { ...current, restore: undefined } : current)
            setError('')
          }}>{t('I checked the session log')}</button></>}
      </div>}
    </section>}
    <div hidden={open}>{children}</div>
    <section id={panelId} hidden={!open} aria-labelledby={titleId} className={styles.panel} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); browse() }
    }}>
      <header className={styles.header}>
        <div className={styles.title}><ShoppingCart size={19}/><h2 tabIndex={-1} ref={heading} id={titleId}>{title}</h2></div>
        <Button type="button" size="sm" variant="ghost" onClick={browse}><ArrowLeft size={14}/>{t('Continue browsing')}</Button>
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
            <label><input type="radio" name={panelId} value="Keep" checked={policy === 'Keep'} onChange={() => setPolicy('Keep')}
              aria-labelledby={panelId + '-keep'} aria-describedby={panelId + '-keep-description'}/>
              <span><strong id={panelId + '-keep'}>{policyText('Keep')}</strong>
                <small id={panelId + '-keep-description'}>{t('If a name already exists, VBR adds {suffix} to the restored copy.', {suffix:'RESTORED_YYYYMMDD_HHMMSS'})}</small></span></label>
            <label><input type="radio" name={panelId} value="Overwrite" checked={policy === 'Overwrite'} onChange={() => setPolicy('Overwrite')}
              aria-labelledby={panelId + '-overwrite'} aria-describedby={panelId + '-overwrite-description'}/>
              <span><strong id={panelId + '-overwrite'}>{policyText('Overwrite')}</strong>
                <small id={panelId + '-overwrite-description'}>{t('Replace matching files and folders with the versions from the backup.')}</small></span></label>
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
            <Input value={folder} required disabled={busy} aria-describedby={panelId + '-folder'} onChange={event => {setFolder(event.target.value); setError('')}}/></label>
            <small id={panelId + '-folder'}>{t('VBR needs a folder on the original guest for these items.')}</small></div>}
          {!check && <p className={styles.checking} role="status"><Loader2 size={14} className="motion-safe:animate-spin"/>{t('Checking your selections against VBR…')}</p>}
          {check?.status === 'error' && <p role="alert" className={styles.error}>{diagnostic(check.message)}</p>}
          {(check?.status === 'error' || check?.status === 'credentialsRequired' || credentialsError || error) && <button type="button" disabled={busy} className={styles.textButton} onClick={() => {
            setChecked(undefined); setError(''); setRecheck(value => value + 1)
          }}>{t('Retry')}</button>}
        </div>}
        {error && <p role="alert" className={styles.error}>{diagnostic(error)}</p>}
      </div>
      <footer className={styles.footer}>
        {step === 'review' ? <>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setStep('items')}><ArrowLeft size={14}/>{t('Back to cart')}</Button>
          <Button type="button" size="sm" disabled={!valid} onClick={submit}>{busy ? <><Loader2 size={14} className="motion-safe:animate-spin"/>{t('Recovery requested')}</> : <>{t('Start restore')}<ArrowRight size={14}/></>}</Button>
        </> : <>
          <span>{t('{count} selected', {count:counts.format(count)})}</span>
          <Button type="button" size="sm" disabled={!count || !ready || busy || restoreActive} onClick={() => { setError(''); setCredentialsId(''); setChecked(undefined); setPolicy('Keep'); setStep('review') }}>{t('Review restore')}<ArrowRight size={14}/></Button>
        </>}
      </footer>
    </section>
  </div>
}
