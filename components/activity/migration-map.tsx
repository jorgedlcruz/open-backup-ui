'use client'
// Open Backup UI v1.0.2

import { useState } from 'react'
import { HardDrive, Server } from 'lucide-react'
import { migrationTransfer } from '@/lib/activity/instant-vm'
import { migrationHops, migrationSpeed } from '@/lib/activity/migration-plan'
import type { ActivityDetail } from '@/lib/activity/session'
import type { Task } from '@/lib/investigation/model'
import { useInvestigationPresentation } from '@/components/investigation/shared'
import { RecoveryDiagram, RecoveryNode } from './recovery-diagram'
import {MigrationPath, useMigrationTask} from './migration-path'
import styles from './session.module.css'

const phases = {idle:'unknown', pending:'accepted', migrating:'active', succeeded:'completed', warning:'warning', failed:'failed', canceled:'canceled', unknown:'unknown'} as const

function MigrationTaskMap({data, task}: {data: ActivityDetail; task?: Task}) {
  const {t, bytes, notice} = useInvestigationPresentation()
  const {id, sourceKey, session} = data
  const working = !!session && !session.endTime && session.state !== 'Stopped'
  const {plan,proxies,task:detailTask,error}=useMigrationTask(sourceKey,id,task?.id,working)
  const single=data.tasks.available && data.tasks.complete && data.tasks.data.length===1
  const speed=migrationSpeed(session,task,single,data.throughput) ?? (detailTask && migrationSpeed(session,detailTask,single))
  const record = working && session && task?.state ? {...session, id:task.id, state:task.state, endTime:task.endTime,
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
    <RecoveryDiagram label={t('Migration session')} nodes={2+migrationHops(proxies).length}>
      <RecoveryNode kind="machine" label={t('Source VM')} name={task?.name || t('Not reported')} facts={sourceFacts}/>
      <MigrationPath phase={phase} proxies={proxies} speed={speed}/>
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
