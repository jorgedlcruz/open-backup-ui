'use client'

import Link from 'next/link'
import { useEffect, useReducer, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import { ApplicationRequestError } from '@/lib/api/application-request'
import { veeamApi } from '@/lib/api/veeam-client'
import { migrationTransfer } from '@/lib/activity/instant-vm'
import { migrationReceiptEvent, migrationReceipts, storeMigration, type MigrationReceipt } from '@/lib/activity/migration-receipt'
import type { ActivityDetail } from '@/lib/activity/session'
import type { Mount } from '@/lib/activity/model'
import { validId, type Session } from '@/lib/investigation/model'
import { vbrError } from '@/lib/i18n/vbr-errors'
import { InstantRecoveryWorkspace, type InstantRecoveryTransfer } from './instant-recovery-workspace'
import { MigrationForm, type MigrationPlacement } from './migration-form'

function useMigrationSession(sourceKey: string, sessionId?: string) {
  const [record, setRecord] = useState<{id: string; session?: Session; unavailable?: boolean}>()
  useEffect(() => {
    if (!sessionId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      let finished = false
      try {
        const data = await veeamApi.requestActivity<ActivityDetail>(`/api/vbr/activity/sessions/${sessionId}?sourceKey=${sourceKey}`, {signal:controller.signal})
        if (controller.signal.aborted) return
        if (data.sourceKey !== sourceKey || data.session?.id !== sessionId || !data.session) throw new Error('Unverified migration session')
        setRecord({id:sessionId!, session:data.session})
        finished = !!data.session.endTime || data.session.state === 'Stopped'
      } catch {
        if (!controller.signal.aborted) setRecord({id:sessionId!, unavailable:true})
      }
      if (!finished && !controller.signal.aborted) timer = setTimeout(poll, 5000)
    }
    void poll()
    return () => {controller.abort(); clearTimeout(timer)}
  }, [sourceKey, sessionId])
  return sessionId && record?.id === sessionId ? record : undefined
}

const phases = {pending:'accepted', migrating:'active', succeeded:'completed', warning:'warning', failed:'failed', canceled:'canceled', unknown:'unknown'} as const

export function InstantRecoveryControls({mount, sourceKey, session, migrationSession, disabled, refresh, onMigrationLockChange}: {
  mount: Mount; sourceKey: string; session?: Session|null; migrationSession?: Session|null; disabled: boolean
  refresh: () => void; onMigrationLockChange: (locked: boolean) => void
}) {
  const {t} = useI18n()
  const [configuring, setConfiguring] = useState(false)
  const [error, setError] = useState('')
  const [, reread] = useReducer(n => n + 1, 0)
  const submitting = useRef(false)
  const receipt = migrationReceipts(sourceKey, mount.sessionId).find(r => r.mount.id === mount.id && r.mount.kind === mount.kind)
  useEffect(() => {
    window.addEventListener(migrationReceiptEvent, reread)
    return () => window.removeEventListener(migrationReceiptEvent, reread)
  }, [])
  const linked = migrationSession && migrationSession.id !== receipt?.previousChildId &&
    (!receipt?.childId || migrationSession.id === receipt.childId) ? migrationSession : undefined
  const child = useMigrationSession(sourceKey, receipt?.childId !== linked?.id ? receipt?.childId : undefined)
  const operation = child?.session ?? linked
  const evidence = migrationTransfer(mount, session, operation)
  const recoverable = ['failed','canceled'].includes(evidence.phase) && mount.state === 'Mounted'
  const locked = !recoverable && (!!receipt || evidence.phase !== 'idle')
  const canConfigure = !disabled && !locked && mount.state === 'Mounted'
  useEffect(() => {onMigrationLockChange(locked)}, [locked, onMigrationLockChange])

  async function migrate(placement: MigrationPlacement) {
    if (!canConfigure || !configuring || submitting.current || (mount.kind !== 'vSphere' && mount.kind !== 'hyperV')) return
    submitting.current = true
    setError('')
    const pending: MigrationReceipt = {
      mount:{id:mount.id,sessionId:mount.sessionId,kind:mount.kind,state:mount.state,name:mount.name,
        host:mount.host,backup:mount.backup,pointTime:mount.pointTime,instantVm:mount.instantVm},
      destination:{host:placement.host?.name || (placement.useOriginalPlacement ? mount.instantVm?.host : undefined), datastore:placement.datastore?.name},
      status:'submitting', previousChildId:operation?.id,
    }
    storeMigration(sourceKey, mount, pending)
    onMigrationLockChange(true)
    try {
      const result = await veeamApi.requestActivity<{accepted:boolean; sessionId:string|null}>(`/api/vbr/activity/mounts/${mount.id}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kind:mount.kind, action:'migrate', sessionId:mount.sessionId, sourceKey, ...placement}),
      })
      const childId = validId(result.sessionId) && result.sessionId !== mount.sessionId ? result.sessionId : undefined
      storeMigration(sourceKey, mount, {...pending, status:result.accepted ? 'accepted' : 'unknown', childId})
      setConfiguring(false)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Request failed.'))
      const rejected = err instanceof ApplicationRequestError && err.status >= 400 && err.status < 500 && err.status !== 408
      storeMigration(sourceKey, mount, rejected ? receipt : {...pending, status:'unknown'})
      if (!rejected) setConfiguring(false)
      refresh()
    } finally {submitting.current = false}
  }

  const phase: InstantRecoveryTransfer['phase'] | undefined = evidence.phase !== 'idle' ? phases[evidence.phase] : receipt?.status === 'accepted' ? 'accepted'
    : receipt?.status === 'unknown' ? 'unknown' : undefined
  const transfer = !configuring && phase ? {phase:child?.unavailable && phase === 'accepted' ? 'unknown' as const : phase,
    percent:evidence.progress, transferredBytes:evidence.transferredBytes, message:operation?.result?.message || undefined} : undefined
  const childId = receipt?.childId || linked?.id
  return <>
    <InstantRecoveryWorkspace mount={mount} destination={configuring ? undefined : receipt?.destination} transfer={transfer}
      canConfigure={canConfigure} configuring={configuring && (canConfigure || receipt?.status === 'submitting')}
      onConfigure={() => {if (canConfigure) {setError(''); setConfiguring(true)}}}>
      <MigrationForm mount={mount} sourceKey={sourceKey} busy={disabled || !!submitting.current}
        onCancel={() => {setConfiguring(false); setError('')}} onSubmit={migrate}/>
    </InstantRecoveryWorkspace>
    {error && <p role="alert" className="text-sm text-destructive">{vbrError(t,error)}</p>}
    {receipt?.status === 'unknown' && evidence.phase === 'idle' && <p role="status" className="text-sm text-muted-foreground">{t('Check Sessions before submitting another request.')}</p>}
    {validId(childId) && childId !== mount.sessionId && <Link className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
      href={`/vbr/activity/${childId}?sourceKey=${sourceKey}`}>{t('Migration session')}<ArrowUpRight size={14}/></Link>}
  </>
}
