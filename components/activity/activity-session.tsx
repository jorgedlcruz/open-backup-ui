'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Activity, ArrowLeft, ArrowUpRight, Database, FileText, Files, FolderOpen, FolderTree, Layers, Map, RefreshCw, Server, Square } from 'lucide-react'
import { ApplicationRequestError } from '@/lib/api/application-request'
import { veeamApi } from '@/lib/api/veeam-client'
import type { ActivityDetail } from '@/lib/activity/session'
import { migrationTransfer } from '@/lib/activity/instant-vm'
import { canUnmountGuestFiles, sessionProgress, type Mount } from '@/lib/activity/model'
import { recordStatus, time, validId } from '@/lib/investigation/model'
import { findSessionLaunch } from '@/lib/restore-points/launch'
import { GuestFileBrowser } from '@/components/restore-points/guest-file-browser'
import { RecoverySignal } from '@/components/restore-points/recovery-signal'
import { LogViewer, Status, useInvestigationPresentation } from '@/components/investigation/shared'
import { Workloads, TaskDetails } from '@/components/investigation/session-investigation'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InstantRecoveryControls, MountControls, readPendingMigrationMounts } from './mount-controls'
import { canStopPublishing, isInstantVmMount, migrationForMount, mountKey, recoveryMapMounts } from './session-commands'
import { UnmountGuestFiles } from './unmount-guest-files'
import ops from '@/components/operations/operations.module.css'
import investigation from '@/components/investigation/investigation.module.css'
import styles from './session.module.css'

