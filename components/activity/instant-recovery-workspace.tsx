'use client'
// Open Backup UI v1.0.2

import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ArrowRight, Database, GripVertical, HardDrive, Layers, MapPin, Power, Server } from 'lucide-react'
import type { Mount } from '@/lib/activity/model'
import {migrationHops, type MigrationProxies, type MigrationSpeed} from '@/lib/activity/migration-plan'
import {MigrationPath} from './migration-path'
import { useInvestigationPresentation } from '@/components/investigation/shared'
import { RecoveryConnector, RecoveryDiagram, RecoveryHostArt, RecoveryNode, type RecoveryFact, type RecoveryPhase } from './recovery-diagram'
import styles from './instant-recovery-workspace.module.css'

export type InstantRecoveryTransfer = {
  phase: RecoveryPhase
  percent?: number
  message?: string
  transferredBytes?: number
  totalBytes?: number
  proxies?: MigrationProxies
  speed?: MigrationSpeed
}

type WorkspaceProps = {
  mount: Mount
  destination?: {host?: string; datastore?: string}
  transfer?: InstantRecoveryTransfer
  canConfigure?: boolean
  configuring?: boolean
  onConfigure?: () => void
  children?: ReactNode
}

const dragType = 'application/x-open-backup-ui-instant-vm'

