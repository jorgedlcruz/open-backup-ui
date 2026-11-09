'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { veeamApi } from '@/lib/api/veeam-client'
import { uncertainRestore, type GuestRestoreRequest, type GuestTask, type RestoreInventoryItem, type RestorePlatform } from '@/lib/restore-points/workflow'
import { isTaskRunning, readWorkspace, workspaceKey, type GuestWorkspace } from '@/lib/restore-points/guest-workspace'
import { GuestFileExplorer } from './guest-file-explorer'
import { TargetPicker } from './target-picker'
import { useRecoveryPresentation } from './use-presentation'
import styles from './workflow.module.css'

type BrowserProps = { sessionId: string; sourceKey: string; onUnmount?: () => void }

export function GuestFileBrowser(props: BrowserProps) {
  return <MountedBrowser key={props.sourceKey + props.sessionId} {...props} />
}

function MountedBrowser(props: BrowserProps) {
  const [initial, setInitial] = useState<GuestWorkspace>()
  const storageKey = workspaceKey(props.sourceKey, props.sessionId)
  useEffect(() => {
    try { setInitial(readWorkspace(sessionStorage.getItem(storageKey))) }
    catch { setInitial({ cart: [] }) }
  }, [storageKey])
  return initial ? <Browser {...props} storageKey={storageKey} initial={initial} /> : null
}

