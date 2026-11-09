'use client'
// Open Backup UI v1.0.2

import { useEffect, useState } from 'react'
import { Box, Database, FileCode2, Folder, HardDrive, Layers, Server } from 'lucide-react'
import { useInvestigationPresentation } from '@/components/investigation/shared'
import { currentRestoreTask, diskPathActive, latestRestoreEvent, restoreDiskPaths, restoreProgress } from '@/lib/activity/entire-restore-progress'
import { veeamApi } from '@/lib/api/veeam-client'
import type { LogRecord, Logs } from '@/lib/investigation/model'
import type { ActivityDetail } from '@/lib/activity/session'
import { RecoveryConnector, RecoveryDiagram, RecoveryNode, type RecoveryFact } from './recovery-diagram'
import styles from './entire-vm-recovery-map.module.css'

type Progress = ReturnType<typeof restoreProgress>

function useTaskFlowLogs(sourceKey: string, sessionId: string, taskId: string | undefined, revision: string) {
  const [snapshot, setSnapshot] = useState<{key:string; logs:Logs} | null>(null)
  const key = taskId && JSON.stringify([sourceKey, sessionId, taskId])
  useEffect(() => {
    if (!taskId || !key) return
    const controller = new AbortController()
    veeamApi.getTaskInvestigation(sessionId, taskId, controller.signal, sourceKey).then(result => {
      if (!controller.signal.aborted) setSnapshot(result.task.id === taskId && result.task.sessionId === sessionId ? {key, logs:result.logs} : null)
    }).catch(() => { if (!controller.signal.aborted) setSnapshot(null) })
    return () => controller.abort()
  }, [sourceKey, sessionId, taskId, key, revision])
  return snapshot?.key === key ? snapshot?.logs : undefined
}

