'use client'

import { useEffect, useMemo, useState } from 'react'
import { veeamApi } from '@/lib/api/veeam-client'
import type { InventoryKind, RestoreInventoryItem, RestorePlatform } from '@/lib/restore-points/workflow'
import { Button } from '@/components/ui/button'
import { useRecoveryPresentation } from './use-presentation'
import styles from './workflow.module.css'

const identity = (item: RestoreInventoryItem) => JSON.stringify([item.hostName, item.type, item.objectId, item.urn, item.name])

export function TargetPicker({ label, platform, kind, server, sourceKey, value, required, emptyLabel, onChange }: {
  label: string; platform: RestorePlatform; kind: InventoryKind; server?: string; sourceKey: string
  value?: RestoreInventoryItem; required?: boolean; emptyLabel?: string; onChange: (item?: RestoreInventoryItem) => void
}) {
  const { t, diagnostic } = useRecoveryPresentation()
  const [items, setItems] = useState<RestoreInventoryItem[]>([])
  const scope = JSON.stringify([sourceKey, platform, kind, server])
  const [loadedScope, setLoadedScope] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.name, (counts.get(item.name) || 0) + 1)
    return counts
  }, [items])
  useEffect(() => {
    const controller = new AbortController()
    setItems([])
    setError('')
    setLoading(true)
    async function load() {
      const accumulated = new Map<string, RestoreInventoryItem>()
      let skip = 0
      for (;;) {
        const page = await veeamApi.getRestoreInventory(platform, kind, server, skip, controller.signal)
        if (page.sourceKey !== sourceKey) throw new Error('The selected VBR source changed. Reopen the restore point.')
        if (controller.signal.aborted) return
        for (const item of page.data) accumulated.set(identity(item), item)
        const next = page.pagination.skip + page.pagination.count
        if (next >= page.pagination.total) break
        if (next <= skip) throw new Error('Inventory pagination did not advance.')
        skip = next
      }
      if (!controller.signal.aborted) {
        setItems([...accumulated.values()])
        setLoadedScope(scope)
      }
    }
    load().catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t('Inventory is unavailable.')) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [platform, kind, server, sourceKey, scope, revision, t])
  useEffect(() => {
    const soleLocation = kind === 'Server' || kind === 'Host' || kind === 'Folder'
    if (soleLocation && required && !value && scope === loadedScope && !loading && items.length === 1) onChange(items[0])
  }, [kind, required, value, scope, loadedScope, loading, items, onChange])

  return <div className={styles.field}>
    <label><span>{label}</span>
      <select aria-label={label} value={value ? identity(value) : ''} required={required} disabled={loading || !!error}
        onChange={event => onChange(items.find(item => identity(item) === event.target.value))}>
        <option value="">{loading ? t('Reading inventory…') : items.length ? required ? t('Select a destination') : emptyLabel || t('Use source settings') : t('No eligible destinations')}</option>
        {items.map(item => <option key={identity(item)} value={identity(item)}>{item.name}{nameCounts.get(item.name)! > 1 ? ' · ' + (item.urn || item.objectId || item.hostName) : ''}</option>)}
      </select>
    </label>
    {error && <div className={styles.error} role="alert">{diagnostic(error)} <Button type="button" variant="link" size="sm" onClick={() => setRevision(n => n + 1)}>{t('Retry')}</Button></div>}
  </div>
}
