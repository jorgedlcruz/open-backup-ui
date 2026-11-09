'use client'
// Open Backup UI v1.0.2

import Link from 'next/link'
import { useEffect, useReducer, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { useI18n } from '@/components/providers/i18n-provider'
import { ApplicationRequestError } from '@/lib/api/application-request'
import { veeamApi } from '@/lib/api/veeam-client'
import { migrationTransfer } from '@/lib/activity/instant-vm'
import {migrationSpeed} from '@/lib/activity/migration-plan'
import {useMigrationTask} from './migration-path'
import { migrationReceiptEvent, migrationReceipts, storeMigration, type MigrationReceipt } from '@/lib/activity/migration-receipt'
import type { ActivityDetail } from '@/lib/activity/session'
import type { Mount } from '@/lib/activity/model'
import { validId, type Session } from '@/lib/investigation/model'
import { vbrError } from '@/lib/i18n/vbr-errors'
import { InstantRecoveryWorkspace, type InstantRecoveryTransfer } from './instant-recovery-workspace'
import { MigrationForm, type MigrationPlacement } from './migration-form'
import { migrationDestination } from './session-commands'

function useMigrationSession(sourceKey: string, parentId:string, sessionId?: string) {
  const [record, setRecord] = useState<{id: string; sourceKey:string; detail?: ActivityDetail; unavailable?: boolean}>()
  useEffect(() => {
    if (!sessionId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>, running=false, finished=false
    async function poll() {
      if (document.hidden || running || finished || controller.signal.aborted) return
      running=true
      try {
        const data = await veeamApi.requestActivity<ActivityDetail>(`/api/vbr/activity/sessions/${sessionId}?sourceKey=${sourceKey}`, {signal:controller.signal})
        if (controller.signal.aborted) return
        if (data.sourceKey !== sourceKey || data.id !== sessionId || data.session?.id !== sessionId ||
          data.session?.sessionType !== 'QuickMigration' || validId(data.session.parentSessionId) && data.session.parentSessionId !== parentId) throw new Error('Unverified migration session')
        setRecord({id:sessionId!,sourceKey,detail:data})
        finished = !!data.session.endTime || data.session.state === 'Stopped'
      } catch {
        if (!controller.signal.aborted) setRecord({id:sessionId!,sourceKey,unavailable:true})
      } finally {running=false}
      if (!finished && !controller.signal.aborted) timer = setTimeout(poll, 15000)
    }
    void poll()
    function visible(){if(!document.hidden){clearTimeout(timer);void poll()}}
    document.addEventListener('visibilitychange',visible)
    return () => {controller.abort(); clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}
  }, [sourceKey, parentId, sessionId])
  return sessionId && record?.id === sessionId && record.sourceKey === sourceKey ? record : undefined
}

const phases = {pending:'accepted', migrating:'active', succeeded:'completed', warning:'warning', failed:'failed', canceled:'canceled', unknown:'unknown'} as const

type MigrationCheck = {state:'checking'|'accepted'|'rejected'|'unknown'; sessionId?:string; error?:string}

function applyCheck(source: string, entry: MigrationReceipt, result: MigrationCheck) {
  const childId = validId(result.sessionId) && result.sessionId !== entry.mount.sessionId ? result.sessionId : undefined
  if (result.state === 'rejected') storeMigration(source,entry.mount,undefined)
  else storeMigration(source,entry.mount,{...entry,status:result.state,childId})
}

export function InstantRecoveryControls({mount, sourceKey, session, migrationSession, association, disabled, refresh, onMigrationLockChange}: {
  mount: Mount; sourceKey: string; session?: Session|null; migrationSession?: Session|null; disabled: boolean
  association?: NonNullable<ActivityDetail['instantMigrations']>[number]
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
  const trackingId = receipt?.status === 'checking' ? receipt.requestId : undefined
  useEffect(() => {
    if (!trackingId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const params = new URLSearchParams({requestId:trackingId, sourceKey, kind:mount.kind, sessionId:mount.sessionId})
    const path = `/api/vbr/activity/mounts/${mount.id}?${params}`
    let misses = 0
    async function observe() {
      const current = migrationReceipts(sourceKey,mount.sessionId).find(r => r.requestId === trackingId)
      if (!current || current.status !== 'checking') return
      try {
        const result = await veeamApi.requestActivity<MigrationCheck>(path,{signal:controller.signal})
        if (controller.signal.aborted) return
        misses = 0
        setError('')
        if (result.state !== 'checking') {
          applyCheck(sourceKey,current,result)
          if (result.error) setError(result.error)
          refresh()
          return
        }
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof ApplicationRequestError && [401,403,409].includes(err.status)) {
          setError(err.message)
          storeMigration(sourceKey,current.mount,{...current,status:'unknown'})
          return
        }
        if (err instanceof ApplicationRequestError && err.status === 404 && ++misses >= 3) {
          storeMigration(sourceKey,current.mount,{...current,status:'unknown'})
          return
        }
        setError(err instanceof Error ? err.message : t('Request failed.'))
      }
      timer = setTimeout(observe, 4000)
    }
    void observe()
    return () => {controller.abort(); clearTimeout(timer)}
  }, [trackingId, sourceKey, mount.kind, mount.id, mount.sessionId, refresh, t])
  const linked = migrationSession && migrationSession.id !== receipt?.previousChildId &&
    (association || !receipt?.childId || migrationSession.id === receipt.childId) ? migrationSession : undefined
  const childId = linked?.id || receipt?.childId
  const child = useMigrationSession(sourceKey,mount.sessionId,childId)
  const detail=child?.detail
  const terminalChild=detail?.session?.endTime || detail?.session?.state==='Stopped'
  const operation = terminalChild ? detail?.session : linked ?? detail?.session
  // A mount is one VM. Only a completely enumerated, single-VM child identifies
  // its task without guessing by VM name. Multi-VM children have their own selector.
  const single=!!detail?.tasks.available && detail.tasks.complete && detail.tasks.data.length===1 && detail.tasks.data[0].sessionId===childId
  const task=single ? detail?.tasks.data[0] : undefined
  const {proxies,task:detailTask}=useMigrationTask(sourceKey,childId,task?.id,!!operation && !operation.endTime && operation.state!=='Stopped')
  const speed=single ? migrationSpeed(operation,task,true,detail?.throughput) ?? migrationSpeed(operation,detailTask,true) : undefined
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
      status:'submitting', previousChildId:operation?.id, requestId:uuid(),
    }
    storeMigration(sourceKey, mount, pending)
    onMigrationLockChange(true)
    try {
      const result = await veeamApi.requestActivity<MigrationCheck>(`/api/vbr/activity/mounts/${mount.id}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kind:mount.kind, action:'migrate', sessionId:mount.sessionId, requestId:pending.requestId, sourceKey, ...placement}),
      })
      applyCheck(sourceKey,pending,result)
      if (result.error) setError(result.error)
      setConfiguring(result.state === 'rejected')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Request failed.'))
      const rejected = err instanceof ApplicationRequestError && err.status >= 400 && err.status < 500 && err.status !== 408
      storeMigration(sourceKey, mount, rejected ? receipt : {...pending, status:'checking'})
      if (!rejected) setConfiguring(false)
      refresh()
    } finally {submitting.current = false}
  }

  const phase: InstantRecoveryTransfer['phase'] | undefined = evidence.phase !== 'idle' ? phases[evidence.phase] : receipt?.status === 'checking' ? 'checking' : receipt?.status === 'accepted' ? 'accepted'
    : receipt?.status === 'unknown' ? 'unknown' : undefined
  const transfer = !configuring && phase ? {phase:child?.unavailable && phase === 'accepted' ? 'unknown' as const : phase,
    percent:evidence.progress, transferredBytes:evidence.transferredBytes, message:operation?.result?.message || undefined,proxies,speed} : undefined
  const destination = migrationDestination(mount.id, childId, association, receipt)
  return <>
    <InstantRecoveryWorkspace mount={mount} destination={configuring ? undefined : destination} transfer={transfer}
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
