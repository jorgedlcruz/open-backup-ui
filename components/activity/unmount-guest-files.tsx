'use client'

import { useEffect, useRef, useState } from 'react'
import { HardDrive, Loader2 } from 'lucide-react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useRecoveryPresentation } from '@/components/restore-points/use-presentation'
import { veeamApi } from '@/lib/api/veeam-client'
import { guestRestoreBusy, isTaskRunning, readWorkspace, workspaceKey, type GuestWorkspace } from '@/lib/restore-points/guest-workspace'
import { uncertainRestore } from '@/lib/restore-points/workflow'

export function UnmountGuestFiles({sessionId, sourceKey, onUnmount}: {
  sessionId: string; sourceKey: string; onUnmount: () => void
}) {
  const { t, diagnostic } = useRecoveryPresentation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const workspace = useRef<GuestWorkspace>({cart: []})
  const key = workspaceKey(sourceKey, sessionId)

  useEffect(() => {
    try { workspace.current = readWorkspace(sessionStorage.getItem(key)) } catch { workspace.current = {cart: []} }
    function updated(event: Event) {
      const {storageKey, workspace: current} = (event as CustomEvent<{storageKey: string; workspace: GuestWorkspace}>).detail
      if (storageKey === key) workspace.current = current
    }
    window.addEventListener('guest-workspace-changed', updated)
    return () => window.removeEventListener('guest-workspace-changed', updated)
  }, [key])

  async function unmount() {
    if (submitting.current || uncertain) return
    submitting.current = true
    setBusy(true)
    setError('')
    let sent = false
    try {
      // A remembered task may have finished while the file browser was closed.
      let current = workspace.current
      if (current.task?.id && isTaskRunning(current.task)) {
        const task = await veeamApi.guestTask(sessionId, sourceKey, current.task.id)
        current = workspace.current.task?.id === task.id ? { ...workspace.current, task } : workspace.current
      }
      if (guestRestoreBusy(current)) {
        setError(t('Check the file restore in the recovery cart before unmounting.'))
        return
      }
      sent = true
      await veeamApi.modifyGuestFiles({action:'unmount', sessionId, sourceKey})
      try { sessionStorage.removeItem(key) } catch { /* Storage can be unavailable. */ }
      setOpen(false)
      onUnmount()
    } catch (error) {
      setUncertain(sent && uncertainRestore(error))
      setError(error instanceof Error ? diagnostic(error.message) : t('Unmount failed'))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <AlertDialog open={open} onOpenChange={next => {
    if (busy) return
    if (next && !uncertain) setError('')
    setOpen(next)
  }}>
    <AlertDialogTrigger asChild><Button type="button" size="sm" variant="outline"><HardDrive size={15}/>{t('Unmount')}</Button></AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('Unmount')}</AlertDialogTitle>
        <AlertDialogDescription>{t('End this guest file restore session and unmount its disks?')}</AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {uncertain && <p role="status" className="text-sm">{t('Check the session log before trying again.')}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>{t('Cancel')}</AlertDialogCancel>
        <AlertDialogAction disabled={busy || uncertain} onClick={event => {
          event.preventDefault()
          void unmount()
        }}>{busy && <Loader2 size={14} className="motion-safe:animate-spin"/>}{busy ? t('Unmounting') : t('Unmount')}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
