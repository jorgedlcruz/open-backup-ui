'use client'
// Open Backup UI v1.2.0

import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { veeamApi } from '@/lib/api/veeam-client'
import { isTaskRunning, type GuestWorkspace } from '@/lib/restore-points/guest-workspace'
import { uncertainRestore } from '@/lib/restore-points/workflow'
import { useRecoveryPresentation } from './use-presentation'
import styles from './guest-files.module.css'

export function GuestDownloadPanel({ sessionId, sourceKey, workspace, setWorkspace, enabled }: {
  sessionId: string; sourceKey: string; workspace: GuestWorkspace; setWorkspace: Dispatch<SetStateAction<GuestWorkspace>>; enabled: boolean
}) {
  const { t, diagnostic, label } = useRecoveryPresentation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const transfer = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => transfer.current?.abort(), [])
  const guard = useRef(false)
  const transferFrame = useId()
  const download = workspace.download
  const id = download?.id
  const key = download?.downloadKey
  const running = isTaskRunning(download)
  const ready = download?.state === 'Stopped' && download.result === 'Success'
  useEffect(() => {
    if (!id || !key || !running) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const task = await veeamApi.guestDownloadTask(sessionId, sourceKey, id!, key!, false, controller.signal)
        if (controller.signal.aborted) return
        setWorkspace(current => current.download?.id === id && current.download ? { ...current, download: { ...current.download, ...task, id: id! } } : current)
        setError('')
        if (!isTaskRunning(task)) return
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t('Recovery request failed.')) }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000)
    }
    timer = setTimeout(poll, 1200)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [id, key, running, sessionId, sourceKey, setWorkspace, t])
  async function prepareOrStop() {
    if (guard.current || uncertain) return
    guard.current = true
    setBusy(true); setError('')
    try {
      if (running && download) {
        const status = await veeamApi.guestDownloadTask(sessionId, sourceKey, download.id, download.downloadKey, true)
        setWorkspace(current => ({ ...current, download: { ...download, ...status, id: download.id } }))
      } else {
        const paths = workspace.cart.map(item => item.path)
        const task = await veeamApi.prepareGuestDownload(sessionId, sourceKey, paths)
        setWorkspace(current => ({ ...current, download: { ...task, count: paths.length } }))
      }
    } catch (err) { setUncertain(!running && uncertainRestore(err)); setError(err instanceof Error ? err.message : t('Recovery request failed.')) }
    finally { guard.current = false; setBusy(false) }
  }
  async function saveWithBearer() {
    if (!download || guard.current) return
    const picker = (window as Window & { showSaveFilePicker?: (opts: { suggestedName: string }) => Promise<FileSystemFileHandle> }).showSaveFilePicker
    if (!picker) { setError(t('Reconnect a VBR data source to save the ZIP in this browser.')); return }
    guard.current = true
    setBusy(true); setError('')
    const controller = new AbortController()
    transfer.current = controller
    let destination: FileSystemWritableFileStream | undefined
    try {
      const file = await picker.call(window, { suggestedName: 'guest-files-' + download.id + '.zip' })
      destination = await file.createWritable()
      const body = await veeamApi.streamGuestArchive(sessionId, sourceKey, download.id, download.downloadKey, controller.signal)
      await body.pipeTo(destination, { signal: controller.signal })
    } catch (err) {
      await destination?.abort().catch(() => {})
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof Error ? err.message : t('Recovery request failed.'))
    } finally { guard.current = false; transfer.current = undefined; setBusy(false) }
  }

  return <div className={styles.download}>
    {!download ? <Button type="button" variant="outline" size="sm" onClick={prepareOrStop} disabled={uncertain || busy || !enabled || !workspace.cart.length}>
      {busy ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>} {t('Download cart as ZIP')}</Button>
      : <><div className={styles.downloadTask} role="status">
        {running ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>}
        <span>{t('ZIP archive')} · {download.count} · {label(download.result && download.result !== 'None' ? download.result : download.state || 'Starting')}
          {running && download.progressPercent != null && ' · ' + download.progressPercent + '%'}</span>
        {running && <Button type="button" variant="ghost" size="sm" onClick={prepareOrStop} disabled={busy || download.state === 'Stopping'}>{t('Cancel')}</Button>}
        {ready && download.bearerOnly && <Button type="button" size="sm" disabled={busy} onClick={saveWithBearer}><Download size={14}/>{t('Save ZIP')}</Button>}
        {ready && !download.bearerOnly && <form action="/api/vbr/restore/files" method="post" target={transferFrame}>
          {Object.entries({action: 'streamDownload', sessionId, sourceKey, taskId: download.id, downloadKey: download.downloadKey}).map(([name, value]) => <input key={name} type="hidden" name={name} value={value}/>)}
          <Button type="submit" size="sm"><Download size={14}/>{t('Save ZIP')}</Button>
        </form>}
        {(!running || error) && <button type="button" className={styles.iconButton} aria-label={t('Dismiss download')} onClick={() => { setWorkspace(current => ({ ...current, download: undefined })); setError('') }}><X size={15}/></button>}
      </div>
        <iframe hidden name={transferFrame} title={t('ZIP archive')} onLoad={event => {
          try {
            const body = event.currentTarget.contentDocument?.body.textContent
            if (body) { const response = JSON.parse(body); if (typeof response.error === 'string') setError(response.error) }
          } catch { setError(t('Recovery request failed.')) }
        }}/>
      </>}
    {error && <span className={styles.error} role="alert">{diagnostic(error)}</span>}
    {uncertain && <span>{t('Check Sessions before submitting another request.')}</span>}
  </div>
}