function RecoveryProperties({mount}: {mount: Mount}) {
  const {t, date, label} = useInvestigationPresentation()
  const facts = [
    [t('State'), label(mount.state)], [t('Host'), mount.host], [t('Backup'), mount.backup],
    [t('Restore point'), mount.pointTime && date(mount.pointTime)], [t('Disks'), mount.disks?.join(', ')],
    [t('Type'), mount.publication?.mode], [t('Port'), mount.publication?.port?.toString()],
  ].filter(([,value]) => !!value)
  return <><dl className={styles.properties}>{facts.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    {mount.publication?.disks.map((disk,i) => disk.accessLink || disk.mountPoints.length ? <div className={styles.paths} key={i}>
      <strong>{disk.name || t('Disk')}</strong>{[...new Set([disk.accessLink, ...disk.mountPoints].filter(Boolean))].map(address => <code key={address}>{address}</code>)}
    </div> : null)}</>
}

type StopPhase = 'sending' | 'uncertain' | 'accepted'
function StopPublishing({mount, sourceKey, migrationLocked, phase, onPhase, onAccepted, distinguish}: {
  mount: Mount; sourceKey: string; migrationLocked: boolean; phase?: StopPhase
  onPhase: (key: string, phase?: StopPhase) => void; onAccepted: (next?: string) => void; distinguish: boolean
}) {
  const {t, notice} = useInvestigationPresentation()
  const [open, setOpen] = useState(false), [error, setError] = useState('')
  const sending = useRef(false)
  const label = t('Stop publishing')
  const target = mount.name || mount.id
  async function submit() {
    if (!open || sending.current || phase || migrationLocked) return
    sending.current = true
    onPhase(mountKey(mount), 'sending')
    setError('')
    try {
      const result = await veeamApi.requestActivity<{sessionId: string|null}>(`/api/vbr/activity/mounts/${mount.id}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sourceKey, sessionId:mount.sessionId, kind:mount.kind, action:'unmount'}),
      })
      onPhase(mountKey(mount), 'accepted')
      onAccepted(result.sessionId || undefined)
    } catch (err) {
      const rejected = err instanceof ApplicationRequestError && err.status >= 400 && err.status < 500 && err.status !== 408
      onPhase(mountKey(mount), rejected ? undefined : 'uncertain')
      setError(err instanceof Error ? err.message : t('Request failed.'))
    } finally {
      sending.current = false
    }
  }
  return <AlertDialog open={open} onOpenChange={next => {
    if (sending.current) return
    if (next && !phase) setError('')
    setOpen(next)
  }}>
    <AlertDialogTrigger asChild><Button type="button" variant="outline" size="sm" disabled={migrationLocked}>
      <Square size={14}/>{label}{distinguish && ' · ' + target}
    </Button></AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{label} · {target}</AlertDialogTitle>
        <AlertDialogDescription>{t('Stop publishing this recovery and discard changes made since it was mounted?')}</AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{notice(error)}</p>}
      {phase === 'uncertain' && <p role="status" className="text-sm">{t('Check the session log before trying again.')}</p>}
      <AlertDialogFooter><AlertDialogCancel disabled={phase === 'sending'}>{t('Cancel')}</AlertDialogCancel>
        <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" disabled={!!phase || migrationLocked}
          onClick={event => {event.preventDefault(); void submit()}}>{phase === 'sending' ? t('Submitting…') : label}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

type MigrationLock = {mount: Mount; locked: boolean}
function RecoveryMap({mount, data, migrationSession, disabled, refresh, onMigrationLock}: {
  mount: Mount; data: ActivityDetail; disabled: boolean; refresh: () => void
  migrationSession: ActivityDetail['instantMigration']
  onMigrationLock: (mount: Mount, locked: boolean) => void
}) {
  const current = useRef(mount)
  useEffect(() => { current.current = mount }, [mount])
  const onMigrationLockChange = useCallback((locked: boolean) => onMigrationLock(current.current, locked), [onMigrationLock])
  return <InstantRecoveryControls mount={mount} sourceKey={data.sourceKey} session={data.session} migrationSession={migrationSession}
    disabled={disabled} refresh={refresh} onMigrationLockChange={onMigrationLockChange}/>
}

function StopRestore({data, refresh}: {data: ActivityDetail; refresh: () => void}) {
  const {t, notice} = useInvestigationPresentation()
  const [phase, setPhase] = useState<'ready'|'confirm'|'sending'|'accepted'|'uncertain'>('ready')
  const [error, setError] = useState('')
  const lock = useRef(false)
  async function stop() {
    if (phase !== 'confirm' || lock.current) return
    lock.current = true; setPhase('sending'); setError('')
    try {
      await veeamApi.requestActivity('/api/vbr/activity/sessions/' + data.id, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'stop',sourceKey:data.sourceKey})})
      setPhase('accepted'); refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Request failed.'))
      setPhase(err instanceof ApplicationRequestError && err.status > 0 && err.status < 500 ? 'confirm' : 'uncertain')
    } finally { lock.current = false }
  }
  if (phase === 'ready') return <Button size="sm" variant="outline" onClick={() => setPhase('confirm')}>{t('Stop restore')}</Button>
  return <div className={styles.commands}>
    {phase === 'accepted' ? <p role="status">{t('VBR accepted the request.')}</p> : phase === 'uncertain' ? <p>{t('Check Sessions before submitting another request.')}</p> :
      <><p>{t('Stop this VM restore before it finishes?')}</p><Button size="sm" variant="destructive" disabled={phase === 'sending'} onClick={stop}>{t('Stop restore')}</Button>
        <Button size="sm" variant="outline" disabled={phase === 'sending'} onClick={() => {setPhase('ready'); setError('')}}>{t('Cancel')}</Button></>}
    {error && <p role="alert">{notice(error)}</p>}
  </div>
}

// Wait for each read to settle before scheduling another, even when a VBR source is slow.
function useSession(id: string, query: string) {
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<ActivityDetail>()
  const [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const pinned = useRef(new URLSearchParams(query).get('sourceKey'))
  const refresh = useCallback(() => setRevision(n => n + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>, running = false
    async function tick() {
      if (running || controller.signal.aborted) return
      clearTimeout(timer)
      if (document.hidden) return
      running = true; setLoading(true)
      let delay = 5000, retry = true
      try {
        const params = new URLSearchParams(query)
        if (pinned.current) params.set('sourceKey', pinned.current)
        const result = await veeamApi.requestActivity<ActivityDetail>('/api/vbr/activity/sessions/' + id + '?' + params, {signal:controller.signal})
        if (controller.signal.aborted) return
        pinned.current = result.sourceKey; setData(result); setError('')
        if (result.session?.endTime && !result.mounts.length) delay = 60000
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Request failed.')
        if (err instanceof ApplicationRequestError && [400,401,403,409].includes(err.status)) { setData(undefined); retry = false }
        delay = 10000
      } finally {
        running = false
        if (!controller.signal.aborted) { setLoading(false); if (retry) timer = setTimeout(tick, delay) }
      }
    }
    void tick()
    document.addEventListener('visibilitychange', tick)
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', tick) }
  }, [id, query, revision])
  return { data, error, loading, refresh, revision }
}

export function ActivitySession({id, query}: {id: string; query: string}) {
  const {t, date, label, duration, bytes, rate, formatNumber, notice} = useInvestigationPresentation()
  const router = useRouter()
  const {data, error, loading, refresh, revision} = useSession(id, query)
  const [tab, setTab] = useState('logs'), [taskId, setTaskId] = useState<string>()
  const [fileOpened, setFileOpened] = useState(false)
  const [recoveryOpened, setRecoveryOpened] = useState(false)
  const [filesUnmounted, setFilesUnmounted] = useState(false)
  const [stopPhases, setStopPhases] = useState<Record<string, StopPhase | undefined>>({})
  const [migrationLocks, setMigrationLocks] = useState<Record<string, MigrationLock>>({})
  const sourceKey = data?.sourceKey || new URLSearchParams(query).get('sourceKey')
  const onMigrationLock = useCallback((mount: Mount, locked: boolean) => {
    const key = mountKey(mount)
    const recorded = sourceKey && readPendingMigrationMounts(sourceKey, id).some(saved => mountKey(saved) === key)
    setMigrationLocks(previous => {
      if (previous[key]?.locked === locked || !previous[key] && !locked && !recorded) return previous
      return {...previous, [key]: {mount, locked}}
    })
  }, [sourceKey, id])
  const filesTab = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const restoreTab = () => {
      if (window.location.hash === '#guest-files') {
        setFileOpened(true)
        setTab('files')
      } else if (window.location.hash === '#recovery-map') {
        setRecoveryOpened(true)
        setTab('recovery')
      } else {
        setTab(previous => previous === 'files' || previous === 'recovery' ? 'logs' : previous)
      }
    }
    restoreTab()
    window.addEventListener('hashchange', restoreTab)
    return () => window.removeEventListener('hashchange', restoreTab)
  }, [])
  const [accepted, setAccepted] = useState(false)
  const session = data?.session, mounts = data?.mounts.filter(m => !filesUnmounted || m.kind !== 'flr') ?? []
  const [receipt,setReceipt] = useState<ReturnType<typeof findSessionLaunch>>()
  useEffect(() => { if (sourceKey) setReceipt(findSessionLaunch(sourceKey, id)) }, [sourceKey, id])
  const fileMount = mounts.find(m => m.kind === 'flr')
  const readyToBrowse = fileMount?.state === 'Mounted' && !fileMount.error && !error
  const type = session?.sessionType || mounts[0]?.operation
  const isFile = !!fileMount || /FileLevelRestore/.test(type || '') || receipt?.operation === 'StartFlrRestore'
  const jobDone = !!session && (!!session.endTime || session.state === 'Stopped')
  const status = mounts[0]?.state ?? (filesUnmounted && !jobDone ? 'Unmounted' : session ? recordStatus(session) : undefined)
  const percent = sessionProgress(session, fileMount || mounts[0])
  const child = data?.children
  const storedMounts = data ? readPendingMigrationMounts(data.sourceKey, id) : []
  const mapMounts = data ? recoveryMapMounts(data, [...storedMounts, ...Object.values(migrationLocks).map(entry => entry.mount)], query) : []
  const migrationPhase = migrationTransfer(null, session, data?.instantMigration).phase
  const migrationPending = migrationPhase === 'migrating' || migrationPhase === 'pending' || migrationPhase === 'unknown'
  const hasMap = mapMounts.length > 0
  const hasRecovery = hasMap || mounts.some(m => m.kind !== 'flr') || !!data?.canStop
  const isRecovery = isFile || hasRecovery || !!child || /Restore|Recovery|Publish|Migration/.test(type || '')
  const link = (next: string) => '/vbr/activity/' + next + (sourceKey ? '?sourceKey=' + sourceKey : '')
  function onAccepted(next?: string) {
    if (validId(next) && next !== id) router.push(link(next))
    else { setAccepted(true); selectTab('logs'); refresh() }
  }
  function onFilesUnmounted() {
    setFileOpened(false)
    setFilesUnmounted(true)
    onAccepted()
  }
  const latest = data?.logs.data.reduce<(ActivityDetail['logs']['data'][number]) | undefined>((a,b) =>
    !a || (time(b.updateTime || b.startTime) ?? 0) >= (time(a.updateTime || a.startTime) ?? 0) ? b : a, undefined)
  const activeTab = (tab === 'files' && !fileMount) || (tab === 'recovery' && !hasRecovery) || (tab === 'application' && !child) ? 'logs' : tab
  function selectTab(value: string) {
    setTab(value)
    if (value === 'files') setFileOpened(true)
    if (value === 'recovery') setRecoveryOpened(true)
    const location = new URL(window.location.href)
    const hash = value === 'files' ? '#guest-files' : value === 'recovery' && hasMap ? '#recovery-map' : ''
    if (location.hash !== hash && (hash || ['#guest-files', '#recovery-map'].includes(location.hash))) {
      location.hash = hash
      window.history.replaceState(window.history.state, '', location)
    }
  }
  const facts = [
    [t('Started'), session?.creationTime && date(session.creationTime)], [t('Initiated by'), session?.initiatedBy],
    ...(isRecovery ? [[t('Restore point'), (mounts[0]?.pointTime || receipt?.pointTime) && date(mounts[0]?.pointTime || receipt?.pointTime)],
      [t('Destination host'), mounts[0]?.host]] : [[t('Transferred'), session?.progress?.transferredSize != null && bytes(session.progress.transferredSize)],
      [t('Processing rate'), session?.progress?.processingRate && rate(session.progress.processingRate)]]),
    [t('Ended'), session?.endTime && date(session.endTime)], [t('Duration'), session && (jobDone || session.progress?.duration) && duration(session)],
  ].filter(([,value]) => !!value)
  const related = [...new Set([session?.parentSessionId, session?.relatedSessionId, session?.originalSessionId].filter((v): v is string => validId(v) && v !== id))]
  const typeLabel = type === 'RestoreVm' ? t('Entire VM restore') : isFile ? t('Guest file restore') : type === 'InstantRecovery' ? t('Instant VM Recovery') : type ? label(type).replace(/([a-z])([A-Z])/g, '$1 $2') : t('Session Investigation')
  return <main className={ops.console}>
    <header className={ops.header}><div><Link href="/vbr/activity" className={styles.back}><ArrowLeft size={14}/>{t('Sessions')}</Link>
      <h1>{mounts[0]?.name || session?.name || receipt?.workload || t('Session Investigation')}</h1><p>{typeLabel}{data?.sourceName && ' · ' + data.sourceName}</p></div>
      <div className={styles.commands}>{status && <Status value={status}/>}
        {data && fileMount && canUnmountGuestFiles(fileMount, session) && !error && <UnmountGuestFiles sessionId={fileMount.sessionId} sourceKey={data.sourceKey} onUnmount={onFilesUnmounted}/>}
        {data && mapMounts.filter(mount => canStopPublishing(mount, data, error)).map(mount => {
          const key = mountKey(mount)
          const locked = migrationPending ||
            (migrationLocks[key]?.locked ?? storedMounts.some(saved => mountKey(saved) === key))
          const completed = migrationForMount(mount, mapMounts, data.instantMigration) && (migrationPhase === 'succeeded' || migrationPhase === 'warning')
          return !completed && stopPhases[key] !== 'accepted' && <StopPublishing key={data.sourceKey + key} mount={mount} sourceKey={data.sourceKey}
            distinguish={mapMounts.length > 1} migrationLocked={locked} phase={stopPhases[key]} onAccepted={onAccepted}
            onPhase={(which, phase) => setStopPhases(previous => ({...previous, [which]:phase}))}/>
        })}
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>{t('Refresh')}</Button></div>
    </header>
    {error && <div role="alert" className={ops.notice}>{notice(error)} {data && t('Showing the last successful snapshot.')}</div>}
    {accepted && <p className={ops.notice} role="status">{t('VBR accepted the request.')}</p>}
    {!data && !error && <section className={ops.panel}><RecoverySignal stage="session" acknowledged={!!receipt}/></section>}
    {data && <div className={investigation.workspace}>
      <section className={ops.panel}>
        <div className={styles.progressNote}><div className={styles.glyph}>{isFile ? <FolderTree/> : isRecovery ? <Database/> : <Activity/>}</div>
          <div className={styles.lastEvent}><small>{readyToBrowse ? t('Current state') : t('Latest event')}</small>
            <strong>{readyToBrowse ? t('Guest files are ready to browse.') : latest?.title || session?.result?.message || (status ? label(status) : t('No log records'))}</strong>
            {!readyToBrowse && latest?.startTime && <time>{date(latest.updateTime || latest.startTime)}</time>}</div>
          {readyToBrowse && activeTab !== 'files' && <Button size="sm" onClick={() => {selectTab('files'); filesTab.current?.focus()}}>
            <FolderOpen size={16}/>{t('Browse guest files')}</Button>}
          {!jobDone && !filesUnmounted && percent != null && <div className={styles.progress}><span>{formatNumber(percent)}%</span><progress aria-label={t('Progress')} max={100} value={percent}/></div>}
        </div>
        {!!facts.length && <dl className={styles.facts}>{facts.map(([key,value]) => <div key={String(key)}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
        {session?.result?.message && session.result.message !== latest?.title && !['Success','None'].includes(session.result.message) && <p className={investigation.message}>{session.result.message}</p>}
        {mounts.filter(m => m.error).map(m => <p role="alert" className={ops.notice} key={m.id}>{m.error}</p>)}
        {!mounts.some(m => m.error) && receipt?.mountErrors?.map((issue,i) => <p className={ops.notice} key={i}>{issue.message}</p>)}
      </section>
      <section className={ops.panel}>
        <Tabs value={activeTab} onValueChange={selectTab} className="gap-0">
          <TabsList className={styles.tabs} aria-label={t('Session evidence type')}>
            <TabsTrigger value="logs"><FileText/>{t('Session log')}{data.logs.available && <small>{formatNumber(data.logs.data.length)}</small>}</TabsTrigger>
            {isFile && <TabsTrigger ref={filesTab} value="files" disabled={!fileMount}><FolderTree/>{t('Guest files')}</TabsTrigger>}
            {hasRecovery && <TabsTrigger value="recovery">{hasMap ? <Map/> : <Database/>}{hasMap ? t('Recovery map') : t('Recovery actions')}</TabsTrigger>}
            {child && <TabsTrigger value="application"><Layers/>{t('Application items')}</TabsTrigger>}
            {(!isRecovery || data.tasks.data.length > 0) && <TabsTrigger value="workloads"><Server/>{t('Workloads')}{data.tasks.available && <small>{formatNumber(data.tasks.data.length)}</small>}</TabsTrigger>}
          </TabsList>
          <TabsContent value="logs"><LogViewer id={id} logs={data.logs} title={t('Session log')} newestFirst/></TabsContent>
          <TabsContent value="workloads"><Workloads evidence={data} onInspect={task => setTaskId(task.id)}/></TabsContent>
          {fileOpened && fileMount && <TabsContent value="files" forceMount hidden={activeTab !== 'files'} className={'p-4 ' + styles.filePanel}>
            <GuestFileBrowser key={data.sourceKey + fileMount.id} sourceKey={data.sourceKey} sessionId={fileMount.sessionId}/>
          </TabsContent>}
          {(recoveryOpened || storedMounts.length > 0 || migrationPending || mapMounts.some(m => m.state === 'Migrating')) && <TabsContent value="recovery" forceMount hidden={activeTab !== 'recovery'} className={styles.inset}>
            {mapMounts.map(mount => {
              const key = mountKey(mount)
              const live = mounts.some(item => mountKey(item) === key)
              const migrationSession = migrationForMount(mount, mapMounts, data.instantMigration)
              const unscopedTransfer = !migrationSession && migrationPending
              return <RecoveryMap key={data.sourceKey + key} data={data} mount={mount} refresh={refresh} onMigrationLock={onMigrationLock}
                migrationSession={migrationSession} disabled={!!error || !!stopPhases[key] || !live || jobDone ||
                  unscopedTransfer || session?.state === 'Stopping' || data.mountWarnings.includes(mount.kind)}/>
            })}
            {mounts.filter(m => m.kind !== 'flr' && !isInstantVmMount(m)).map(m => <div key={m.kind + m.id} className={styles.recovery}><h2>{m.name || typeLabel}</h2>
              <RecoveryProperties mount={m}/>{!error && <MountControls key={m.id + m.state} mount={m} sourceKey={data.sourceKey} onAccepted={onAccepted}/>}</div>)}
            {data.canStop && !error && <StopRestore data={data} refresh={refresh}/>}
          </TabsContent>}
          {child && <TabsContent value="application" className={styles.inset}><h2>{t('Application item restores')}</h2>
            {child.data.map(s => <Link className={styles.child} key={s.id} href={link(s.id)}><Files size={17}/><span>{s.name || s.id}</span><Status value={recordStatus(s)}/><ArrowUpRight size={15}/></Link>)}
            {!child.available ? <p>{t('Application item sessions could not be loaded.')}</p> : !child.data.length ? <p>{t('No application item restores have been reported.')}</p> : !child.complete && <p>{t('Partial collection')}</p>}
          </TabsContent>}
        </Tabs>
        {isFile && !fileMount && !data.mountWarnings.includes('flr') && <p className={styles.note}>{jobDone || filesUnmounted ? t('This session has no active guest file mount.') : t('Guest files become available when VBR reports a mount.')}</p>}
        {data.mountWarnings.length > 0 && <p className={styles.note}>{t('Some mount records could not be loaded.')}</p>}
        <footer className={ops.panelFoot}>{t('Updated {date}', {date:date(data.updatedAt)})} · <span>{id}</span>
          {related.map(next => <Link className={styles.related} key={next} href={link(next)}>{t('Related session')} <ArrowUpRight size={12}/></Link>)}</footer>
      </section>
    </div>}
    <Dialog open={!!taskId} onOpenChange={open => {if (!open) setTaskId(undefined)}}><DialogContent className={investigation.drawer}>
      {taskId && data && <TaskDetails sessionId={id} taskId={taskId} refresh={revision} sourceKey={data.sourceKey}/>}</DialogContent></Dialog>
  </main>
}
