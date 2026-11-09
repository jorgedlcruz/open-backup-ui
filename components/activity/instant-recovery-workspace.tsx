'use client'

import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ArrowRight, Box, Check, Database, GripVertical, HardDrive, Layers, MapPin, Plus, Power, Server } from 'lucide-react'
import type { Mount } from '@/lib/activity/model'
import { useInvestigationPresentation } from '@/components/investigation/shared'
import styles from './instant-recovery-workspace.module.css'

export type InstantRecoveryTransfer = {
  phase: 'accepted' | 'active' | 'completed' | 'warning' | 'failed' | 'canceled' | 'unknown'
  percent?: number
  message?: string
  transferredBytes?: number
  totalBytes?: number
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

function ServerUnit() {
  return <span className={styles.serverUnit}><i/><b/></span>
}

function HostArt({production, complete}: {production?: boolean; complete?: boolean}) {
  return <span aria-hidden="true" className={styles.hostArt} data-production={production || undefined}>
    <span className={styles.machineBadge} data-empty={production && !complete || undefined}>
      {production && !complete ? <Plus/> : <Box/>}
    </span>
    <span className={styles.uplink}/>
    <span className={styles.chassis}><ServerUnit/><ServerUnit/></span>
  </span>
}

function RepositoryArt() {
  return <span aria-hidden="true" className={styles.repositoryArt}>
    <i/><i/><i/><span><Database size={15}/></span>
  </span>
}

function Connection({transfer, phase, mountedLabel}: {transfer?: boolean; phase?: InstantRecoveryTransfer['phase']; mountedLabel?: string}) {
  return <div className={styles.connection} data-mounted={!!mountedLabel || undefined} data-transfer={transfer || undefined} data-phase={phase}>
    <span className={styles.strand}><i/></span>
    {phase === 'completed' ? <Check aria-hidden/> : <ArrowRight aria-hidden/>}
    {mountedLabel && <span className={styles.linkLabel}>{mountedLabel}</span>}
  </div>
}

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

  const machine = <><HostArt/>{available && <GripVertical aria-hidden className={styles.grip} size={14}/>}</>
  return <section aria-label={t('Instant Recovery workspace')} className={styles.workspace}>
    <div className={styles.canvas} data-editing={configuring || undefined}>
      <div className={styles.repository}>
        <div className={styles.art}><RepositoryArt/></div>
        <div className={styles.identity}><span className={styles.role}>{t('Source backup')}</span><strong>{evidence?.backupName || missing}</strong></div>
        <dl className={styles.facts}>
          <div><dt><Database/>{t('Backup repository')}</dt><dd>{evidence?.repository || missing}</dd></div>
          {!evidence?.backupName && mount.backup && <div><dt>{t('Backup job')}</dt><dd>{mount.backup}</dd></div>}
          {evidence?.sourceVm && evidence.sourceVm !== vmName && <div><dt>{t('Source VM')}</dt><dd>{evidence.sourceVm}</dd></div>}
          {mount.pointTime && <div><dt><Layers/>{t('Restore point')}</dt><dd>{date(mount.pointTime)}</dd></div>}
        </dl>
      </div>
      <Connection mountedLabel={mount.state === 'Mounted' ? t('Mounted') : undefined}/>
      <div className={styles.machine}>
        {available ? <button type="button" className={styles.dragHandle} aria-label={t('Choose destination for {name}', {name: vmName || t('Virtual machine')})}
          aria-controls={configuring ? formId : undefined} aria-expanded={!!configuring} aria-describedby={helperId} draggable
          onDragStart={dragStart} onDragEnd={() => {setDragging(false); setOverTarget(false)}} onClick={configure}>{machine}</button> :
          <div className={styles.art}>{machine}</div>}
        <div className={styles.identity}><span className={styles.role}>{t('Recovered VM')}</span><strong>{vmName || missing}</strong></div>
        <div className={styles.power} data-power={power}><Power size={12} aria-hidden/>{powerLabel}</div>
        <dl className={styles.facts}>
          <div><dt><Server/>{isHyperV ? t('Hyper-V host') : t('ESXi host')}</dt><dd>{host || missing}</dd></div>
          {evidence?.cluster && <div><dt><Layers/>{t('Cluster')}</dt><dd>{evidence.cluster}</dd></div>}
          {evidence?.writeCache && <div><dt><HardDrive/>{t('Write cache')}</dt><dd>{evidence.writeCache}</dd></div>}
        </dl>
      </div>
      <Connection transfer phase={transfer?.phase}/>
      <div className={styles.destination} data-enabled={available || undefined} data-dragging={dragging || undefined}
        data-over={overTarget || undefined} data-configuring={configuring || undefined} onDragOver={dragOver}
        onDragLeave={event => {if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOverTarget(false)}}
        onDrop={drop}>
        {!configuring && <div className={styles.art}><HostArt production complete={transfer?.phase === 'completed' || transfer?.phase === 'warning'}/></div>}
        <div className={styles.identity}><span className={styles.role}>{t('Production destination')}</span>
          {!configuring && <strong>{destination?.host || (available ? t('Drop the VM here') : missing)}</strong>}</div>
        {!configuring && (destination?.datastore || transfer) && <dl className={styles.facts}><div><dt><HardDrive/>{t('Destination datastore')}</dt><dd>{destination?.datastore || missing}</dd></div></dl>}
        {available && !configuring && <button type="button" className={styles.choose} onClick={configure} aria-expanded={false}>
          <MapPin size={14} aria-hidden/>{t('Choose destination')}<ArrowRight size={13} aria-hidden/></button>}
        {configuring && <div className={styles.form} tabIndex={-1} role="region" id={formId} ref={form} aria-label={t('Production destination')}>{children}</div>}
      </div>
    </div>
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
  </section>
}
