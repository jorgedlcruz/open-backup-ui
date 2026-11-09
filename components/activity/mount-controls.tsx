'use client'
// Open Backup UI v1.0.2

import { useRef, useState } from 'react'
import type { Mount } from '@/lib/activity/model'
import { useI18n } from '@/components/providers/i18n-provider'
import { vbrError } from '@/lib/i18n/vbr-errors'
import { Button } from '@/components/ui/button'
import { ApplicationRequestError } from '@/lib/api/application-request'
import { veeamApi } from '@/lib/api/veeam-client'
import { MigrationForm, type MigrationPlacement } from './migration-form'

export { InstantRecoveryControls } from './instant-recovery-controls'
export { readPendingMigrationMounts } from '@/lib/activity/migration-receipt'

export function MountControls({mount, sourceKey, onAccepted}: {
  mount: Mount; sourceKey: string; onAccepted: (sessionId?: string) => void
}) {
  const {t} = useI18n()
  const [action, setAction] = useState<'migrate'|'unmount'|null>(null)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  if ((mount.kind !== 'fcd' && mount.kind !== 'publish') || !['Mounted', 'Failed', 'MountFailed', 'UnmountFailed'].includes(mount.state)) return null

  async function submit(placement: MigrationPlacement = {}) {
    if (!action || lock.current || uncertain || accepted) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await veeamApi.requestActivity<{sessionId: string|null}>(`/api/vbr/activity/mounts/${mount.id}`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({sourceKey, sessionId: mount.sessionId, kind: mount.kind, action, ...placement}),
      })
      setAccepted(true)
      onAccepted(result.sessionId || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Request failed.'))
      setUncertain(!(err instanceof ApplicationRequestError) || !err.status || err.status >= 500)
    } finally { lock.current = false; setBusy(false) }
  }
  function cancel() {setError(''); setAction(null)}
  if (accepted) return <p role="status">{t('VBR accepted the request.')}</p>
  if (!action) return <div className="flex flex-wrap gap-2 border-t pt-4">
    {mount.kind === 'fcd' && mount.state === 'Mounted' && <Button size="sm" onClick={() => setAction('migrate')}>{t('Migrate to production')}</Button>}
    <Button size="sm" variant="outline" onClick={() => setAction('unmount')}>{t('Stop publishing')}</Button>
  </div>
  return <section className="grid gap-3 border-t pt-4">
    {action === 'migrate' ? <MigrationForm mount={mount} sourceKey={sourceKey} onCancel={cancel} onSubmit={submit} busy={busy || uncertain}/> :
      <><p>{t('Stop publishing this recovery and discard changes made since it was mounted?')}</p><div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={busy || uncertain} onClick={() => submit()}>{t('Stop publishing')}</Button>
        <Button size="sm" variant="outline" disabled={busy || uncertain} onClick={cancel}>{t('Cancel')}</Button></div></>}
    {error && <p role="alert" className="text-sm text-destructive">{vbrError(t,error)}</p>}
    {uncertain && <p role="status">{t('Check Sessions before submitting another request.')}</p>}
  </section>
}