export function EntireVmRecoveryMap({data}: {data: ActivityDetail}) {
  const {t, label, bytes, date, formatNumber} = useInvestigationPresentation()
  const [selection, setSelection] = useState('')
  const [diskSelection, setDiskSelection] = useState<{vm:string; disk:string}>()
  const evidence = data.entireRestore
  const choices = (evidence?.vms || []).map((vm, index) => ({
    key: vm.taskId || JSON.stringify([vm.sourceVm, vm.targetVm, vm.vmConfigFile, index]),
    name: vm.targetVm || vm.sourceVm || vm.vmConfigFile || t('Virtual machine {number}', {number:formatNumber(index + 1)}),
    vm,
  }))
  const selected = choices.find(row => row.key === selection) || choices[0]
  const vm = selected?.vm, multiple = choices.length > 1
  const task = currentRestoreTask(vm?.taskId, data.id, data.tasks.data)
  const overall = restoreProgress(data.session)
  const singleLaunch = choices.length === 1 && !!evidence?.mode
  const object = restoreProgress(task || (singleLaunch ? data.session : undefined))
  const latest = latestRestoreEvent(data.logs.data)
  const singleTask = !!task && !multiple && data.tasks.available && data.tasks.complete && data.tasks.data.length === 1
  const useSessionLog = (singleTask || singleLaunch) && data.logs.available && data.logs.complete
  const taskLogs = useTaskFlowLogs(data.sourceKey, data.id, useSessionLog ? undefined : task?.id, data.updatedAt)
  if (!evidence) return null
  const scoped = useSessionLog ? data.logs : taskLogs
  const records = scoped?.available && scoped.complete ? scoped.data : []
  const paths = restoreDiskPaths(records)
  const latestScoped = useSessionLog ? latest : latestRestoreEvent(records)
  const active = (event?: LogRecord) => diskPathActive(data.session, task, event, latestScoped)
  const disk = paths.find(path => selected?.key === diskSelection?.vm && path.disk === diskSelection?.disk) ||
    paths.find(path => active(path.event)) || paths[0]
  const transferring = active(disk ? disk.event : latestScoped)
  const phase = transferring ? 'active' : object.phase
  const connectorPhase = phase === 'accepted' ? undefined : phase
  const missing = t('Not reported')
  const status = (p: Progress) => {
    switch (p.phase) {
      case 'completed': return t('Restore completed')
      case 'warning': return t('Restore completed with warnings')
      case 'failed': return t('Restore failed')
      case 'canceled': return t('Restore canceled')
      case 'accepted': return t('Restore in progress')
      default: return p.state ? label(p.state) : t('Status unavailable')
    }
  }
  const percent = (n: number) => formatNumber(n / 100, {style:'percent', maximumFractionDigits:1})
  const source: RecoveryFact[] = [], target: RecoveryFact[] = []
  if (vm?.backupName && vm.repository) source.push({label:t('Backup repository'), value:vm.repository, icon:Database})
  if (vm?.sourceVm && (vm.backupName || vm.repository)) source.push({label:t('Source VM'), value:vm.sourceVm, icon:Box})
  if (vm?.pointTime) source.push({label:t('Restore point'), value:date(vm.pointTime), icon:Layers})
  if (vm?.host) target.push({label:t('Destination host'), value:vm.host, icon:Server})
  if (vm?.datastore) target.push({label:t('Destination datastore'), value:vm.datastore, icon:HardDrive})
  if (vm?.storagePath) target.push({label:t('Storage path'), value:vm.storagePath, icon:Folder})
  if (vm?.vmConfigFile && vm.targetVm) target.push({label:t('VM configuration'), value:vm.vmConfigFile, icon:FileCode2})
  const sourceRole = vm?.backupName ? t('Source backup') : vm?.repository ? t('Backup repository') : vm?.sourceVm ? t('Source VM') : t('Source backup')
  const targetName = vm?.targetVm || vm?.vmConfigFile || (evidence.mode === 'OriginalLocation' ? t('Original location') : missing)
  const latestVisible = latest?.title && ['checking','accepted'].includes(overall.phase)
  const taskVisible = !!task && (multiple || object.phase !== overall.phase || (object.percent != null && object.percent !== overall.percent))
  const footer = <div className={styles.summary} data-phase={overall.phase}>
    <div className={styles.status}>
      <span>{t('Restore progress')}</span><strong role="status">{status(overall)}</strong>
      {overall.percent != null && <b>{percent(overall.percent)}</b>}
    </div>
    {overall.percent != null && <progress className={styles.bar} aria-label={t('Restore progress')} max={100} value={overall.percent}/>}
    {overall.transferred != null && <div className={styles.detail}>{t('Transferred')} · {bytes(overall.transferred)}</div>}
    {latestVisible && <div className={styles.detail}><span>{t('Latest event')}</span> · {latest.title}</div>}
  </div>
  return <div className={styles.map}>
    {multiple && <label className={styles.picker}>
      <span>{t('Virtual machine')}</span>
      <select value={selected.key} onChange={event => setSelection(event.target.value)}>
        {choices.map(row => <option key={row.key} value={row.key}>{row.name}</option>)}
      </select>
    </label>}
    {paths.length > 1 && disk && selected && <label className={styles.picker}>
      <span>{t('Disk')}</span><select value={disk.disk} onChange={event => setDiskSelection({vm:selected.key,disk:event.target.value})}>
        {paths.map(path => <option key={path.disk}>{path.disk}</option>)}
      </select>
    </label>}
    <RecoveryDiagram label={t('Entire VM restore')} nodes={disk?.proxy ? 3 : 2} footer={footer}>
      <RecoveryNode kind="repository" label={sourceRole} name={vm?.backupName || vm?.repository || vm?.sourceVm || missing} facts={source}/>
      <RecoveryConnector phase={connectorPhase} io={disk?.proxy ? 'read' : undefined} label={disk?.proxy ? t('Read') : disk ? t('Disk transfer') : undefined}/>
      {disk?.proxy && <>
        <RecoveryNode kind="proxy" label={t('Backup proxy')} name={disk.proxy} facts={[{label:t('Disk'), value:disk.disk, icon:HardDrive}]}/>
        <RecoveryConnector phase={connectorPhase} io="write" label={t('Write')}/>
      </>}
      <RecoveryNode kind="destination" phase={connectorPhase}
        label={!vm?.targetVm && vm?.vmConfigFile ? t('VM configuration') : t('Destination VM')} name={targetName} facts={target}>
        {taskVisible && <div className={styles.task}><span>{t('VM task')}</span><strong>{status(object)}</strong>
          {object.percent != null && <b>{percent(object.percent)}</b>}
          {object.transferred != null && <span>{t('Transferred')} · {bytes(object.transferred)}</span>}
        </div>}
      </RecoveryNode>
    </RecoveryDiagram>
  </div>
}
