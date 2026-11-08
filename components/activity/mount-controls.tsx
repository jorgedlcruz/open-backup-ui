'use client'

import { useRef, useState } from 'react'
import type { Mount } from '@/lib/activity/model'
import { useI18n } from '@/components/providers/i18n-provider'
import { Button } from '@/components/ui/button'
import { TargetPicker } from '@/components/restore-points/target-picker'
import type { RestoreInventoryItem } from '@/lib/restore-points/workflow'
import { applicationRequest, ApplicationRequestError } from '@/lib/api/application-request'

export function MountControls({mount, sourceKey, onAccepted}: {
  mount: Mount; sourceKey: string; onAccepted: (sessionId?: string) => void
}) {
  const {t} = useI18n()
  const [action, setAction] = useState<'migrate'|'unmount'|null>(null)
  const [server, setServer] = useState<RestoreInventoryItem>()
  const [host, setHost] = useState<RestoreInventoryItem>()
  const [hostKind, setHostKind] = useState<'Host'|'Cluster'>('Host')
  const [pool, setPool] = useState<RestoreInventoryItem>()
  const [folder, setFolder] = useState<RestoreInventoryItem>()
  const [useOriginal, setUseOriginal] = useState(!!mount.originalLocation)
  const [datastore, setDatastore] = useState<RestoreInventoryItem>()
  const [quick, setQuick] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  if (mount.kind === 'other' || mount.kind === 'flr' || !['Mounted', 'Failed', 'MountFailed', 'UnmountFailed'].includes(mount.state)) return null
  const stop = t('Stop publishing')
  const migrate = t('Migrate to production')
  const label = action === 'unmount' ? stop : migrate
  const selectTarget = action === 'migrate' && mount.kind !== 'hyperV'
  const ready = !selectTarget || !!datastore && (mount.kind === 'fcd' || useOriginal || !!host)

  function resetPlacement() {
    setHost(undefined)
    setPool(undefined)
    setFolder(undefined)
    setDatastore(undefined)
  }

  async function submit() {
    if (!action || !ready || lock.current || uncertain) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await applicationRequest<{sessionId: string|null}>(`/api/vbr/activity/mounts/${mount.id}`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({sourceKey, sessionId: mount.sessionId, kind: mount.kind, action,
          ...(selectTarget ? {host, resourcePool: pool, folder, datastore, useOriginalPlacement: useOriginal, quickMigration: quick} : {})}),
      })
      onAccepted(result.sessionId || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Request failed.'))
      setUncertain(!(err instanceof ApplicationRequestError) || !err.status || err.status >= 500)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  if (!action) return <div className="flex flex-wrap gap-2 border-t pt-4">
    {mount.kind !== 'publish' && mount.state === 'Mounted' && <Button size="sm" onClick={() => setAction('migrate')}>{migrate}</Button>}
    <Button size="sm" variant="outline" onClick={() => setAction('unmount')}>{stop}</Button>
  </div>
  return <section className="grid gap-3 border-t pt-4">
    <h3 className="font-semibold">{label}</h3>
    <p className="text-sm text-muted-foreground">{action === 'unmount'
      ? t('Stop publishing this recovery and discard changes made since it was mounted?')
      : mount.kind === 'hyperV' ? t('Move this recovered VM to its production storage?')
        : t('Choose the production destination for this recovery.')}</p>
    {selectTarget && <fieldset disabled={busy || uncertain} className="grid gap-3">
      <TargetPicker label={t('Inventory server')} platform="VSphere" sourceKey={sourceKey} kind="Server" value={server}
        onChange={value => {setServer(value); resetPlacement()}} required/>
      {mount.kind === 'vSphere' && mount.originalLocation && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={useOriginal} onChange={event => {resetPlacement(); setUseOriginal(event.target.checked)}}/>{t('Use source settings')}
      </label>}
      {server && mount.kind === 'vSphere' && !useOriginal && <>
        <label className="flex items-center gap-2 text-sm">{t('Destination')}
          <select className="rounded border bg-background px-2 py-1" value={hostKind}
            onChange={event => {setHostKind(event.target.value === 'Host' ? 'Host' : 'Cluster'); resetPlacement()}}>
            <option value="Host">{t('Host')}</option><option value="Cluster">{t('Cluster')}</option>
          </select>
        </label>
        <TargetPicker label={hostKind === 'Host' ? t('Destination host') : t('Cluster')} platform="VSphere" kind={hostKind}
          sourceKey={sourceKey} server={server.hostName} value={host}
          onChange={value => {resetPlacement(); setHost(value)}} required/>
        {host && <>
          <TargetPicker label={t('Resource pool')} platform="VSphere" kind="ResourcePool"
            sourceKey={sourceKey} server={server.hostName} value={pool} onChange={setPool}/>
          <TargetPicker label={t('Folder')} platform="VSphere" kind="Folder"
            sourceKey={sourceKey} server={server.hostName} value={folder} onChange={setFolder}/>
        </>}
      </>}
      {server && <TargetPicker label={t('Destination datastore')} platform="VSphere" kind="Datastore" sourceKey={sourceKey}
        server={server.hostName} value={datastore} onChange={setDatastore} required/>}
      {mount.kind === 'vSphere' && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={quick} onChange={event => setQuick(event.target.checked)}/>{t('Use Veeam Quick Migration')}
      </label>}
    </fieldset>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {uncertain && <p role="status" className="text-sm">{t('Check Activity before submitting another request.')}</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy || uncertain || !ready} variant={action === 'unmount' ? 'destructive' : 'default'} onClick={submit}>
        {busy ? t('Submitting…') : label}
      </Button>
      <Button size="sm" variant="outline" disabled={busy || uncertain} onClick={() => {setError(''); setAction(null)}}>{t('Cancel')}</Button>
    </div>
  </section>
}