function Browser({ sessionId, sourceKey, onUnmount, initial, storageKey }: BrowserProps & { initial: GuestWorkspace; storageKey: string }) {
  const { t, diagnostic } = useRecoveryPresentation()
  const [workspace, setWorkspace] = useState(initial)
  const selected = workspace.cart.map(item => item.path)
  const [error, setError] = useState('')
  const [action, setAction] = useState<'restore' | 'unmount'>()
  const [restoreType, setRestoreType] = useState<GuestRestoreRequest['restoreType']>('Keep')
  const [custom, setCustom] = useState(false)
  const [platform, setPlatform] = useState<RestorePlatform>('VSphere')
  const [server, setServer] = useState<RestoreInventoryItem>()
  const [host, setHost] = useState<RestoreInventoryItem>()
  const [targetPath, setTargetPath] = useState('')
  const [credentials, setCredentials] = useState<{id: string; name: string}[]>([])
  const [credentialsId, setCredentialsId] = useState('')
  const [closed, setClosed] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [task, setTask] = useState<GuestTask | undefined>(initial.task)
  const [taskError, setTaskError] = useState('')
  const lock = useRef(false)
  useEffect(() => {
    try {
      if (closed) sessionStorage.removeItem(storageKey)
      else sessionStorage.setItem(storageKey, JSON.stringify({ ...workspace, task }))
    } catch { /* The current tab still holds the cart in memory. */ }
  }, [storageKey, workspace, task, closed])
  useEffect(() => {
    if (action !== 'restore') return
    const controller = new AbortController()
    veeamApi.guestCredentials(sessionId, sourceKey, controller.signal)
      .then(value => { if (!controller.signal.aborted) setCredentials(value.credentials) })
      .catch(() => { /* VBR can use the credentials already associated with the guest. */ })
    return () => controller.abort()
  }, [action, sourceKey, sessionId])
  const taskId = task?.id
  const runningTask = isTaskRunning(task)
  useEffect(() => {
    if (!taskId || !runningTask || closed) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const status = await veeamApi.guestTask(sessionId, sourceKey, taskId!, controller.signal)
        if (!controller.signal.aborted) { setTask(status); setTaskError('') }
      } catch (err) {
        if (!controller.signal.aborted) setTaskError(err instanceof Error ? err.message : t('Recovery request failed.'))
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 5000)
      }
    }
    timer = setTimeout(poll, 2000)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [taskId, sessionId, sourceKey, runningTask, closed, t])

  async function confirm() {
    if (lock.current || !action || uncertain || (action === 'restore' && !selected.length)) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (action === 'restore') {
        const result = await veeamApi.modifyGuestFiles({
          action, sessionId, sourceKey, sourcePaths: selected, restoreType, credentialsId: credentialsId || undefined,
          ...(custom && { targetHost: host, targetPath: targetPath.trim() }),
        })
        setTask(result)
        setWorkspace(current => ({ ...current, cart: [] }))
      } else {
        await veeamApi.modifyGuestFiles({ action, sessionId, sourceKey })
        setClosed(true)
        try { sessionStorage.removeItem(storageKey) } catch { /* Tab storage can be unavailable. */ }
        onUnmount?.()
      }
      setAction(undefined)
    } catch (err) {
      setUncertain(uncertainRestore(err))
      setError(err instanceof Error ? err.message : t('Recovery request failed.'))
    } finally { lock.current = false; setBusy(false) }
  }
  if (closed) return <p role="status" className={styles.status}>{t('File system unmounted')}</p>
  return <section className={styles.browser}>
    <div className={styles.bar}><h3>{t('Guest file restore')}</h3>
      {!action && <Button variant="outline" size="sm" disabled={runningTask || uncertain} onClick={() => setAction('unmount')}>{t('Unmount')}</Button>}</div>
    {task && <p className={styles.status} role="status">{t('File restore task')} · {task.state || t('Recovery requested')}{task.progressPercent != null ? ' · ' + task.progressPercent + '%' : ''}{task.result && task.result !== 'None' ? ' · ' + task.result : ''}</p>}
    {taskError && <p role="alert" className={styles.error}>{diagnostic(taskError)}</p>}
    {action === 'unmount' ? <p>{t('End this guest file restore session and unmount its disks?')}</p> : action === 'restore' ? <>
      <ul className={styles.paths}>{selected.map(item => <li key={item}>{item}</li>)}</ul>
      <div className={styles.fields}><label className={styles.field}>{t('Destination')}<select value={custom ? 'new' : 'original'} onChange={event => { setCustom(event.target.value === 'new'); setRestoreType('Keep') }}>
        <option value="original">{t('Original location')}</option><option value="new">{t('New location')}</option></select></label>
        <label className={styles.field}>{t('Existing files')}<select value={restoreType} onChange={event => setRestoreType(event.target.value as GuestRestoreRequest['restoreType'])}>
          <option value="Keep">{t('Keep both copies')}</option><option value="Overwrite">{t('Overwrite existing files')}</option>
          {!custom && <option value="PermissionOnly">{t('Restore permissions only')}</option>}</select></label>
        {custom && <>
          <label className={styles.field}>{t('Platform')}<select value={platform} onChange={event => { setPlatform(event.target.value as RestorePlatform); setServer(undefined); setHost(undefined) }}>
            <option value="VSphere">VMware vSphere</option><option value="HyperV">Microsoft Hyper-V</option></select></label>
          <TargetPicker label={t('Inventory server')} platform={platform} kind="Server" sourceKey={sourceKey} value={server} onChange={item => { setServer(item); setHost(undefined) }} required />
          {server && <TargetPicker label={t('Virtual machine')} platform={platform} kind="VirtualMachine" server={server.hostName} sourceKey={sourceKey} value={host} onChange={setHost} required />}
          <label className={styles.field}>{t('Target folder')}<Input value={targetPath} onChange={event => setTargetPath(event.target.value)} required /></label>
        </>}
        {!!credentials.length && <label className={styles.field}>{t('Credentials')}<select value={credentialsId} onChange={event => setCredentialsId(event.target.value)}>
          <option value="">{t('Automatic selection')}</option>{credentials.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      </div>
    </> : <GuestFileExplorer sessionId={sessionId} sourceKey={sourceKey} workspace={workspace} setWorkspace={setWorkspace}
      restoreDisabled={runningTask || uncertain} onRestore={() => { setAction('restore'); setError('') }} />}
    {error && <p role="alert" className={styles.error}>{diagnostic(error)}</p>}
    {uncertain && <p>{t('Check Activity before submitting another request.')}</p>}
    {action && <div className={styles.actions}><Button variant="outline" disabled={busy} onClick={() => setAction(undefined)}>{t('Cancel')}</Button>
      <Button disabled={busy || uncertain || (action === 'restore' && custom && (!host || !targetPath.trim()))} onClick={confirm}>{busy && <Loader2 size={14} className="animate-spin" />}{action === 'unmount' ? t('Unmount') : t('Restore selected files')}</Button></div>}
  </section>
}
