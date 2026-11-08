'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, File, Folder, HardDrive, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { veeamApi } from '@/lib/api/veeam-client'
import { guestItemPath, uncertainRestore, type GuestDirectory, type GuestRestoreRequest, type GuestTask, type RestoreInventoryItem, type RestorePlatform } from '@/lib/restore-points/workflow'
import { TargetPicker } from './target-picker'
import { useRecoveryPresentation } from './use-presentation'
import styles from './workflow.module.css'

export function GuestFileBrowser(props: { sessionId: string; sourceKey: string }) {
  return <Browser key={props.sourceKey + props.sessionId} {...props} />
}

function Browser({ sessionId, sourceKey }: { sessionId: string; sourceKey: string }) {
  const { t, diagnostic, size } = useRecoveryPresentation()
  const [history, setHistory] = useState<string[]>([])
  const [skip, setSkip] = useState(0)
  const [directory, setDirectory] = useState<GuestDirectory>()
  const [selected, setSelected] = useState<string[]>([])
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
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
  const [task, setTask] = useState<GuestTask>()
  const [taskError, setTaskError] = useState('')
  const lock = useRef(false)
  const path = history[history.length - 1]
  useEffect(() => {
    if (closed) return
    const controller = new AbortController()
    setLoading(true)
    setDirectory(undefined)
    setError('')
    veeamApi.browseGuestFiles(sessionId, sourceKey, path, skip, controller.signal).then(value => {
      if (!controller.signal.aborted) setDirectory(value)
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t('Recovery request failed.')) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [sessionId, sourceKey, path, skip, revision, closed, t])
  useEffect(() => {
    if (action !== 'restore') return
    const controller = new AbortController()
    veeamApi.guestCredentials(sessionId, sourceKey, controller.signal)
      .then(value => { if (!controller.signal.aborted) setCredentials(value.credentials) })
      .catch(() => { /* VBR can use the credentials already associated with the guest. */ })
    return () => controller.abort()
  }, [action, sourceKey, sessionId])
  const taskId = task?.id
  const runningTask = !!taskId && !['stopped','finished','completed','failed','succeeded','canceled','cancelled'].includes(task?.state?.toLowerCase() || '')
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
        setSelected([])
      } else {
        await veeamApi.modifyGuestFiles({ action, sessionId, sourceKey })
        setClosed(true)
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
    </> : <>
      <div className={styles.bar}>
        <Button variant="ghost" size="sm" disabled={!history.length || loading} onClick={() => { setHistory(previous => previous.slice(0,-1)); setSkip(0) }}><ArrowLeft size={14} />{t('Back')}</Button>
        <strong>{path || directory?.path || t('Guest file system')}</strong>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => setRevision(n => n+1)}>{t('Refresh')}</Button>
      </div>
      {loading ? <p className={styles.status}><Loader2 size={15} className="animate-spin" />{t('Loading…')}</p>
        : directory && <><ul className={styles.files}>{directory.items.map(item => {
          const fullPath = guestItemPath(item,directory)
          const canOpen = item.type === 'Drive' || item.type === 'Folder'
          const Icon = item.type === 'Drive' ? HardDrive : canOpen ? Folder : File
          return <li key={fullPath}>
            {item.type !== 'Drive' && <input type="checkbox" aria-label={fullPath} checked={selected.includes(fullPath)} onChange={event => setSelected(current => event.target.checked ? [...current,fullPath] : current.filter(value => value !== fullPath))} />}
            <Icon size={15} />{canOpen ? <button type="button" onClick={() => { setHistory(previous => [...previous,fullPath]); setSkip(0) }}>{item.displayName || item.name}<ChevronRight size={14} /></button> : <span>{item.displayName || item.name}</span>}
            {item.type === 'File' && <small>{size(item.size)}</small>}
          </li>
        })}</ul>{!directory.items.length && <p>{t('This folder is empty.')}</p>}
        {(skip > 0 || directory.pagination.count + skip < directory.pagination.total) && <div className={styles.bar}>
          <Button size="sm" variant="outline" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip-directory.pagination.limit))}>{t('Previous')}</Button>
          <Button size="sm" variant="outline" disabled={!directory.pagination.count || skip + directory.pagination.count >= directory.pagination.total} onClick={() => setSkip(skip+directory.pagination.count)}>{t('Next')}</Button>
        </div>}</>}
      <div className={styles.actions}><Button disabled={!selected.length || runningTask || uncertain} onClick={() => { setAction('restore'); setError('') }}>{t('Restore selected files')}</Button></div>
    </>}
    {error && <p role="alert" className={styles.error}>{diagnostic(error)}</p>}
    {uncertain && <p>{t('Check Activity before submitting another request.')}</p>}
    {action && <div className={styles.actions}><Button variant="outline" disabled={busy} onClick={() => setAction(undefined)}>{t('Cancel')}</Button>
      <Button disabled={busy || uncertain || (action === 'restore' && custom && (!host || !targetPath.trim()))} onClick={confirm}>{busy && <Loader2 size={14} className="animate-spin" />}{action === 'unmount' ? t('Unmount') : t('Restore selected files')}</Button></div>}
  </section>
}