export function InstantRecoveryWorkspace({mount, destination, transfer, canConfigure, configuring, onConfigure, children}: WorkspaceProps) {
  const { t, date, bytes, formatNumber } = useInvestigationPresentation()
  const [dragging, setDragging] = useState(false)
  const [overTarget, setOverTarget] = useState(false)
  const formId = useId(), helperId = useId()
  const form = useRef<HTMLDivElement>(null)
  const requestedFocus = useRef(false)
  const evidence = mount.instantVm
  const available = !!canConfigure && !!onConfigure
  const missing = t('Not reported')
  const host = evidence ? evidence.host : mount.host
  const isHyperV = mount.kind === 'hyperV'
  const vmName = mount.name || evidence?.targetName
  const power = evidence?.powerState
  const powerLabel = power === 'PoweredOn' ? t('Powered on') : power === 'PoweredOff' ? t('Powered off') :
    power === 'Suspended' ? t('Suspended') : t('VM power unknown')
  const dropKey = JSON.stringify([mount.sessionId, mount.id])
  const percent = transfer?.percent
  const reportedPercent = typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : undefined
  const transferred = transfer?.transferredBytes, total = transfer?.totalBytes
  const phaseLabel = transfer && {
    checking: t('VBR is checking the migration.'),
    accepted: t('Migration requested'), active: t('Transfer in progress'), completed: t('Migration completed'),
    warning: t('Migration completed with warnings'), failed: t('Migration failed'), canceled: t('Migration canceled'),
    unknown: t('Migration status unavailable'),
  }[transfer.phase]

  useEffect(() => {
    if (configuring && requestedFocus.current) {
      form.current?.focus()
      requestedFocus.current = false
    }
  }, [configuring])

  function configure() {
    if (!available) return
    if (configuring) {
      form.current?.focus()
      return
    }
    requestedFocus.current = true
    onConfigure?.()
  }

  function dragStart(event: DragEvent<HTMLButtonElement>) {
    if (!available) return event.preventDefault()
    event.dataTransfer.setData(dragType, dropKey)
    event.dataTransfer.effectAllowed = 'move'
    setDragging(true)
  }

  function dragOver(event: DragEvent<HTMLDivElement>) {
    if (!dragging || !available || !event.dataTransfer.types.includes(dragType)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setOverTarget(true)
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    if (!dragging || !available || !event.dataTransfer.types.includes(dragType)) return
    event.preventDefault()
    setOverTarget(false)
    setDragging(false)
    if (event.dataTransfer.getData(dragType) === dropKey) configure()
  }

  const sourceFacts: RecoveryFact[] = [{label:t('Backup repository'), value:evidence?.repository || missing, icon:Database}]
  if (!evidence?.backupName && mount.backup) sourceFacts.push({label:t('Backup job'),value:mount.backup})
  if (evidence?.sourceVm && evidence.sourceVm !== vmName) sourceFacts.push({label:t('Source VM'),value:evidence.sourceVm})
  if (mount.pointTime) sourceFacts.push({label:t('Restore point'),value:date(mount.pointTime),icon:Layers})
  const vmFacts: RecoveryFact[] = [{label:isHyperV ? t('Hyper-V host') : t('ESXi host'),value:host || missing,icon:Server}]
  if (evidence?.cluster) vmFacts.push({label:t('Cluster'),value:evidence.cluster,icon:Layers})
  if (evidence?.writeCache) vmFacts.push({label:t('Write cache'),value:evidence.writeCache,icon:HardDrive})
  const destinationName = destination?.host || (destination?.datastore ? undefined : !transfer && available ? t('Drop the VM here') : missing)
  const footer = <>
    {available && <span id={helperId} className={styles.srOnly}>{t('Drag the VM here or choose a destination.')}</span>}
    {transfer && <div className={styles.transfer} data-phase={transfer.phase}>
      <div className={styles.transferHeading}><span className={styles.transferState} role="status"><i aria-hidden/>{phaseLabel}</span>
        {reportedPercent != null && <strong>{formatNumber(reportedPercent / 100, {style:'percent', maximumFractionDigits:1})}</strong>}</div>
      {reportedPercent != null && <progress aria-label={t('Migration progress')} value={reportedPercent} max={100}/>}
      {typeof transferred === 'number' && Number.isFinite(transferred) && transferred >= 0 && <div className={styles.transferDetail}>
        {t('Transferred')} · {bytes(transferred)}{typeof total === 'number' && Number.isFinite(total) && total >= transferred && <> / {bytes(total)}</>}
      </div>}
      {transfer.message && <div className={styles.transferDetail}>{transfer.message}</div>}
    </div>}
  </>
  const proxies=transfer?.proxies ?? {}
  return <RecoveryDiagram label={t('Instant Recovery workspace')} nodes={3+migrationHops(proxies).length} editing={configuring} footer={footer}>
    <RecoveryNode kind="repository" label={t('Source backup')} name={evidence?.backupName || missing} facts={sourceFacts}/>
    <RecoveryConnector mounted={mount.state === 'Mounted'} label={mount.state === 'Mounted' ? t('Mounted') : undefined}/>
    <RecoveryNode kind="machine" label={t('Recovered VM')} name={vmName || missing} facts={vmFacts}
      artwork={available ? <button type="button" className={styles.dragHandle} aria-label={t('Choose destination for {name}', {name:vmName || t('Virtual machine')})}
        aria-controls={configuring ? formId : undefined} aria-expanded={!!configuring} aria-describedby={helperId} draggable
        onDragStart={dragStart} onDragEnd={() => {setDragging(false); setOverTarget(false)}} onClick={configure}>
        <RecoveryHostArt/><GripVertical aria-hidden className={styles.grip} size={14}/></button> : undefined}
      status={<div className={styles.power} data-power={power}><Power size={12} aria-hidden/>{powerLabel}</div>}/>
    <MigrationPath phase={transfer?.phase} proxies={proxies} speed={transfer?.speed}/>
    <RecoveryNode kind="destination" phase={transfer?.phase} label={t('Production destination')} name={configuring ? undefined : destinationName}
      facts={!configuring && destination?.datastore ? [{label:t('Destination datastore'),value:destination.datastore,icon:HardDrive,primary:!destination.host}] : undefined}
      available={available} editing={configuring} data-dragging={dragging || undefined} data-over={overTarget || undefined} onDragOver={dragOver}
      onDragLeave={event => {if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOverTarget(false)}}
      onDrop={drop}>
      {available && !configuring && <button type="button" className={styles.choose} onClick={configure} aria-expanded={false}>
        <MapPin size={14} aria-hidden/>{t('Choose destination')}<ArrowRight size={13} aria-hidden/></button>}
      {configuring && <div className={styles.form} tabIndex={-1} role="region" id={formId} ref={form} aria-label={t('Production destination')}>{children}</div>}
    </RecoveryNode>
  </RecoveryDiagram>
}
