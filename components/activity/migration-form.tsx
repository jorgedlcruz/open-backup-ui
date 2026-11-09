'use client'
// Open Backup UI v1.0.2

import { useState } from 'react'
import { useI18n } from '@/components/providers/i18n-provider'
import { TargetPicker } from '@/components/restore-points/target-picker'
import { Button } from '@/components/ui/button'
import type { Mount } from '@/lib/activity/model'
import type { RestoreInventoryItem } from '@/lib/restore-points/workflow'
import styles from '@/components/restore-points/workflow.module.css'

export type MigrationPlacement = {
  host?: RestoreInventoryItem; resourcePool?: RestoreInventoryItem; folder?: RestoreInventoryItem;
  datastore?: RestoreInventoryItem; useOriginalPlacement?: boolean; quickMigration?: boolean
}

export function MigrationForm({mount, sourceKey, busy, onCancel, onSubmit}: {
  mount: Mount; sourceKey: string; busy: boolean; onCancel: () => void; onSubmit: (placement: MigrationPlacement) => void
}) {
  const {t} = useI18n()
  const [server, setServer] = useState<RestoreInventoryItem>()
  const [hostKind, setHostKind] = useState<'Host'|'Cluster'>('Host')
  const [placement, setPlacement] = useState<MigrationPlacement>({useOriginalPlacement: !!mount.originalLocation})
  const vmware = mount.kind === 'vSphere'
  const needsDatastore = mount.kind !== 'hyperV'
  const ready = !needsDatastore || !!placement.datastore && (!vmware || placement.useOriginalPlacement || !!placement.host)
  function resetTargets(update: Partial<MigrationPlacement> = {}) {
    setPlacement(previous => ({quickMigration: previous.quickMigration, useOriginalPlacement: previous.useOriginalPlacement, ...update}))
  }
  function updatePlacement(update: Partial<MigrationPlacement>) {
    setPlacement(previous => ({...previous, ...update}))
  }
  return <form className={styles.flow} onSubmit={event => {
    event.preventDefault()
    if (!busy && ready) onSubmit(needsDatastore ? placement : {})
  }}>
    {needsDatastore ? <fieldset disabled={busy} className="grid min-w-0 gap-3">
      <TargetPicker label={t('Inventory server')} platform="VSphere" sourceKey={sourceKey} kind="Server" value={server}
        onChange={value => {setServer(value); resetTargets()}} required/>
      {vmware && mount.originalLocation && <label className={styles.check}>
        <input type="checkbox" checked={!!placement.useOriginalPlacement} onChange={event => resetTargets({useOriginalPlacement:event.target.checked})}/>{t('Use source settings')}
      </label>}
      {server && vmware && !placement.useOriginalPlacement && <>
        <div className={styles.field}><label><span>{t('Destination')}</span>
          <select value={hostKind} onChange={event => {setHostKind(event.target.value === 'Cluster' ? 'Cluster' : 'Host'); resetTargets()}}>
            <option value="Host">{t('Host')}</option><option value="Cluster">{t('Cluster')}</option>
          </select>
        </label></div>
        <TargetPicker label={hostKind === 'Host' ? t('Destination host') : t('Cluster')} platform="VSphere" kind={hostKind}
          sourceKey={sourceKey} server={server.hostName} value={placement.host} onChange={host => resetTargets({host})} required/>
      </>}
      {server && <TargetPicker label={t('Destination datastore')} platform="VSphere" kind="Datastore"
        sourceKey={sourceKey} server={server.hostName} value={placement.datastore} onChange={datastore => updatePlacement({datastore})} required/>}
      {vmware && <details><summary className="cursor-pointer text-sm">{t('Advanced settings')}</summary>
        <div className="mt-3 grid gap-3">
          {server && placement.host && <>
            <TargetPicker label={t('Resource pool')} platform="VSphere" kind="ResourcePool" sourceKey={sourceKey}
              server={server.hostName} value={placement.resourcePool} onChange={resourcePool => updatePlacement({resourcePool})}/>
            <TargetPicker label={t('Folder')} platform="VSphere" kind="Folder" sourceKey={sourceKey}
              server={server.hostName} value={placement.folder} onChange={folder => updatePlacement({folder})}/>
          </>}
          <label className={styles.check}><input type="checkbox" checked={!!placement.quickMigration}
            onChange={event => updatePlacement({quickMigration:event.target.checked})}/>{t('Use Veeam Quick Migration')}</label>
        </div>
      </details>}
    </fieldset> : <p>{t('Move this recovered VM to its production storage?')}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" disabled={busy || !ready}>{busy ? t('Submitting…') : t('Migrate to production')}</Button>
      <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>{t('Cancel')}</Button>
    </div>
  </form>
}
