'use client'
// Open Backup UI v1.0.2

import { useEffect, useState } from 'react'
import { HardDrive, Server } from 'lucide-react'
import { veeamApi } from '@/lib/api/veeam-client'
import { ApplicationRequestError } from '@/lib/api/application-request'
import { migrationTransfer } from '@/lib/activity/instant-vm'
import { readMigrationPlan, type MigrationPlan } from '@/lib/activity/migration-plan'
import type { ActivityDetail } from '@/lib/activity/session'
import type { Task } from '@/lib/investigation/model'
import { useInvestigationPresentation } from '@/components/investigation/shared'
import { RecoveryConnector, RecoveryDiagram, RecoveryNode } from './recovery-diagram'
import styles from './session.module.css'

const phases = {idle:'unknown', pending:'accepted', migrating:'active', succeeded:'completed', warning:'warning', failed:'failed', canceled:'canceled', unknown:'unknown'} as const

function MigrationTaskMap({data, task}: {data: ActivityDetail; task?: Task}) {
  const {t, bytes, notice} = useInvestigationPresentation()
  const [plan, setPlan] = useState<MigrationPlan>()
  const [error, setError] = useState('')
  const {id, sourceKey, session} = data
  const taskId = task?.id
  const working = !!session && !session.endTime && session.state !== 'Stopped'
  useEffect(() => {
    if (!taskId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>, running = false, finished = false
    const selectedId = taskId
    async function read() {
      if (document.hidden || controller.signal.aborted || running || finished) return
      running = true
      let retry = working
      try {
        const evidence = await veeamApi.getTaskInvestigation(id, selectedId, controller.signal, sourceKey)
        if (controller.signal.aborted || evidence.task.id !== selectedId || evidence.task.sessionId !== id) return
        const next = readMigrationPlan(evidence.logs.data)
        setPlan(next); setError('')
        if (next) finished = true
      } catch (err) {
        if (controller.signal.aborted) return
        setPlan(undefined)
        setError(err instanceof Error ? err.message : 'Request failed.')
        if (err instanceof ApplicationRequestError && [400,401,403,404,409].includes(err.status)) retry = false
      } finally {running = false}
      if (retry && !finished && !controller.signal.aborted) timer = setTimeout(read, 15000)
    }
    void read()
    function visible() { if (!document.hidden) {clearTimeout(timer); void read()} }
    document.addEventListener('visibilitychange', visible)
    return () => {controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible)}
  }, [id, sourceKey, taskId, working])
  const record = session && task?.state ? {...session, id:task.id, state:task.state, endTime:task.endTime,
    result:task.result, progress:task.progress, progressPercent:task.progress?.progressPercent} : session
  const phase = phases[migrationTransfer(null, record).phase]
  const transferred = task?.progress?.transferredSize ?? (data.tasks.data.length <= 1 ? session?.progress?.transferredSize : undefined)
  const state = {checking:'Migration requested', accepted:'Migration requested', active:'Transfer in progress', completed:'Migration completed',
    warning:'Migration completed with warnings', failed:'Migration failed', canceled:'Migration canceled', unknown:'Migration status unavailable'}[phase]
  const sourceFacts = [
    ...(plan?.sourceHost ? [{label:t('Host'),value:plan.sourceHost,icon:Server}] : []),
    ...(plan?.sources.length ? [{label:t('Datastore'),value:plan.sources.join(', '),icon:HardDrive}] : []),
  ]
  const targetFacts = plan?.targets.length ? [{label:t('Destination datastore'), value:plan.targets.join(', '),icon:HardDrive}] : []
  return <>
    <RecoveryDiagram label={t('Migration session')} nodes={2}>
      <RecoveryNode kind="machine" label={t('Source VM')} name={task?.name || t('Not reported')} facts={sourceFacts}/>
      <RecoveryConnector phase={phase}/>
      <RecoveryNode kind="destination" phase={phase} label={t('Production destination')} name={plan?.targetHost || t('Not reported')} facts={targetFacts}/>
    </RecoveryDiagram>
    <div className={styles.mapStatus}><strong>{t(state)}</strong>
      {typeof transferred === 'number' && transferred >= 0 && <span>{t('Transferred')} · {bytes(transferred)}</span>}</div>
    {error && <p role="alert" className={styles.note}>{notice(error)}</p>}
  </>
}

export function MigrationMap({data}: {data: ActivityDetail}) {
  const {t} = useInvestigationPresentation()
  const [selected, setSelected] = useState('')
  const task = data.tasks.data.find(row => row.id === selected) ?? data.tasks.data[0]
  return <>
    {data.tasks.data.length > 1 && <label className={styles.mapPicker}>{t('Workload')}
      <select value={task?.id || ''} onChange={event => setSelected(event.target.value)}>
        {data.tasks.data.map(row => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}
      </select></label>}
    <MigrationTaskMap key={data.sourceKey + data.id + (task?.id || '')} data={data} task={task}/>
  </>
}
